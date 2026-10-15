#!/usr/bin/env node
// Capture current production extension UI in a fresh, focus-safe profile.
// Retain 2x source PNGs and lossless WebP; no credentials or live provider calls.
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  http = require('node:http'),
  assert = require('node:assert/strict')
const { createRequire } = require('node:module')
const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const arg = (name) => {
  const index = process.argv.indexOf('--' + name, 2)
  const value = index < 0 ? undefined : process.argv[index + 1]
  if (!value || value.startsWith('--')) throw Error(`Missing value for --${name}`)
  return value
}
const runtimePath = arg('runtime'),
  helperPath = arg('helper')
const { guardBrowserClose } = require('./testing/owned-browser-close.cjs')
const runtime = createRequire(path.join(runtimePath, 'docs-ui.cjs'))
const { chromium } = runtime('playwright'),
  sharp = runtime('sharp')
const helper = require(helperPath)
const root = path.resolve(__dirname, '..')
const report = {
  extension: '.output/chrome-mv3',
  sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim(),
  version: JSON.parse(fs.readFileSync(path.join(root, '.output/chrome-mv3/manifest.json'), 'utf8'))
    .version,
  sourceDirty: Boolean(
    execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()
  ),
  sourceFiles: Object.fromEntries(
    [
      'src/features/translation-center/ui/TranslationCenter.vue',
      'src/ui/components/UiLanguageOnboarding.vue',
      'src/app/popup/PopupApp.vue',
      'src/features/settings/ui/SettingsSections.vue',
      'src/features/settings/ui/services/ServiceConfiguration.vue',
      'src/features/settings/ui/services/ServiceCatalog.vue',
    ].map((file) => [
      file,
      createHash('sha256')
        .update(fs.readFileSync(path.join(root, file)))
        .digest('hex'),
    ])
  ),
  scale: 2,
  screenshots: [],
  errors: [],
}
let profile, server, launched
let launchAttempted = false, browserGuarded = false, hasPrimaryError = false
;(async () => {
  profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-docs-ui-'))
  server = http.createServer((_, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(
      '<!doctype html><html lang="en"><meta charset="utf-8"><title>Reading example</title><main><h1>A world worth exploring.</h1><p>Every language offers a new way to see the world.</p></main></html>'
    )
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  launchAttempted = true
  launched = await helper.launchFocusSafePersistentContext({
    chromium,
    profileDir: profile,
    browserPath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    background: true,
    headless: false,
    viewport: { width: 1280, height: 800 },
    browserArgs: [
      `--disable-extensions-except=${root}/.output/chrome-mv3`,
      `--load-extension=${root}/.output/chrome-mv3`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
    timeout: 30000,
  })
  guardBrowserClose(launched, profile)
  browserGuarded = true
  Object.assign(report, {
    launchMode: launched.launchMode,
    focusPolicy: launched.focusPolicy,
    windowPlacement: launched.windowPlacement,
  })
  const ctx = launched.context
  const worker =
    ctx.serviceWorkers()[0] || (await ctx.waitForEvent('serviceworker', { timeout: 30000 }))
  const origin = worker.url().split('/').slice(0, 3).join('/')
  const create = async () => {
    const page = await helper.newPageWithoutForeground(ctx, 30000)
    page.on('pageerror', (e) => report.errors.push(e.message))
    return page
  }
  const article = await create()
  await article.goto('http://127.0.0.1:' + server.address().port)
  const popup = await create()
  await popup.goto(origin + '/popup.html')
  await popup.locator('.popup-shell[data-config-ready="true"]').waitFor()
  for (const locale of ['zh-CN', 'en-US']) {
    const result = await popup.evaluate(async (locale) => {
      const read = await chrome.runtime.sendMessage({
        type: 'configStorageRead',
        key: 'local:config',
      })
      if (!read.success) throw Error(read.error)
      const old = typeof read.value === 'string' ? JSON.parse(read.value) : read.value
      return chrome.runtime.sendMessage({
        type: 'persistConfig',
        mode: 'replace',
        baseRevision: old.__fluentConfigRevision,
        clientId: 'docs-ui-' + crypto.randomUUID(),
        sequence: 1,
        config: {
          ...old,
          uiLanguage: locale,
          uiLanguageSetupCompleted: false,
          service: 'freeTranslation',
          from: 'auto',
          to: locale === 'en-US' ? 'en' : 'zh-Hans',
        },
      })
    }, locale)
    assert.equal(result.success, true, result.error)
    await helper.activateExtensionTabWithoutForeground(ctx, article, 30000)
    await popup.reload()
    await popup.locator('.popup-shell[data-config-ready="true"]').waitFor()
    const sourceDir = path.join(root, 'marketing/source/site-ui', locale)
    const webDir = path.join(root, 'docs/public/screenshots/ui', locale)
    fs.mkdirSync(sourceDir, { recursive: true })
    fs.mkdirSync(webDir, { recursive: true })
    async function capture(page, name, selector, targets = []) {
      const w = name.startsWith('popup') ? 360 : 1280,
        h = 800
      await page.setViewportSize({ width: w, height: h })
      await page.evaluate(() => document.fonts.ready)
      const cdp = await ctx.newCDPSession(page)
      let captureFailed = false
      try {
        await cdp.send('Emulation.setDeviceMetricsOverride', {
          width: w,
          height: h,
          deviceScaleFactor: 2,
          mobile: false,
        })
        const rect = selector
          ? await page.locator(selector).boundingBox()
          : { x: 0, y: 0, width: w, height: h }
        assert(rect, selector)
        const clip = {
          x: Math.floor(rect.x),
          y: Math.floor(rect.y),
          width: Math.ceil(rect.width),
          height: Math.ceil(rect.height),
          scale: 1,
        }
        const data = await cdp.send('Page.captureScreenshot', {
          format: 'png',
          fromSurface: true,
          captureBeyondViewport: true,
          clip,
        })
        const buffer = Buffer.from(data.data, 'base64'),
          source = path.join(sourceDir, name + '.png'),
          web = path.join(webDir, name + '.webp')
        fs.writeFileSync(source, buffer)
        await sharp(buffer).webp({ lossless: true, effort: 6 }).toFile(web)
        const meta = await sharp(web).metadata()
        assert.equal(meta.width, clip.width * 2)
        assert.equal(meta.height, clip.height * 2)
        assert(
          (await sharp(buffer).ensureAlpha().raw().toBuffer()).equals(
            await sharp(web).ensureAlpha().raw().toBuffer()
          )
        )
        const points = []
        for (const target of targets) {
          const box = await page
            .locator(target + ':visible')
            .first()
            .boundingBox()
          assert(box, 'Missing visible target: ' + target)
          const centerX = box.x + box.width / 2,
            centerY = box.y + box.height / 2
          assert(
            centerX >= rect.x && centerX <= rect.x + rect.width &&
              centerY >= rect.y && centerY <= rect.y + rect.height,
            'Target outside screenshot: ' + target
          )
          points.push({
            x: ((centerX - rect.x) / rect.width) * 100,
            y: ((centerY - rect.y) / rect.height) * 100,
          })
        }
        report.screenshots.push({
          points,
          locale,
          name,
          source: path.relative(root, source),
          web: path.relative(root, web),
          width: meta.width,
          height: meta.height,
          bytes: fs.statSync(web).size,
          losslessPixels: true,
        })
      } catch (error) {
        captureFailed = true
        throw error
      } finally {
        try {
          await cdp.detach()
        } catch (error) {
          if (!captureFailed) throw error
          console.error('Failed to detach screenshot session:', error)
        }
      }
    }
    await popup.locator('[data-testid="onboarding-language-step"]').waitFor()
    await capture(popup, 'popup-language-initial', '.popup-shell')
    await popup.locator('[data-language="' + locale + '"]').click()
    await capture(popup, 'popup-language', '.popup-shell')
    await popup.locator('.onboarding-confirm').last().click()
    await popup.locator('.feature-card').first().waitFor()
    await capture(popup, 'popup', '.popup-shell')
    const settings = await create()
    await settings.goto(origin + '/options.html#settings-general')
    await settings.locator('.sidebar').waitFor()
    await capture(settings, 'settings-general')
    await settings.locator('.sidebar [data-section="settings-services"]').click()
    await settings.locator('.service-catalog').waitFor()
    await capture(settings, 'settings-services')
    const sections = {
      'settings-general': [
        '.sidebar [data-section="settings-general"]',
        '[data-testid="translation-language-setting"] .fluentread-select',
        '[data-testid="default-translation-service-card"]',
      ],
      'settings-interface': [
        '.sidebar [data-section="settings-interface"]',
        '.translation-style-gallery button',
        '.translation-style-stage',
      ],
      'settings-translation-center': [
        '.translation-editor',
        '.add-service-button',
        '.translate-primary-button',
      ],
      'settings-data': [
        '.sidebar [data-section="settings-data"]',
        '.transfer-actions button:nth-child(1)',
        '.transfer-actions button:nth-child(2)',
      ],
      'settings-glossary': [
        '.sidebar [data-section="settings-glossary"]',
        '.glossary-start .primary',
        '.glossary-builtins-page button',
      ],
      'settings-sites': [
        '.sidebar [data-section="settings-sites"]',
        '.preference-add',
        '.settings-page-tabs button:last-child',
      ],
      'settings-translation-stats': [
        '.sidebar [data-section="settings-translation-stats"]',
        '.stats-range',
        '.stats-summary',
      ],
      'settings-vocabulary': [
        '.sidebar [data-section="settings-vocabulary"]',
        '.collection-overview',
        '.vocabulary-book',
      ],
    }
    for (const [name, targets] of Object.entries(sections)) {
      await settings.locator('.sidebar [data-section="' + name + '"]').click()
      await settings.waitForTimeout(250)
      if (name === 'settings-translation-center') await settings.locator('.example-button').click()
      await capture(settings, name, undefined, targets)
    }
    await settings.locator('.sidebar [data-section="settings-services"]').click()
    await settings.locator('[data-service-value="openai"]').click()
    await settings.waitForTimeout(250)
    await capture(settings, 'settings-provider', undefined, [
      '[data-service-value="openai"]',
      '.api-key-entry input',
      '.sidebar [data-section="settings-general"]',
    ])
    await settings.close()
  }
  assert.deepEqual(report.errors, [])
  const guides = Object.fromEntries(
    ['zh-CN', 'en-US'].map((locale) => [
      locale,
      Object.fromEntries(
        report.screenshots
          .filter((item) => item.locale === locale && item.points.length)
          .map((item) => [
            item.name,
            {
              src: '/' + item.web.replace('docs/public/', ''),
              width: item.width,
              height: item.height,
              points: item.points,
            },
          ])
      ),
    ])
  )
  fs.writeFileSync(
    path.join(root, 'docs/.vitepress/theme/guide-ui.json'),
    JSON.stringify(guides, null, 2) + '\n'
  )
})()
  .catch((e) => {
    hasPrimaryError = true
    report.error = e?.stack || String(e)
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    const cleanupErrors = []
    const cleanup = async (resource, release) => {
      try { await release() } catch (error) {
        cleanupErrors.push(error)
        ;(report.cleanupErrors ||= []).push({resource, error: String(error?.stack || error)})
        console.error(`Failed to clean up ${resource}:`, error)
        process.exitCode = 1
      }
    }
    let browserClosed = false
    await cleanup('browser', async () => {
      if (browserGuarded) { await launched.close(); browserClosed = true }
    })
    await cleanup('server connections', () => server?.closeAllConnections())
    await cleanup('server', async () => {
      if (!server) return
      await new Promise((resolve, reject) => server.close((error) => {
        if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error)
        else resolve()
      }))
    })
    await cleanup('profile', () => {
      if (!profile) return
      if (browserClosed || !launchAttempted) fs.rmSync(profile, { recursive: true, force: true })
      else {
        report.retainedProfile = profile
        report.retainedProfileLaunchAttempted = launchAttempted
      }
    })
    await cleanup('report', () => fs.writeFileSync(
      path.join(root, 'marketing/site-ui-manifest.json'),
      JSON.stringify(report, null, 2) + '\n'
    ))
    if (cleanupErrors.length && !hasPrimaryError) throw cleanupErrors[0]
    if (!hasPrimaryError) console.log(JSON.stringify(report))
  })
  .catch((error) => { console.error(error); process.exitCode = 1 })
