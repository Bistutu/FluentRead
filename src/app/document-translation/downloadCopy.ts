/**
 * @file src/app/document-translation/downloadCopy.ts
 * 文件职责：提供文档下载窗口专属的七语言文案，并沿用共享界面语言归一化规则。
 * 主要内容：保存原文件、翻译结果下载和原文保存状态的静态资源；未知语言回退简体中文。
 * 模块边界：仅由独立文档页面加载，不注册或修改全局语言包，不进入网页翻译及 userscript 的共享资源。
 */
import {normalizeUiLanguage} from '@/src/core/i18n/language';

const messages = {
    "zh-CN": {
        "title": "下载文件",
        "contentHint": "保存原文，或按原格式下载包含校订的翻译结果。",
        "original": "下载原文",
        "originalHint": "保留原文件，不包含翻译或校订。",
        "originalDownloaded": "原文件已开始下载，请在浏览器下载列表中查看。",
        "translationRequired": "翻译后可下载双语或译文文件。"
    },
    "en-US": {
        "title": "Download file",
        "contentHint": "Save the original or download the translation with your edits in the original format.",
        "original": "Download original",
        "originalHint": "Keeps the original file without translation or edits.",
        "originalDownloaded": "Original download started. Check your browser's downloads.",
        "translationRequired": "Translate first to download a bilingual or translated file."
    },
    "ja-JP": {
        "title": "ファイルをダウンロード",
        "contentHint": "原本を保存するか、修正を含む翻訳結果を元の形式でダウンロードできます。",
        "original": "原本をダウンロード",
        "originalHint": "翻訳や修正を含めず、元のファイルを保存します。",
        "originalDownloaded": "原本のダウンロードを開始しました。ブラウザーのダウンロード一覧をご確認ください。",
        "translationRequired": "翻訳後、対訳または訳文のファイルをダウンロードできます。"
    },
    "ko-KR": {
        "title": "파일 다운로드",
        "contentHint": "원본을 저장하거나 수정 사항이 포함된 번역 결과를 원래 형식으로 다운로드하세요.",
        "original": "원본 다운로드",
        "originalHint": "번역이나 수정 없이 원본 파일을 보존합니다.",
        "originalDownloaded": "원본 파일 다운로드를 시작했습니다. 브라우저의 다운로드 목록을 확인하세요.",
        "translationRequired": "번역 후 이중 언어 또는 번역문 파일을 다운로드할 수 있습니다."
    },
    "fr-FR": {
        "title": "Télécharger le fichier",
        "contentHint": "Enregistrez l’original ou téléchargez la traduction avec vos corrections dans le format d’origine.",
        "original": "Télécharger l’original",
        "originalHint": "Conserve le fichier d’origine sans traduction ni corrections.",
        "originalDownloaded": "Téléchargement de l’original lancé. Consultez les téléchargements de votre navigateur.",
        "translationRequired": "Traduisez d’abord pour télécharger un fichier bilingue ou traduit."
    },
    "es-ES": {
        "title": "Descargar archivo",
        "contentHint": "Guarda el original o descarga la traducción con tus correcciones en el formato original.",
        "original": "Descargar original",
        "originalHint": "Conserva el archivo original sin traducción ni correcciones.",
        "originalDownloaded": "Se ha iniciado la descarga del original. Revisa las descargas de tu navegador.",
        "translationRequired": "Traduce primero para descargar un archivo bilingüe o traducido."
    },
    "ru-RU": {
        "title": "Скачать файл",
        "contentHint": "Сохраните оригинал или скачайте перевод с вашими правками в исходном формате.",
        "original": "Скачать оригинал",
        "originalHint": "Сохраняет исходный файл без перевода и правок.",
        "originalDownloaded": "Загрузка исходного файла началась. Проверьте список загрузок браузера.",
        "translationRequired": "Сначала переведите документ, чтобы скачать двуязычный файл или перевод."
    }
};

export function getDocumentDownloadCopy(language: unknown): typeof messages['zh-CN'] {
    return messages[normalizeUiLanguage(language)];
}
