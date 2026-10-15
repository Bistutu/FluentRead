/**
 * @file src/services/diagnostics/index.ts
 * 文件职责：将翻译与页面失败映射为可复用、可操作且不会泄露供应商原始消息的自助诊断。
 * 主要内容：定义稳定的诊断代码、动作和七语言文案，按结构化错误优先归因，并用严格白名单生成供用户预览的本地报告。
 * 模块边界：本模块仅包含纯数据转换，不读取配置、网页正文或浏览器状态，不记录日志，不保存、下载或发送报告；具体界面决定何时展示及响应用户明确的导出操作。
 */

import type {TranslationErrorKind} from '../translation/errors';

export const DIAGNOSTIC_CODES = [
  'cancelled', 'offline', 'no-content', 'unsupported-page', 'page-unavailable', 'context-invalid',
  'authentication', 'model-configuration', 'configuration', 'configuration-save', 'rate-limit',
  'timeout', 'network', 'provider', 'unknown',
] as const;
export type DiagnosticCode = typeof DIAGNOSTIC_CODES[number];
export type DiagnosticAction = 'retry' | 'services' | 'site-settings' | 'refresh' | 'dismiss';
export interface Diagnostic {
  code: DiagnosticCode;
  titleKey: `diagnostics.${DiagnosticCode}.title`;
  detailKey: `diagnostics.${DiagnosticCode}.detail`;
  actions: DiagnosticAction[];
  /** 服务要求的最短等待时间；调用方应在等待期间禁用手动重试，不安排自动重试。 */
  retryAfterMs?: number;
}
export interface DiagnosticContext {
  reason?: 'no-content' | 'unsupported-page' | 'configuration' | 'configuration-save' | 'cancelled';
  online?: boolean;
}

const actions: Record<DiagnosticCode, DiagnosticAction[]> = {
  cancelled: ['retry', 'dismiss'],
  offline: ['retry', 'dismiss'],
  'no-content': ['retry', 'site-settings', 'dismiss'],
  'unsupported-page': ['dismiss'],
  'page-unavailable': ['refresh', 'dismiss'],
  'context-invalid': ['refresh', 'dismiss'],
  authentication: ['services', 'dismiss'],
  'model-configuration': ['services', 'dismiss'],
  configuration: ['services', 'dismiss'],
  'configuration-save': ['retry', 'dismiss'],
  'rate-limit': ['services', 'retry', 'dismiss'],
  timeout: ['retry', 'services', 'dismiss'],
  network: ['retry', 'services', 'dismiss'],
  provider: ['retry', 'services', 'dismiss'],
  unknown: ['retry', 'services', 'dismiss'],
};

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function duration(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.min(Number.MAX_SAFE_INTEGER, Math.ceil(value)) : undefined;
}

function makeDiagnostic(code: DiagnosticCode, retryAfterMs?: number): Diagnostic {
  return {
    code, titleKey: `diagnostics.${code}.title`, detailKey: `diagnostics.${code}.detail`,
    actions: [...actions[code]],
    ...(retryAfterMs === undefined ? {} : {retryAfterMs}),
  };
}

/** 跨消息边界只信任固定代码；动作、文案键以及冷却数据必须在接收端重新生成。 */
export function normalizeDiagnostic(value: unknown): Diagnostic | undefined {
  const candidate = record(value);
  if (!DIAGNOSTIC_CODES.includes(candidate.code as DiagnosticCode)) return undefined;
  const code = candidate.code as DiagnosticCode;
  return makeDiagnostic(code, code === 'rate-limit' ? duration(candidate.retryAfterMs) : undefined);
}

const kinds: readonly TranslationErrorKind[] = [
  'authentication', 'rate-limit', 'timeout', 'network', 'bad-request', 'provider', 'response', 'unknown',
];

/** 仅把原始消息当作旧接口的归因线索；返回值永远不携带消息、堆栈、请求 ID 或供应商详情。 */
export function diagnoseFailure(error: unknown, context: DiagnosticContext = {}): Diagnostic {
  const candidate = record(error);
  const message = typeof candidate.message === 'string' ? candidate.message : typeof error === 'string' ? error : '';
  const code = typeof candidate.code === 'string' ? candidate.code.toLowerCase() : '';
  const name = typeof candidate.name === 'string' ? candidate.name : '';
  if (context.reason === 'cancelled' || name === 'AbortError' || code === 'err_canceled' || code === 'abort_err') {
    return makeDiagnostic('cancelled');
  }
  if (context.reason) return makeDiagnostic(context.reason);
  if (/extension context invalidated/iu.test(message)) return makeDiagnostic('context-invalid');
  const status = typeof candidate.statusCode === 'number' ? candidate.statusCode : candidate.status;
  const knownKind = kinds.includes(candidate.kind as TranslationErrorKind) ? candidate.kind as TranslationErrorKind : undefined;
  // 供应商适配层已经知道的类型优先于模糊消息；HTTP 状态码只在类型缺失或未知时补充。
  const kind = knownKind && knownKind !== 'unknown' ? knownKind
    : status === 401 || status === 403 ? 'authentication'
    : status === 429 ? 'rate-limit'
    : status === 408 || status === 504 ? 'timeout'
    : typeof status === 'number' && status >= 500 && status <= 599 ? 'provider'
    : typeof status === 'number' && status >= 400 && status <= 499 ? 'bad-request'
    : undefined;
  if (kind === 'authentication') return makeDiagnostic('authentication');
  if (kind === 'rate-limit') return makeDiagnostic('rate-limit', duration(candidate.retryAfterMs));
  if (kind === 'timeout') return makeDiagnostic('timeout');
  if (kind === 'network') return makeDiagnostic(context.online === false ? 'offline' : 'network');
  if (kind === 'provider' || kind === 'response') return makeDiagnostic('provider');
  if (kind === 'bad-request') {
    return makeDiagnostic(/model|deployment|模型/iu.test(code + ' ' + message) ? 'model-configuration' : 'configuration');
  }
  if (/receiving end does not exist|could not establish connection|(?:没有|找不到|无)(?:消息)?接收端|接收端不存在/iu.test(message)) return makeDiagnostic('page-unavailable');
  if (/invalid_api_key|authentication|unauthorized|forbidden/iu.test(code)
      || /\b40[13]\b|api.?key.*(?:invalid|missing|expired)|unauthori[sz]ed|forbidden|鉴权|密钥.*(?:无效|未配置|过期)|凭据.*(?:无效|未配置)/iu.test(message)) return makeDiagnostic('authentication');
  if (/model_not_found|invalid_model|deployment_not_found/iu.test(code)
      || /(?:model|deployment).*(?:not found|not configured|missing|invalid)|invalid model|模型.*(?:未配置|不存在|无效)/iu.test(message)) return makeDiagnostic('model-configuration');
  if (/\b429\b|rate.?limit|quota|限流|配额|请求过于频繁/iu.test(code + ' ' + message)) return makeDiagnostic('rate-limit', duration(candidate.retryAfterMs));
  if (/timeout|timed out|超时/iu.test(code + ' ' + message) || name === 'TimeoutError') return makeDiagnostic('timeout');
  if (context.online === false) return makeDiagnostic('offline');
  if (/failed to fetch|networkerror|network error|网络/iu.test(message)) return makeDiagnostic('network');
  if (/\b5\d\d\b|服务.*(?:不可用|内部错误)/iu.test(message)) return makeDiagnostic('provider');
  return makeDiagnostic('unknown');
}

type Copy = {title: string; detail: string};
type DiagnosticLanguage = 'zh' | 'en' | 'ja' | 'ko' | 'fr' | 'ru' | 'es';
const text: Record<DiagnosticLanguage, Record<DiagnosticCode, Copy>> = {
  zh: {
    cancelled: {title: '翻译已取消', detail: '原文和当前设置已保留。准备好后可以再次翻译。'},
    offline: {title: '当前没有网络连接', detail: '恢复网络后重试。翻译内容和服务设置无需重新填写。'},
    'no-content': {title: '没有找到可翻译的正文', detail: '等待页面加载后重试，或检查此网站的翻译范围。也可以选中文字进行翻译。'},
    'unsupported-page': {title: '此页面无法直接翻译', detail: '浏览器内部页和扩展商店限制扩展访问。请在普通网页使用翻译。'},
    'page-unavailable': {title: '网页翻译组件暂不可用', detail: '刷新网页后重试，并检查扩展是否有此网站的访问权限。浏览器内部页和扩展商店请改用普通网页。'},
    'context-invalid': {title: '扩展已更新，需要刷新页面', detail: '保存页面上尚未提交的内容，再刷新网页以继续翻译。'},
    authentication: {title: '服务凭据或权限有问题', detail: '检查 API Key 是否有效，以及账号是否有当前模型的访问权限。也可以在服务设置中选择其他服务。'},
    'model-configuration': {title: '当前模型配置不可用', detail: '在服务设置中核对模型名称和接口地址，并测试连接；保存后返回这里重试。'},
    configuration: {title: '当前服务配置需要检查', detail: '在服务设置中检查接口地址、模型和请求参数，并测试连接；保存后返回这里重试。'},
    'configuration-save': {title: '配置尚未保存', detail: '连接检查尚未开始。请稍候重试；当前填写内容会保留。若持续失败，请重新打开设置页检查配置。'},
    'rate-limit': {title: '服务暂时限流或额度不足', detail: '等待服务恢复后重试，或在服务设置中检查额度、选择其他服务。你的选择不会被自动修改。'},
    timeout: {title: '翻译等待超时', detail: '可以重试；若持续超时，请检查网络或在服务设置中测试连接、调整请求超时。'},
    network: {title: '无法连接翻译服务', detail: '检查网络和代理后重试；若其他网页正常，请在服务设置中检查接口地址并测试连接。'},
    provider: {title: '服务暂时无法完成翻译', detail: '请稍后重试，或在服务设置中选择其他服务。'},
    unknown: {title: '翻译未完成', detail: '可以重试，或检查当前服务。诊断预览仅包含错误分类和必要的运行信息。'},
  },
  en: {
    cancelled: {title: 'Translation cancelled', detail: 'Your original text and settings are preserved. Translate again when ready.'},
    offline: {title: 'You appear to be offline', detail: 'Reconnect and retry. You do not need to enter your text or service settings again.'},
    'no-content': {title: 'No translatable text found', detail: 'Wait for the page to load and retry, or check this site’s translation scope. You can also select text to translate.'},
    'unsupported-page': {title: 'This page cannot be translated directly', detail: 'Browser internal pages and extension stores restrict extension access. Try translation on a regular webpage.'},
    'page-unavailable': {title: 'The page translation component is unavailable', detail: 'Refresh the page and retry, and check that the extension can access this website. Use a regular webpage instead of browser internal pages or extension stores.'},
    'context-invalid': {title: 'Refresh this page after the extension update', detail: 'Save any unsubmitted work on the page, then refresh to continue translating.'},
    authentication: {title: 'Check service credentials or permissions', detail: 'Check that your API key is valid and your account can access the selected model. You can also select another service in settings.'},
    'model-configuration': {title: 'The selected model is unavailable', detail: 'Check the model name and endpoint in service settings and test the connection. Save, then return here to retry.'},
    configuration: {title: 'Check the current service configuration', detail: 'Check the endpoint, model and request parameters in service settings and test the connection. Save, then return here to retry.'},
    'configuration-save': {title: 'Your configuration has not been saved', detail: 'The connection check has not started. Wait a moment and retry; your entered values are preserved. If this continues, reopen settings and check the configuration.'},
    'rate-limit': {title: 'The service is rate limited or out of quota', detail: 'Wait before retrying, or check quota and select another service in settings. Your selection will not change automatically.'},
    timeout: {title: 'Translation timed out', detail: 'Retry the translation. If this continues, check your network or test the connection and adjust the request timeout in service settings.'},
    network: {title: 'Cannot connect to the translation service', detail: 'Check your network and proxy, then retry. If other websites work, check the endpoint and test the connection in service settings.'},
    provider: {title: 'The service could not complete the translation', detail: 'Try again later or select another service in settings.'},
    unknown: {title: 'Translation did not complete', detail: 'Retry or check the selected service. The diagnostic preview contains only the failure category and essential runtime information.'},
  },
  ja: {
    "cancelled": {"title": "翻訳をキャンセルしました", "detail": "原文と現在の設定は保持されています。準備ができたら、もう一度翻訳できます。"},
    "offline": {"title": "ネットワークに接続されていません", "detail": "接続を回復してから再試行してください。翻訳する内容やサービスの設定を入力し直す必要はありません。"},
    "no-content": {"title": "翻訳できる本文が見つかりません", "detail": "ページの読み込みを待って再試行するか、このサイトの翻訳範囲を確認してください。テキストを選択して翻訳することもできます。"},
    "unsupported-page": {"title": "このページは直接翻訳できません", "detail": "ブラウザーの内部ページや拡張機能ストアは、拡張機能からのアクセスを制限しています。通常のウェブページで翻訳してください。"},
    "page-unavailable": {"title": "ページの翻訳コンポーネントを利用できません", "detail": "ページを再読み込みして再試行し、拡張機能にこのサイトへのアクセス権があるか確認してください。内部ページや拡張機能ストアでは、通常のウェブページを開いてください。"},
    "context-invalid": {"title": "拡張機能の更新後はページの再読み込みが必要です", "detail": "ページ上の未送信の内容を保存してから、ページを再読み込みして翻訳を続けてください。"},
    "authentication": {"title": "サービスの認証情報または権限を確認してください", "detail": "API Key が有効で、アカウントに現在のモデルを利用する権限があるか確認してください。サービス設定で別のサービスを選ぶこともできます。"},
    "model-configuration": {"title": "現在のモデルを利用できません", "detail": "サービス設定でモデル名と API アドレスを確認し、接続テストを行ってください。保存後にここへ戻って再試行してください。"},
    "configuration": {"title": "現在のサービス設定を確認してください", "detail": "サービス設定で API アドレス、モデル、リクエストのパラメーターを確認し、接続テストを行ってください。保存後にここへ戻って再試行してください。"},
    "configuration-save": {"title": "設定がまだ保存されていません", "detail": "接続テストはまだ始まっていません。少し待って再試行してください。入力内容は保持されています。解決しない場合は、設定ページを開き直して確認してください。"},
    "rate-limit": {"title": "サービスのリクエスト制限または利用枠に達しました", "detail": "サービスの回復を待って再試行するか、サービス設定で利用枠を確認して別のサービスを選んでください。選択は自動で変更されません。"},
    "timeout": {"title": "翻訳の待機時間を超えました", "detail": "再試行できます。繰り返し発生する場合は、ネットワークを確認するか、サービス設定で接続テストを行い、リクエストのタイムアウトを調整してください。"},
    "network": {"title": "翻訳サービスに接続できません", "detail": "ネットワークとプロキシを確認して再試行してください。他のサイトに接続できる場合は、サービス設定で API アドレスを確認し、接続テストを行ってください。"},
    "provider": {"title": "サービスが翻訳を完了できませんでした", "detail": "しばらくしてから再試行するか、サービス設定で別のサービスを選んでください。"},
    "unknown": {"title": "翻訳が完了しませんでした", "detail": "再試行するか、現在のサービスを確認してください。診断プレビューにはエラーの分類と必要な実行情報だけが含まれます。"},
  },
  ko: {
    "cancelled": {"title": "번역이 취소되었습니다", "detail": "원문과 현재 설정은 유지됩니다. 준비되면 다시 번역할 수 있습니다."},
    "offline": {"title": "네트워크에 연결되어 있지 않습니다", "detail": "네트워크에 다시 연결한 후 재시도하세요. 번역할 내용이나 서비스 설정을 다시 입력할 필요는 없습니다."},
    "no-content": {"title": "번역할 본문을 찾지 못했습니다", "detail": "페이지가 로드될 때까지 기다린 후 재시도하거나 이 사이트의 번역 범위를 확인하세요. 텍스트를 선택해 번역할 수도 있습니다."},
    "unsupported-page": {"title": "이 페이지는 직접 번역할 수 없습니다", "detail": "브라우저 내부 페이지와 확장 프로그램 스토어는 확장 프로그램의 접근을 제한합니다. 일반 웹페이지에서 번역을 사용하세요."},
    "page-unavailable": {"title": "페이지 번역 구성 요소를 사용할 수 없습니다", "detail": "페이지를 새로고침한 후 재시도하고 확장 프로그램에 이 사이트의 접근 권한이 있는지 확인하세요. 브라우저 내부 페이지나 확장 프로그램 스토어 대신 일반 웹페이지를 사용하세요."},
    "context-invalid": {"title": "확장 프로그램 업데이트 후 페이지 새로고침이 필요합니다", "detail": "페이지에서 아직 제출하지 않은 내용을 저장한 후 새로고침하여 번역을 계속하세요."},
    "authentication": {"title": "서비스 인증 정보나 권한을 확인하세요", "detail": "API Key가 유효한지, 계정에 현재 모델의 접근 권한이 있는지 확인하세요. 서비스 설정에서 다른 서비스를 선택할 수도 있습니다."},
    "model-configuration": {"title": "현재 모델을 사용할 수 없습니다", "detail": "서비스 설정에서 모델 이름과 API 주소를 확인하고 연결을 테스트하세요. 저장한 후 여기로 돌아와 다시 시도하세요."},
    "configuration": {"title": "현재 서비스 설정을 확인하세요", "detail": "서비스 설정에서 API 주소, 모델 및 요청 매개변수를 확인하고 연결을 테스트하세요. 저장한 후 여기로 돌아와 다시 시도하세요."},
    "configuration-save": {"title": "설정이 아직 저장되지 않았습니다", "detail": "연결 테스트가 아직 시작되지 않았습니다. 잠시 기다린 후 다시 시도하세요. 입력한 내용은 유지됩니다. 문제가 계속되면 설정 페이지를 다시 열어 확인하세요."},
    "rate-limit": {"title": "서비스 요청 한도나 사용량 한도에 도달했습니다", "detail": "서비스가 복구된 후 다시 시도하거나 서비스 설정에서 사용량을 확인하고 다른 서비스를 선택하세요. 선택한 서비스가 자동으로 변경되지는 않습니다."},
    "timeout": {"title": "번역 대기 시간이 초과되었습니다", "detail": "번역을 다시 시도하세요. 문제가 계속되면 네트워크를 확인하거나 서비스 설정에서 연결을 테스트하고 요청 제한 시간을 조정하세요."},
    "network": {"title": "번역 서비스에 연결할 수 없습니다", "detail": "네트워크와 프록시를 확인한 후 다시 시도하세요. 다른 웹사이트가 정상적으로 작동하면 서비스 설정에서 API 주소를 확인하고 연결을 테스트하세요."},
    "provider": {"title": "서비스가 번역을 완료하지 못했습니다", "detail": "잠시 후 다시 시도하거나 서비스 설정에서 다른 서비스를 선택하세요."},
    "unknown": {"title": "번역이 완료되지 않았습니다", "detail": "다시 시도하거나 현재 서비스를 확인하세요. 진단 미리보기에는 오류 분류와 필요한 실행 정보만 포함됩니다."},
  },
  fr: {
    "cancelled": {"title": "Traduction annulée", "detail": "Le texte original et vos réglages sont conservés. Relancez la traduction quand vous le souhaitez."},
    "offline": {"title": "Vous semblez hors ligne", "detail": "Reconnectez-vous, puis réessayez. Vous n’avez pas besoin de saisir à nouveau le texte ou les réglages du service."},
    "no-content": {"title": "Aucun texte à traduire trouvé", "detail": "Attendez le chargement de la page, puis réessayez, ou vérifiez la zone à traduire sur ce site. Vous pouvez aussi sélectionner du texte à traduire."},
    "unsupported-page": {"title": "Cette page ne peut pas être traduite directement", "detail": "Les pages internes du navigateur et les boutiques d’extensions limitent l’accès des extensions. Utilisez la traduction sur une page web ordinaire."},
    "page-unavailable": {"title": "Le composant de traduction de la page est indisponible", "detail": "Actualisez la page et réessayez. Vérifiez aussi que l’extension est autorisée à accéder à ce site. Utilisez une page web ordinaire plutôt qu’une page interne ou une boutique d’extensions."},
    "context-invalid": {"title": "Actualisez la page après la mise à jour de l’extension", "detail": "Enregistrez les éléments non envoyés sur la page, puis actualisez-la pour continuer à traduire."},
    "authentication": {"title": "Vérifiez les identifiants ou les autorisations du service", "detail": "Vérifiez que la clé API est valide et que votre compte a accès au modèle choisi. Vous pouvez aussi choisir un autre service dans les réglages."},
    "model-configuration": {"title": "Le modèle choisi est indisponible", "detail": "Vérifiez le nom du modèle et l’adresse de l’API dans les réglages du service, puis testez la connexion. Enregistrez et revenez ici pour réessayer."},
    "configuration": {"title": "Vérifiez la configuration du service actuel", "detail": "Vérifiez l’adresse de l’API, le modèle et les paramètres de requête dans les réglages du service, puis testez la connexion. Enregistrez et revenez ici pour réessayer."},
    "configuration-save": {"title": "Votre configuration n’est pas encore enregistrée", "detail": "Le test de connexion n’a pas commencé. Patientez un instant, puis réessayez ; les valeurs saisies sont conservées. Si le problème persiste, rouvrez les réglages et vérifiez la configuration."},
    "rate-limit": {"title": "Le service limite les requêtes ou le quota est épuisé", "detail": "Attendez avant de réessayer, ou vérifiez le quota et choisissez un autre service dans les réglages. Votre choix ne sera pas modifié automatiquement."},
    "timeout": {"title": "Le délai de traduction est dépassé", "detail": "Réessayez. Si le problème persiste, vérifiez le réseau ou testez la connexion et ajustez le délai des requêtes dans les réglages du service."},
    "network": {"title": "Connexion au service de traduction impossible", "detail": "Vérifiez le réseau et le proxy, puis réessayez. Si les autres sites fonctionnent, vérifiez l’adresse de l’API et testez la connexion dans les réglages du service."},
    "provider": {"title": "Le service n’a pas pu terminer la traduction", "detail": "Réessayez plus tard ou choisissez un autre service dans les réglages."},
    "unknown": {"title": "La traduction n’est pas terminée", "detail": "Réessayez ou vérifiez le service actuel. L’aperçu du diagnostic contient uniquement la catégorie d’erreur et les informations d’exécution nécessaires."},
  },
  ru: {
    "cancelled": {"title": "Перевод отменён", "detail": "Исходный текст и текущие настройки сохранены. Повторите перевод, когда будете готовы."},
    "offline": {"title": "Нет подключения к сети", "detail": "Восстановите подключение и повторите попытку. Вводить текст и настройки сервиса заново не нужно."},
    "no-content": {"title": "Текст для перевода не найден", "detail": "Дождитесь загрузки страницы и повторите попытку или проверьте область перевода для этого сайта. Также можно выделить текст и перевести его."},
    "unsupported-page": {"title": "Эту страницу нельзя перевести напрямую", "detail": "Внутренние страницы браузера и магазины расширений ограничивают доступ расширений. Используйте перевод на обычной веб-странице."},
    "page-unavailable": {"title": "Компонент перевода страницы недоступен", "detail": "Обновите страницу и повторите попытку. Проверьте, есть ли у расширения доступ к этому сайту. Вместо внутренних страниц браузера и магазинов расширений откройте обычную веб-страницу."},
    "context-invalid": {"title": "После обновления расширения нужно обновить страницу", "detail": "Сохраните неотправленные данные на странице, затем обновите её, чтобы продолжить перевод."},
    "authentication": {"title": "Проверьте ключи доступа и разрешения сервиса", "detail": "Убедитесь, что ключ API действителен, а у аккаунта есть доступ к выбранной модели. Также можно выбрать другой сервис в настройках."},
    "model-configuration": {"title": "Выбранная модель недоступна", "detail": "Проверьте имя модели и адрес API в настройках сервиса и протестируйте подключение. Сохраните настройки и вернитесь сюда, чтобы повторить попытку."},
    "configuration": {"title": "Проверьте текущие настройки сервиса", "detail": "Проверьте адрес API, модель и параметры запроса в настройках сервиса и протестируйте подключение. Сохраните настройки и вернитесь сюда, чтобы повторить попытку."},
    "configuration-save": {"title": "Настройки ещё не сохранены", "detail": "Проверка подключения ещё не началась. Подождите немного и повторите попытку; введённые значения сохранены. Если проблема не исчезнет, снова откройте настройки и проверьте конфигурацию."},
    "rate-limit": {"title": "Сервис ограничил запросы или квота исчерпана", "detail": "Подождите и повторите попытку либо проверьте квоту и выберите другой сервис в настройках. Ваш выбор не изменится автоматически."},
    "timeout": {"title": "Превышено время ожидания перевода", "detail": "Повторите попытку. Если проблема сохраняется, проверьте сеть либо протестируйте подключение и измените время ожидания запроса в настройках сервиса."},
    "network": {"title": "Не удалось подключиться к сервису перевода", "detail": "Проверьте сеть и прокси, затем повторите попытку. Если другие сайты работают, проверьте адрес API и протестируйте подключение в настройках сервиса."},
    "provider": {"title": "Сервис не смог завершить перевод", "detail": "Повторите попытку позже или выберите другой сервис в настройках."},
    "unknown": {"title": "Перевод не завершён", "detail": "Повторите попытку или проверьте текущий сервис. Предпросмотр диагностики содержит только категорию ошибки и необходимые сведения о работе расширения."},
  },
  es: {
    "cancelled": {"title": "Traducción cancelada", "detail": "El texto original y los ajustes se conservan. Vuelve a traducir cuando quieras."},
    "offline": {"title": "No hay conexión a la red", "detail": "Vuelve a conectarte y reintenta. No necesitas introducir otra vez el texto ni los ajustes del servicio."},
    "no-content": {"title": "No se encontró texto para traducir", "detail": "Espera a que se cargue la página y reintenta, o revisa el área de traducción de este sitio. También puedes seleccionar texto para traducirlo."},
    "unsupported-page": {"title": "Esta página no se puede traducir directamente", "detail": "Las páginas internas del navegador y las tiendas de extensiones limitan el acceso de las extensiones. Usa la traducción en una página web normal."},
    "page-unavailable": {"title": "El componente de traducción de la página no está disponible", "detail": "Recarga la página y reintenta. Comprueba también que la extensión tenga acceso a este sitio. Usa una página web normal en lugar de una página interna o una tienda de extensiones."},
    "context-invalid": {"title": "Recarga la página tras actualizar la extensión", "detail": "Guarda el contenido de la página que aún no hayas enviado y recárgala para seguir traduciendo."},
    "authentication": {"title": "Revisa las credenciales o los permisos del servicio", "detail": "Comprueba que la clave API sea válida y que tu cuenta tenga acceso al modelo elegido. También puedes elegir otro servicio en los ajustes."},
    "model-configuration": {"title": "El modelo elegido no está disponible", "detail": "Revisa el nombre del modelo y la dirección de la API en los ajustes del servicio y prueba la conexión. Guarda los cambios y vuelve aquí para reintentar."},
    "configuration": {"title": "Revisa la configuración del servicio actual", "detail": "Revisa la dirección de la API, el modelo y los parámetros de solicitud en los ajustes del servicio y prueba la conexión. Guarda los cambios y vuelve aquí para reintentar."},
    "configuration-save": {"title": "La configuración aún no se ha guardado", "detail": "La prueba de conexión no ha comenzado. Espera un momento y reintenta; se conservan los valores introducidos. Si el problema continúa, vuelve a abrir los ajustes y revisa la configuración."},
    "rate-limit": {"title": "El servicio limita las solicitudes o se ha agotado la cuota", "detail": "Espera antes de reintentar, o revisa la cuota y elige otro servicio en los ajustes. Tu elección no cambiará automáticamente."},
    "timeout": {"title": "Se agotó el tiempo de espera de la traducción", "detail": "Vuelve a intentarlo. Si el problema continúa, revisa la red o prueba la conexión y ajusta el tiempo de espera de las solicitudes en los ajustes del servicio."},
    "network": {"title": "No se puede conectar al servicio de traducción", "detail": "Revisa la red y el proxy y vuelve a intentarlo. Si otros sitios funcionan, revisa la dirección de la API y prueba la conexión en los ajustes del servicio."},
    "provider": {"title": "El servicio no pudo completar la traducción", "detail": "Vuelve a intentarlo más tarde o elige otro servicio en los ajustes."},
    "unknown": {"title": "La traducción no se completó", "detail": "Vuelve a intentarlo o revisa el servicio actual. La vista previa del diagnóstico solo incluye la categoría del error y la información de ejecución necesaria."},
  },
};
const labels: Record<DiagnosticLanguage, Record<DiagnosticAction, string>> = {
  zh: {retry: '重试', services: '检查翻译服务', 'site-settings': '检查网站范围', refresh: '刷新页面', dismiss: '关闭'},
  en: {retry: 'Retry', services: 'Check translation service', 'site-settings': 'Check site scope', refresh: 'Refresh page', dismiss: 'Dismiss'},
  ja: {"retry": "再試行", "services": "翻訳サービスを確認", "site-settings": "サイトの翻訳範囲を確認", "refresh": "ページを再読み込み", "dismiss": "閉じる"},
  ko: {"retry": "다시 시도", "services": "번역 서비스 확인", "site-settings": "사이트 번역 범위 확인", "refresh": "페이지 새로고침", "dismiss": "닫기"},
  fr: {"retry": "Réessayer", "services": "Vérifier le service", "site-settings": "Vérifier la zone du site", "refresh": "Actualiser la page", "dismiss": "Fermer"},
  ru: {"retry": "Повторить", "services": "Проверить сервис перевода", "site-settings": "Проверить область сайта", "refresh": "Обновить страницу", "dismiss": "Закрыть"},
  es: {"retry": "Reintentar", "services": "Revisar servicio de traducción", "site-settings": "Revisar área del sitio", "refresh": "Recargar página", "dismiss": "Cerrar"},
};
function language(locale: string): DiagnosticLanguage {
  const base = locale.toLowerCase().split(/[-_]/u)[0];
  return ['zh', 'en', 'ja', 'ko', 'fr', 'ru', 'es'].includes(base) ? base as DiagnosticLanguage : 'en';
}
export function getDiagnosticText(diagnostic: Pick<Diagnostic, 'code'>, locale = 'zh-CN'): Copy {
  return {...text[language(locale)][diagnostic.code]};
}
export function getDiagnosticActionLabel(action: DiagnosticAction, locale = 'zh-CN'): string {
  return labels[language(locale)][action];
}

export type DiagnosticUiTextKey = "preview" | "report" | "privacy" | "export" | "exportFailed" | "first-use-start" | "first-use-translating" | "first-use-ready" | "refresh-failed" | "source-closed" | "source-looking" | "source-return" | "source-unavailable" | "source-returned" | "source-return-hint";
const uiText: Record<DiagnosticLanguage, Record<DiagnosticUiTextKey, string>> = {
  zh: {
    "refresh-failed": "无法刷新网页，请手动刷新后重试。",
    "source-closed": "原网页已关闭，请重新打开网页。",
    "source-looking": "正在查找原网页…",
    "source-return": "返回原网页",
    "source-unavailable": "原网页已关闭或当前无法访问。请打开需要翻译的网页，再通过扩展重试。",
    "source-returned": "已返回原网页，可通过扩展重试翻译。",
    "source-return-hint": "检查服务后，返回原网页，通过扩展重试翻译。",
    "preview": "预览诊断",
    "report": "报告预览",
    "privacy": "仅在本地。只含状态和版本，不含正文、网址或凭据。",
    "export": "导出 JSON",
    "exportFailed": "导出失败，可选中预览内容复制。",
    "first-use-start": "打开外文网页，点击翻译即可开始。可在上方选择翻译服务。",
    "first-use-translating": "正在翻译，完成后可在网页中阅读译文。",
    "first-use-ready": "译文已显示。下次也可选中文字，或用快捷键翻译段落。",
  },
  en: {
    "refresh-failed": "Could not reload the page. Reload it manually and try again.",
    "source-closed": "The original page is closed. Open it again.",
    "source-looking": "Finding your page…",
    "source-return": "Return to your page",
    "source-unavailable": "The original page is closed or unavailable. Open the page you want to translate and retry from the extension.",
    "source-returned": "Your page is active. Retry translation from the extension.",
    "source-return-hint": "After checking your service, return to your page and retry translation from the extension.",
    "preview": "Preview report",
    "report": "Report preview",
    "privacy": "Local only. Contains status and version; no page text, URLs or credentials.",
    "export": "Export JSON",
    "exportFailed": "Export failed. Select and copy the preview.",
    "first-use-start": "Open a foreign-language page and translate. Choose a service above if needed.",
    "first-use-translating": "Translating. Read the result on the page when ready.",
    "first-use-ready": "Translation is ready. You can also select text or use the paragraph shortcut.",
  },
  ja: {
    "refresh-failed": "ページを再読み込みできませんでした。手動で再読み込みしてから再試行してください。",
    "source-closed": "元のページは閉じられています。もう一度開いてください。",
    "source-looking": "元のページを探しています…",
    "source-return": "元のページに戻る",
    "source-unavailable": "元のページは閉じられているか、現在アクセスできません。翻訳するページを開き、拡張機能から再試行してください。",
    "source-returned": "元のページに戻りました。拡張機能から翻訳を再試行できます。",
    "source-return-hint": "サービスを確認したら元のページに戻り、拡張機能から翻訳を再試行してください。",
    "preview": "診断をプレビュー",
    "report": "診断レポートのプレビュー",
    "privacy": "ローカルでのみ使用します。状態とバージョンだけを含み、本文、URL、認証情報は含みません。",
    "export": "JSON をエクスポート",
    "exportFailed": "エクスポートできませんでした。プレビューの内容を選択してコピーしてください。",
    "first-use-start": "外国語のページを開き、翻訳をクリックして開始します。上で翻訳サービスを選べます。",
    "first-use-translating": "翻訳中です。完了したらページ上で訳文を読めます。",
    "first-use-ready": "訳文を表示しました。次回はテキストの選択や段落翻訳のショートカットも使えます。",
  },
  ko: {
    "refresh-failed": "페이지를 새로고침하지 못했습니다. 직접 새로고침한 후 다시 시도하세요.",
    "source-closed": "원래 페이지가 닫혔습니다. 페이지를 다시 여세요.",
    "source-looking": "원래 페이지를 찾는 중…",
    "source-return": "원래 페이지로 돌아가기",
    "source-unavailable": "원래 페이지가 닫혔거나 현재 접근할 수 없습니다. 번역할 페이지를 열고 확장 프로그램에서 다시 시도하세요.",
    "source-returned": "원래 페이지로 돌아왔습니다. 확장 프로그램에서 번역을 다시 시도할 수 있습니다.",
    "source-return-hint": "서비스를 확인한 후 원래 페이지로 돌아가 확장 프로그램에서 번역을 다시 시도하세요.",
    "preview": "진단 미리보기",
    "report": "진단 보고서 미리보기",
    "privacy": "로컬에서만 사용합니다. 상태와 버전만 포함하며 본문, URL, 인증 정보는 포함하지 않습니다.",
    "export": "JSON 내보내기",
    "exportFailed": "내보내지 못했습니다. 미리보기 내용을 선택해 복사하세요.",
    "first-use-start": "외국어 페이지를 열고 번역을 누르면 시작됩니다. 위에서 번역 서비스를 선택할 수 있습니다.",
    "first-use-translating": "번역 중입니다. 완료되면 웹페이지에서 번역문을 읽을 수 있습니다.",
    "first-use-ready": "번역문이 표시되었습니다. 다음에는 텍스트를 선택하거나 문단 번역 단축키를 사용할 수도 있습니다.",
  },
  fr: {
    "refresh-failed": "Impossible d’actualiser la page. Actualisez-la manuellement, puis réessayez.",
    "source-closed": "La page d’origine est fermée. Rouvrez-la.",
    "source-looking": "Recherche de la page d’origine…",
    "source-return": "Revenir à la page d’origine",
    "source-unavailable": "La page d’origine est fermée ou inaccessible. Ouvrez la page à traduire, puis réessayez depuis l’extension.",
    "source-returned": "La page d’origine est active. Réessayez la traduction depuis l’extension.",
    "source-return-hint": "Après avoir vérifié le service, revenez à la page d’origine et réessayez la traduction depuis l’extension.",
    "preview": "Aperçu du diagnostic",
    "report": "Aperçu du rapport",
    "privacy": "En local uniquement. Contient l’état et la version, sans texte de page, URL ni identifiants.",
    "export": "Exporter en JSON",
    "exportFailed": "Échec de l’export. Sélectionnez et copiez l’aperçu.",
    "first-use-start": "Ouvrez une page en langue étrangère et lancez la traduction. Vous pouvez choisir un service ci-dessus.",
    "first-use-translating": "Traduction en cours. Le résultat sera lisible sur la page une fois prêt.",
    "first-use-ready": "La traduction est affichée. Vous pouvez aussi sélectionner du texte ou utiliser le raccourci de traduction des paragraphes.",
  },
  ru: {
    "refresh-failed": "Не удалось обновить страницу. Обновите её вручную и повторите попытку.",
    "source-closed": "Исходная страница закрыта. Откройте её снова.",
    "source-looking": "Поиск исходной страницы…",
    "source-return": "Вернуться к исходной странице",
    "source-unavailable": "Исходная страница закрыта или недоступна. Откройте нужную страницу и повторите попытку из расширения.",
    "source-returned": "Исходная страница открыта. Повторите перевод из расширения.",
    "source-return-hint": "Проверьте сервис, вернитесь к исходной странице и повторите перевод из расширения.",
    "preview": "Предпросмотр диагностики",
    "report": "Предпросмотр отчёта",
    "privacy": "Только локально. Содержит состояние и версию, без текста страницы, URL и учётных данных.",
    "export": "Экспорт JSON",
    "exportFailed": "Не удалось экспортировать. Выделите и скопируйте содержимое предпросмотра.",
    "first-use-start": "Откройте страницу на иностранном языке и нажмите кнопку перевода. Сервис можно выбрать выше.",
    "first-use-translating": "Идёт перевод. Когда он завершится, результат появится на странице.",
    "first-use-ready": "Перевод отображён. В следующий раз можно также выделить текст или использовать сочетание клавиш для перевода абзаца.",
  },
  es: {
    "refresh-failed": "No se pudo recargar la página. Recárgala manualmente y vuelve a intentarlo.",
    "source-closed": "La página original está cerrada. Vuelve a abrirla.",
    "source-looking": "Buscando la página original…",
    "source-return": "Volver a la página original",
    "source-unavailable": "La página original está cerrada o no está disponible. Abre la página que quieras traducir y vuelve a intentarlo desde la extensión.",
    "source-returned": "La página original está activa. Vuelve a intentar la traducción desde la extensión.",
    "source-return-hint": "Después de comprobar el servicio, vuelve a la página original y reintenta la traducción desde la extensión.",
    "preview": "Ver diagnóstico",
    "report": "Vista previa del informe",
    "privacy": "Solo en local. Incluye el estado y la versión; sin texto de página, URL ni credenciales.",
    "export": "Exportar JSON",
    "exportFailed": "La exportación falló. Selecciona y copia la vista previa.",
    "first-use-start": "Abre una página en otro idioma y pulsa traducir para empezar. Puedes elegir un servicio arriba.",
    "first-use-translating": "Traduciendo. Podrás leer el resultado en la página cuando esté listo.",
    "first-use-ready": "La traducción está lista. También puedes seleccionar texto o usar el atajo de traducción de párrafos.",
  },
};
/** 诊断界面与首次翻译提示共用固定纯文案，不读取配置或收集运行状态。 */
export function getDiagnosticUiText(key: DiagnosticUiTextKey, locale = 'zh-CN'): string {
  return uiText[language(locale)][key];
}

const FEATURES = ['popup', 'page', 'services', 'selection', 'hover', 'document', 'image', 'video', 'unknown'] as const;
const SERVICE_TYPES = ['free', 'traditional', 'ai', 'custom', 'composite', 'local', 'unknown'] as const;
export interface DiagnosticReportInput {
  diagnostic: Pick<Diagnostic, 'code' | 'retryAfterMs'>;
  feature?: typeof FEATURES[number];
  serviceType?: typeof SERVICE_TYPES[number];
  extensionVersion?: string;
  online?: boolean;
}
export interface DiagnosticReport {
  schemaVersion: 1;
  diagnostic: {code: DiagnosticCode; retryAfterMs?: number};
  feature?: typeof FEATURES[number];
  serviceType?: typeof SERVICE_TYPES[number];
  extensionVersion?: string;
  online?: boolean;
}

/** 用户请求预览时才调用；即使调用方误传整个 Error、配置或恶意对象，也只投影白名单标量。 */
export function buildDiagnosticReport(input: DiagnosticReportInput): DiagnosticReport {
  const source = record(input);
  const diagnostic = record(source.diagnostic);
  const code = DIAGNOSTIC_CODES.includes(diagnostic.code as DiagnosticCode) ? diagnostic.code as DiagnosticCode : 'unknown';
  const retryAfterMs = code === 'rate-limit' ? duration(diagnostic.retryAfterMs) : undefined;
  return {
    schemaVersion: 1,
    diagnostic: {code, ...(retryAfterMs === undefined ? {} : {retryAfterMs})},
    ...(FEATURES.includes(source.feature as typeof FEATURES[number]) ? {feature: source.feature as typeof FEATURES[number]} : {}),
    ...(SERVICE_TYPES.includes(source.serviceType as typeof SERVICE_TYPES[number]) ? {serviceType: source.serviceType as typeof SERVICE_TYPES[number]} : {}),
    ...(typeof source.extensionVersion === 'string' && /^\d{1,4}(?:\.\d{1,4}){1,3}$(?![\s\S])/u.test(source.extensionVersion) ? {extensionVersion: source.extensionVersion} : {}),
    ...(typeof source.online === 'boolean' ? {online: source.online} : {}),
  };
}
