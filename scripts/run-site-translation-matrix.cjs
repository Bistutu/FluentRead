#!/usr/bin/env node

// 顺序运行真实站点矩阵。默认只运行 required case，并对每个 case 依次执行
// hover/full；每个子进程仍由 run-site-translation-test.cjs 创建独立 profile。

const fs = require('node:fs');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const CASES_PATH = path.join(__dirname, '..', 'tests', 'browser-translation-cases.json');
const CASE_RUNNER = path.join(__dirname, 'run-site-translation-test.cjs');
const CASES = JSON.parse(fs.readFileSync(CASES_PATH, 'utf8'));

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
  const errors = [];

  if (required.length < 20) errors.push(`required case 不足 20 个：${required.length}`);
  if (requiredHosts.size < 20) errors.push(`required 独立域名不足 20 个：${requiredHosts.size}`);
  if (quarantine.length < 2) errors.push(`quarantine case 不足 2 个：${quarantine.length}`);
  if (urls.size !== entries.length) errors.push(`URL 不唯一：${urls.size}/${entries.length}`);

  for (const [name, config] of entries) {
    const selectors = normalizeSelectors(config);
    if (!config.url) errors.push(`${name} 缺少 url`);
    if (selectors.length === 0 || selectors.some((selector) => !String(selector).trim())) {
      errors.push(`${name} 缺少 requiredSelectors/selector`);
    }
    if (!config.hoverSelector && !config.selector) errors.push(`${name} 缺少 hoverSelector/selector`);
    if (!Array.isArray(config.forbiddenSelectors) || config.forbiddenSelectors.length === 0) {
      errors.push(`${name} 缺少 forbiddenSelectors`);
    }
    if (config.dynamicForbiddenSelectors && (!Array.isArray(config.dynamicForbiddenSelectors) ||
        config.dynamicForbiddenSelectors.some((selector) => !config.forbiddenSelectors.includes(selector)))) {
      errors.push(`${name} 的 dynamicForbiddenSelectors 必须是 forbiddenSelectors 的子集`);
    }
    if (config.fullCoverageSelectors && (!Array.isArray(config.fullCoverageSelectors) ||
        config.fullCoverageSelectors.length === 0)) {
      errors.push(`${name} 的 fullCoverageSelectors 必须是非空数组`);
    }
    if (!Array.isArray(config.interactionSelectors) || config.interactionSelectors.length === 0) {
      errors.push(`${name} 缺少 interactionSelectors`);
    }
    const modes = Array.isArray(config.modes) ? config.modes : ['hover', 'full'];
    if (!modes.includes('hover') || !modes.includes('full')) errors.push(`${name} 必须同时支持 hover/full`);
    if (config.tier === 'quarantine' && !config.quarantineReason) errors.push(`${name} 缺少 quarantineReason`);
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

function main() {
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
    const child = spawnSync(process.execPath, childArgs(args, job.name, job.mode), {stdio: 'inherit'});
    results.push({...job, ok: child.status === 0, exitCode: child.status, signal: child.signal || null});
  }

  const requiredFailures = results.filter((result) => !result.ok && result.tier === 'required');
  const quarantineFailures = results.filter((result) => !result.ok && result.tier === 'quarantine');
  process.stdout.write(`${JSON.stringify({
    ok: requiredFailures.length === 0 && (!args.failOnQuarantine || quarantineFailures.length === 0),
    jobs: results.length,
    passed: results.filter((result) => result.ok).length,
    requiredFailures,
    quarantineFailures,
  }, null, 2)}\n`);
  if (requiredFailures.length > 0 || (args.failOnQuarantine && quarantineFailures.length > 0)) {
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
}
