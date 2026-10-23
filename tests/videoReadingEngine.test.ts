import {afterEach, describe, expect, it, vi} from 'vitest';
import {getReadingAnnotationLanguage, READING_ANNOTATION_SCHEMES} from '@/src/core/readingAnnotation';
import {annotateReading} from '@/src/features/video-subtitle/reading/engine';
import {createHindiRomanizer} from '@/src/features/video-subtitle/reading/hindi';
import {romanizeThai} from '@/src/features/video-subtitle/reading/thai';
import {transliterateWritten} from '@/src/features/video-subtitle/reading/writtenTransliteration';

const nativeWebAssembly = globalThis.WebAssembly;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.doUnmock('@pinyin-pro/data/traditional');
  vi.doUnmock('@/src/features/video-subtitle/reading/japanese');
});

describe('video reading language resolution', () => {
  it('rejects prototype property names as unknown track languages', () => {
    for (const language of ['constructor', '__proto__']) {
      expect(getReadingAnnotationLanguage('こんにちは', language)).toBeNull();
    }
  });

  it('normalizes the supported track aliases and filters mismatched scripts', () => {
    for (const [text,tag,expected] of [
      ['日本語','jpn','ja'],['한국어','ko_KR','ko'],['漢語','zh-Hant','zh'],['普通话','cmn','zh'],
      ['Привет','ru-RU','ru'],['Ελληνικά','ell','el'],['العربية','ara','ar'],['हिन्दी','hin','hi'],['ภาษาไทย','tha','th'],
    ]) expect(getReadingAnnotationLanguage(text,tag)).toBe(expected);
    expect(getReadingAnnotationLanguage('English','ja')).toBeNull();
    expect(getReadingAnnotationLanguage('普通话','en')).toBeNull();
    expect(getReadingAnnotationLanguage('','ja')).toBeNull();
    expect(getReadingAnnotationLanguage('あ'.repeat(3001),'ja')).toBeNull();
  });

  it('does not infer a dialect, shared script or already Latin track', () => {
    for(const tag of ['yue','zh-yue','zh-Latn','zh-nan','hak','wuu','zh-Hant-HK-yue']) expect(getReadingAnnotationLanguage('你好',tag)).toBeNull();
    for(const text of ['日本','العربية','भारत','Привет']) expect(getReadingAnnotationLanguage(text,'auto')).toBeNull();
    expect(getReadingAnnotationLanguage('こんにちは','auto')).toBe('ja');
    expect(getReadingAnnotationLanguage('한국어','und')).toBe('ko');
    expect(getReadingAnnotationLanguage('Ελλάδα','unknown')).toBe('el');
    expect(getReadingAnnotationLanguage('ไทย','original')).toBe('th');
    expect(getReadingAnnotationLanguage('हिन्दी','ne')).toBeNull();
    expect(getReadingAnnotationLanguage('Ελληνικά','grc')).toBeNull();
  });
});

describe('actual local reading engines', () => {
  it('reads simplified and traditional Mandarin with phrase disambiguation and tone marks', async () => {
    expect(await annotateReading('重庆银行','zh','')).toMatchObject({text:'chóng qìng yín háng',language:'zh',scheme:READING_ANNOTATION_SCHEMES.zh});
    expect(await annotateReading('銀行的音樂','zh-Hant','')).toMatchObject({text:'yín háng de yīn yuè',language:'zh'});
    expect(await annotateReading('OpenAI 中国 123','zh','')).toMatchObject({text:'OpenAI zhōng guó 123'});
  });

  it('applies Korean assimilation and preserves mixed Latin spelling', async () => {
    expect(await annotateReading('국립 한국어 같이 읽는','ko','')).toMatchObject({text:'gungnip hangugeo gachi ingneun',language:'ko'});
    expect(await annotateReading('YouTube 한국어 AI','ko','')).toMatchObject({text:'YouTube hangugeo AI'});
    expect(await annotateReading('한국어'.normalize('NFD'),'ko','')).toMatchObject({text:'hangugeo'});
  });

  it('parses Thai syllables, implicit vowels, finals and dictionary compounds instead of letter substitution', async () => {
    for(const [text,reading] of [
      ['สวัสดีครับ','sawatdi khrap'],['ขอบคุณมาก','khop khun mak'],['ฉันชอบกินข้าว','chan chop kin khao'],
      ['ถนนราชบุรี','thanon ratchaburi'],['กรุงเทพมหานคร','krung thep maha nakhon'],
      ['วันนี้อากาศดี','wan ni akat di'],['เด็กๆ เล่นกัน','dek dek len kan'],['สะอาด','sa-at'],
      ['YouTube และ AI','YouTube lae AI'],
    ]) expect(romanizeThai(text)).toBe(reading);
    expect(await annotateReading('สวัสดีครับ','th','')).toMatchObject({text:'sawatdi khrap',scheme:'thai-rtgs-v1'});
    expect(romanizeThai('วันที่ ๑๒')).toContain('๑๒');
  });

  it('keeps malformed Thai intact rather than promoting an unparsed letter fallback to reading', async () => {
    expect(romanizeThai('ะ')).toBe('ะ');
    expect(romanizeThai('เๆ')).toBe('เๆ');
    expect(await annotateReading('ะ','th','')).toBeNull();
  });

  it('returns no result for unsupported or already Latin subtitles', async () => {
    expect(await annotateReading('Hello','en','')).toBeNull();
    expect(await annotateReading('你好','yue','')).toBeNull();
    expect(await annotateReading('','auto','')).toBeNull();
  });

  it('routes written engines and requires a trusted dictionary before Japanese initialization', async () => {
    await expect(annotateReading('猫','ja','')).rejects.toThrow('dictionary URL is required');
    expect(await annotateReading('Привет','ru','')).toMatchObject({text:'Privet'});
    expect(await annotateReading('Ευχαριστώ','el','')).toMatchObject({text:'Efcharistó'});
    expect(await annotateReading('كتب','ar','')).toMatchObject({text:'ktb'});
  });

  it('retries Chinese loading after an unavailable dictionary chunk', async () => {
    vi.resetModules();
    vi.doMock('@pinyin-pro/data/traditional', () => {throw new Error('dictionary chunk unavailable');});
    const {annotateReading: annotate} = await import('@/src/features/video-subtitle/reading/engine');
    await expect(annotate('銀行','zh','')).rejects.toThrow();
    vi.doUnmock('@pinyin-pro/data/traditional');
    expect(await annotate('銀行','zh','')).toMatchObject({text:'yín háng'});
  });

  it('does not emit an empty result from a reading adapter', async () => {
    vi.resetModules();
    vi.doMock('@/src/features/video-subtitle/reading/japanese', () => ({romanizeJapanese: vi.fn(async () => '')}));
    const {annotateReading: annotate} = await import('@/src/features/video-subtitle/reading/engine');
    expect(await annotate('猫','ja','https://extension.test/reading-annotation/ja/')).toBeNull();
  });
});

describe('written Russian, modern Greek and Arabic boundaries', () => {
  it('keeps Russian й/ё composed correctly and preserves existing stress and capitalized digraphs', () => {
    expect(transliterateWritten('Йога и ёлка','ru')).toBe('Joga i ëlka');
    expect(transliterateWritten('Йога и ёлка'.normalize('NFD'),'ru')).toBe('Joga i ëlka');
    expect(transliterateWritten('ЩУКА test','ru')).toBe('ŠČUKA test');
    expect(transliterateWritten('приве́т OpenAI','ru')).toBe('privét OpenAI');
  });

  it('handles modern Greek digraphs, voicing, stress and diaeresis', () => {
    expect(transliterateWritten('Ευχαριστώ','el')).toBe('Efcharistó');
    expect(transliterateWritten('αύριο και είμαι','el')).toBe('ávrio ke íme');
    expect(transliterateWritten('Γεια σου','el')).toBe('Yia sou');
    expect(transliterateWritten('ΑΥΤΟ ΜΠΟΡΩ','el')).toBe('AFTO BORO');
    expect(transliterateWritten('Μαΐου','el')).toBe('Maḯou');
    expect(transliterateWritten('καλημέρα AI 😊'.normalize('NFD'),'el')).toBe('kaliméra AI 😊');
  });

  it('keeps unsupported historic Greek letters and detached marks and covers medial nasal clusters', () => {
    expect(transliterateWritten('Ϝ \u0301','el')).toBe('Ϝ \u0301');
    expect(transliterateWritten('λάμπα πάντα άγκυρα','el')).toBe('lámba pánda ángira');
    expect(transliterateWritten('ευ ηυ γ','el')).toBe('ef if g');
  });

  it('uses only written Arabic vowels, handles hamza carriers and explicit gemination', () => {
    expect(transliterateWritten('كتب','ar')).toBe('ktb');
    expect(transliterateWritten('مُحَمَّد','ar')).toBe('muḥammad');
    expect(transliterateWritten('شُكْرًا','ar')).toBe('šukran');
    expect(transliterateWritten('أُسْرَة','ar')).toBe('ʾusraẗ');
    expect(transliterateWritten('سُؤَال','ar')).toBe('suʾāl');
    expect(transliterateWritten('١٢٣؟ OpenAI','ar')).toBe('123? OpenAI');
    expect(transliterateWritten('ﻻ','ar')).toBe('lā');
  });
});

describe('Hindi lazy phonetic engine port', () => {
  it('deduplicates initialization and requests the independently evaluated Hindi lexicon and reranker', async () => {
    const transliterate = vi.fn(() => 'bharat');
    const load = vi.fn(async () => transliterate);
    const romanize = createHindiRomanizer(load);
    expect(await Promise.all([romanize('भारत','https://extension.test/hi.wasm'),romanize('भारत','https://extension.test/hi.wasm')])).toEqual(['bharat','bharat']);
    expect(load).toHaveBeenCalledTimes(1);
    expect(transliterate).toHaveBeenCalledWith('भारत',{lexicon:true,rerank:true});
    await expect(romanize('भारत','https://extension.test/other.wasm')).rejects.toThrow('new Worker');
  });

  it('retries after initialization failures and avoids WASM for non-Hindi text', async () => {
    const load=vi.fn().mockRejectedValueOnce(new Error('missing wasm')).mockResolvedValue(() => 'namaste');
    const romanize=createHindiRomanizer(load);
    await expect(romanize('Hello','')).resolves.toBe('Hello');
    expect(load).not.toHaveBeenCalled();
    await expect(romanize('नमस्ते','')).rejects.toThrow('URL is required');
    await expect(romanize('नमस्ते','/hi.wasm')).rejects.toThrow('missing wasm');
    await expect(romanize('नमस्ते','/hi.wasm')).resolves.toBe('namaste');
    await expect(romanize('अ'.repeat(3001),'/hi.wasm')).rejects.toThrow('3000');
  });

  function stubRuntime(transliterate: (text: string) => string = text => text) {
    const run=vi.fn(() => {
      vi.stubGlobal('gomanizeTranslit', transliterate);
      return new Promise<void>(() => {});
    });
    class Runtime {importObject = {gojs: {}}; run = run;}
    const instantiate=vi.fn(async () => ({instance: {exports: {}}}));
    vi.stubGlobal('Go', Runtime);
    vi.stubGlobal('gomanizeTranslit', undefined);
    vi.stubGlobal('WebAssembly', Object.assign(Object.create(nativeWebAssembly), {instantiate}));
    return {run, instantiate};
  }

  it('initializes the fixed runtime and packaged WASM and derives Hindi assets from the trusted Japanese base', async () => {
    const transliterate=vi.fn(() => 'namaste');
    const {run,instantiate}=stubRuntime(transliterate);
    const bytes=new ArrayBuffer(4);
    const fetch=vi.fn(async () => ({ok:true,arrayBuffer:async () => bytes}));
    vi.stubGlobal('fetch',fetch);
    const romanize=createHindiRomanizer();
    await expect(romanize('नमस्ते','https://extension.test/hi.wasm')).resolves.toBe('namaste');
    await expect(romanize('नमस्ते','https://extension.test/hi.wasm')).resolves.toBe('namaste');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(instantiate).toHaveBeenCalledWith(bytes,{gojs:{}});
    expect(run).toHaveBeenCalledTimes(1);
    expect(transliterate).toHaveBeenCalledWith('नमस्ते',{lexicon:true,rerank:true});
    // 重建实际路由模块，其初始化只从 Worker 自有的词典基地址推导另一个自有资源。
    vi.resetModules();
    const {annotateReading: annotate}=await import('@/src/features/video-subtitle/reading/engine');
    await import('@/src/features/video-subtitle/reading/hindi');
    stubRuntime(transliterate);
    expect(await annotate('नमस्ते','hi','https://extension.test/reading-annotation/ja/')).toMatchObject({text:'namaste',language:'hi'});
    expect(fetch).toHaveBeenLastCalledWith('https://extension.test/reading-annotation/hi/gomanize.wasm');
  });

  it('rejects a missing runtime, failed downloads and absent exports and allows a fresh retry', async () => {
    const romanize=createHindiRomanizer();
    vi.stubGlobal('Go',undefined);
    await expect(romanize('नमस्ते','/hi.wasm')).rejects.toThrow('runtime is unavailable');
    stubRuntime();
    let rejectCancel!: (reason: unknown) => void;
    const cancel=vi.fn(() => new Promise<void>((_resolve, reject) => {rejectCancel = reject;}));
    vi.stubGlobal('fetch',vi.fn(async () => new Response(new ReadableStream({cancel}), {status:404})));
    await expect(romanize('नमस्ते','/hi.wasm')).rejects.toThrow('(404)');
    expect(cancel).toHaveBeenCalledTimes(1);
    rejectCancel(new Error('late cleanup failure'));
    await Promise.resolve();
    vi.stubGlobal('fetch',vi.fn(async () => ({ok:false,status:500,body:null})));
    await expect(romanize('नमस्ते','/hi.wasm')).rejects.toThrow('(500)');
    vi.stubGlobal('fetch',vi.fn(async () => ({ok:true,arrayBuffer:async () => new ArrayBuffer(0)})));
    class MissingExports {importObject={}; run() {return new Promise<void>(() => {});}}
    vi.stubGlobal('Go',MissingExports);
    vi.stubGlobal('gomanizeTranslit',undefined);
    await expect(romanize('नमस्ते','/hi.wasm')).rejects.toThrow('did not initialize');
    stubRuntime(() => 'namaste');
    await expect(romanize('नमस्ते','/hi.wasm')).resolves.toBe('namaste');
  });

  it('propagates a runtime failure and starts cleanly on a later request', async () => {
    stubRuntime(() => 'namaste');
    vi.stubGlobal('fetch',vi.fn(async () => ({ok:true,arrayBuffer:async () => new ArrayBuffer(0)})));
    class FailedRuntime {
      importObject={};
      run() {vi.stubGlobal('gomanizeTranslit',() => 'unused');return Promise.reject(new Error('runtime exited'));}
    }
    vi.stubGlobal('Go',FailedRuntime);
    const romanize=createHindiRomanizer();
    await expect(romanize('नमस्ते','/hi.wasm')).rejects.toThrow('runtime exited');
    stubRuntime(() => 'namaste');
    await expect(romanize('नमस्ते','/hi.wasm')).resolves.toBe('namaste');
  });
});
