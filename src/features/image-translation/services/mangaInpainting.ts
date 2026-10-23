/**
 * @file src/features/image-translation/services/mangaInpainting.ts
 * 文件职责：用按需加载的本地 LaMa 漫画模型修补复杂背景上的原字形，保留气泡之外和蒙版之外的原始像素。
 * 主要内容：共享本次原图背景分类，按识别行及其有界描边余量建立局部蒙版，截取有上下文且最长边不超过 512 的有界补丁，归一化 ONNX 张量并仅回写蒙版区域；融合 ONNX 执行图，兼容的硬件 GPU 加速修补、设备失效有界切换 CPU；独立 Worker 串行推理、70% 计算时间预算、滚动取消保留模型端口并由 owner 有界收尾，三分钟空闲释放约束资源。
 * 模块边界：不读取网页 DOM、不上传图像、不翻译文字；均匀气泡无需加载模型，最后的译文排版由 mangaRendering 处理，模型生成内容始终局限于检测文字蒙版。
 */
import {localWasmThreads, paceLocalInference} from '@/src/shared/onnx/resources';
import {mangaInferenceClient, mangaExtensionUrl, type MangaPatch} from './mangaInferenceClient';
import {probeWebGpu} from '@/src/shared/onnx/webgpu';
import {protectMangaSession} from './mangaSessionFallback';
import {configureOnnxWasmBackend} from '@/src/shared/onnx/wasmBinary';
import {assertMangaOcrActive, loadMangaInpaintAsset, MANGA_INPAINT_ASSET, withMangaModelAdmission} from './mangaOcrAssets';
import {mangaRegionBackground, type MangaBackground} from './mangaRendering';
import type {MangaRegion} from './mangaRegions';
import {mangaMaskBoxes as maskBoxes} from '../mangaPatchResult';

export type {MangaPatch} from './mangaInferenceClient';
interface PatchMapping {patch: MangaPatch; left: number; top: number; sourceWidth: number; sourceHeight: number}
interface InpaintPort {run(patch: MangaPatch, signal?:AbortSignal, progress?:(percent?:number,initializing?:boolean)=>void): Promise<Float32Array>; release(): Promise<void>}

/** 识别框已有字形留白，蒙版按原始行分别构造，避免把整个段落之间的画面也擦除。 */
export function createMangaPatch(pixels: Uint8ClampedArray, width: number, height: number, region: MangaRegion): PatchMapping {
    const box = region.bbox, padding = Math.max(24, Math.round(region.fontSize));
    const left = Math.max(0, Math.floor(box.x0) - padding), top = Math.max(0, Math.floor(box.y0) - padding);
    const sourceWidth = Math.min(width, Math.ceil(box.x1) + padding) - left;
    const sourceHeight = Math.min(height, Math.ceil(box.y1) + padding) - top;
    const scale = Math.min(1, 512 / Math.max(sourceWidth, sourceHeight));
    const patchWidth = Math.max(64, Math.ceil(sourceWidth * scale / 64) * 64);
    const patchHeight = Math.max(64, Math.ceil(sourceHeight * scale / 64) * 64);
    const count = patchWidth * patchHeight;
    const image = new Float32Array(count * 3), mask = new Float32Array(count);
    const boxes = maskBoxes(region,width,height);
    for (let y = 0; y < patchHeight; y += 1) for (let x = 0; x < patchWidth; x += 1) {
        const sx = left + Math.min(sourceWidth - 1, Math.floor(x * sourceWidth / patchWidth));
        const sy = top + Math.min(sourceHeight - 1, Math.floor(y * sourceHeight / patchHeight));
        const input = (sy * width + sx) * 4, output = y * patchWidth + x;
        for (let channel = 0; channel < 3; channel += 1) image[channel * count + output] = pixels[input + channel] / 255;
        if (boxes.some(line => sx >= line.x0 && sx < line.x1 && sy >= line.y0 && sy < line.y1)) mask[output] = 1;
    }
    return {patch:{image,mask,width:patchWidth,height:patchHeight},left,top,sourceWidth,sourceHeight};
}

/** 只回写字形及描边蒙版内的像素，蒙版以外始终使用原图。 */
export function applyMangaPatch(pixels: Uint8ClampedArray, width: number, region: MangaRegion, mapping: PatchMapping, output: Float32Array): void {
    const {patch,left,top,sourceWidth,sourceHeight} = mapping, count = patch.width * patch.height;
    if (output.length !== count * 3 || !output.every(Number.isFinite)) throw new Error('漫画背景修补结果无效');
    for (const box of maskBoxes(region,width,pixels.length/(width*4))) {
        for (let y = Math.floor(box.y0); y < box.y1; y += 1) for (let x = Math.floor(box.x0); x < box.x1; x += 1) {
            const px = Math.min(patch.width-1, Math.floor((x-left) * patch.width / sourceWidth));
            const py = Math.min(patch.height-1, Math.floor((y-top) * patch.height / sourceHeight));
            const sample = py * patch.width + px, destination = (y * width + x) * 4;
            for (let channel = 0; channel < 3; channel += 1) pixels[destination+channel] = Math.round(Math.max(0,Math.min(1,output[channel*count+sample]))*255);
        }
    }
}

export function createMangaInpaintingRuntime(create: (signal?: AbortSignal,progress?:(percent?:number,initializing?:boolean)=>void) => Promise<InpaintPort>) {
    let service: InpaintPort | undefined, idle: ReturnType<typeof setTimeout> | undefined;
    let tail: Promise<void> = Promise.resolve();
    function queue<T>(operation:()=>Promise<T>) {const result=tail.then(operation);tail=result.then(()=>undefined,()=>undefined);return result;}
    async function release() {clearTimeout(idle);idle=undefined;const current=service;service=undefined;await current?.release();}
    return {
        repair(pixels:Uint8ClampedArray,width:number,height:number,regions:MangaRegion[],signal?:AbortSignal,onPreparing?:(percent?:number,initializing?:boolean)=>void,onRepair?:(done:number,total:number)=>void,backgrounds?:MangaBackground[]) {
            return withMangaModelAdmission(() => queue(async()=>{
                assertMangaOcrActive(signal); clearTimeout(idle);
                try {
                    return await (async () => {
                        const result = new Uint8ClampedArray(pixels);
                        const pending = regions.filter((region,index) => !(backgrounds?.[index] ?? mangaRegionBackground(pixels,width,height,region.bbox)).uniform);
                        let completed = 0;
                        for (const region of pending) {
                            assertMangaOcrActive(signal);
                            if (!service) {onPreparing?.();service=await create(signal,onPreparing);}
                            assertMangaOcrActive(signal);
                            onRepair?.(completed,pending.length);
                            const mapping=createMangaPatch(pixels,width,height,region);
                            const output=await service.run(mapping.patch,signal,onPreparing);
                            assertMangaOcrActive(signal);applyMangaPatch(result,width,region,mapping,output);
                            completed++;onRepair?.(completed,pending.length);
                        }
                        return result;
                    })().catch(async error => {
                        if (signal?.aborted && (error as Error | undefined)?.name === 'AbortError') throw error;
                        const current=service;service=undefined;
                        await Promise.resolve().then(()=>current?.release()).catch(()=>undefined);
                        throw error;
                    });
                } finally {idle=setTimeout(()=>{void queue(release).catch(()=>undefined);},180000);}
            }));
        },
        dispose:()=>queue(release),
    };
}

export async function createBrowserMangaInpainter(signal?:AbortSignal,progress?:(percent?:number,initializing?:boolean)=>void):Promise<InpaintPort> {
    let lastPercent = -1;
    const model=await loadMangaInpaintAsset(signal,bytes=>{
        const percent=Math.min(99,Math.floor(bytes*100/MANGA_INPAINT_ASSET.bytes));
        if(percent!==lastPercent){lastPercent=percent;progress?.(percent);}
    });assertMangaOcrActive(signal);progress?.(undefined,true);
    const ort=await import('onnxruntime-web/webgpu');ort.env.wasm.numThreads=localWasmThreads();
    configureOnnxWasmBackend(ort.env.wasm,{mjs:mangaExtensionUrl('/fluent-read-ai/ort-wasm-simd-threaded.asyncify.mjs'),wasm:mangaExtensionUrl('/fluent-read-ai/ort-wasm-simd-threaded.asyncify.wasm')});
    const gpu=await probeWebGpu();
    let activeSignal=signal;
    let usingGpu=gpu.available;
    const session=await ort.InferenceSession.create(model,{executionProviders:usingGpu?['webgpu','wasm']:['wasm'],graphOptimizationLevel:'all'}).catch(error=>{
        assertMangaOcrActive(signal);
        if(!usingGpu)throw error;
        usingGpu=false;
        return ort.InferenceSession.create(model,{executionProviders:['wasm'],graphOptimizationLevel:'all'});
    });
    if(usingGpu)protectMangaSession(session,async()=>{
        assertMangaOcrActive(activeSignal);
        const bytes=await loadMangaInpaintAsset(activeSignal);assertMangaOcrActive(activeSignal);
        const cpu=await ort.InferenceSession.create(bytes,{executionProviders:['wasm'],graphOptimizationLevel:'all'});
        try {assertMangaOcrActive(activeSignal);}catch(error){await Promise.resolve().then(()=>cpu.release()).catch(()=>undefined);throw error;}
        return cpu;
    },()=>activeSignal);
    try {assertMangaOcrActive(signal);} catch(error) {await Promise.resolve().then(()=>session.release()).catch(()=>undefined);throw error;}
    return {run:async (patch,runSignal)=>{
        activeSignal=runSignal;
        const image=new ort.Tensor('float32',patch.image,[1,3,patch.height,patch.width]);
        const mask=new ort.Tensor('float32',patch.mask,[1,1,patch.height,patch.width]);
        let output:Awaited<ReturnType<typeof session.run>>|undefined;
        try {output=await paceLocalInference(()=>session.run({image,mask}));return new Float32Array(output.inpainted.data as Float32Array);}
        finally {image.dispose();mask.dispose();Object.values(output||{}).forEach(tensor=>tensor.dispose());}
    },release:()=>session.release()};
}

async function createWorkerMangaInpainter(signal?:AbortSignal, progress?:(percent?:number,initializing?:boolean)=>void):Promise<InpaintPort> {
    const notify = (stage: 'preparing' | 'initializing' | 'recognizing', percent?:number) => progress?.(percent,stage==='initializing');
    await mangaInferenceClient.prepare('inpaint',signal,notify);
    return {run:(patch,runSignal,onPreparing)=>mangaInferenceClient.request({type:'inpaint',patch},runSignal,(stage,percent)=>onPreparing?.(percent,stage==='initializing')),release:()=>mangaInferenceClient.release('inpaint')};
}

export const mangaInpaintingRuntime=createMangaInpaintingRuntime(createWorkerMangaInpainter);
