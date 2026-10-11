import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {createServer, type ViteDevServer} from 'vite'
import vue from '@vitejs/plugin-vue'
import {createRequire} from 'node:module'
import {resolve} from 'node:path'
import {readFileSync} from 'node:fs'
import {gzipSync} from 'node:zlib'
import {services} from '@/src/core/config/catalog'
import paths from '@/src/ui/assets/serviceBrandPaths.json'

const require = createRequire(import.meta.url)
const {createSSRApp} = require('vue') as typeof import('vue')
const {renderToString} = require('vue/server-renderer') as typeof import('vue/server-renderer')
let server: ViteDevServer
let component: import('vue').Component
beforeAll(async () => {
  server = await createServer({configFile: false, logLevel: 'silent', appType: 'custom',
    resolve: {alias: {'@': resolve(process.cwd(), '.')}}, server: {middlewareMode: true, hmr: false}, plugins: [vue()]})
  component = (await server.ssrLoadModule('/src/ui/components/ServiceIcon.vue')).default
})
afterAll(async () => {await server?.close()})
const render = (service: string, size = 'small') => renderToString(createSSRApp(component, {service, size}))

describe('local service SVG icons', () => {
  it('renders every built-in provider and custom profile as SVG without letter or network fallbacks', async () => {
    for (const service of [...Object.values(services), 'custom:work']) {
      const html = await render(service)
      expect(html, service).toContain('<svg')
      expect(html, service).not.toContain('data-service-icon-fallback')
      expect(html, service).not.toMatch(/<(?:img|image|text)\b|v-html|https?:\/\//u)
    }
    expect(await render('unknown')).toContain('data-service-icon-fallback')
    expect(await render('custom:work')).not.toContain('data-brand-icon')
  })

  it('renders every sourced brand path in small and large variants', async () => {
    for (const [service, shape] of Object.entries(paths)) {
      for (const size of ['small', 'large']) {
        const html = await render(service, size)
        expect(html).toContain(`service-brand-icon--${size}`)
        expect(html).toContain('data-brand-icon')
        expect(html.match(/<path\b/gu)?.length, service).toBe(shape.length)
      }
    }
  })

  it('reuses the Doubao brand for the free web node without a network fallback', async () => {
    const html = await render('doubaoWeb')
    expect(html).toContain('data-service="doubaoWeb"')
    expect(html).toContain('data-brand-icon')
    expect(html.match(/<path\b/gu)?.length).toBe(paths.doubao.length)
    expect(html).not.toContain('data-service-icon-fallback')
    expect(html).not.toMatch(/<(?:img|image)\b|https?:\/\//u)
  })

  it('keeps static paths small and excludes SVG scripting, links, IDs and external resources', () => {
    for (const shape of Object.values(paths)) for (const attributes of shape) {
      expect(Object.keys(attributes).every(key => ['d', 'clip-rule', 'fill-rule', 'opacity', 'fill-opacity'].includes(key))).toBe(true)
      expect(attributes.d).toMatch(/^[MmLlHhVvCcSsQqTtAaZzEe0-9.,+\-\s]+$/u)
    }
    const bytes = readFileSync(resolve('src/ui/assets/serviceBrandPaths.json'))
    expect(bytes.length).toBeLessThan(45_000)
    expect(gzipSync(bytes).length).toBeLessThan(18_000)
    expect(readFileSync(resolve('public/third-party-notices/lobe-icons-MIT.txt'), 'utf8')).toContain('Copyright (c) 2023 LobeHub')
  })
})
