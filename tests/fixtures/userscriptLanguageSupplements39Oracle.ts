/**
 * @file tests/fixtures/userscriptLanguageSupplements39Oracle.ts
 * 文件职责：冻结封存39候选原未压缩语言补充声明和注册合并表达式，作为gzip迁移的独立测试oracle。
 * 主要内容：逐字复制旧reading/recovery/section/DeepLX/MiMo/timeout目录与旧覆盖顺序，不导入新factory或新补充数据。
 * 模块边界：仅在测试中根据传入旧bundle计算预期最终对象；来源身份见本轮tests-review/SEALED39_ORACLE_PROVENANCE.json。
 */
import type {RegisteredUiLanguage, UiLanguage, UiLanguageBundle} from '@/src/core/i18n/types';

const readingAppearanceLegacyLabels: Readonly<Record<RegisteredUiLanguage, string>> = {
    "en-US": "Website reading font",
    "ja-JP": "サイトの閲覧フォント",
    "ko-KR": "웹사이트 읽기 글꼴",
    "fr-FR": "Police de lecture du site",
    "ru-RU": "Шрифт чтения на сайте",
    "es-ES": "Fuente de lectura del sitio"
};

type RecoveryMessages = Readonly<Record<'learning.panelLoadError' | 'learning.reloadPage', string>>;

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

const mimoRetirementSource = "MiMo 旧编号将于北京时间 2026-10-21 10:00 失效。直连官方 API 时，自定义模型及请求体中的 mimo-v2.5 / mimo-v2.5-pro 会分别按 mimo-v2.6-flash / mimo-v2.6-pro 请求并按新模型计费；第三方网关请手动确认型号。";

const mimoRetirementLegacyText: Readonly<Record<RegisteredUiLanguage, Readonly<Record<string, string>>>> = {
    'en-US': {[mimoRetirementSource]: "MiMo legacy IDs expire at 10:00 Beijing time on 2026-10-21. For direct official API requests, custom model and request-body IDs mimo-v2.5 / mimo-v2.5-pro are sent as mimo-v2.6-flash / mimo-v2.6-pro and billed at the new rates. Check model IDs with your third-party gateway."},
    'ja-JP': {[mimoRetirementSource]: "MiMo の旧 ID は北京時間 2026-10-21 10:00 に無効になります。公式 API への直接リクエストでは、カスタムモデルとリクエスト本文の mimo-v2.5 / mimo-v2.5-pro をそれぞれ mimo-v2.6-flash / mimo-v2.6-pro に置換し、新モデルの料金が適用されます。外部ゲートウェイのモデル ID は手動で確認してください。"},
    'ko-KR': {[mimoRetirementSource]: "MiMo의 기존 ID는 베이징 시간 2026-10-21 10:00에 만료됩니다. 공식 API에 직접 요청할 때 사용자 지정 모델 및 요청 본문의 mimo-v2.5 / mimo-v2.5-pro는 각각 mimo-v2.6-flash / mimo-v2.6-pro로 전송되며 새 모델 요금이 적용됩니다. 타사 게이트웨이의 모델 ID는 직접 확인하세요."},
    'fr-FR': {[mimoRetirementSource]: "Les anciens identifiants MiMo expirent le 2026-10-21 à 10:00, heure de Pékin. Pour les appels directs à l’API officielle, mimo-v2.5 / mimo-v2.5-pro dans le modèle personnalisé ou le corps de requête deviennent respectivement mimo-v2.6-flash / mimo-v2.6-pro, aux nouveaux tarifs. Vérifiez manuellement les modèles des passerelles tierces."},
    'ru-RU': {[mimoRetirementSource]: "Старые ID MiMo перестанут действовать 2026-10-21 в 10:00 по пекинскому времени. При прямом обращении к официальному API идентификаторы mimo-v2.5 / mimo-v2.5-pro в пользовательской модели и теле запроса заменяются на mimo-v2.6-flash / mimo-v2.6-pro соответственно, с оплатой по новым тарифам. Модели сторонних шлюзов проверьте вручную."},
    'es-ES': {[mimoRetirementSource]: "Los ID antiguos de MiMo caducan el 2026-10-21 a las 10:00, hora de Pekín. En las solicitudes directas a la API oficial, mimo-v2.5 / mimo-v2.5-pro en modelos personalizados o cuerpos de solicitud se envían como mimo-v2.6-flash / mimo-v2.6-pro, respectivamente, con las nuevas tarifas. Comprueba manualmente los modelos de pasarelas de terceros."},
};

const aiRequestTimeoutMessages: Readonly<Record<UiLanguage, Readonly<Record<string, string>>>> = {
    "zh-CN": {
        "settings.requestLimits.aiTimeout": "AI 翻译请求超时",
        "settings.requestLimits.aiTimeoutHelp": "每次 AI 翻译请求默认等待 120 秒，可设为 10–600 秒。慢模型或长文本可适当延长等待时间。",
        "settings.requestLimits.seconds": "秒",
    },
    "en-US": {
        "settings.requestLimits.aiTimeout": "AI translation request timeout",
        "settings.requestLimits.aiTimeoutHelp": "Each AI translation request waits up to 120 seconds by default. Range: 10–600 seconds. Allow more time for slow models or long text.",
        "settings.requestLimits.seconds": "s",
    },
    "ja-JP": {
        "settings.requestLimits.aiTimeout": "AI 翻訳リクエストのタイムアウト",
        "settings.requestLimits.aiTimeoutHelp": "AI 翻訳はリクエストごとに既定で最大 120 秒待機します。範囲は 10～600 秒です。応答の遅いモデルや長文では待機時間を延ばせます。",
        "settings.requestLimits.seconds": "秒",
    },
    "ko-KR": {
        "settings.requestLimits.aiTimeout": "AI 번역 요청 제한 시간",
        "settings.requestLimits.aiTimeoutHelp": "AI 번역 요청은 기본적으로 최대 120초 동안 기다리며 10–600초로 설정할 수 있습니다. 느린 모델이나 긴 텍스트는 대기 시간을 늘려 주세요.",
        "settings.requestLimits.seconds": "초",
    },
    "fr-FR": {
        "settings.requestLimits.aiTimeout": "Délai des requêtes de traduction IA",
        "settings.requestLimits.aiTimeoutHelp": "Chaque requête de traduction IA attend jusqu’à 120 secondes par défaut. Plage : 10–600 secondes. Prolongez l’attente pour les modèles lents ou les textes longs.",
        "settings.requestLimits.seconds": "sec",
    },
    "ru-RU": {
        "settings.requestLimits.aiTimeout": "Тайм-аут запросов перевода ИИ",
        "settings.requestLimits.aiTimeoutHelp": "По умолчанию каждый запрос перевода ИИ ожидает до 120 секунд. Диапазон: 10–600 секунд. Для медленных моделей или длинного текста увеличьте время ожидания.",
        "settings.requestLimits.seconds": "с",
    },
    "es-ES": {
        "settings.requestLimits.aiTimeout": "Tiempo de espera de traducción IA",
        "settings.requestLimits.aiTimeoutHelp": "Cada solicitud de traducción IA espera hasta 120 segundos de forma predeterminada. Rango: 10–600 segundos. Amplíe la espera para modelos lentos o textos largos.",
        "settings.requestLimits.seconds": "seg",
    },
};

export function frozen39Registration(registered: RegisteredUiLanguage, bundle: UiLanguageBundle): UiLanguageBundle {
    const recovery = recoveryMessages[registered];
    return {...bundle, legacyText: {...bundle.legacyText,
                ...mimoRetirementLegacyText[registered], '网站阅读字体': readingAppearanceLegacyLabels[registered]}, messages: {
                ...recovery, ...bundle.messages, ...aiRequestTimeoutMessages[registered], ...sectionSweepMessages[registered],
                ...deeplxMessages[registered],
            }};
}
