import {describe, expect, it, vi} from 'vitest';
import {prepareWhisperEncoderReuse, prepareWhisperProcessorReuse, withWhisperStoppingCriteria, type WhisperEncoderReuseModel, type WhisperAudioProcessor} from '@/src/features/video-subtitle/offscreen/whisperEncoderReuse';

function fixture() {
  const tensor = {dims: [1, 1500, 384], dispose: vi.fn()};
  const processed = {input_features: {dims: [1, 80, 3000]}};
  const forwardParams = ['input_features', 'decoder_input_ids'];
  const model: WhisperEncoderReuseModel = {
    config: {model_type: 'whisper', is_encoder_decoder: true},
    main_input_name: 'input_features',
    forward_params: forwardParams,
    _prepare_encoder_decoder_kwargs_for_generation: vi.fn(async parameters => ({...parameters.model_inputs, encoder_outputs: tensor})),
  };
  return {model, processed, tensor, forwardParams};
}

describe('Whisper 3.8.1 单窗编码适配', () => {
  it.each([
    ['库升级', (f: ReturnType<typeof fixture>) => f, '3.8.2'],
    ['无配置', (f: ReturnType<typeof fixture>) => {delete f.model.config; return f;}],
    ['其他模型', (f: ReturnType<typeof fixture>) => {f.model.config!.model_type = 'other'; return f;}],
    ['非编码解码模型', (f: ReturnType<typeof fixture>) => {f.model.config!.is_encoder_decoder = false; return f;}],
    ['输入名称变化', (f: ReturnType<typeof fixture>) => {f.model.main_input_name = 'input_ids'; return f;}],
    ['无输入白名单', (f: ReturnType<typeof fixture>) => {f.model.forward_params = null; return f;}],
    ['白名单缺少特征', (f: ReturnType<typeof fixture>) => {f.model.forward_params = []; return f;}],
    ['无编码接口', (f: ReturnType<typeof fixture>) => {delete f.model._prepare_encoder_decoder_kwargs_for_generation; return f;}],
    ['没有特征', (f: ReturnType<typeof fixture>) => {f.processed = {} as any; return f;}],
    ['特征没有形状', (f: ReturnType<typeof fixture>) => {f.processed = {input_features: {}} as any; return f;}],
    ['多 batch', (f: ReturnType<typeof fixture>) => {f.processed.input_features.dims[0] = 2; return f;}],
  ] as const)('不兼容时不执行编码：%s', async (_name, change, version?: string) => {
    const f = change(fixture());
    const operation = f.model._prepare_encoder_decoder_kwargs_for_generation;
    expect(await prepareWhisperEncoderReuse(f.model, f.processed, version || '3.8.1')).toBeNull();
    if (operation) expect(operation).not.toHaveBeenCalled();
  });

  it('完整特征只编码一次，生成保留其余参数并恢复原白名单数组，释放幂等', async () => {
    const f = fixture();
    const originalProcessed = {...f.processed};
    const lease = (await prepareWhisperEncoderReuse(f.model, f.processed, '3.8.1'))!;
    expect(f.model._prepare_encoder_decoder_kwargs_for_generation).toHaveBeenCalledWith({
      inputs_tensor: f.processed.input_features, model_inputs: originalProcessed,
      model_input_name: 'input_features', generation_config: {guidance_scale: null},
    });
    expect(f.processed).toEqual(originalProcessed);
    expect(lease.encoderOutputs).toBe(f.tensor);
    expect(lease.modelInputs).toEqual({encoder_outputs: f.tensor});
    const options = {num_beams: 1, language: 'ja', max_new_tokens: 64};
    const returned = await lease.transcribe(options, async actual => {
      expect(actual).toEqual({...options, encoder_outputs: f.tensor});
      expect(f.model.forward_params).toEqual([...f.forwardParams, 'encoder_outputs']);
      expect(f.tensor.dispose).not.toHaveBeenCalled();
      return '字幕';
    });
    expect(returned).toBe('字幕');
    expect(options).not.toHaveProperty('encoder_outputs');
    expect(f.model.forward_params).toBe(f.forwardParams);
    expect(f.model._prepare_encoder_decoder_kwargs_for_generation).toHaveBeenCalledTimes(1);
    lease.dispose();
    lease.dispose();
    expect(f.tensor.dispose).toHaveBeenCalledTimes(1);
    await expect(lease.transcribe({}, async () => null)).rejects.toThrow('跨请求');
  });

  it('生成抛错也恢复白名单，调用方仍能释放张量', async () => {
    const f = fixture();
    const lease = (await prepareWhisperEncoderReuse(f.model, f.processed, '3.8.1'))!;
    await expect(lease.transcribe({chunk_length_s: 0}, async () => {throw new Error('decoder failed');})).rejects.toThrow('decoder failed');
    expect(f.model.forward_params).toBe(f.forwardParams);
    lease.dispose();
    expect(f.tensor.dispose).toHaveBeenCalledTimes(1);
  });

  it('拒绝同时生成、生成期间释放和内部分块，拒绝后原租约可继续使用', async () => {
    const f = fixture();
    const lease = (await prepareWhisperEncoderReuse(f.model, f.processed, '3.8.1'))!;
    await expect(lease.transcribe({chunk_length_s: 10}, async () => null)).rejects.toThrow('内部分块');
    await lease.transcribe({}, async () => {
      await expect(lease.transcribe({}, async () => null)).rejects.toThrow('并发');
      expect(() => lease.dispose()).toThrow('尚未结束');
    });
    lease.dispose();
    expect(f.tensor.dispose).toHaveBeenCalledTimes(1);
  });

  it.each([
    undefined, {}, {dispose: 'not a function'},
  ])('编码接口未返回可释放张量时报契约错误，不能默默重复编码：%s', async output => {
    const f = fixture();
    f.model._prepare_encoder_decoder_kwargs_for_generation = vi.fn(async () => ({encoder_outputs: output}));
    await expect(prepareWhisperEncoderReuse(f.model, f.processed, '3.8.1')).rejects.toThrow('可释放');
  });

  it.each([undefined, [1, 2], [2, 1500, 384]])('形状不符合单窗契约时先释放：%s', async dims => {
    const f = fixture();
    f.tensor.dims = dims as any;
    await expect(prepareWhisperEncoderReuse(f.model, f.processed, '3.8.1')).rejects.toThrow('完整音频窗');
    expect(f.tensor.dispose).toHaveBeenCalledTimes(1);
  });

  it('编码计算错误交给现有后端恢复，不能吞掉错误再次推理', async () => {
    const f = fixture();
    f.model._prepare_encoder_decoder_kwargs_for_generation = vi.fn(async () => {throw new Error('encoder failed');});
    await expect(prepareWhisperEncoderReuse(f.model, f.processed, '3.8.1')).rejects.toThrow('encoder failed');
  });
});

describe('Whisper 3.8.1 单窗特征适配', () => {
  function processorFixture(inherited = false) {
    const processor = vi.fn(async (_audio: Float32Array) => ({})) as WhisperAudioProcessor;
    processor.feature_extractor = {config: {sampling_rate: 16_000, chunk_length: 30, hop_length: 160}};
    const transcriber = inherited ? Object.create({processor}) : {processor};
    transcriber.model = {config: {model_type: 'whisper'}};
    const feature = {dims: [1, 80, 3000], dispose: vi.fn()};
    const processed = {input_features: feature};
    return {processor, transcriber, processed, feature, audio: Float32Array.from([.1, .2])};
  }

  it.each([
    ['未知版本', (f: ReturnType<typeof processorFixture>) => f, '3.8.2'],
    ['无模型', (f: ReturnType<typeof processorFixture>) => {delete f.transcriber.model; return f;}],
    ['无模型配置', (f: ReturnType<typeof processorFixture>) => {f.transcriber.model = {}; return f;}],
    ['其他模型', (f: ReturnType<typeof processorFixture>) => {f.transcriber.model.config.model_type = 'other'; return f;}],
    ['无processor', (f: ReturnType<typeof processorFixture>) => {delete f.transcriber.processor; return f;}],
    ['不可调用processor', (f: ReturnType<typeof processorFixture>) => {f.transcriber.processor = {}; return f;}],
    ['无extractor', (f: ReturnType<typeof processorFixture>) => {delete f.processor.feature_extractor; return f;}],
    ['无extractor配置', (f: ReturnType<typeof processorFixture>) => {f.processor.feature_extractor = {}; return f;}],
    ['采样率变化', (f: ReturnType<typeof processorFixture>) => {f.processor.feature_extractor!.config!.sampling_rate = 48000; return f;}],
    ['窗长变化', (f: ReturnType<typeof processorFixture>) => {f.processor.feature_extractor!.config!.chunk_length = 20; return f;}],
    ['步长变化', (f: ReturnType<typeof processorFixture>) => {f.processor.feature_extractor!.config!.hop_length = 80; return f;}],
    ['无特征', (f: ReturnType<typeof processorFixture>) => {f.processed = {} as any; return f;}],
    ['无形状', (f: ReturnType<typeof processorFixture>) => {f.feature.dims = undefined as any; return f;}],
    ['形状维数变化', (f: ReturnType<typeof processorFixture>) => {f.feature.dims = [1, 80]; return f;}],
    ['多batch', (f: ReturnType<typeof processorFixture>) => {f.feature.dims[0] = 2; return f;}],
    ['特征维变化', (f: ReturnType<typeof processorFixture>) => {f.feature.dims[1] = 128; return f;}],
    ['帧数变化', (f: ReturnType<typeof processorFixture>) => {f.feature.dims[2] = 1500; return f;}],
    ['无法释放', (f: ReturnType<typeof processorFixture>) => {f.feature.dispose = null as any; return f;}],
    ['不可恢复own属性', (f: ReturnType<typeof processorFixture>) => {Object.defineProperty(f.transcriber, 'processor', {configurable: false}); return f;}],
    ['不可扩展继承对象', (_f: ReturnType<typeof processorFixture>) => {const f = processorFixture(true); Object.preventExtensions(f.transcriber); return f;}],
  ] as const)('不兼容时保留原处理流程：%s', (_name, change, version?: string) => {
    const f = change(processorFixture());
    expect(prepareWhisperProcessorReuse(f.transcriber, f.audio, f.processed, version || '3.8.1')).toBeNull();
    expect(f.processor).not.toHaveBeenCalled();
    if (typeof f.feature.dispose === 'function') expect(f.feature.dispose).not.toHaveBeenCalled();
  });

  it.each([false, true])('同一音频只复用一次，保留配置和张量归属，恢复原属性（继承：%s）', async inherited => {
    const f = processorFixture(inherited), descriptor = Object.getOwnPropertyDescriptor(f.transcriber, 'processor');
    const lease = prepareWhisperProcessorReuse(f.transcriber, f.audio, f.processed, '3.8.1')!;
    expect(await lease.transcribe({}, async () => {
      expect(f.transcriber.processor.feature_extractor).toBe(f.processor.feature_extractor);
      const processed = await f.transcriber.processor(f.audio);
      expect(processed).toBe(f.processed);
      expect(f.feature.dispose).not.toHaveBeenCalled();
      return 'complete';
    })).toBe('complete');
    expect(f.processor).not.toHaveBeenCalled();
    expect(f.feature.dispose).not.toHaveBeenCalled();
    expect(Object.getOwnPropertyDescriptor(f.transcriber, 'processor')).toEqual(descriptor);
    expect(f.transcriber.processor).toBe(f.processor);
    await expect(lease.transcribe({}, async () => null)).rejects.toThrow('跨请求');
  });

  it('保留getter this 与不可写但可恢复的原descriptor，异常也准确恢复', async () => {
    const f = processorFixture();
    Object.defineProperty(f.processor, 'feature_extractor', {get() {expect(this).toBe(f.transcriber.processor); return {config: {sampling_rate: 16_000, chunk_length: 30, hop_length: 160}};}});
    Object.defineProperty(f.transcriber, 'processor', {writable: false, enumerable: false});
    const descriptor = Object.getOwnPropertyDescriptor(f.transcriber, 'processor');
    const lease = prepareWhisperProcessorReuse(f.transcriber, f.audio, f.processed, '3.8.1')!;
    await expect(lease.transcribe({}, async () => {
      expect(f.transcriber.processor.feature_extractor!.config!.sampling_rate).toBe(16000);
      await f.transcriber.processor(f.audio);
      throw new Error('decode failed');
    })).rejects.toThrow('decode failed');
    expect(Object.getOwnPropertyDescriptor(f.transcriber, 'processor')).toEqual(descriptor);
    expect(f.feature.dispose).not.toHaveBeenCalled();
  });

  it.each(['foreign', 'extra', 'twice'])('流水线音频契约改变时拒绝并恢复：%s', async mode => {
    const f = processorFixture(), lease = prepareWhisperProcessorReuse(f.transcriber, f.audio, f.processed, '3.8.1')!;
    await expect(lease.transcribe({chunk_length_s: 0}, async () => {
      if (mode === 'foreign') return f.transcriber.processor(f.audio.slice());
      if (mode === 'extra') return f.transcriber.processor(f.audio, {});
      await f.transcriber.processor(f.audio);
      return f.transcriber.processor(f.audio);
    })).rejects.toThrow('改变了当前音频窗');
    expect(f.transcriber.processor).toBe(f.processor);
  });

  it('拒绝内部分块与同实例并发，其他实例独立，encoder和stop hook可以嵌套', async () => {
    const a = processorFixture(), b = processorFixture();
    const lease = prepareWhisperProcessorReuse(a.transcriber, a.audio, a.processed, '3.8.1')!;
    const same = prepareWhisperProcessorReuse(a.transcriber, a.audio, a.processed, '3.8.1')!;
    const other = prepareWhisperProcessorReuse(b.transcriber, b.audio, b.processed, '3.8.1')!;
    await expect(lease.transcribe({chunk_length_s: 10}, async () => null)).rejects.toThrow('内部分块');
    const e = fixture(), encoder = (await prepareWhisperEncoderReuse(e.model, e.processed, '3.8.1'))!;
    a.transcriber.model = e.model;
    e.model._get_stopping_criteria = () => ({criteria: [] as unknown[], push(item) {this.criteria.push(item);}});
    await lease.transcribe({}, async () => {
      await expect(same.transcribe({}, async () => null)).rejects.toThrow('并发');
      expect(await other.transcribe({}, async () => b.transcriber.processor(b.audio))).toBe(b.processed);
      await encoder.transcribe({}, async () => withWhisperStoppingCriteria(e.model, {}, '3.8.1', async () => {
        expect(await a.transcriber.processor(a.audio)).toBe(a.processed);
      }));
    });
    await same.transcribe({}, async () => a.transcriber.processor(a.audio));
    expect(a.transcriber.processor).toBe(a.processor);
    expect(e.model.forward_params).toBe(e.forwardParams);
    encoder.dispose();
  });
});

describe('Whisper 3.8.1 请求停止条件适配', () => {
  function stoppingFixture(inherited = false) {
    const previousCriteria = [vi.fn(() => [false]), vi.fn(() => [false])];
    const original = vi.fn(function (this: WhisperEncoderReuseModel, _config: unknown, existing?: unknown) {
      expect(this).toBe(model);
      const criteria = [...previousCriteria, ...(existing ? [existing] : [])];
      return {criteria, push(item: unknown) {criteria.push(item as any);}};
    });
    const model: WhisperEncoderReuseModel = inherited ? Object.create({_get_stopping_criteria: original}) : {_get_stopping_criteria: original};
    model.config = {model_type: 'whisper'};
    return {model, original, previousCriteria};
  }

  it.each(['3.8.2', undefined])('未知版本明确拒绝，不执行生成：%s', async version => {
    const f = stoppingFixture();
    const operation = vi.fn(async () => null);
    await expect(withWhisperStoppingCriteria(f.model, {}, version, operation)).rejects.toThrow('契约不兼容');
    expect(operation).not.toHaveBeenCalled();
  });

  it.each([undefined, {}, {config: {model_type: 'other'}, _get_stopping_criteria: vi.fn()}, {config: {model_type: 'whisper'}}])('缺少实际 Whisper hook 时拒绝：%s', async model => {
    await expect(withWhisperStoppingCriteria(model, {}, '3.8.1', async () => null)).rejects.toThrow('契约不兼容');
  });

  it.each([false, true])('保留原条件、去重注入，并恢复实例原属性归属（继承：%s）', async inherited => {
    const f = stoppingFixture(inherited), stop = () => [false];
    const descriptor = Object.getOwnPropertyDescriptor(f.model, '_get_stopping_criteria');
    await withWhisperStoppingCriteria(f.model, stop, '3.8.1', async () => {
      expect(f.model._get_stopping_criteria).not.toBe(f.original);
      const result = f.model._get_stopping_criteria!({max_length: 443}, stop);
      expect(result.criteria).toEqual([...f.previousCriteria, stop]);
      expect(result.criteria.filter(value => value === stop)).toHaveLength(1);
    });
    expect(f.model._get_stopping_criteria).toBe(f.original);
    expect(Object.getOwnPropertyDescriptor(f.model, '_get_stopping_criteria')).toEqual(descriptor);
  });

  it('定时中断实际异步生成循环，未到长度上限即停止并恢复接口', async () => {
    vi.useFakeTimers();
    try {
      const f = stoppingFixture(true);
      let interrupted = false, iterations = 0;
      const stop = () => [interrupted];
      const timer = setTimeout(() => {interrupted = true;}, 4);
      const operation = withWhisperStoppingCriteria(f.model, stop, '3.8.1', async () => {
        const criteria = f.model._get_stopping_criteria!({max_length: 443});
        while (iterations < 440 && !criteria.criteria.some(criterion => (criterion as () => boolean[])()[0])) {
          await new Promise(resolve => setTimeout(resolve, 1));
          iterations++;
        }
        return iterations;
      });
      await vi.advanceTimersByTimeAsync(5);
      expect(await operation).toBe(4);
      expect(iterations).toBeLessThan(440);
      expect(f.model._get_stopping_criteria).toBe(f.original);
      clearTimeout(timer);
    } finally {vi.useRealTimers();}
  });

  it('与共享 encoder lease 嵌套时独立恢复，生成失败释放后仍可再次使用', async () => {
    const f = fixture(), s = stoppingFixture();
    f.model._get_stopping_criteria = s.original.bind(s.model);
    const original = f.model._get_stopping_criteria;
    const lease = (await prepareWhisperEncoderReuse(f.model, f.processed, '3.8.1'))!;
    await expect(lease.transcribe({}, async () => withWhisperStoppingCriteria(f.model, {}, '3.8.1', async () => {
      expect(f.model.forward_params).toEqual([...f.forwardParams, 'encoder_outputs']);
      throw new Error('decoder failed');
    }))).rejects.toThrow('decoder failed');
    expect(f.model._get_stopping_criteria).toBe(original);
    expect(f.model.forward_params).toBe(f.forwardParams);
    await withWhisperStoppingCriteria(f.model, {}, '3.8.1', async () => null);
    lease.dispose();
    expect(f.tensor.dispose).toHaveBeenCalledOnce();
  });

  it('拒绝同一实例并发，但允许不同实例，并在异常后恢复', async () => {
    const a = stoppingFixture(), b = stoppingFixture();
    await withWhisperStoppingCriteria(a.model, {}, '3.8.1', async () => {
      await expect(withWhisperStoppingCriteria(a.model, {}, '3.8.1', async () => null)).rejects.toThrow('并发');
      expect(await withWhisperStoppingCriteria(b.model, {}, '3.8.1', async () => 'other')).toBe('other');
    });
    await expect(withWhisperStoppingCriteria(a.model, {}, '3.8.1', async () => {throw new Error('operation failed');})).rejects.toThrow('operation failed');
    expect(a.model._get_stopping_criteria).toBe(a.original);
    expect(b.model._get_stopping_criteria).toBe(b.original);
  });

  it('不可恢复的 own hook 提前拒绝，不改变实例', async () => {
    const f = stoppingFixture();
    Object.defineProperty(f.model, '_get_stopping_criteria', {configurable: false});
    await expect(withWhisperStoppingCriteria(f.model, {}, '3.8.1', async () => null)).rejects.toThrow('不可恢复');
    expect(f.model._get_stopping_criteria).toBe(f.original);
  });

  it.each([null, {criteria: null, push: vi.fn()}, {criteria: []}])('原 hook 契约不符时拒绝，并恢复接口：%s', async output => {
    const f = stoppingFixture();
    f.model._get_stopping_criteria = vi.fn(() => output as any);
    const original = f.model._get_stopping_criteria;
    await expect(withWhisperStoppingCriteria(f.model, {}, '3.8.1', async () => f.model._get_stopping_criteria!({}))).rejects.toThrow('有效列表');
    expect(f.model._get_stopping_criteria).toBe(original);
  });
});
