import {afterEach, describe, expect, it, vi} from 'vitest';
import {getReadingAnnotationLanguage, READING_ANNOTATION_SCHEMES} from '@/src/core/readingAnnotation';
import {annotateReading} from '@/src/features/video-subtitle/reading/engine';
import {createHindiRomanizer} from '@/src/features/video-subtitle/reading/hindi';
import {romanizeThai} from '@/src/features/video-subtitle/reading/thai';
import {transliterateWritten} from '@/src/features/video-subtitle/reading/writtenTransliteration';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.doUnmock('@pinyin-pro/data/traditional');
  vi.doUnmock('@/src/features/video-subtitle/reading/japanese');
  vi.doUnmock('@/src/features/video-subtitle/reading/hindi');
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

  it('routes Hindi to the fixed-data engine without deriving a downloadable WASM address', async () => {
    vi.resetModules();
    const romanizeHindi = vi.fn(async () => 'namaste');
    vi.doMock('@/src/features/video-subtitle/reading/hindi', () => ({romanizeHindi}));
    const {annotateReading: annotate} = await import('@/src/features/video-subtitle/reading/engine');
    expect(await annotate('नमस्ते', 'hi', '')).toMatchObject({text: 'namaste', language: 'hi'});
    expect(romanizeHindi).toHaveBeenCalledWith('नमस्ते');
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
  it('deduplicates initialization and keeps lexicon and reranker enabled without loading caller URLs', async () => {
    const transliterate = vi.fn(() => 'bharat');
    const load = vi.fn(async () => transliterate);
    const romanize = createHindiRomanizer(load);
    expect(await Promise.all([romanize('भारत','https://extension.test/hi.wasm'),romanize('भारत','https://untrusted.test/other.wasm')])).toEqual(['bharat','bharat']);
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith();
    expect(transliterate).toHaveBeenCalledWith('भारत',{lexicon:true,rerank:true});
  });

  it('retries initialization failures and skips non-Hindi input before downloading', async () => {
    const load=vi.fn().mockRejectedValueOnce(new Error('data unavailable')).mockResolvedValue(() => 'namaste');
    const romanize=createHindiRomanizer(load);
    await expect(romanize('Hello','')).resolves.toBe('Hello');
    expect(load).not.toHaveBeenCalled();
    await expect(romanize('नमस्ते')).rejects.toThrow('data unavailable');
    await expect(romanize('नमस्ते')).resolves.toBe('namaste');
    await expect(romanize('अ'.repeat(3001))).rejects.toThrow('3000');
  });

  it('normalizes nukta sequences and shares a rejected initialization without poisoning a later attempt', async () => {
    let reject!: (reason: unknown) => void;
    const failed = new Promise<never>((_resolve, onReject) => {reject = onReject;});
    const transliterate = vi.fn((text: string) => text);
    const load = vi.fn().mockReturnValueOnce(failed).mockResolvedValue(transliterate);
    const romanize = createHindiRomanizer(load);
    const pending = [romanize('क़'),romanize('क़')];
    reject(new Error('offline'));
    expect(await Promise.allSettled(pending)).toEqual([expect.objectContaining({status:'rejected'}),expect.objectContaining({status:'rejected'})]);
    await expect(romanize('क़')).resolves.toBe('क़');
    expect(transliterate).toHaveBeenCalledWith('क़',{lexicon:true,rerank:true});
  });
});
