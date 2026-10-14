/**
 * @file src/core/config/deeplx.ts
 *
 * 文件职责：维护 DeepLX 端点预设及多端点解析规则，为请求适配器提供确定、有序且可替换令牌的候选地址。
 * 主要内容：声明 DEFAULT_DEEPLX_ENDPOINT，解析换行或逗号分隔的自定义地址，并在 getDeepLXEndpoints 中合并配置 URL、代理和 token 占位符。 可核对的公开符号包括 DEFAULT_DEEPLX_ENDPOINT、parseDeepLXEndpoints、getDeepLXEndpoints。
 * 模块边界：本文件属于 core 领域层，只定义规则、类型与纯转换；不直接读写浏览器存储、不发起网络请求、不挂载 Vue/WXT 入口，持久化、协议调用和界面编排分别由 services、providers 与 features 承担。
 */

/**
 * 旧配置仍保存这个公共地址；无凭据的默认配置先由 provider 直连 DeepL，
 * 此地址仅作为失败后的备用，用户自建地址和代理继续保持指定的请求边界。
 */
export const DEFAULT_DEEPLX_ENDPOINT = "https://deeplx.1stg.me/translate"

const DEEPLX_TOKEN_PLACEHOLDER = /\{\{(?:apiKey|token)\}\}/g
const DEEPLX_TOKEN_PLACEHOLDER_CHECK = /\{\{(?:apiKey|token)\}\}/

const DEEPLX_ENDPOINT_SEPARATOR = /[\n,]+/

export function parseDeepLXEndpoints(value: unknown): string[] {
  if (typeof value !== "string") {
    return []
  }

  return [...new Set(value.split(DEEPLX_ENDPOINT_SEPARATOR).map((endpoint) => endpoint.trim()).filter(Boolean))]
}

function resolveDeepLXEndpoint(endpoint: string, token: string): string | null {
  if (DEEPLX_TOKEN_PLACEHOLDER.test(endpoint) && !token) {
    DEEPLX_TOKEN_PLACEHOLDER.lastIndex = 0
    return null
  }

  DEEPLX_TOKEN_PLACEHOLDER.lastIndex = 0
  return endpoint.replace(DEEPLX_TOKEN_PLACEHOLDER, encodeURIComponent(token))
}

/** 判断当前生效的 DeepLX 地址是否全部要求 API Key；proxy 地址优先。 */
export function requiresDeepLXToken(configuredURL: unknown, proxyURL: unknown): boolean {
  const proxyEndpoints = parseDeepLXEndpoints(proxyURL)
  const endpoints = proxyEndpoints.length > 0
    ? proxyEndpoints
    : (() => {
      const configuredEndpoints = parseDeepLXEndpoints(configuredURL)
      return configuredEndpoints.length > 0 ? configuredEndpoints : [DEFAULT_DEEPLX_ENDPOINT]
    })()
  return endpoints.length > 0 && endpoints.every((endpoint) => DEEPLX_TOKEN_PLACEHOLDER_CHECK.test(endpoint))
}

export function getDeepLXEndpoints(configuredURL: unknown, proxyURL: unknown, token = ""): string[] {
  const proxyEndpoints = parseDeepLXEndpoints(proxyURL)
  const configuredEndpoints = parseDeepLXEndpoints(configuredURL)
  const endpoints = proxyEndpoints.length > 0
    ? proxyEndpoints
    : configuredEndpoints.length > 0 ? configuredEndpoints : [DEFAULT_DEEPLX_ENDPOINT]
  const resolvedEndpoints = endpoints.map((endpoint) => resolveDeepLXEndpoint(endpoint, token)).filter((endpoint): endpoint is string => endpoint !== null)
  if (resolvedEndpoints.length > 0) return resolvedEndpoints
  // 候选为空只可能是所有地址均含占位符且未提供令牌；保留用户指定的地址边界。
  throw new Error('DeepLX 地址包含 {{apiKey}} 或 {{token}} 占位符，请填写 API Key；无 Key 地址请移除占位符。')
}
