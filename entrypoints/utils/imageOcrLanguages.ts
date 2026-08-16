export type ImageOcrLanguageCode = 'eng' | 'chi_sim' | 'jpn';

export type ImageOcrLanguagePack = {
    code: ImageOcrLanguageCode;
    label: string;
    description: string;
    size: string;
    recommended: boolean;
};

export const IMAGE_OCR_LANGUAGE_STATE_KEY = 'fluentReadImageOcrLanguages';

export const IMAGE_OCR_LANGUAGE_PACKS: ImageOcrLanguagePack[] = [
    {
        code: 'chi_sim',
        label: '简体中文',
        description: '识别中文界面、截图和图片文字',
        size: '约 20 MB',
        recommended: true,
    },
    {
        code: 'eng',
        label: 'English',
        description: '识别英文和拉丁字母文字',
        size: '约 11 MB',
        recommended: true,
    },
    {
        code: 'jpn',
        label: '日本語',
        description: '识别日文图片和漫画文字',
        size: '约 16 MB',
        recommended: false,
    },
];

export const IMAGE_OCR_RECOMMENDED_LANGUAGES: ImageOcrLanguageCode[] = ['chi_sim', 'eng'];

export function getRequiredImageOcrLanguages(sourceLanguage: string): ImageOcrLanguageCode[] {
    if (sourceLanguage === 'en') return ['eng'];
    if (sourceLanguage === 'zh-Hans') return ['chi_sim', 'eng'];
    if (sourceLanguage === 'ja') return ['jpn', 'eng'];
    // 自动检测优先覆盖中文和英文；日文语言包在设置页中按需下载。
    return [...IMAGE_OCR_RECOMMENDED_LANGUAGES];
}

export function normalizeImageOcrLanguageCodes(value: unknown): ImageOcrLanguageCode[] {
    if (!Array.isArray(value)) return [];
    const supported = new Set(IMAGE_OCR_LANGUAGE_PACKS.map(item => item.code));
    return [...new Set(value.filter((code): code is ImageOcrLanguageCode => typeof code === 'string' && supported.has(code as ImageOcrLanguageCode)))];
}
