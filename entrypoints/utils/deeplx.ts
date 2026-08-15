/**
 * The public endpoint is an unofficial DeepLX deployment. Keep it explicit so
 * users can replace it with a local or self-hosted endpoint at any time.
 */
export const DEFAULT_DEEPLX_ENDPOINT = "https://deeplx.1stg.me/translate"

export const DEEPLX_ENDPOINT_PRESETS = [
  {
    label: "1stG 公共站点（免 Key，已验证）",
    url: DEFAULT_DEEPLX_ENDPOINT,
  },
  {
    label: "Fanyimao 公共站点（需站点 Token，已验证）",
    url: "https://freeapi.fanyimao.cn/translate?token={{apiKey}}",
  },
  {
    label: "DeepLX 社区站点（需个人 Token）",
    url: "https://api.deeplx.org/{{apiKey}}/translate",
  },
  {
    label: "本地 DeepLX（需自行运行）",
    url: "http://localhost:1188/translate",
  },
] as const

const DEEPLX_TOKEN_PLACEHOLDER = /\{\{(?:apiKey|token)\}\}/g

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

export function getDeepLXEndpoints(configuredURL: unknown, proxyURL: unknown, token = ""): string[] {
  const proxyEndpoints = parseDeepLXEndpoints(proxyURL)
  if (proxyEndpoints.length > 0) {
    const resolvedProxyEndpoints = proxyEndpoints.map((endpoint) => resolveDeepLXEndpoint(endpoint, token)).filter((endpoint): endpoint is string => endpoint !== null)
    return resolvedProxyEndpoints.length > 0 ? resolvedProxyEndpoints : [DEFAULT_DEEPLX_ENDPOINT]
  }

  const configuredEndpoints = parseDeepLXEndpoints(configuredURL)
  const endpoints = configuredEndpoints.length > 0 ? configuredEndpoints : [DEFAULT_DEEPLX_ENDPOINT]
  const resolvedEndpoints = endpoints.map((endpoint) => resolveDeepLXEndpoint(endpoint, token)).filter((endpoint): endpoint is string => endpoint !== null)
  return resolvedEndpoints.length > 0 ? resolvedEndpoints : [DEFAULT_DEEPLX_ENDPOINT]
}
