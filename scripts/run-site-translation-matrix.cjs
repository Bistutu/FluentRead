#!/usr/bin/env node

// 顺序运行真实站点矩阵。默认只运行 required case，并对每个 case 依次执行
// hover/full；每个子进程仍由 run-site-translation-test.cjs 创建独立 profile。

const fs = require('node:fs');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {
  normalizeCoverageRules,
  normalizeHoverTargets,
  validateCoverageRules,
} = require('./run-site-translation-test.cjs');

const CASES_PATH = path.join(__dirname, '..', 'tests', 'browser-translation-cases.json');
const CASE_RUNNER = path.join(__dirname, 'run-site-translation-test.cjs');
const CASES = JSON.parse(fs.readFileSync(CASES_PATH, 'utf8'));
const HOST_MUTABLE_FORBIDDEN_SELECTORS = new Set(['.MathJax_Display']);

function parseArgs(argv) {
  const args = {
    background: true,
    includeQuarantine: false,
    failOnQuarantine: false,
    list: false,
    mode: 'both',
    cases: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--') continue;
    if (token === '--background') continue;
    if (token === '--headed') {
      args.background = false;
      continue;
    }
    if (token === '--include-quarantine') {
      args.includeQuarantine = true;
      continue;
    }
    if (token === '--fail-on-quarantine') {
      args.failOnQuarantine = true;
      continue;
    }
    if (token === '--list') {
      args.list = true;
      continue;
    }
    if (!token.startsWith('--')) throw new Error(`无法识别参数：${token}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`参数缺少值：${token}`);
    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (key === 'case' || key === 'cases') {
      args.cases.push(...value.split(',').map((name) => name.trim()).filter(Boolean));
    } else {
      args[key] = value;
    }
    index += 1;
  }

  if (!['hover', 'full', 'both'].includes(args.mode)) throw new Error('--mode 必须是 hover、full 或 both');
  if (args.timeout !== undefined && (!Number.isFinite(Number(args.timeout)) || Number(args.timeout) <= 0)) {
    throw new Error('--timeout 必须为正数');
  }
  if (args.jobTimeout !== undefined && (!Number.isFinite(Number(args.jobTimeout)) || Number(args.jobTimeout) <= 0)) {
    throw new Error('--job-timeout 必须为正数');
  }
  if (!args.list && !args.extensionDir) throw new Error('必须传入 --extension-dir');
  if (!args.list && !args.playwrightRoot) throw new Error('必须传入 --playwright-root');
  return args;
}

function normalizeSelectors(config) {
  const selectors = config.requiredSelectors || (config.selector ? [config.selector] : []);
  return Array.isArray(selectors) ? selectors : [selectors];
}

function validateMatrix() {
  const entries = Object.entries(CASES);
  const required = entries.filter(([, config]) => (config.tier || 'required') === 'required');
  const quarantine = entries.filter(([, config]) => config.tier === 'quarantine');
  const urls = new Set(entries.map(([, config]) => config.url));
  const requiredHosts = new Set(required.map(([, config]) => new URL(config.url).hostname));
  const requiredCoverageRules = required.flatMap(([name, config]) =>
    normalizeCoverageRules(config.coverageRules).map((rule) => ({...rule, caseName: name})));
  const errors = [];

  if (required.length < 25) errors.push(`required case 不足 25 个：${required.length}`);
  if (requiredHosts.size < 22) errors.push(`required 独立域名不足 22 个：${requiredHosts.size}`);
  if (quarantine.length < 2) errors.push(`quarantine case 不足 2 个：${quarantine.length}`);
  if (urls.size !== entries.length) errors.push(`URL 不唯一：${urls.size}/${entries.length}`);
  if (requiredCoverageRules.filter((rule) => rule.kind === 'heading' && /\bh1\b/iu.test(rule.selector)).length < 8) {
    errors.push('required 矩阵至少需要 8 个独立 H1 全覆盖契约');
  }
  if (requiredCoverageRules.filter((rule) => rule.trackDynamic).length < 3) {
    errors.push('required 矩阵至少需要 3 个动态节点覆盖契约');
  }

  for (const [name, config] of entries) {
    const selectors = normalizeSelectors(config);
    const forbiddenSelectors = Array.isArray(config.forbiddenSelectors) ? config.forbiddenSelectors : [];
    const optionalForbiddenSelectors = Array.isArray(config.optionalForbiddenSelectors)
      ? config.optionalForbiddenSelectors
      : [];
    const dynamicForbiddenSelectors = Array.isArray(config.dynamicForbiddenSelectors)
      ? config.dynamicForbiddenSelectors
      : [];
    const mutableForbiddenSelectors = Array.isArray(config.mutableForbiddenSelectors)
      ? config.mutableForbiddenSelectors
      : [];
    const requiredForbiddenSelectors = forbiddenSelectors.filter(
      (selector) => !optionalForbiddenSelectors.includes(selector),
    );
    if (!config.url) errors.push(`${name} 缺少 url`);
    if (selectors.length === 0 || selectors.some((selector) => !String(selector).trim())) {
      errors.push(`${name} 缺少 requiredSelectors/selector`);
    }
    if (!config.hoverSelector && !config.selector) errors.push(`${name} 缺少 hoverSelector/selector`);
    if (config.hoverTargets && (!Array.isArray(config.hoverTargets) || config.hoverTargets.length === 0 ||
        config.hoverTargets.some((target) => !target?.name || !target?.selector ||
          (target.index !== undefined && (!Number.isInteger(target.index) || target.index < 0))))) {
      errors.push(`${name} 的 hoverTargets 必须是包含 name/selector/非负 index 的非空数组`);
    }
    if (forbiddenSelectors.length === 0) {
      errors.push(`${name} 缺少 forbiddenSelectors`);
    }
    if (config.optionalForbiddenSelectors && (!Array.isArray(config.optionalForbiddenSelectors) ||
        config.optionalForbiddenSelectors.length === 0 ||
        config.optionalForbiddenSelectors.some((selector) => !forbiddenSelectors.includes(selector)))) {
      errors.push(`${name} 的 optionalForbiddenSelectors 必须是 forbiddenSelectors 的非空子集`);
    }
    if ((config.tier || 'required') === 'required' && config.forbiddenMustExistSelectors &&
        JSON.stringify([...new Set(config.forbiddenMustExistSelectors)]) !==
          JSON.stringify([...new Set(requiredForbiddenSelectors)])) {
      errors.push(`${name} 是 required case，forbiddenMustExistSelectors 如显式配置必须覆盖全部非可选 forbiddenSelectors`);
    }
    if (config.dynamicForbiddenSelectors && (!Array.isArray(config.dynamicForbiddenSelectors) ||
        config.dynamicForbiddenSelectors.some((selector) => !forbiddenSelectors.includes(selector)))) {
      errors.push(`${name} 的 dynamicForbiddenSelectors 必须是 forbiddenSelectors 的子集`);
    }
    if (config.mutableForbiddenSelectors && (!Array.isArray(config.mutableForbiddenSelectors) ||
        config.mutableForbiddenSelectors.length === 0 ||
        mutableForbiddenSelectors.some((selector) => !HOST_MUTABLE_FORBIDDEN_SELECTORS.has(selector) ||
          !forbiddenSelectors.includes(selector) ||
          !dynamicForbiddenSelectors.includes(selector)))) {
      errors.push(`${name} 的 mutableForbiddenSelectors 必须是允许列表、dynamicForbiddenSelectors 与 ` +
        'forbiddenSelectors 的非空子集');
    }
    if (config.forbiddenMustExistSelectors && (!Array.isArray(config.forbiddenMustExistSelectors) ||
        config.forbiddenMustExistSelectors.length === 0 ||
        config.forbiddenMustExistSelectors.some((selector) => !forbiddenSelectors.includes(selector)))) {
      errors.push(`${name} 的 forbiddenMustExistSelectors 必须是 forbiddenSelectors 的非空子集`);
    }
    if (config.interactionScenarios && (!Array.isArray(config.interactionScenarios) ||
        config.interactionScenarios.length === 0 || config.interactionScenarios.some((scenario) =>
          !scenario?.name || !scenario?.triggerSelector || !scenario?.openKey || !scenario?.dialogSelector ||
          !scenario?.comboboxSelector || !scenario?.listboxSelector || !scenario?.inputText ||
          (scenario.closeAttempts !== undefined && (!Number.isInteger(scenario.closeAttempts) ||
            scenario.closeAttempts < 1 || scenario.closeAttempts > 3))))) {
      errors.push(`${name} 的 interactionScenarios 必须声明 trigger/dialog/combobox/listbox/inputText，` +
        '且 closeAttempts 必须是 1-3 的整数');
    }
    if (config.fullCoverageSelectors && (!Array.isArray(config.fullCoverageSelectors) ||
        config.fullCoverageSelectors.length === 0)) {
      errors.push(`${name} 的 fullCoverageSelectors 必须是非空数组`);
    }
    const coverageRules = normalizeCoverageRules(config.coverageRules, config.fullCoverageSelectors);
    errors.push(...validateCoverageRules(name, coverageRules, {
      requireExplicit: (config.tier || 'required') === 'required',
      explicitRules: config.coverageRules,
    }));
    if ((config.tier || 'required') === 'required' && config.fullCoverageSelectors) {
      errors.push(`${name} 不得再使用 fullCoverageSelectors；请迁移到 coverageRules`);
    }
    const hoverTargets = normalizeHoverTargets(config.hoverTargets, {
      fallbackSelector: config.hoverSelector || config.selector || selectors[0],
      coverageRules,
    });
    const hoverSelectors = new Set(hoverTargets.map(({selector}) => selector));
    const missingHoverSelectors = coverageRules
      .map(({selector}) => selector)
      .filter((selector) => !hoverSelectors.has(selector));
    if ((config.tier || 'required') === 'required' && missingHoverSelectors.length > 0) {
      errors.push(`${name} 的 hoverTargets 未覆盖 coverageRules：${missingHoverSelectors.join(', ')}`);
    }
    if (!Array.isArray(config.interactionSelectors) || config.interactionSelectors.length === 0) {
      errors.push(`${name} 缺少 interactionSelectors`);
    }
    const modes = Array.isArray(config.modes) ? config.modes : ['hover', 'full'];
    if (!modes.includes('hover') || !modes.includes('full')) errors.push(`${name} 必须同时支持 hover/full`);
    if (config.tier === 'quarantine' && !config.quarantineReason) errors.push(`${name} 缺少 quarantineReason`);
  }

  const pr4038 = CASES['github-immersive-pr-4038'];
  const pr4038Rules = normalizeCoverageRules(pr4038?.coverageRules);
  if (!pr4038 || (pr4038.tier || 'required') !== 'required') {
    errors.push('缺少 required 的 github-immersive-pr-4038 回归页');
  } else if (!pr4038Rules.some((rule) => rule.kind === 'heading' && /\bh1\b/iu.test(rule.selector)) ||
      !pr4038Rules.some((rule) => rule.kind === 'content') ||
      !pr4038Rules.some((rule) => rule.kind === 'list')) {
    errors.push('github-immersive-pr-4038 必须分别覆盖 H1、正文和列表，不能只验证单个 selector');
  }
  const pr4038HoverSelectors = (pr4038?.hoverTargets || []).map((target) => target.selector);
  if (JSON.stringify(pr4038HoverSelectors) !== JSON.stringify([
    'main h1',
    '.markdown-body h2',
    '.markdown-body p',
    '.markdown-body li',
  ])) {
    errors.push('github-immersive-pr-4038 的 hover 必须分别验证 H1、首个 H2、首个 P 和首个 LI');
  }
  if (!pr4038?.forbiddenMustExistSelectors?.includes("button[aria-haspopup='dialog'][aria-label*='search' i]") ||
      !pr4038?.interactionScenarios?.some((scenario) =>
        scenario.triggerSelector === "button[aria-haspopup='dialog'][aria-label*='search' i]" &&
        scenario.dialogSelector === "[role='dialog'][aria-modal='true']" &&
        scenario.comboboxSelector === "[role='combobox']" &&
        scenario.listboxSelector === "[role='listbox']" && scenario.inputText === 'issues' &&
        scenario.closeAttempts === 2)) {
    errors.push('github-immersive-pr-4038 必须验证真实 Search trigger、输入、dialog、combobox 和 listbox');
  }

  if (errors.length > 0) throw new Error(`站点矩阵配置无效：\n- ${errors.join('\n- ')}`);
  return {entries, required, quarantine, requiredHosts};
}

function selectedEntries(args, entries) {
  const requested = [...new Set(args.cases)];
  if (requested.length > 0) {
    const unknown = requested.filter((name) => !CASES[name]);
    if (unknown.length > 0) throw new Error(`未知 case：${unknown.join(', ')}`);
    return requested.map((name) => [name, CASES[name]]);
  }
  return entries.filter(([, config]) => args.includeQuarantine || config.tier !== 'quarantine');
}

function childArgs(args, name, mode) {
  const values = [
    CASE_RUNNER,
    '--case', name,
    '--mode', mode,
    '--extension-dir', args.extensionDir,
    '--playwright-root', args.playwrightRoot,
    args.background ? '--background' : '--headed',
  ];
  if (args.browserPath) values.push('--browser-path', args.browserPath);
  if (args.timeout) values.push('--timeout', args.timeout);
  if (args.artifactsDir) values.push('--artifacts-dir', path.join(path.resolve(args.artifactsDir), name, mode));
  return values;
}

function computeJobTimeoutMs(pageTimeout, mode, override) {
  if (override !== undefined) return Number(override);
  const normalizedPageTimeout = Number(pageTimeout) || 60000;
  return mode === 'full'
    ? Math.max(12 * 60 * 1000, normalizedPageTimeout * 3 + 5 * 60 * 1000)
    : Math.max(5 * 60 * 1000, normalizedPageTimeout * 2);
}

function killProcessGroup(child, signal) {
  if (!child?.pid) return false;
  if (process.platform !== 'win32') {
    try {
      process.kill(-child.pid, signal);
      return true;
    } catch {
      // The group may already be gone; fall through to the direct child.
    }
  }
  try {
    return child.kill(signal);
  } catch {
    return false;
  }
}

function runChildWithWatchdog(command, values, options = {}) {
  const timeoutMs = Number(options.timeoutMs);
  const killGraceMs = options.killGraceMs ?? 5000;
  const spawnImpl = options.spawnImpl || spawn;
  const killGroup = options.killProcessGroupImpl || killProcessGroup;
  const startedAt = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let timeoutTimer;
    let killTimer;
    let finalTimer;
    let killSent = false;
    let deferredClose = null;
    const child = spawnImpl(command, values, {
      stdio: options.stdio || 'inherit',
      detached: process.platform !== 'win32',
    });
    const finish = (exitCode, signal, error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      clearTimeout(killTimer);
      clearTimeout(finalTimer);
      resolve({
        ok: !timedOut && !error && exitCode === 0,
        exitCode,
        signal: signal || null,
        timedOut,
        timeoutMs,
        durationMs: Date.now() - startedAt,
        error: error?.message || null,
      });
    };
    const recordExit = (exitCode, signal, error) => {
      if (!timedOut) {
        finish(exitCode, signal, error);
        return;
      }
      // Once the watchdog owns shutdown, a direct runner exit is not enough:
      // detached Edge/renderer descendants may still be alive in its process
      // group. Preserve the exit result, but do not settle or cancel the
      // scheduled group SIGKILL until that signal has actually been sent.
      deferredClose = {exitCode, signal, error};
      if (killSent) finish(exitCode, signal, error);
    };
    child.once('error', (error) => recordExit(null, null, error));
    child.once('close', (exitCode, signal) => recordExit(exitCode, signal, null));
    timeoutTimer = setTimeout(() => {
      timedOut = true;
      killGroup(child, 'SIGTERM');
      killTimer = setTimeout(() => {
        killSent = true;
        killGroup(child, 'SIGKILL');
        if (deferredClose) {
          finish(deferredClose.exitCode, deferredClose.signal, deferredClose.error);
          return;
        }
        finalTimer = setTimeout(() => finish(null, 'WATCHDOG', null), killGraceMs);
      }, killGraceMs);
    }, timeoutMs);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const matrix = validateMatrix();

  if (args.list) {
    process.stdout.write(`${JSON.stringify({
      total: matrix.entries.length,
      required: matrix.required.length,
      requiredHosts: matrix.requiredHosts.size,
      quarantine: matrix.quarantine.length,
      cases: matrix.entries.map(([name, config]) => ({
        name,
        tier: config.tier || 'required',
        url: config.url,
        modes: config.modes || ['hover', 'full'],
        coverageRules: normalizeCoverageRules(config.coverageRules, config.fullCoverageSelectors),
        quarantineReason: config.quarantineReason || null,
      })),
    }, null, 2)}\n`);
    return;
  }

  const entries = selectedEntries(args, matrix.entries);
  const requestedModes = args.mode === 'both' ? ['hover', 'full'] : [args.mode];
  const jobs = entries.flatMap(([name, config]) => requestedModes
    .filter((mode) => (config.modes || ['hover', 'full']).includes(mode))
    .map((mode) => ({name, mode, tier: config.tier || 'required'})));
  const results = [];

  for (const job of jobs) {
    process.stdout.write(`\n=== ${job.name} / ${job.mode} / ${job.tier} ===\n`);
    const timeoutMs = computeJobTimeoutMs(args.timeout, job.mode, args.jobTimeout);
    const child = await runChildWithWatchdog(process.execPath, childArgs(args, job.name, job.mode), {timeoutMs});
    if (child.timedOut) {
      process.stderr.write(`[site-translation-matrix] ${job.name}/${job.mode} 总 watchdog 超时 ` +
        `(${timeoutMs}ms)，已终止隔离浏览器进程组\n`);
    }
    results.push({...job, ...child});
  }

  const requiredFailures = results.filter((result) => !result.ok && result.tier === 'required');
  const quarantineFailures = results.filter((result) => !result.ok && result.tier === 'quarantine');
  process.stdout.write(`${JSON.stringify({
    ok: requiredFailures.length === 0 && (!args.failOnQuarantine || quarantineFailures.length === 0),
    jobs: results.length,
    passed: results.filter((result) => result.ok).length,
    requiredFailures,
    quarantineFailures,
    timeoutFailures: results.filter((result) => result.timedOut),
  }, null, 2)}\n`);
  if (requiredFailures.length > 0 || (args.failOnQuarantine && quarantineFailures.length > 0)) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  });
}

module.exports = {computeJobTimeoutMs, runChildWithWatchdog, validateMatrix};
