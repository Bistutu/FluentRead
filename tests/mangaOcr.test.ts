vi.mock('@/src/shared/onnx/resources', async original => ({...await original<any>(), paceLocalInference: mocks.pace}));
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
const mocks = vi.hoisted(() => ({assets:vi.fn(),remove:vi.fn(),initialize:vi.fn(),recognize:vi.fn(),destroy:vi.fn(),options:vi.fn(),
    gpu:vi.fn(),cpuCreate:vi.fn(),sessions:[] as any[],inpaintDispose:vi.fn(),bitmapClose:vi.fn(),contexts:[] as any[],canvases:[] as any[],
    workerPrepare:vi.fn(),workerRequest:vi.fn(),workerRelease:vi.fn(),workerDispose:vi.fn(),encode:vi.fn(),pace:vi.fn((operation:()=>Promise<unknown>)=>operation()),
    wasm:{numThreads:0,wasmPaths:undefined as unknown,proxy:true}}));
vi.mock('@/src/features/image-translation/services/mangaOcrAssets', async importOriginal => ({...await importOriginal<any>(),loadMangaOcrAssets:mocks.assets,removeMangaOcrAssets:mocks.remove}));
vi.mock('onnxruntime-web/webgpu',()=>({env:{wasm:mocks.wasm},InferenceSession:{create:mocks.cpuCreate}}));
vi.mock('@/src/shared/onnx/webgpu',()=>({probeWebGpu:mocks.gpu}));
vi.mock('ppu-paddle-ocr/web',()=>({PaddleOcrService:class{constructor(options:unknown){mocks.options(options)}detectionSession=mocks.sessions[0];recognitionSession=mocks.sessions[1];async initialize(){return mocks.initialize();}recognize=mocks.recognize;destroy=mocks.destroy;}}));
vi.mock('@/src/features/image-translation/services/mangaInpainting',()=>({mangaInpaintingRuntime:{dispose:mocks.inpaintDispose}}));
vi.mock('@/src/features/image-translation/services/mangaInferenceClient',async original=>({...await original<any>(),mangaInferenceClient:{prepare:mocks.workerPrepare,request:mocks.workerRequest,release:mocks.workerRelease,dispose:mocks.workerDispose}}));
vi.mock('@/src/features/image-translation/services/imageEncoding',()=>({encodeImageCanvas:mocks.encode}));
import {createBrowserMangaOcr, createMangaOcrRuntime, mangaOcrRuntime, removeMangaModels, disposeMangaModels} from '@/src/features/image-translation/services/mangaOcr';
const opaquePixels=()=>{const pixels=new Uint8ClampedArray(200*200*4);for(let index=3;index<pixels.length;index+=4)pixels[index]=255;return pixels;};
const response = {results:[{text:'Hello world',confidence:0.99,box:{x:10,y:10,width:100,height:20}}]};
const deferred = <T,>() => {let resolve!:(v:T)=>void,reject!:(e:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const tick = async () => {for(let i=0;i<6;i++)await Promise.resolve()};
beforeEach(()=>{vi.useFakeTimers();vi.clearAllMocks();mocks.contexts=[];mocks.canvases=[];mocks.sessions=[];mocks.gpu.mockResolvedValue({available:false,info:''});mocks.assets.mockResolvedValue({charactersDictionary:new ArrayBuffer(4)});mocks.initialize.mockResolvedValue(undefined);mocks.destroy.mockResolvedValue(undefined);mocks.remove.mockResolvedValue(undefined);mocks.inpaintDispose.mockResolvedValue(undefined);mocks.recognize.mockResolvedValue(response);vi.stubGlobal('GPUDevice',class{get adapterInfo(){return {};}});vi.stubGlobal('chrome',{runtime:{getURL:(p:string)=>'chrome-extension://test'+p}});vi.stubGlobal('fetch',vi.fn(async()=>new Response(new Uint8Array([1,2,3]))));
    mocks.workerPrepare.mockReset().mockResolvedValue(undefined);mocks.workerRequest.mockReset().mockResolvedValue(response);mocks.workerRelease.mockReset().mockResolvedValue(undefined);mocks.encode.mockReset().mockResolvedValue('data:image/png;base64,rasterized');
    vi.stubGlobal('createImageBitmap',vi.fn(async()=>({width:200,height:200,close:mocks.bitmapClose})));
    vi.stubGlobal('document',{createElement:vi.fn(()=>{const ctx={drawImage:vi.fn(),fillRect:vi.fn(),putImageData:vi.fn(),getImageData:vi.fn(()=>({data:opaquePixels()}))};const canvas={width:0,height:0,getContext:vi.fn(()=>ctx)};mocks.contexts.push(ctx);mocks.canvases.push(canvas);return canvas;})});
});
afterEach(async()=>{await mangaOcrRuntime.dispose().catch(()=>undefined);vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks()});

describe('漫画本地神经 OCR 会话',()=>{
    it.each([
        'data:image/svg+xml;base64,PHN2Zy8+',
        'data:IMAGE/SVG+XML;base64,PHN2Zy8+',
        'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E',
    ])('默认 Worker 将已解码 SVG 栅格化为 PNG 后识别，保留尺寸与借用图片：%s',async image=>{
        const controller=new AbortController(),progress=vi.fn(),close=vi.fn();
        const source={naturalWidth:460,naturalHeight:250,width:230,height:125,src:image,close} as unknown as HTMLImageElement;
        mocks.encode.mockImplementationOnce(async(canvas,signal)=>{
            expect(canvas).toMatchObject({width:460,height:250});expect(signal).toBe(controller.signal);
            return 'data:image/png;base64,rasterized';
        });
        expect(await mangaOcrRuntime.recognize(image,'en',460,250,controller.signal,progress,source)).toHaveLength(1);
        expect(mocks.encode).toHaveBeenCalledOnce();expect(mocks.encode.mock.calls[0][0]).toBe(mocks.canvases[0]);
        expect(mocks.contexts[0].drawImage).toHaveBeenCalledWith(source,0,0);
        expect(mocks.workerRequest).toHaveBeenCalledWith({type:'recognize',image:'data:image/png;base64,rasterized'},controller.signal,progress);
        expect(mocks.canvases[0]).toMatchObject({width:0,height:0});
        expect(source).toMatchObject({naturalWidth:460,naturalHeight:250,width:230,height:125,src:image});expect(close).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();expect(createImageBitmap).not.toHaveBeenCalled();expect(mocks.bitmapClose).not.toHaveBeenCalled();
    });

    it.each(['data:image/png;base64,png','data:image/jpeg;base64,jpeg','data:image/webp;base64,webp'])('默认 Worker 直接转发位图，不重复编码：%s',async image=>{
        const controller=new AbortController(),progress=vi.fn();
        const source={naturalWidth:200,naturalHeight:200,src:image} as HTMLImageElement;
        expect(await mangaOcrRuntime.recognize(image,'en',200,200,controller.signal,progress,source)).toHaveLength(1);
        expect(mocks.workerRequest).toHaveBeenCalledWith({type:'recognize',image},controller.signal,progress);
        expect(mocks.encode).not.toHaveBeenCalled();expect(document.createElement).not.toHaveBeenCalled();
        expect(source.src).toBe(image);
    });

    it.each(['context','drawing','encoding'])('默认 Worker 的 SVG 栅格化失败不发送推理，释放画布并保留原错误和图片：%s',async failureStage=>{
        const image='data:image/svg+xml;base64,PHN2Zy8+';
        const source={naturalWidth:460,naturalHeight:250,src:image} as HTMLImageElement;
        const failure=new Error('SVG '+failureStage+' failed');
        const canvasFactory=vi.mocked(document.createElement).getMockImplementation()!;
        vi.mocked(document.createElement).mockImplementationOnce(()=>{
            const canvas=canvasFactory('canvas');
            if(failureStage==='context') vi.mocked((canvas as HTMLCanvasElement).getContext).mockReturnValue(null);
            if(failureStage==='drawing') mocks.contexts.at(-1).drawImage.mockImplementationOnce(()=>{throw failure;});
            return canvas;
        });
        if(failureStage==='encoding') mocks.encode.mockRejectedValueOnce(failure);
        const pending=mangaOcrRuntime.recognize(image,'en',460,250,undefined,undefined,source);
        if(failureStage==='context') await expect(pending).rejects.toThrow('浏览器不支持');
        else await expect(pending).rejects.toBe(failure);
        expect(mocks.workerRequest).not.toHaveBeenCalled();expect(mocks.canvases[0]).toMatchObject({width:0,height:0});
        expect(mocks.encode).toHaveBeenCalledTimes(failureStage==='encoding'?1:0);
        expect(source.src).toBe(image);expect(mocks.bitmapClose).not.toHaveBeenCalled();
    });

    it('默认 Worker 在 SVG 编码期间取消，丢弃迟到 PNG 并释放画布，暖端口仍可复用',async()=>{
        const image='data:image/svg+xml;base64,PHN2Zy8+',controller=new AbortController(),pending=deferred<string>();
        const source={naturalWidth:460,naturalHeight:250,src:image} as HTMLImageElement;
        mocks.encode.mockReturnValueOnce(pending.promise);
        const recognition=mangaOcrRuntime.recognize(image,'en',460,250,controller.signal,undefined,source);
        await tick();expect(mocks.encode).toHaveBeenCalledWith(mocks.canvases[0],controller.signal);
        expect(mocks.workerRequest).not.toHaveBeenCalled();
        const cancelled=expect(recognition).rejects.toMatchObject({name:'AbortError'});
        controller.abort();await cancelled;
        pending.resolve('data:image/png;base64,late');await tick();
        expect(mocks.workerRequest).not.toHaveBeenCalled();expect(mocks.canvases[0]).toMatchObject({width:0,height:0});
        expect(mocks.workerRelease).not.toHaveBeenCalled();expect(source.src).toBe(image);
        expect(await mangaOcrRuntime.recognize('data:image/png;base64,next','en',200,200)).toHaveLength(1);
        expect(mocks.workerRequest).toHaveBeenCalledWith({type:'recognize',image:'data:image/png;base64,next'},undefined,undefined);
        expect(mocks.workerPrepare).toHaveBeenCalledOnce();
    });

    it('默认 Worker 在 SVG 编码报告取消时释放画布，保留调用方图片且不转发推理',async()=>{
        const image='data:image/svg+xml;base64,PHN2Zy8+',controller=new AbortController();
        const source={naturalWidth:460,naturalHeight:250,src:image} as HTMLImageElement;
        mocks.encode.mockImplementationOnce(async()=>{controller.abort();throw new DOMException('cancelled','AbortError');});
        await expect(mangaOcrRuntime.recognize(image,'en',460,250,controller.signal,undefined,source)).rejects.toMatchObject({name:'AbortError'});
        await tick();expect(mocks.workerRequest).not.toHaveBeenCalled();expect(mocks.workerRelease).not.toHaveBeenCalled();
        expect(mocks.canvases[0]).toMatchObject({width:0,height:0});expect(source.src).toBe(image);
    });

    it('默认 Worker 代理转发图片、取消信号与阶段，复用端口并在空闲后释放',async()=>{
        const controller=new AbortController(),progress=vi.fn();
        mocks.workerPrepare.mockImplementationOnce(async(kind,signal,notify)=>{
            expect(kind).toBe('ocr');expect(signal).toBe(controller.signal);
            notify('preparing',35);notify('initializing');
        });
        mocks.workerRequest.mockImplementationOnce(async(_message,_signal,notify)=>{notify('recognizing',72);return response;});
        expect(await mangaOcrRuntime.recognize('first','en',200,200,controller.signal,progress)).toHaveLength(1);
        expect(mocks.workerRequest).toHaveBeenCalledWith({type:'recognize',image:'first'},controller.signal,progress);
        expect(progress.mock.calls).toEqual([['preparing',0],['preparing',35],['initializing'],['recognizing'],['recognizing',72]]);
        await mangaOcrRuntime.recognize('second','en',200,200);
        expect(mocks.workerPrepare).toHaveBeenCalledOnce();
        expect(mocks.workerRequest).toHaveBeenLastCalledWith({type:'recognize',image:'second'},undefined,undefined);
        expect(mocks.assets).not.toHaveBeenCalled();expect(mocks.initialize).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();expect(createImageBitmap).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(179999);expect(mocks.workerRelease).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);expect(mocks.workerRelease).toHaveBeenCalledWith('ocr');
        await mangaOcrRuntime.recognize('third','en',200,200);expect(mocks.workerPrepare).toHaveBeenCalledTimes(2);
        await mangaOcrRuntime.dispose();expect(mocks.workerRelease.mock.calls).toEqual([['ocr'],['ocr']]);
    });

    it('默认 Worker 准备或识别失败后可重新创建，释放失败保留原推理错误',async()=>{
        mocks.workerPrepare.mockRejectedValueOnce(new Error('worker prepare failed'));
        await expect(mangaOcrRuntime.recognize('download','en',200,200)).rejects.toThrow('worker prepare failed');
        expect(mocks.workerRequest).not.toHaveBeenCalled();expect(mocks.workerRelease).not.toHaveBeenCalled();
        mocks.workerRequest.mockRejectedValueOnce(new Error('worker inference failed'));
        mocks.workerRelease.mockRejectedValueOnce(new Error('worker release failed'));
        await expect(mangaOcrRuntime.recognize('failed','en',200,200)).rejects.toThrow('worker inference failed');
        expect(mocks.workerRelease).toHaveBeenCalledWith('ocr');
        expect(await mangaOcrRuntime.recognize('retry','en',200,200)).toHaveLength(1);
        expect(mocks.workerPrepare).toHaveBeenCalledTimes(3);
        await removeMangaModels();
        expect(mocks.workerRelease).toHaveBeenCalledTimes(2);expect(mocks.remove).toHaveBeenCalledOnce();
    });

    it('默认 Worker 排队取消不转发新请求，运行中取消丢弃迟到结果并保留暖模型端口',async()=>{
        const pending=deferred<typeof response>(),controller=new AbortController(),queuedController=new AbortController();
        mocks.workerRequest.mockReturnValueOnce(pending.promise);
        const first=mangaOcrRuntime.recognize('active','en',200,200,controller.signal);
        await tick();expect(mocks.workerRequest).toHaveBeenCalledWith({type:'recognize',image:'active'},controller.signal,undefined);
        const queued=mangaOcrRuntime.recognize('queued','en',200,200,queuedController.signal);
        const queuedCancelled=expect(queued).rejects.toMatchObject({name:'AbortError'});
        queuedController.abort();await queuedCancelled;expect(mocks.workerRequest).toHaveBeenCalledOnce();
        const cancelled=expect(first).rejects.toMatchObject({name:'AbortError'});
        controller.abort();await cancelled;expect(mocks.workerRelease).not.toHaveBeenCalled();
        pending.resolve(response);await tick();
        expect(mocks.workerRelease).not.toHaveBeenCalled();expect(mocks.workerRequest).toHaveBeenCalledOnce();
        expect(await mangaOcrRuntime.recognize('retry','en',200,200)).toHaveLength(1);
        expect(mocks.workerPrepare).toHaveBeenCalledOnce();
        await mangaOcrRuntime.dispose();expect(mocks.workerRelease).toHaveBeenCalledWith('ocr');
    });

    it('Worker 正常取消错误不释放暖端口，页面销毁与模型删除硬清理共享 Worker',async()=>{
        const controller=new AbortController();
        mocks.workerRequest.mockImplementationOnce(async()=>{controller.abort();throw new DOMException('cancelled','AbortError');});
        await expect(mangaOcrRuntime.recognize('old','en',200,200,controller.signal)).rejects.toMatchObject({name:'AbortError'});
        expect(mocks.workerRelease).not.toHaveBeenCalled();
        expect(await mangaOcrRuntime.recognize('next','en',200,200)).toHaveLength(1);
        expect(mocks.workerPrepare).toHaveBeenCalledOnce();
        disposeMangaModels();expect(mocks.workerDispose).toHaveBeenCalledOnce();
        await tick();await removeMangaModels();
        expect(mocks.workerDispose).toHaveBeenCalledTimes(2);
        expect(mocks.remove).toHaveBeenCalledOnce();
    });

    it('Worker 上下文使用 OffscreenCanvas 识别整页和气泡，映射坐标并清空所有画布',async()=>{
        const pixels=opaquePixels();
        for(let y=40;y<90;y++)for(let x=30;x<80;x++)pixels.fill(255,(y*200+x)*4,(y*200+x)*4+4);
        const offscreen=vi.fn(function(width:number,height:number){
            const ctx={drawImage:vi.fn(),fillRect:vi.fn(),putImageData:vi.fn(),getImageData:vi.fn(()=>({data:mocks.canvases.length===1?pixels:opaquePixels()}))};
            const canvas={width,height,getContext:vi.fn(()=>ctx)};
            mocks.contexts.push(ctx);mocks.canvases.push(canvas);return canvas;
        });
        vi.stubGlobal('OffscreenCanvas',offscreen);vi.stubGlobal('document',undefined);
        mocks.recognize.mockResolvedValueOnce(response).mockResolvedValueOnce({results:[{text:'Dialogue',confidence:.99,box:{x:15,y:30,width:90,height:30}}]});
        const port=await createBrowserMangaOcr();
        const result=await port.recognize('worker-image',{flatten:true,noCache:true,strategy:'per-box'});
        expect(result.results).toEqual(response.results);
        expect(result.bubbles?.[0].results[0].box).toEqual({x:35,y:50,width:30,height:10});
        expect(offscreen.mock.calls).toEqual([[0,0],[0,0],[0,0]]);
        for(const canvas of mocks.canvases) expect(canvas.getContext).toHaveBeenCalledWith('2d',{willReadFrequently:true});
        expect(mocks.contexts[1].fillRect).toHaveBeenCalledWith(30,40,50,50);
        expect(mocks.contexts[2].drawImage).toHaveBeenCalledWith(mocks.canvases[0],30,40,50,50,0,0,150,150);
        expect(mocks.canvases.every(canvas=>canvas.width===0&&canvas.height===0)).toBe(true);
        expect(mocks.bitmapClose).toHaveBeenCalledOnce();await port.destroy();
    });

    it('Worker OffscreenCanvas 推理失败也清空画布并关闭自有位图',async()=>{
        vi.stubGlobal('document',undefined);
        vi.stubGlobal('OffscreenCanvas',class {
            width:number;height:number;
            constructor(width:number,height:number){this.width=width;this.height=height;mocks.canvases.push(this);}
            getContext(){return {fillRect:vi.fn(),drawImage:vi.fn(),putImageData:vi.fn(),getImageData:()=>({data:opaquePixels()})};}
        });
        const failure=new Error('worker OCR failed');mocks.recognize.mockRejectedValueOnce(failure);
        const port=await createBrowserMangaOcr();
        await expect(port.recognize('worker-image',{flatten:true,noCache:true,strategy:'per-box'})).rejects.toBe(failure);
        expect(mocks.canvases.every(canvas=>canvas.width===0&&canvas.height===0)).toBe(true);
        expect(mocks.bitmapClose).toHaveBeenCalledOnce();await port.destroy();
    });

    it('CPU detection 与 recognition 会话也经过推理间歇，保持 this、参数与返回值',async()=>{
        const feeds={input:new Float32Array([1])},options={fetches:['output']};
        const detectionRun=vi.fn(async function(this:unknown,...args:unknown[]){expect(this).toBe(detection);expect(args).toEqual([feeds,options]);return response;});
        const recognitionRun=vi.fn(async function(this:unknown,...args:unknown[]){expect(this).toBe(recognition);expect(args).toEqual([feeds]);return response;});
        const detection={run:detectionRun,release:vi.fn()},recognition={run:recognitionRun,release:vi.fn()};
        vi.stubGlobal('navigator',{hardwareConcurrency:8,deviceMemory:8});
        vi.stubGlobal('crossOriginIsolated',true);vi.stubGlobal('SharedArrayBuffer',class {});
        mocks.sessions=[detection,recognition];
        mocks.recognize.mockImplementationOnce(async()=>{await detection.run(feeds,options);return recognition.run(feeds);});
        const port=await createBrowserMangaOcr();
        expect((await port.recognize('image',{flatten:true,noCache:true,strategy:'per-box'})).results).toEqual(response.results);
        expect(mocks.wasm.numThreads).toBe(2);
        expect(mocks.pace).toHaveBeenCalledTimes(2);expect(detectionRun).toHaveBeenCalledOnce();expect(recognitionRun).toHaveBeenCalledOnce();
        await port.destroy();
    });

    it('硬件 GPU 执行失败时沿用当前请求切换 CPU，取消期间不留下新会话',async()=>{
        mocks.gpu.mockResolvedValue({available:true,info:'hardware'});
        const detection={run:vi.fn().mockRejectedValue(new Error('GPU')),release:vi.fn(async()=>{})};
        mocks.sessions=[detection,undefined];
        const cpu={run:vi.fn(async()=>response),release:vi.fn(async()=>{})};mocks.cpuCreate.mockResolvedValue(cpu);
        const assets={detection:new ArrayBuffer(2),recognition:new ArrayBuffer(3),charactersDictionary:new ArrayBuffer(4)};mocks.assets.mockResolvedValue(assets);
        const port=await createBrowserMangaOcr();mocks.recognize.mockImplementationOnce(async()=>detection.run());
        await port.recognize('image',{flatten:true,noCache:true,strategy:'per-box'});
        expect(mocks.options.mock.calls[0][0].session.executionProviders).toEqual(['webgpu','wasm']);
        expect(mocks.cpuCreate).toHaveBeenCalledWith(assets.detection,{executionProviders:['wasm'],graphOptimizationLevel:'all'});await port.destroy();
        const controller=new AbortController(),second={run:vi.fn().mockRejectedValue(new Error('GPU')),release:vi.fn(async()=>{})};mocks.sessions=[undefined,second];
        const next=await createBrowserMangaOcr();mocks.cpuCreate.mockImplementationOnce(async()=>{controller.abort();return cpu;});
        mocks.recognize.mockImplementationOnce(async()=>second.run());
        await expect(next.recognize('image',{flatten:true,noCache:true,strategy:'per-box',signal:controller.signal})).rejects.toMatchObject({name:'AbortError'});expect(cpu.release).toHaveBeenCalledOnce();
        const pending=new AbortController(),third={run:vi.fn().mockRejectedValue(new Error('GPU')),release:vi.fn(async()=>{})};mocks.sessions=[third,third];
        const last=await createBrowserMangaOcr();mocks.recognize.mockImplementationOnce(async()=>{mocks.assets.mockImplementationOnce(async()=>{pending.abort();return assets;});return third.run();});
        await expect(last.recognize('image',{flatten:true,noCache:true,strategy:'per-box',signal:pending.signal})).rejects.toMatchObject({name:'AbortError'});
    });
    it('SDK 吞掉 CPU 回退失败时仍报告真实错误，不能把失败当成没有文字',async()=>{
        mocks.gpu.mockResolvedValue({available:true,info:'hardware'});
        const session={run:vi.fn().mockRejectedValue(new Error('GPU')),release:vi.fn(async()=>{})};mocks.sessions=[session,undefined];mocks.cpuCreate.mockRejectedValueOnce(new Error('CPU failed'));
        const port=await createBrowserMangaOcr();mocks.recognize.mockImplementationOnce(async()=>{try{await session.run();}catch{}return {results:[]};});
        await expect(port.recognize('image',{flatten:true,noCache:true,strategy:'per-box'})).rejects.toThrow('CPU failed');
        expect(mocks.canvases.every(c=>c.width===0&&c.height===0)).toBe(true);
    });
    it('不可用会话在失败后释放，立即重试创建新会话，清理失败不覆盖原错误',async()=>{
        const port={recognize:vi.fn().mockRejectedValueOnce(new Error('CPU inference')).mockResolvedValue(response),destroy:vi.fn().mockRejectedValueOnce(new Error('cleanup')).mockResolvedValue(undefined)};
        const create=vi.fn(async()=>port),runtime=createMangaOcrRuntime(create);
        await expect(runtime.recognize('first','en',200,200)).rejects.toThrow('CPU inference');
        expect(await runtime.recognize('retry','en',200,200)).toHaveLength(1);expect(create).toHaveBeenCalledTimes(2);await runtime.dispose();
    });
    it('借用已解码图片避免重复获取与解码，推理后只释放自有 Canvas，保留调用方图片',async()=>{
        const source={naturalWidth:200,naturalHeight:200,src:'data:image/png;base64,source'} as HTMLImageElement;
        const port=await createBrowserMangaOcr();await port.recognize(source.src,{flatten:true,noCache:true,strategy:'per-box',decodedImage:source});
        expect(fetch).not.toHaveBeenCalled();expect(createImageBitmap).not.toHaveBeenCalled();expect(mocks.bitmapClose).not.toHaveBeenCalled();
        expect(mocks.contexts[0].drawImage).toHaveBeenCalledWith(source,0,0);expect(mocks.canvases.every(c=>c.width===0&&c.height===0)).toBe(true);
        expect(source.src).toBe('data:image/png;base64,source');
        const runtime=createMangaOcrRuntime(async()=>port);await runtime.recognize(source.src,'en',200,200,undefined,undefined,source);
        expect(fetch).not.toHaveBeenCalled();await runtime.dispose();
    });
    it.each(['png','svg+xml'].flatMap(format=>[0,255].map(shade=>({format,shade}))))('透明 $format 前景 $shade 只在识别像素合成对比底色，原图仍可透明重绘',async({format,shade})=>{
        const image=`data:image/${format};base64,transparent`,source={naturalWidth:200,naturalHeight:200,src:image} as HTMLImageElement;
        const pixels=new Uint8ClampedArray(200*200*4);pixels.set([shade,shade,shade,255],0);
        const factory=vi.mocked(document.createElement).getMockImplementation()!;
        vi.mocked(document.createElement).mockImplementationOnce(()=>{const canvas=factory('canvas');mocks.contexts[0].getImageData.mockReturnValue({data:pixels});return canvas;});
        mocks.recognize.mockImplementationOnce(async canvas=>{
            expect(canvas).toBe(mocks.canvases[0]);const context=mocks.contexts[0];
            expect(context.drawImage).toHaveBeenCalledWith(source,0,0);expect(context.putImageData).toHaveBeenCalledWith({data:pixels},0,0);
            expect(context.drawImage.mock.invocationCallOrder[0]).toBeLessThan(context.putImageData.mock.invocationCallOrder[0]);
            expect([...pixels.slice(0,8)]).toEqual([shade,shade,shade,255,255-shade,255-shade,255-shade,255]);
            expect(context.fillRect).not.toHaveBeenCalled();expect(source.src).toBe(image);return response;
        });
        const port=await createBrowserMangaOcr();expect((await port.recognize(image,{flatten:true,noCache:true,strategy:'per-box',decodedImage:source})).results).toEqual(response.results);
        expect(source.src).toBe(image);expect(mocks.canvases[0]).toMatchObject({width:0,height:0});
        expect(mocks.encode).not.toHaveBeenCalled();expect(mocks.bitmapClose).not.toHaveBeenCalled();await port.destroy();
    });
    it('复用会话串行识别，阅读期间保留会话，空闲三分钟释放，随后重新创建',async()=>{
        const port={recognize:vi.fn(async()=>response),destroy:vi.fn(async()=>{})},create=vi.fn(async()=>port),runtime=createMangaOcrRuntime(create),progress=vi.fn();
        expect(await runtime.recognize('image','en',200,200,undefined,progress)).toHaveLength(1);
        await runtime.recognize('second','en',200,200);expect(create).toHaveBeenCalledOnce();expect(progress.mock.calls).toEqual([['preparing',0],['recognizing']]);
        await vi.advanceTimersByTimeAsync(60000);expect(port.destroy).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(120000);expect(port.destroy).toHaveBeenCalledOnce();
        await runtime.recognize('third','en',200,200);expect(create).toHaveBeenCalledTimes(2);await runtime.dispose();expect(port.destroy).toHaveBeenCalledTimes(2);
        await runtime.dispose();
    });
    it('取消排队请求立即返回且不干扰正在识别的页，迟到结果丢弃',async()=>{
        const pending=deferred<typeof response>(),port={recognize:vi.fn(()=>pending.promise),destroy:vi.fn()},create=vi.fn(async()=>port),runtime=createMangaOcrRuntime(create);
        const firstAbort=new AbortController(),queuedAbort=new AbortController();
        const first=runtime.recognize('first','en',200,200,firstAbort.signal);await tick();
        const queued=runtime.recognize('queued','en',200,200,queuedAbort.signal);const stopped=expect(queued).rejects.toMatchObject({name:'AbortError'});queuedAbort.abort();await stopped;
        const firstStopped=expect(first).rejects.toMatchObject({name:'AbortError'});firstAbort.abort();await firstStopped;
        pending.resolve(response);await tick();await runtime.dispose();expect(port.recognize).toHaveBeenCalledOnce();
    });
    it('预取消、创建失败和识别失败后队列均可继续，移除模型先释放会话',async()=>{
        const create=vi.fn(),runtime=createMangaOcrRuntime(create),aborted=new AbortController();aborted.abort();
        await expect(runtime.recognize('cancel','en',200,200,aborted.signal)).rejects.toMatchObject({name:'AbortError'});expect(create).not.toHaveBeenCalled();
        create.mockRejectedValueOnce(new Error('download failed'));await expect(runtime.recognize('fail','en',200,200)).rejects.toThrow('download failed');
        await runtime.dispose();const port={recognize:vi.fn().mockRejectedValueOnce(new Error('ocr failed')).mockResolvedValue(response),destroy:vi.fn()};create.mockResolvedValue(port);
        await expect(runtime.recognize('bad','en',200,200)).rejects.toThrow('ocr failed');expect(await runtime.recognize('good','en',200,200)).toHaveLength(1);
        await runtime.removeModels();expect(port.destroy).toHaveBeenCalledTimes(2);expect(mocks.remove).toHaveBeenCalledOnce();
    });
    it('空闲销毁失败不会成为未处理异常，也不会阻止新任务',async()=>{
        const port={recognize:vi.fn(async()=>response),destroy:vi.fn().mockRejectedValue(new Error('closed'))},runtime=createMangaOcrRuntime(async()=>port);
        await runtime.recognize('image','en',200,200);await vi.advanceTimersByTimeAsync(180000);
        expect(await runtime.recognize('next','en',200,200)).toHaveLength(1);
    });
    it('浏览器适配只加载本地 WASM 和已校验模型，图片在本地解码',async()=>{
        const progress=vi.fn();mocks.assets.mockImplementationOnce(async(_signal,notify)=>{notify(32);return {charactersDictionary:new ArrayBuffer(4)}});
        const port=await createBrowserMangaOcr(undefined,progress);await port.recognize('data:image/png;base64,aQ==',{flatten:true,noCache:true,strategy:'per-box'});await port.destroy();
        expect(progress).toHaveBeenCalledWith('preparing',32);expect(mocks.wasm).toMatchObject({numThreads:1,proxy:false,wasmPaths:{mjs:'chrome-extension://test/fluent-read-ai/ort-wasm-simd-threaded.asyncify.mjs',wasm:'chrome-extension://test/fluent-read-ai/ort-wasm-simd-threaded.asyncify.wasm'}});
        expect(fetch).toHaveBeenCalledWith('data:image/png;base64,aQ==');expect(mocks.recognize.mock.calls[0][0]).toBe(mocks.canvases[0]);
        expect(mocks.canvases[0].width).toBe(0);expect(mocks.bitmapClose).toHaveBeenCalledOnce();
        expect(mocks.options.mock.calls[0][0]).toMatchObject({session:{executionProviders:['wasm'],graphOptimizationLevel:'all'},recognition:{minimumConfidence:0.65}});
        await createBrowserMangaOcr();
    });
    it('放大气泡分别识别并映射回原图坐标，失败和取消时释放所有画布',async()=>{
        const pixels=opaquePixels();for(let y=40;y<90;y++)for(let x=30;x<80;x++)pixels.fill(255,(y*200+x)*4,(y*200+x)*4+4);
        const original=vi.mocked(document.createElement).getMockImplementation()!;let main=true;
        vi.mocked(document.createElement).mockImplementation(()=>{const canvas=original('canvas');if(main){main=false;mocks.contexts.at(-1).getImageData.mockReturnValue({data:pixels});}return canvas;});
        mocks.recognize.mockResolvedValueOnce(response).mockResolvedValueOnce({results:[{text:'Clear dialogue',confidence:.99,box:{x:15,y:30,width:90,height:30}}]});
        const port=await createBrowserMangaOcr();const result=await port.recognize('image',{flatten:true,noCache:true,strategy:'per-box'});
        expect(result.results).toEqual(response.results);expect(mocks.contexts[0].fillRect).not.toHaveBeenCalled();expect(mocks.contexts[0].putImageData).not.toHaveBeenCalled();
        expect(result.bubbles?.[0].results[0].box).toEqual({x:35,y:50,width:30,height:10});expect(mocks.contexts[1].fillRect).toHaveBeenCalledWith(30,40,50,50);expect(mocks.contexts[2].drawImage).toHaveBeenCalledWith(mocks.canvases[0],30,40,50,50,0,0,150,150);
        expect(mocks.canvases.every(c=>c.width===0&&c.height===0)).toBe(true);
        // 相同输入在推理之后取消，不能返回迟到的气泡结果。
        main=true;const abort=new AbortController();mocks.recognize.mockImplementationOnce(async()=>{abort.abort();return response;});
        await expect(port.recognize('image',{flatten:true,noCache:true,strategy:'per-box',signal:abort.signal})).rejects.toMatchObject({name:'AbortError'});
        expect(mocks.bitmapClose).toHaveBeenCalledTimes(2);
        main=true;mocks.recognize.mockResolvedValueOnce(response).mockRejectedValueOnce(new Error('crop inference failed'));
        await expect(port.recognize('image',{flatten:true,noCache:true,strategy:'per-box'})).rejects.toThrow('crop inference failed');
        expect(mocks.canvases.every(c=>c.width===0&&c.height===0)).toBe(true);
    });
    it('不支持 Canvas 和解码期间取消时释放位图，裁剪 Canvas 缺失也释放资源',async()=>{
        const port=await createBrowserMangaOcr();
        vi.mocked(document.createElement).mockReturnValueOnce({width:200,height:200,getContext:()=>null} as any);
        await expect(port.recognize('image',{flatten:true,noCache:true,strategy:'per-box'})).rejects.toThrow('浏览器不支持');
        const abort=new AbortController();vi.mocked(createImageBitmap).mockImplementationOnce(async()=>{abort.abort();return {width:200,height:200,close:mocks.bitmapClose} as any;});
        await expect(port.recognize('image',{flatten:true,noCache:true,strategy:'per-box',signal:abort.signal})).rejects.toMatchObject({name:'AbortError'});
        const pixels=opaquePixels();for(let y=40;y<90;y++)for(let x=30;x<80;x++)pixels.fill(255,(y*200+x)*4,(y*200+x)*4+4);
        vi.mocked(document.createElement).mockReturnValueOnce({width:200,height:200,getContext:()=>({fillRect:vi.fn(),drawImage:vi.fn(),putImageData:vi.fn(),getImageData:()=>({data:pixels})})} as any).mockReturnValueOnce({width:0,height:0,getContext:()=>null} as any);
        await expect(port.recognize('image',{flatten:true,noCache:true,strategy:'per-box'})).rejects.toThrow('浏览器不支持');expect(mocks.bitmapClose).toHaveBeenCalledTimes(3);
        const canvasFactory=vi.mocked(document.createElement).getMockImplementation()!;
        vi.mocked(document.createElement).mockReturnValueOnce({width:200,height:200,getContext:()=>({fillRect:vi.fn(),drawImage:vi.fn(),putImageData:vi.fn(),getImageData:()=>({data:pixels})})} as any)
            .mockImplementationOnce(()=>canvasFactory('canvas')).mockReturnValueOnce({width:0,height:0,getContext:()=>null} as any);
        await expect(port.recognize('image',{flatten:true,noCache:true,strategy:'per-box'})).rejects.toThrow('浏览器不支持');
        const stopped=new AbortController();stopped.abort();await expect(port.recognize('image',{flatten:true,noCache:true,strategy:'per-box',signal:stopped.signal})).rejects.toMatchObject({name:'AbortError'});
    });
    it('设置清理先释放背景修补和 OCR 会话，卸载期间销毁失败不会变成未处理异常',async()=>{
        await removeMangaModels();expect(mocks.inpaintDispose).toHaveBeenCalledOnce();expect(mocks.remove).toHaveBeenCalledOnce();
        const dispose=vi.spyOn(mangaOcrRuntime,'dispose').mockRejectedValue(new Error('already closed'));mocks.inpaintDispose.mockRejectedValueOnce(new Error('already closed'));
        disposeMangaModels();await tick();expect(dispose).toHaveBeenCalledOnce();expect(mocks.inpaintDispose).toHaveBeenCalledTimes(2);
    });
    it('初始化异常或初始化期间取消均销毁模型，不返回半初始化会话',async()=>{
        mocks.initialize.mockRejectedValueOnce(new Error('init failed'));await expect(createBrowserMangaOcr()).rejects.toThrow('init failed');expect(mocks.destroy).toHaveBeenCalledOnce();
        const abort=new AbortController();mocks.initialize.mockImplementationOnce(async()=>abort.abort());await expect(createBrowserMangaOcr(abort.signal)).rejects.toMatchObject({name:'AbortError'});expect(mocks.destroy).toHaveBeenCalledTimes(2);
        const cancelled=new AbortController();cancelled.abort();await expect(createBrowserMangaOcr(cancelled.signal)).rejects.toMatchObject({name:'AbortError'});
    });
});
