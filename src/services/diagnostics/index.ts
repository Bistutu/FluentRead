/**
 * @file src/services/diagnostics/index.ts
 * 文件职责：将翻译与页面失败映射为可复用、可操作且不会泄露供应商原始消息的自助诊断。
 * 主要内容：定义稳定的诊断代码、动作和中英文文案，按结构化错误优先归因，并用严格白名单生成供用户预览的本地报告。
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
const text: Record<'zh' | 'en', Record<DiagnosticCode, Copy>> = {
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
};
const labels: Record<'zh' | 'en', Record<DiagnosticAction, string>> = {
  zh: {retry: '重试', services: '检查翻译服务', 'site-settings': '检查网站范围', refresh: '刷新页面', dismiss: '关闭'},
  en: {retry: 'Retry', services: 'Check translation service', 'site-settings': 'Check site scope', refresh: 'Refresh page', dismiss: 'Dismiss'},
};
function language(locale: string): 'zh' | 'en' { return locale.toLowerCase().startsWith('zh') ? 'zh' : 'en'; }
export function getDiagnosticText(diagnostic: Pick<Diagnostic, 'code'>, locale = 'zh-CN'): Copy {
  return {...text[language(locale)][diagnostic.code]};
}
export function getDiagnosticActionLabel(action: DiagnosticAction, locale = 'zh-CN'): string {
  return labels[language(locale)][action];
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
