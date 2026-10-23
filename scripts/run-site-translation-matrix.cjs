#!/usr/bin/env node

// 最大 2 个 job 有界并发运行真实站点矩阵，按原 jobs 序列输出结果。
// 每个子进程仍由 run-site-translation-test.cjs 创建独立 profile。

const path = require('node:path');
const fs = require('node:fs');
const {spawn} = require('node:child_process');
const {
  CASES,
  MATRIX_REQUIREMENTS,
  collectBaseCaseConfigErrors,
  normalizeCaseConfig,
} = require('./site-translation/case-config.cjs');

const MAINTENANCE = require('./site-translation/maintenance-cases.json');
const CASE_RUNNER = path.join(__dirname, 'run-site-translation-test.cjs');
const MAX_CONCURRENT_JOBS = 2;
const {FOCUS_SAFETY_EXIT_CODE} = require('./testing/site-error-diagnostics.cjs');

function parseArgs(argv) {
  const args = {
    background: true,
    allowNetwork: false,
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
    if (['--controlled-provider', '--stability-probes'].includes(token)) {
      args[token === '--controlled-provider' ? 'controlledProvider' : 'stabilityProbes'] = true;
      continue;
    }
    if (token === '--allow-network') {
      args.allowNetwork = true;
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

  if (args.stabilityProbes && args.mode !== 'full') throw new Error('--stability-probes requires --mode full');
  if (!['hover', 'full', 'both'].includes(args.mode)) throw new Error('--mode 必须是 hover、full 或 both');
  if (args.timeout !== undefined && (!Number.isFinite(Number(args.timeout)) || Number(args.timeout) <= 0)) {
    throw new Error('--timeout 必须为正数');
  }
  if (args.jobTimeout !== undefined && (!Number.isFinite(Number(args.jobTimeout)) || Number(args.jobTimeout) <= 0)) {
    throw new Error('--job-timeout 必须为正数');
  }
  if (!args.list && !args.extensionDir) throw new Error('必须传入 --extension-dir');
  if (!args.list && !args.playwrightRoot) throw new Error('必须传入 --playwright-root');
  if (!args.list && !args.allowNetwork) throw new Error('真实网络矩阵必须显式传入 --allow-network');
  if (!args.list && args.background && !args.focusSafeHelper) {
    throw new Error('后台模式必须传入 --focus-safe-helper，禁止回退到会抢焦点的 Playwright 启动');
  }
  return args;
}

function validateMatrix(caseConfigs = CASES) {
  const entries = Object.entries(caseConfigs);
  const required = entries.filter(([, config]) => (config.tier || 'required') === 'required');
  const quarantine = entries.filter(([, config]) => config.tier === 'quarantine');
  const urls = new Set(entries.map(([, config]) => config.url));
  const requiredHosts = new Set();
  const requiredCoverageRules = [];
  const normalizedByName = new Map();
  const errors = [];

  for (const [name, config] of entries) {
    const tier = config.tier || 'required';
    if (typeof config.url !== 'string' || !config.url.trim()) {
      errors.push(`${name} 缺少 url`);
    } else {
      try {
        const parsedUrl = new URL(config.url);
        if (tier === 'required') requiredHosts.add(parsedUrl.hostname);
      } catch (error) {
        errors.push(`${name} 的 url 无效：${config.url}（${error.message}）`);
      }
    }

    let normalized;
    try {
      normalized = normalizeCaseConfig(name, config);
      normalizedByName.set(name, normalized);
      errors.push(...collectBaseCaseConfigErrors(name, config, normalized));
    } catch (error) {
      errors.push(`${name} 配置规范化失败：${error.message}`);
      continue;
    }

    const requiredForbiddenSelectors = normalized.forbiddenSelectors.filter(
      (selector) => !normalized.optionalForbiddenSelectors.includes(selector),
    );
    if (tier === 'required') {
      requiredCoverageRules.push(...normalized.coverageRules.map((rule) => ({...rule, caseName: name})));
    }
    if (!config.hoverSelector && !config.selector) errors.push(`${name} 缺少 hoverSelector/selector`);
    if (tier === 'required' && Array.isArray(config.forbiddenMustExistSelectors) &&
        JSON.stringify([...new Set(config.forbiddenMustExistSelectors)]) !==
          JSON.stringify([...new Set(requiredForbiddenSelectors)])) {
      errors.push(`${name} 是 required case，forbiddenMustExistSelectors 如显式配置必须覆盖全部非可选 forbiddenSelectors`);
    }
    if (tier === 'required' && config.fullCoverageSelectors) {
      errors.push(`${name} 不得再使用 fullCoverageSelectors；请迁移到 coverageRules`);
    }
    const hoverSelectors = new Set(normalized.hoverTargets.map(({selector}) => selector));
    const missingHoverSelectors = normalized.coverageRules
      .map(({selector}) => selector)
      .filter((selector) => !hoverSelectors.has(selector));
    if (tier === 'required' && missingHoverSelectors.length > 0) {
      errors.push(`${name} 的 hoverTargets 未覆盖 coverageRules：${missingHoverSelectors.join(', ')}`);
    }
    if (!normalized.modes.includes('hover') || !normalized.modes.includes('full')) {
      errors.push(`${name} 必须同时支持 hover/full`);
    }
    if (config.tier === 'quarantine' && !config.quarantineReason) errors.push(`${name} 缺少 quarantineReason`);
  }

  if (entries.length < MATRIX_REQUIREMENTS.total) {
    errors.push(`case 总数不足 ${MATRIX_REQUIREMENTS.total} 个：${entries.length}`);
  }
  if (required.length < MATRIX_REQUIREMENTS.required) {
    errors.push(`required case 不足 ${MATRIX_REQUIREMENTS.required} 个：${required.length}`);
  }
  if (requiredHosts.size < MATRIX_REQUIREMENTS.requiredHosts) {
    errors.push(`required 独立域名不足 ${MATRIX_REQUIREMENTS.requiredHosts} 个：${requiredHosts.size}`);
  }
  if (quarantine.length < MATRIX_REQUIREMENTS.quarantine) {
    errors.push(`quarantine case 不足 ${MATRIX_REQUIREMENTS.quarantine} 个：${quarantine.length}`);
  }
  if (urls.size !== entries.length) errors.push(`URL 不唯一：${urls.size}/${entries.length}`);
  if (requiredCoverageRules.filter((rule) => rule.kind === 'heading' && /\bh1\b/iu.test(rule.selector)).length <
      MATRIX_REQUIREMENTS.h1CoverageRules) {
    errors.push(`required 矩阵至少需要 ${MATRIX_REQUIREMENTS.h1CoverageRules} 个独立 H1 全覆盖契约`);
  }
  if (requiredCoverageRules.filter((rule) => rule.trackDynamic).length <
      MATRIX_REQUIREMENTS.dynamicCoverageRules) {
    errors.push(`required 矩阵至少需要 ${MATRIX_REQUIREMENTS.dynamicCoverageRules} 个动态节点覆盖契约`);
  }

  const pr4038 = caseConfigs['github-project-pr'];
  const pr4038Rules = normalizedByName.get('github-project-pr')?.coverageRules || [];
  if (!pr4038 || (pr4038.tier || 'required') !== 'required') {
    errors.push('缺少 required 的 github-project-pr 回归页');
  } else if (!pr4038Rules.some((rule) => rule.kind === 'heading' && /\bh1\b/iu.test(rule.selector)) ||
      !pr4038Rules.some((rule) => rule.kind === 'content') ||
      !pr4038Rules.some((rule) => rule.kind === 'list')) {
    errors.push('github-project-pr 必须分别覆盖 H1、正文和列表，不能只验证单个 selector');
  }
  const pr4038HoverTargets = pr4038?.hoverTargets || [];
  const requiredPrTargets = [
    ['pr-title-h1', /\bh1\b/iu],
    ['body-heading-h2', /\bh2\b/iu],
    ['body-paragraph', /\bp\b/iu],
    ['body-list-item', /\bli\b/iu],
  ];
  if (pr4038HoverTargets.length !== requiredPrTargets.length || requiredPrTargets.some(([name, tag], index) => {
    const target = pr4038HoverTargets[index];
    return target?.name !== name || !tag.test(target.selector) || !target.sourceIncludes?.length;
  })) {
    errors.push('github-project-pr 的 hover 必须分别验证 H1、首个 H2、首个 P 和首个 LI');
  }
  if (!pr4038?.forbiddenMustExistSelectors?.includes("button[aria-haspopup='dialog'][aria-label*='search' i]") ||
      !pr4038?.interactionScenarios?.some((scenario) =>
        scenario.triggerSelector === "button[aria-haspopup='dialog'][aria-label*='search' i]" &&
        scenario.dialogSelector === "[role='dialog'][aria-modal='true']" &&
        scenario.comboboxSelector === "[role='combobox']" &&
        scenario.listboxSelector === "[role='listbox']" && scenario.inputText === 'issues' &&
        scenario.closeAttempts === 3)) {
    errors.push('github-project-pr 必须验证真实 Search trigger、输入、dialog、combobox 和 listbox');
  }

  if (errors.length > 0) throw new Error(`站点矩阵配置无效：\n- ${errors.join('\n- ')}`);
  return {entries, required, quarantine, requiredHosts};
}

function selectedEntries(args, entries) {
  if (args.profile && args.profile !== 'maintenance') throw new Error('Unknown profile: ' + args.profile);
  if (args.profile && args.cases.length) throw new Error('--profile and --cases cannot be combined');
  const requested = [...new Set(args.profile === 'maintenance' ? MAINTENANCE.cases.map(item => item.case) : args.cases)];
  if (requested.length > 0) {
    const unknown = requested.filter((name) => !CASES[name]);
    if (unknown.length > 0) throw new Error(`未知 case：${unknown.join(', ')}`);
    return requested.map((name) => [name, CASES[name]]);
  }
  return entries.filter(([, config]) => args.includeQuarantine || config.tier !== 'quarantine');
}

function childArgs(args, name, mode, attempt = 1) {
  const values = [
    CASE_RUNNER,
    '--case', name,
    '--mode', mode,
    '--extension-dir', args.extensionDir,
    '--playwright-root', args.playwrightRoot,
    args.background ? '--background' : '--headed',
  ];
  if (args.controlledProvider) values.push('--controlled-provider');
  if (args.stabilityProbes) values.push('--stability-probes');
  if (args.browserPath) values.push('--browser-path', args.browserPath);
  if (args.timeout) values.push('--timeout', args.timeout);
  if (args.focusSafeHelper) values.push('--focus-safe-helper', args.focusSafeHelper);
  if (args.allowNetwork) values.push('--allow-network');
  if (args.artifactsDir) values.push('--artifacts-dir', path.join(path.resolve(args.artifactsDir), name, mode,
    ...(attempt > 1 ? [`attempt-${attempt}`] : [])));
  return values;
}

function computeJobTimeoutMs(pageTimeout, mode, override) {
  if (override !== undefined) return Number(override);
  const normalizedPageTimeout = Number(pageTimeout) || 60000;
  // 全文包含翻译、完整恢复、再次翻译两轮。每轮允许有进展的队列使用
  // 3 倍阶段预算，另留两次页面等待和长页滚动预算；不能用旧单轮预算
  // 在第二轮仍持续完成时杀掉进程。单阶段无进展与绝对上限仍由 runner 执行。
  return mode === 'full'
    ? Math.max(30 * 60 * 1000, normalizedPageTimeout * 8 + 5 * 60 * 1000)
    : Math.max(5 * 60 * 1000, normalizedPageTimeout * 2);
}

function killProcessGroup(child, signal) {
  if (!child?.pid) return false;
  if (process.platform !== 'win32') {
    try {
      process.kill(-child.pid, signal);
      return true;
    } catch {
      // 进程组可能已经退出；继续尝试直接终止子进程。
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
  const abortSignal = options.signal;
  if (abortSignal?.aborted) {
    return Promise.resolve({ok: false, timedOut: false, aborted: true, notStarted: true});
  }
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let aborted = false;
    let timeoutTimer;
    let killTimer;
    let terminating = false;
    let exited = false;
    let closed = false;
    let childError = null;
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
      abortSignal?.removeEventListener('abort', onAbort);
      resolve({
        ok: !timedOut && !aborted && !error && exitCode === 0,
        exitCode,
        signal: signal || null,
        timedOut,
        aborted,
        timeoutMs,
        durationMs: Date.now() - startedAt,
        error: error ? error.message || String(error) : null,
      });
    };
    const recordExit = (exitCode, signal, error) => {
      closed = true;
      clearTimeout(timeoutTimer);
      abortSignal?.removeEventListener('abort', onAbort);
      if (!terminating) {
        finish(exitCode, signal, error);
        return;
      }
      // watchdog 接管关闭后，仅 runner 直接退出还不够：脱离的 Edge/renderer 后代
      // 可能仍存活于进程组中。保留退出结果，但在真正发出计划中的进程组 SIGKILL 前，
      // 不得结束流程或取消该信号。
      deferredClose = {exitCode, signal, error};
      if (killSent) finish(exitCode, signal, error);
    };
    const sendSignal = (signal) => {
      try {
        killGroup(child, signal);
      } catch (error) {
        childError ||= error;
      }
    };
    const terminate = (fromTimeout) => {
      if (settled) return;
      if (fromTimeout) timedOut = true;
      else aborted = true;
      clearTimeout(timeoutTimer);
      // 只接管本次 spawn 返回且仍存活的直接 child；已经开始的进程组
      // 清理仍保留原 SIGKILL，即使 TERM 后直接 runner 先于后代关闭。
      if (terminating || closed || exited || !child.pid || child.exitCode != null || child.signalCode != null) return;
      terminating = true;
      killTimer = setTimeout(() => {
        killSent = true;
        sendSignal('SIGKILL');
        if (deferredClose) {
          finish(deferredClose.exitCode, deferredClose.signal, childError || deferredClose.error);
        }
        // SIGKILL 不是退出凭证：必须等待真实 close，不合成 WATCHDOG exit。
      }, killGraceMs);
      sendSignal('SIGTERM');
    };
    const onAbort = () => terminate(false);
    child.once('error', (error) => { childError ||= error; });
    child.once('exit', () => {
      exited = true;
      clearTimeout(timeoutTimer);
    });
    child.once('close', (exitCode, signal) => recordExit(exitCode, signal, childError));
    timeoutTimer = setTimeout(() => terminate(true), timeoutMs);
    abortSignal?.addEventListener('abort', onAbort, {once: true});
    // 信号可能在 spawn 过程中到达；监听安装后补查，不能漏掉已启动 child。
    if (abortSignal?.aborted) onAbort();
  });
}

/** 网络/宿主初始化可能偶发失败；重试必须是全新浏览器且再次跑完整契约。 */
async function runJobAttempts(runAttempt, maxAttempts, options = {}) {
  const attempts = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (options.signal?.aborted) break;
    let result;
    try {
      result = await runAttempt(attempt);
    } catch (error) {
      result = {ok: false, timedOut: false, error: error?.message || String(error)};
    }
    attempts.push(result);
    if (result.ok || result.timedOut || result.aborted || result.exitCode === FOCUS_SAFETY_EXIT_CODE) break;
  }
  if (attempts.length === 0) return {ok: false, timedOut: false, aborted: true, notStarted: true, attempts};
  return {...attempts[attempts.length - 1], attempts};
}

/** 两个固定 worker；单 job 失败不能丢弃 required 尾部，父信号则停止领取并 join 在途 job。 */
async function runJobsWithBoundedConcurrency(jobs, runJob, options = {}) {
  const controller = new AbortController();
  const signalSource = options.signalSource || process;
  const results = new Array(jobs.length);
  let nextIndex = 0;
  let abortSignal = null;
  const interrupt = (signal) => {
    if (controller.signal.aborted) return;
    abortSignal = signal;
    controller.abort(signal);
  };
  const onSigint = () => interrupt('SIGINT');
  const onSigterm = () => interrupt('SIGTERM');
  signalSource.on('SIGINT', onSigint);
  signalSource.on('SIGTERM', onSigterm);
  try {
    const worker = async () => {
      while (!controller.signal.aborted && nextIndex < jobs.length) {
        const index = nextIndex++;
        const job = jobs[index];
        try {
          results[index] = {...job, ...await runJob(job, controller.signal)};
          if (results[index].exitCode === FOCUS_SAFETY_EXIT_CODE) interrupt('FOCUS_SAFETY_VIOLATION');
        } catch (error) {
          results[index] = {...job, ok: false, timedOut: false, error: error?.message || String(error)};
        }
      }
    };
    await Promise.all(Array.from({length: Math.min(MAX_CONCURRENT_JOBS, jobs.length)}, () => worker()));
    // 保留取消时未执行的尾部，不能将部分运行包装成完整门禁。
    for (let index = nextIndex; index < jobs.length; index += 1) {
      results[index] = {...jobs[index], ok: false, timedOut: false, aborted: true, notStarted: true, attempts: []};
    }
    return {results, aborted: controller.signal.aborted, abortSignal};
  } finally {
    signalSource.removeListener('SIGINT', onSigint);
    signalSource.removeListener('SIGTERM', onSigterm);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const matrix = validateMatrix();
  const entries = selectedEntries(args, matrix.entries);

  if (args.list) {
    process.stdout.write(`${JSON.stringify({
      total: matrix.entries.length,
      required: matrix.required.length,
      requiredHosts: matrix.requiredHosts.size,
      quarantine: matrix.quarantine.length,
      profile: args.profile || null,
      selected: entries.length,
      cases: (args.profile || args.cases.length ? entries : matrix.entries).map(([name, config]) => ({
        name,
        tier: config.tier || 'required',
        url: config.url,
        modes: config.modes || ['hover', 'full'],
        coverageRules: normalizeCaseConfig(name, config).coverageRules,
        quarantineReason: config.quarantineReason || null,
      })),
    }, null, 2)}\n`);
    return;
  }

  const requestedModes = args.mode === 'both' ? ['hover', 'full'] : [args.mode];
  const jobs = entries.flatMap(([name, config]) => requestedModes
    .filter((mode) => (config.modes || ['hover', 'full']).includes(mode))
    .map((mode) => ({name, mode, tier: config.tier || 'required'})));
  const {results, aborted, abortSignal} = await runJobsWithBoundedConcurrency(jobs, async (job, signal) => {
    process.stdout.write(`\n=== ${job.name} / ${job.mode} / ${job.tier} ===\n`);
    const timeoutMs = computeJobTimeoutMs(args.timeout, job.mode, args.jobTimeout);
    const child = await runJobAttempts((attempt) => {
      if (attempt > 1) {
        process.stdout.write(`[site-translation-matrix] ${job.name}/${job.mode} 第 ${attempt} 次完整复测\n`);
      }
      return runChildWithWatchdog(process.execPath, childArgs(args, job.name, job.mode, attempt), {timeoutMs, signal});
    }, job.tier === 'required' ? 2 : 1, {signal});
    if (child.timedOut) {
      process.stderr.write(`[site-translation-matrix] ${job.name}/${job.mode} 总 watchdog 超时 ` +
        `(${timeoutMs}ms)，隔离 runner 已收到真实 close\n`);
    }
    return child;
  });

  const requiredFailures = results.filter((result) => !result.ok && result.tier === 'required');
  const quarantineFailures = results.filter((result) => !result.ok && result.tier === 'quarantine');
  const evidence = {at: new Date().toISOString(), profile: args.profile || null, controlledProvider: args.controlledProvider === true,
    stabilityProbes: args.stabilityProbes === true, requiredFailures, quarantineFailures, results, aborted, abortSignal};
  if (args.artifactsDir) {fs.mkdirSync(args.artifactsDir, {recursive: true});
    fs.writeFileSync(path.join(args.artifactsDir, 'matrix-report.json'), JSON.stringify(evidence, null, 2));}
  process.stdout.write(`${JSON.stringify({
    ok: !aborted && requiredFailures.length === 0 && (!args.failOnQuarantine || quarantineFailures.length === 0),
    maxConcurrentJobs: MAX_CONCURRENT_JOBS,
    aborted,
    abortSignal,
    jobs: results.length,
    requiredPassed: results.filter(result => result.ok && result.tier === 'required').length,
    requiredPassedHosts: new Set(results.filter(result => result.ok && result.tier === 'required')
      .map(result => new URL(CASES[result.name].url).hostname)).size,
    passed: results.filter((result) => result.ok).length,
    recoveredFailures: results.filter((result) => result.ok && result.attempts?.length > 1)
      .map((result) => ({name: result.name, mode: result.mode, attempts: result.attempts})),
    requiredFailures,
    quarantineFailures,
    timeoutFailures: results.filter((result) => result.timedOut),
    notStartedJobs: results.filter((result) => result.notStarted),
    results,
  }, null, 2)}\n`);
  if (aborted || requiredFailures.length > 0 || (args.failOnQuarantine && quarantineFailures.length > 0)) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  MATRIX_REQUIREMENTS, MAX_CONCURRENT_JOBS, computeJobTimeoutMs, parseArgs, selectedEntries, childArgs,
  runChildWithWatchdog, runJobAttempts, runJobsWithBoundedConcurrency, validateMatrix,
};
