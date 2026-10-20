/**
 * @file userscript/languageSupplementData.ts
 * 文件职责：保存 userscript 语言补充的构建期及开发测试期原文数据。
 * 主要内容：保留原恢复、超时、局部划选、DeepLX、MiMo 与阅读字体文案及覆盖层次；运行制品只含压缩副本。
 * 模块边界：只定义数据和纯工厂函数，不在模块顶层调用，不读取缓存、不请求网络、不注册界面语言。
 */
import type {RegisteredUiLanguage} from '@/src/core/i18n';
import {mimoRetirementLegacyText} from '../src/core/i18n/messages/mimoRetirement';
import {aiRequestTimeoutMessages} from '../src/core/i18n/messages/aiRequestTimeout';

// 配置导入和历史仍可展示扩展站点偏好；注册时补齐标签，不改变固定远程词典。
const readingAppearanceLegacyLabels: Readonly<Record<RegisteredUiLanguage, string>> = {
    "en-US": "Website reading font",
    "ja-JP": "サイトの閲覧フォント",
    "ko-KR": "웹사이트 읽기 글꼴",
    "fr-FR": "Police de lecture du site",
    "ru-RU": "Шрифт чтения на сайте",
    "es-ES": "Fuente de lectura del sitio"
};

type RecoveryMessages = Readonly<Record<'learning.panelLoadError' | 'learning.reloadPage', string>>;
// 固定远程词典保持原发布内容；仅在注册时补齐缺少的恢复文案。
const recoveryMessages: Readonly<Partial<Record<RegisteredUiLanguage, RecoveryMessages>>> = {
    'ja-JP': {
        "learning.panelLoadError": "この項目を開けませんでした。ページを再読み込みして、もう一度お試しください。",
        "learning.reloadPage": "ページを再読み込み",
    },
    'ko-KR': {
        "learning.panelLoadError": "이 항목을 열 수 없습니다. 페이지를 새로고침한 후 다시 시도하세요.",
        "learning.reloadPage": "페이지 새로고침",
    },
    'fr-FR': {
        "learning.panelLoadError": "Cette section n’a pas pu être ouverte. Rechargez la page pour réessayer.",
        "learning.reloadPage": "Recharger la page",
    },
    'ru-RU': {
        "learning.panelLoadError": "Не удалось открыть этот раздел. Перезагрузите страницу и попробуйте снова.",
        "learning.reloadPage": "Перезагрузить страницу",
    },
    'es-ES': {
        "learning.panelLoadError": "No se pudo abrir esta sección. Recarga la página para volver a intentarlo.",
        "learning.reloadPage": "Recargar página",
    },
};

const sectionSweepMessages: Readonly<Partial<Record<RegisteredUiLanguage, Readonly<Record<string, string>>>>> = {
    "ja-JP": {
        "sectionTranslation.picker.preview": "マウスでプレビュー、クリックまたはドラッグで選択",
        "popup.sectionTranslationTitle": "部分翻訳：クリックまたはドラッグで選択して確定",
        "sectionTranslation.picker.instruction": "クリックまたはドラッグで翻訳する範囲を選択",
        "sectionTranslation.picker.dragging": "ドラッグで選択し、離してから確定",
        "sectionTranslation.scope.selected": "{count} 個の範囲を選択"
    },
    "ko-KR": {
        "sectionTranslation.picker.preview": "마우스로 미리 보고 클릭하거나 드래그하여 선택",
        "popup.sectionTranslationTitle": "부분 번역: 클릭하거나 드래그하여 선택한 뒤 확인",
        "sectionTranslation.picker.instruction": "클릭하거나 드래그하여 번역할 영역 선택",
        "sectionTranslation.picker.dragging": "드래그하여 선택하고 놓은 뒤 확인",
        "sectionTranslation.scope.selected": "선택한 영역 {count}개"
    },
    "fr-FR": {
        "sectionTranslation.picker.preview": "Survolez pour prévisualiser ; cliquez ou glissez pour sélectionner",
        "popup.sectionTranslationTitle": "Traduction partielle : cliquez ou glissez pour sélectionner, puis confirmez",
        "sectionTranslation.picker.instruction": "Cliquez ou glissez pour sélectionner les zones à traduire",
        "sectionTranslation.picker.dragging": "Glissez pour sélectionner, relâchez puis confirmez",
        "sectionTranslation.scope.selected": "{count} zones sélectionnées"
    },
    "ru-RU": {
        "sectionTranslation.picker.preview": "Наведите курсор для предпросмотра; нажмите или протяните для выбора",
        "popup.sectionTranslationTitle": "Перевод фрагмента: нажмите или протяните для выбора, затем подтвердите",
        "sectionTranslation.picker.instruction": "Нажмите или протяните, чтобы выбрать области для перевода",
        "sectionTranslation.picker.dragging": "Протяните для выбора, отпустите и подтвердите",
        "sectionTranslation.scope.selected": "Выбрано областей: {count}"
    },
    "es-ES": {
        "sectionTranslation.picker.preview": "Mueve el ratón para previsualizar; haz clic o arrastra para seleccionar",
        "popup.sectionTranslationTitle": "Traducción parcial: haz clic o arrastra para seleccionar y confirma",
        "sectionTranslation.picker.instruction": "Haz clic o arrastra para seleccionar las zonas que quieres traducir",
        "sectionTranslation.picker.dragging": "Arrastra para seleccionar, suelta y confirma",
        "sectionTranslation.scope.selected": "{count} zonas seleccionadas"
    }
};

const deeplxMessages: Readonly<Partial<Record<RegisteredUiLanguage, Readonly<Record<string, string>>>>> = {
    'en-US': {
        'settings.services.deeplx.defaultRoute': 'Direct to DeepL by default',
        'settings.services.deeplx.endpointHelp': 'Without an API key, the default connects directly to DeepL, then tries the public endpoint on failure. Custom URLs need the full path (usually ending in /translate); paths are not added automatically.',
    },
    'ja-JP': {
        'settings.services.deeplx.defaultRoute': '既定：DeepL に直接接続',
        'settings.services.deeplx.endpointHelp': 'API Key が未設定の場合、既定では DeepL に直接接続し、失敗時に公開 API を使用します。カスタム URL は完全なパス（通常は /translate で終わる）が必要です。パスは自動追加されません。',
    },
    'ko-KR': {
        'settings.services.deeplx.defaultRoute': '기본: DeepL 직접 연결',
        'settings.services.deeplx.endpointHelp': 'API Key가 없으면 기본적으로 DeepL에 직접 연결하고, 실패하면 공개 API를 사용합니다. 사용자 지정 주소에는 전체 경로(보통 /translate로 끝남)가 필요하며 경로는 자동으로 추가되지 않습니다.',
    },
    'fr-FR': {
        'settings.services.deeplx.defaultRoute': 'Connexion directe à DeepL par défaut',
        'settings.services.deeplx.endpointHelp': 'Sans clé API, la connexion par défaut se fait directement à DeepL, puis au service public en cas d’échec. Une URL personnalisée doit inclure le chemin complet (généralement /translate) ; le chemin n’est pas ajouté automatiquement.',
    },
    'ru-RU': {
        'settings.services.deeplx.defaultRoute': 'По умолчанию — напрямую к DeepL',
        'settings.services.deeplx.endpointHelp': 'Без API-ключа по умолчанию используется прямое подключение к DeepL, а при сбое — публичный API. Укажите полный путь в своём URL (обычно /translate); путь не добавляется автоматически.',
    },
    'es-ES': {
        'settings.services.deeplx.defaultRoute': 'Conexión directa a DeepL por defecto',
        'settings.services.deeplx.endpointHelp': 'Sin clave API, la conexión predeterminada es directa a DeepL; si falla, se usa el servicio público. Las URL personalizadas necesitan la ruta completa (normalmente /translate); no se añade automáticamente.',
    },
};

export interface LanguageSupplement {
    defaults: Readonly<Record<string, string>>;
    messages: Readonly<Record<string, string>>;
    legacyText: Readonly<Record<string, string>>;
}
export function createLanguageSupplements(): Record<RegisteredUiLanguage, LanguageSupplement> {
    const forLanguage = (language: RegisteredUiLanguage): LanguageSupplement => ({
        defaults: recoveryMessages[language] ?? {},
        messages: {...aiRequestTimeoutMessages[language], ...sectionSweepMessages[language], ...deeplxMessages[language]},
        legacyText: {...mimoRetirementLegacyText[language], '网站阅读字体': readingAppearanceLegacyLabels[language]},
    });
    return {
        'en-US': forLanguage('en-US'),
        'ja-JP': forLanguage('ja-JP'),
        'ko-KR': forLanguage('ko-KR'),
        'fr-FR': forLanguage('fr-FR'),
        'ru-RU': forLanguage('ru-RU'),
        'es-ES': forLanguage('es-ES'),
    };
}
