/**
 * The public endpoint is an unofficial DeepLX deployment. Keep it explicit so
 * users can replace it with a local or self-hosted endpoint at any time.
 */
export const DEFAULT_DEEPLX_ENDPOINT = "https://deeplx.1stg.me/translate"

const DEEPLX_ENDPOINT_SEPARATOR = /[\n,]+/

export function parseDeepLXEndpoints(value: unknown): string[] {
  if (typeof value !== "string") {
    return []
  }

  return [...new Set(value.split(DEEPLX_ENDPOINT_SEPARATOR).map((endpoint) => endpoint.trim()).filter(Boolean))]
}

export function getDeepLXEndpoints(configuredURL: unknown, proxyURL: unknown): string[] {
  const proxyEndpoints = parseDeepLXEndpoints(proxyURL)
  if (proxyEndpoints.length > 0) {
    return proxyEndpoints
  }

  const configuredEndpoints = parseDeepLXEndpoints(configuredURL)
  return configuredEndpoints.length > 0 ? configuredEndpoints : [DEFAULT_DEEPLX_ENDPOINT]
}
