/**
 * 用户可选的划词朗读音色。顺序由多选控件保留；Edge TTS 当前音色失效
 * 时，后台会按该顺序继续尝试，同一语言没有可用自定义音色时再使用内置候选。
 */
export interface SelectionTtsVoiceOption {
    value: string;
    label: string;
    locale: string;
}

export const SELECTION_TTS_VOICE_OPTIONS: readonly SelectionTtsVoiceOption[] = [
    {value: 'en-US-AvaMultilingualNeural', label: 'Ava', locale: 'en-US'},
    {value: 'en-US-AriaNeural', label: 'Aria', locale: 'en-US'},
    {value: 'en-US-JennyNeural', label: 'Jenny', locale: 'en-US'},
    {value: 'en-US-GuyNeural', label: 'Guy', locale: 'en-US'},
    {value: 'en-GB-SoniaNeural', label: 'Sonia', locale: 'en-GB'},
    {value: 'en-GB-RyanNeural', label: 'Ryan', locale: 'en-GB'},
    {value: 'zh-CN-XiaoxiaoMultilingualNeural', label: '晓晓', locale: 'zh-CN'},
    {value: 'zh-CN-XiaoyiNeural', label: '晓伊', locale: 'zh-CN'},
    {value: 'zh-CN-YunxiNeural', label: '云希', locale: 'zh-CN'},
    {value: 'zh-CN-YunyangNeural', label: '云扬', locale: 'zh-CN'},
    {value: 'zh-TW-YunJheMultilingualNeural', label: '雲哲', locale: 'zh-TW'},
    {value: 'zh-TW-HsiaoChenNeural', label: '曉臻', locale: 'zh-TW'},
    {value: 'zh-TW-HsiaoYuNeural', label: '曉雨', locale: 'zh-TW'},
    {value: 'ja-JP-MasaruMultilingualNeural', label: 'Masaru', locale: 'ja-JP'},
    {value: 'ja-JP-NanamiNeural', label: 'Nanami', locale: 'ja-JP'},
    {value: 'ko-KR-HyunsuMultilingualNeural', label: 'Hyunsu', locale: 'ko-KR'},
    {value: 'ko-KR-SunHiNeural', label: 'SunHi', locale: 'ko-KR'},
    {value: 'fr-FR-RemyMultilingualNeural', label: 'Rémy', locale: 'fr-FR'},
    {value: 'de-DE-FlorianMultilingualNeural', label: 'Florian', locale: 'de-DE'},
    {value: 'es-ES-TristanMultilingualNeural', label: 'Tristan', locale: 'es-ES'},
    {value: 'it-IT-AlessioMultilingualNeural', label: 'Alessio', locale: 'it-IT'},
    {value: 'pt-BR-MacerioMultilingualNeural', label: 'Macerio', locale: 'pt-BR'},
] as const;

const KNOWN_SELECTION_TTS_VOICES = new Set(SELECTION_TTS_VOICE_OPTIONS.map((option) => option.value));

export function normalizeSelectionTtsVoiceOrder(value: unknown): string[] {
    if (!Array.isArray(value)) return [];

    const result: string[] = [];
    for (const candidate of value) {
        if (typeof candidate !== 'string' || !KNOWN_SELECTION_TTS_VOICES.has(candidate) || result.includes(candidate)) continue;
        result.push(candidate);
    }
    return result;
}

export function selectionTtsVoiceLocale(voice: string): string {
    return voice.split('-').slice(0, 2).join('-');
}

export function selectionTtsVoiceOption(voice: string): SelectionTtsVoiceOption | undefined {
    return SELECTION_TTS_VOICE_OPTIONS.find((option) => option.value === voice);
}
