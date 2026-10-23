vi.mock('@/src/shared/onnx/resources', async original => ({...await original<any>(), paceLocalInference: mocks.pace}));
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({gpu:vi.fn(),load:vi.fn(),background:vi.fn(),create:vi.fn(),run:vi.fn(),release:vi.fn(),tensor:vi.fn(),tensorDispose:vi.fn(),outputDispose:vi.fn(),workerPrepare:vi.fn(),workerRequest:vi.fn(),workerRelease:vi.fn(),pace:vi.fn((operation:()=>Promise<unknown>)=>operation()),wasm:{numThreads:0,wasmPaths:undefined as unknown,proxy:true}}));
vi.mock('@/src/features/image-translation/services/mangaOcrAssets',async original=>({...await original<any>(),loadMangaInpaintAsset:mocks.load}));
vi.mock('@/src/shared/onnx/webgpu',()=>({probeWebGpu:mocks.gpu}));
vi.mock('@/src/features/image-translation/services/mangaRendering',()=>({mangaRegionBackground:mocks.background}));
vi.mock('onnxruntime-web/webgpu',()=>({env:{wasm:mocks.wasm},InferenceSession:{create:mocks.create},Tensor:class{constructor(...args:unknown[]){mocks.tensor(...args)}dispose=mocks.tensorDispose;}}));
vi.mock('@/src/features/image-translation/services/mangaInferenceClient',async original=>({...await original<any>(),mangaInferenceClient:{prepare:mocks.workerPrepare,request:mocks.workerRequest,release:mocks.workerRelease}}));
import {applyMangaPatch,createBrowserMangaInpainter,createMangaInpaintingRuntime,createMangaPatch,mangaInpaintingRuntime} from '@/src/features/image-translation/services/mangaInpainting';
const region={text:'Hello world',fontSize:20,bbox:{x0:30,y0:30,x1:90,y1:70}};
const pixels=()=>new Uint8ClampedArray(128*128*4).fill(255);
const zero=(patch:{width:number;height:number})=>new Float32Array(patch.width*patch.height*3);
const deferred=<T,>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};};
const tick=async()=>{for(let i=0;i<6;i++)await Promise.resolve();};
beforeEach(()=>{vi.useFakeTimers();vi.clearAllMocks();mocks.gpu.mockResolvedValue({available:false,info:''});mocks.load.mockResolvedValue(new ArrayBuffer(1));mocks.background.mockReturnValue({uniform:false,color:'rgb(255,255,255)'});mocks.release.mockResolvedValue(undefined);mocks.create.mockResolvedValue({run:mocks.run,release:mocks.release});mocks.run.mockResolvedValue({inpainted:{data:new Float32Array([0.25]),dispose:mocks.outputDispose}});vi.stubGlobal('chrome',{runtime:{getURL:(p:string)=>'chrome-extension://test'+p}});
    mocks.workerPrepare.mockReset().mockResolvedValue(undefined);mocks.workerRequest.mockReset().mockImplementation(async({patch})=>zero(patch));mocks.workerRelease.mockReset().mockResolvedValue(undefined);
});
afterEach(async()=>{await mangaInpaintingRuntime.dispose().catch(()=>undefined);vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});
describe('漫画局部神经修补',()=>{
    it('默认 Worker 只修补复杂背景，转发补丁和进度，复用端口并空闲释放',async()=>{
        const input=pixels(),controller=new AbortController(),progress=vi.fn(),repairing=vi.fn();
        mocks.workerPrepare.mockImplementation(async(kind,_signal,notify)=>{
            expect(kind).toBe('inpaint');notify('preparing',25);notify('initializing');
        });
        mocks.workerRequest.mockImplementation(async({patch},_signal,notify)=>{
            notify('recognizing',75);notify('initializing');return zero(patch);
        });
        expect(await mangaInpaintingRuntime.repair(input,128,128,[region],controller.signal,progress,repairing,[{uniform:true,color:'#fff'}])).toEqual(input);
        expect(mocks.workerPrepare).not.toHaveBeenCalled();expect(mocks.workerRequest).not.toHaveBeenCalled();
        const result=await mangaInpaintingRuntime.repair(input,128,128,[region],controller.signal,progress,repairing,[{uniform:false,color:'#fff'}]);
        const patch=createMangaPatch(input,128,128,region).patch;
        expect(mocks.workerPrepare).toHaveBeenCalledWith('inpaint',controller.signal,expect.any(Function));
        expect(mocks.workerRequest).toHaveBeenCalledWith({type:'inpaint',patch},controller.signal,expect.any(Function));
        expect(progress.mock.calls).toEqual([[],[25,false],[undefined,true],[75,false],[undefined,true]]);
        expect(repairing.mock.calls).toEqual([[0,1],[1,1]]);
        expect(Array.from(result.slice((35*128+35)*4,(35*128+35)*4+4))).toEqual([0,0,0,255]);
        expect(result.slice(0,128*4)).toEqual(input.slice(0,128*4));expect(input.every(value=>value===255)).toBe(true);
        await mangaInpaintingRuntime.repair(input,128,128,[region]);
        expect(mocks.workerPrepare).toHaveBeenCalledOnce();expect(mocks.workerRequest).toHaveBeenLastCalledWith({type:'inpaint',patch},undefined,expect.any(Function));
        expect(mocks.load).not.toHaveBeenCalled();expect(mocks.create).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(179999);expect(mocks.workerRelease).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);expect(mocks.workerRelease).toHaveBeenCalledWith('inpaint');
        // 没有用户进度回调时，prepare / request 的阶段通知也应安全吸收。
        await mangaInpaintingRuntime.repair(input,128,128,[region]);expect(mocks.workerPrepare).toHaveBeenCalledTimes(2);
        await mangaInpaintingRuntime.dispose();expect(mocks.workerRelease.mock.calls).toEqual([['inpaint'],['inpaint']]);
    });

    it('默认 Worker 准备与推理失败后重新创建，释放错误不覆盖原错误',async()=>{
        mocks.workerPrepare.mockRejectedValueOnce(new Error('worker prepare failed'));
        await expect(mangaInpaintingRuntime.repair(pixels(),128,128,[region])).rejects.toThrow('worker prepare failed');
        expect(mocks.workerRequest).not.toHaveBeenCalled();expect(mocks.workerRelease).not.toHaveBeenCalled();
        mocks.workerRequest.mockRejectedValueOnce(new Error('worker inference failed'));
        mocks.workerRelease.mockRejectedValueOnce(new Error('worker release failed'));
        await expect(mangaInpaintingRuntime.repair(pixels(),128,128,[region])).rejects.toThrow('worker inference failed');
        expect(mocks.workerRelease).toHaveBeenCalledWith('inpaint');
        expect(await mangaInpaintingRuntime.repair(pixels(),128,128,[region])).toBeInstanceOf(Uint8ClampedArray);
        expect(mocks.workerPrepare).toHaveBeenCalledTimes(3);
        mocks.workerRelease.mockRejectedValueOnce(new Error('idle release failed'));
        await vi.advanceTimersByTimeAsync(180000);
        expect(await mangaInpaintingRuntime.repair(pixels(),128,128,[region])).toBeInstanceOf(Uint8ClampedArray);
        expect(mocks.workerPrepare).toHaveBeenCalledTimes(4);
    });

    it('默认 Worker 保留运行请求的 signal，取消后丢弃迟到补丁，排队取消不发送新请求',async()=>{
        const input=pixels(),controller=new AbortController(),queuedController=new AbortController();
        const patch=createMangaPatch(input,128,128,region).patch,pending=deferred<Float32Array>();
        mocks.workerRequest.mockReturnValueOnce(pending.promise);
        const first=mangaInpaintingRuntime.repair(input,128,128,[region],controller.signal);
        const cancelled=expect(first).rejects.toMatchObject({name:'AbortError'});
        await tick();expect(mocks.workerRequest).toHaveBeenCalledWith({type:'inpaint',patch},controller.signal,expect.any(Function));
        const queued=mangaInpaintingRuntime.repair(input,128,128,[region],queuedController.signal);
        const queuedCancelled=expect(queued).rejects.toMatchObject({name:'AbortError'});
        controller.abort();queuedController.abort();
        expect(mocks.workerRelease).not.toHaveBeenCalled();expect(mocks.workerRequest).toHaveBeenCalledOnce();
        pending.resolve(zero(patch));await cancelled;await queuedCancelled;
        expect(mocks.workerRelease).not.toHaveBeenCalled();expect(mocks.workerRequest).toHaveBeenCalledOnce();
        expect(input.every(value=>value===255)).toBe(true);
        expect(await mangaInpaintingRuntime.repair(input,128,128,[region])).toBeInstanceOf(Uint8ClampedArray);
        expect(mocks.workerPrepare).toHaveBeenCalledOnce();
        await mangaInpaintingRuntime.dispose();expect(mocks.workerRelease).toHaveBeenCalledWith('inpaint');
    });

    it('当前区域取消立即丢弃补丁，不执行剩余区域，下一页复用暖模型',async()=>{
        const controller=new AbortController(),input=pixels(),progress=vi.fn();
        mocks.workerRequest.mockImplementationOnce(async()=>{controller.abort();throw new DOMException('cancelled','AbortError');});
        await expect(mangaInpaintingRuntime.repair(input,128,128,[region,region],controller.signal,undefined,progress)).rejects.toMatchObject({name:'AbortError'});
        expect(mocks.workerRequest).toHaveBeenCalledOnce();expect(mocks.workerRelease).not.toHaveBeenCalled();
        expect(progress.mock.calls).toEqual([[0,2]]);expect(input.every(value=>value===255)).toBe(true);
        await mangaInpaintingRuntime.repair(input,128,128,[region]);
        expect(mocks.workerPrepare).toHaveBeenCalledOnce();expect(mocks.workerRequest).toHaveBeenCalledTimes(2);
    });

    it('浏览器修补按 COI 与共享内存选择两条 WASM 线程，每次 run 都经过 pacer',async()=>{
        vi.stubGlobal('navigator',{hardwareConcurrency:8,deviceMemory:8});
        vi.stubGlobal('crossOriginIsolated',true);vi.stubGlobal('SharedArrayBuffer',class {});
        const port=await createBrowserMangaInpainter(),patch={image:new Float32Array(3),mask:new Float32Array(1),width:1,height:1};
        expect(mocks.wasm.numThreads).toBe(2);
        expect(mocks.wasm.wasmPaths).toEqual({mjs:'chrome-extension://test/fluent-read-ai/ort-wasm-simd-threaded.asyncify.mjs',wasm:'chrome-extension://test/fluent-read-ai/ort-wasm-simd-threaded.asyncify.wasm'});
        expect(await port.run(patch)).toEqual(new Float32Array([.25]));
        const failure=new Error('paced inference failed');mocks.run.mockRejectedValueOnce(failure);
        await expect(port.run(patch)).rejects.toBe(failure);
        expect(mocks.pace).toHaveBeenCalledTimes(2);expect(mocks.tensorDispose).toHaveBeenCalledTimes(4);
        await port.release();expect(mocks.release).toHaveBeenCalledOnce();
    });

    it('GPU 初始化失败改用 CPU，CPU 初始化失败和取消不继续重试',async()=>{
        mocks.gpu.mockResolvedValue({available:true,info:'hardware'});
        mocks.create.mockRejectedValueOnce(new Error('GPU init'));
        const port=await createBrowserMangaInpainter();
        expect(mocks.create.mock.calls.map(call=>call[1].executionProviders)).toEqual([['webgpu','wasm'],['wasm']]);
        await port.release();
        mocks.gpu.mockResolvedValue({available:false,info:''});mocks.create.mockRejectedValueOnce(new Error('CPU init'));
        await expect(createBrowserMangaInpainter()).rejects.toThrow('CPU init');expect(mocks.create).toHaveBeenCalledTimes(3);
        mocks.gpu.mockResolvedValue({available:true,info:'hardware'});const abort=new AbortController();
        mocks.create.mockImplementationOnce(async()=>{abort.abort();throw new Error('GPU init');});
        await expect(createBrowserMangaInpainter(abort.signal)).rejects.toMatchObject({name:'AbortError'});expect(mocks.create).toHaveBeenCalledTimes(4);
    });
    it('GPU 故障时沿用当前补丁及信号回退 CPU，初始化期间取消释放替代会话',async()=>{
        mocks.gpu.mockResolvedValue({available:true,info:'hardware'});
        const gpu={run:vi.fn().mockRejectedValue(new Error('GPU')),release:vi.fn(async()=>{})};
        const cpu={run:mocks.run,release:vi.fn(async()=>{})};mocks.create.mockResolvedValueOnce(gpu).mockResolvedValueOnce(cpu);
        const port=await createBrowserMangaInpainter(),patch={image:new Float32Array(3),mask:new Float32Array(1),width:1,height:1};
        expect(await port.run(patch)).toEqual(new Float32Array([.25]));expect(mocks.create.mock.calls[0][1].executionProviders).toEqual(['webgpu','wasm']);await port.release();expect(cpu.release).toHaveBeenCalledOnce();
        const aborted=new AbortController(),second={run:vi.fn().mockRejectedValue(new Error('GPU')),release:vi.fn(async()=>{})};
        mocks.create.mockResolvedValueOnce(second).mockImplementationOnce(async()=>{aborted.abort();return cpu;});
        const retry=await createBrowserMangaInpainter();await expect(retry.run(patch,aborted.signal)).rejects.toMatchObject({name:'AbortError'});expect(cpu.release).toHaveBeenCalledTimes(2);
        const third={run:vi.fn().mockRejectedValue(new Error('GPU')),release:vi.fn(async()=>{})},pending=new AbortController();mocks.create.mockResolvedValueOnce(third);
        const last=await createBrowserMangaInpainter();mocks.load.mockImplementationOnce(async()=>{pending.abort();return new ArrayBuffer(1);});await expect(last.run(patch,pending.signal)).rejects.toMatchObject({name:'AbortError'});
    });
    it('有界补丁归一化像素和逐行蒙版，长页不将整张图送入模型',()=>{
        const mapping=createMangaPatch(pixels(),128,128,{...region,sourceBoxes:[{x0:30,y0:30,x1:60,y1:50},{x0:30,y0:60,x1:90,y1:70}]});
        expect(mapping.patch.width%64).toBe(0);expect(mapping.patch.image[0]).toBe(1);expect(mapping.patch.mask).toContain(1);expect(mapping.patch.mask).toContain(0);
        const giant=createMangaPatch(new Uint8ClampedArray(1000*1000*4),1000,1000,{...region,bbox:{x0:0,y0:0,x1:1000,y1:1000}});
        expect(giant.patch.width).toBe(512);expect(giant.patch.height).toBe(512);
        expect(createMangaPatch(pixels(),128,128,{...region,bbox:{x0:0,y0:0,x1:4,y1:4}}).patch.width).toBe(64);
        const edge={...region,fontSize:1,bbox:{x0:0,y0:0,x1:4,y1:4}},edgeMapping=createMangaPatch(pixels(),128,128,edge);
        applyMangaPatch(pixels(),128,edge,edgeMapping,zero(edgeMapping.patch));
    });
    it('只回写原始行的 RGB，图外和行间画面与 alpha 完全不变',()=>{
        const input=pixels(),result=new Uint8ClampedArray(input),r={...region,sourceBoxes:[{x0:30,y0:30,x1:60,y1:50}]},mapping=createMangaPatch(input,128,128,r);
        const output=zero(mapping.patch);output.fill(2,0,mapping.patch.width*mapping.patch.height);applyMangaPatch(result,128,r,mapping,output);
        expect(Array.from(result.slice((35*128+35)*4,(35*128+35)*4+4))).toEqual([255,0,0,255]);
        expect(result.slice(0,128*4)).toEqual(input.slice(0,128*4));expect(result[(55*128+35)*4+1]).toBe(255);expect(input.every(v=>v===255)).toBe(true);
        applyMangaPatch(result,128,region,mapping,zero(mapping.patch));
        expect(()=>applyMangaPatch(result,128,region,mapping,new Float32Array(1))).toThrow('无效');
        const bad=zero(mapping.patch);bad[0]=NaN;expect(()=>applyMangaPatch(result,128,region,mapping,bad)).toThrow('无效');
    });
    it('均匀气泡不下载模型，复杂区域才按需初始化并复用会话',async()=>{
        const port={run:vi.fn(async patch=>zero(patch)),release:vi.fn()},create=vi.fn(async()=>port),runtime=createMangaInpaintingRuntime(create),progress=vi.fn();
        mocks.background.mockReturnValueOnce({uniform:true});expect(await runtime.repair(pixels(),128,128,[region])).toEqual(pixels());expect(create).not.toHaveBeenCalled();
        const repairing=vi.fn();const result=await runtime.repair(pixels(),128,128,[region],undefined,progress,repairing);expect(repairing.mock.calls).toEqual([[0,1],[1,1]]);expect(result[(35*128+35)*4]).toBe(0);expect(progress).toHaveBeenCalledOnce();
        await runtime.repair(pixels(),128,128,[region]);expect(create).toHaveBeenCalledOnce();await vi.advanceTimersByTimeAsync(60000);expect(port.release).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(120000);expect(port.release).toHaveBeenCalledOnce();
        await runtime.repair(pixels(),128,128,[region]);expect(create).toHaveBeenCalledTimes(2);await runtime.dispose();await runtime.dispose();
    });
    it('原图背景分类与绘字共享，不重复采样修补后的背景',async()=>{
        const port={run:vi.fn(async patch=>zero(patch)),release:vi.fn()},create=vi.fn(async()=>port),runtime=createMangaInpaintingRuntime(create);
        await runtime.repair(pixels(),128,128,[region],undefined,undefined,undefined,[{color:'rgb(255,255,255)',uniform:true}]);
        expect(mocks.background).not.toHaveBeenCalled();expect(create).not.toHaveBeenCalled();await runtime.dispose();
    });
    it('预取消、初始化取消和推理取消均不回写迟到结果',async()=>{
        const abort=new AbortController();abort.abort();const port={run:vi.fn(async patch=>zero(patch)),release:vi.fn()},create=vi.fn(async()=>port),runtime=createMangaInpaintingRuntime(create);
        await expect(runtime.repair(pixels(),128,128,[region],abort.signal)).rejects.toMatchObject({name:'AbortError'});expect(create).not.toHaveBeenCalled();
        const initAbort=new AbortController();create.mockImplementationOnce(async()=>{initAbort.abort();return port});await expect(runtime.repair(pixels(),128,128,[region],initAbort.signal)).rejects.toMatchObject({name:'AbortError'});
        const inferenceAbort=new AbortController();port.run.mockImplementationOnce(async patch=>{inferenceAbort.abort();return zero(patch)});
        await expect(runtime.repair(pixels(),128,128,[region],inferenceAbort.signal)).rejects.toMatchObject({name:'AbortError'});await runtime.dispose();
    });
    it('创建和推理失败后队列仍可用，空闲释放异常被吸收',async()=>{
        const port={run:vi.fn().mockRejectedValueOnce(new Error('inference')).mockImplementation(async patch=>zero(patch)),release:vi.fn().mockRejectedValue(new Error('released'))},create=vi.fn().mockRejectedValueOnce(new Error('download')).mockResolvedValue(port),runtime=createMangaInpaintingRuntime(create);
        await expect(runtime.repair(pixels(),128,128,[region])).rejects.toThrow('download');await vi.advanceTimersByTimeAsync(180000);
        await expect(runtime.repair(pixels(),128,128,[region])).rejects.toThrow('inference');expect(await runtime.repair(pixels(),128,128,[region])).toBeInstanceOf(Uint8ClampedArray);
        await vi.advanceTimersByTimeAsync(180000);expect(await runtime.repair(pixels(),128,128,[region])).toBeInstanceOf(Uint8ClampedArray);
    });
    it('浏览器模型使用本地 WASM，推理完成或失败都释放所有张量',async()=>{
        const progress=vi.fn();mocks.load.mockImplementationOnce(async(_signal,notify)=>{notify(1);notify(1);notify(100000000);return new ArrayBuffer(1);});
        await createBrowserMangaInpainter(undefined,progress);expect(progress.mock.calls).toEqual([[0],[48],[undefined,true]]);
        const port=await createBrowserMangaInpainter(),patch={image:new Float32Array(3),mask:new Float32Array(1),width:1,height:1};
        expect(await port.run(patch)).toEqual(new Float32Array([0.25]));expect(mocks.tensor.mock.calls.map(c=>c[2])).toEqual([[1,3,1,1],[1,1,1,1]]);
        expect(mocks.outputDispose).toHaveBeenCalledOnce();expect(mocks.tensorDispose).toHaveBeenCalledTimes(2);
        mocks.run.mockRejectedValueOnce(new Error('run'));await expect(port.run(patch)).rejects.toThrow('run');expect(mocks.tensorDispose).toHaveBeenCalledTimes(4);
        await port.release();expect(mocks.release).toHaveBeenCalledOnce();expect(mocks.wasm.numThreads).toBe(1);expect(mocks.create).toHaveBeenCalledWith(expect.any(ArrayBuffer),{executionProviders:['wasm'],graphOptimizationLevel:'all'});
    });
    it('创建模型后取消会释放会话，下载后预取消不创建 ONNX 会话',async()=>{
        const abort=new AbortController();mocks.create.mockImplementationOnce(async()=>{abort.abort();return {release:mocks.release}});
        await expect(createBrowserMangaInpainter(abort.signal)).rejects.toMatchObject({name:'AbortError'});expect(mocks.release).toHaveBeenCalledOnce();
        const cancelled=new AbortController();cancelled.abort();await expect(createBrowserMangaInpainter(cancelled.signal)).rejects.toMatchObject({name:'AbortError'});expect(mocks.create).toHaveBeenCalledOnce();
    });
});
