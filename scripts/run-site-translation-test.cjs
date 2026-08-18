#!/usr/bin/env node

// 运行真实网站的悬浮翻译或全文翻译回归。
//
// 这个脚本只创建临时 Edge profile，并支持屏幕外窗口；它不会连接用户日常
// 浏览器，也不会通过 page.evaluate 派发伪造的键盘事件。Control 和 Alt+T
// 都由 Playwright keyboard API 发送真实的浏览器按键。

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createRequire} = require('node:module');

const CASES = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'tests', 'browser-translation-cases.json'),
  'utf8',
));

function reportProgress(message) {
  process.stderr.write(`[site-translation-test] ${message}\n`);
}

function parseArgs(argv) {
  const args = {
    browserPath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    background: true,
    timeout: 60000,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--') continue;
    if (token === '--background') continue;
    if (token === '--headed') {
      args.background = false;
      continue;
    }
    if (!token.startsWith('--')) throw new Error(`无法识别参数：${token}`);
    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`参数缺少值：${token}`);
    args[key] = value;
    index += 1;
  }

  args.timeout = Number(args.timeout);
  if (!Number.isFinite(args.timeout) || args.timeout <= 0) throw new Error('--timeout 必须为正数');
  if (!args.case) throw new Error('必须传入 --case，例如 example-com');
  if (!CASES[args.case]) throw new Error(`未知 case：${args.case}`);
  if (!['hover', 'full'].includes(args.mode)) throw new Error('--mode 必须是 hover 或 full');
  if (!args.extensionDir) throw new Error('必须传入 --extension-dir');
  if (!args.playwrightRoot) throw new Error('必须传入 --playwright-root');

  const caseConfig = CASES[args.case];
  const requiredSelectors = normalizeSelectorList(caseConfig.requiredSelectors, caseConfig.selector);
  const forbiddenSelectors = normalizeSelectorList(caseConfig.forbiddenSelectors);
  const dynamicForbiddenSelectors = normalizeSelectorList(caseConfig.dynamicForbiddenSelectors);
  const fullCoverageSelectors = normalizeSelectorList(caseConfig.fullCoverageSelectors);
  const interactionSelectors = normalizeSelectorList(caseConfig.interactionSelectors);
  const modes = Array.isArray(caseConfig.modes) ? caseConfig.modes : ['hover', 'full'];
  if (requiredSelectors.length === 0) {
    throw new Error(`case ${args.case} 必须配置 requiredSelectors 或旧版 selector`);
  }
  if (dynamicForbiddenSelectors.some((selector) => !forbiddenSelectors.includes(selector))) {
    throw new Error(`case ${args.case} 的 dynamicForbiddenSelectors 必须同时列入 forbiddenSelectors`);
  }
  if (!modes.includes(args.mode)) throw new Error(`case ${args.case} 不支持 ${args.mode} 模式`);

  return {
    ...caseConfig,
    ...args,
    selector: caseConfig.hoverSelector || caseConfig.selector || requiredSelectors[0],
    requiredSelectors,
    forbiddenSelectors,
    dynamicForbiddenSelectors,
    fullCoverageSelectors,
    interactionSelectors,
    modes,
    tier: caseConfig.tier || 'required',
  };
}

function normalizeSelectorList(value, fallback) {
  const raw = Array.isArray(value) ? value : value ? [value] : fallback ? [fallback] : [];
  return [...new Set(raw.map((selector) => String(selector).trim()).filter(Boolean))];
}

function loadPlaywright(root) {
  try {
    return require('playwright');
  } catch {
    const loader = createRequire(path.join(path.resolve(root), '__fluentread_site_loader__.cjs'));
    return loader('playwright');
  }
}

function assertDedicatedProfile(profileDir) {
  const resolved = path.resolve(profileDir);
  const home = os.homedir();
  const forbidden = [
    path.join(home, 'Library/Application Support/Google/Chrome'),
    path.join(home, 'Library/Application Support/Microsoft Edge'),
    path.join(home, '.config/google-chrome'),
    path.join(home, '.config/microsoft-edge'),
  ];
  if (forbidden.some((root) => {
    const relative = path.relative(root, resolved);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  })) {
    throw new Error(`拒绝使用日常浏览器 profile：${resolved}`);
  }
}

function normalizeConfig(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function readConfig(context, timeout) {
  const workers = context.serviceWorkers();
  const worker = workers[0] || await context.waitForEvent('serviceworker', {timeout: Math.min(timeout, 30000)});
  const match = worker.url().match(/^chrome-extension:\/\/([^/]+)/);
  if (!match) throw new Error('没有找到扩展 service worker');
  const popup = await context.newPage();
  try {
    await popup.goto(`chrome-extension://${match[1]}/popup.html`, {waitUntil: 'domcontentloaded', timeout: 30000});
    const stored = await popup.evaluate(() => chrome.storage.local.get('config'));
    return {extensionId: match[1], config: normalizeConfig(stored.config)};
  } finally {
    await popup.close();
  }
}

async function waitFor(page, predicate, timeout, argument) {
  await page.waitForFunction(predicate, argument, {timeout});
}

async function waitForStableTarget(page, selector, timeout) {
  try {
    await page.waitForSelector(selector, {state: 'attached', timeout});
    await page.locator(selector).first().scrollIntoViewIfNeeded();
    await waitFor(page, (targetSelector) => {
      const target = document.querySelector(targetSelector);
      if (!target) return false;
      if (target.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
      const rect = target.getBoundingClientRect();
      const style = getComputedStyle(target);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' &&
        Boolean(target.textContent?.trim());
    }, timeout, selector);
  } catch (error) {
    const diagnostics = await page.evaluate((targetSelector) => ({
      url: location.href,
      title: document.title,
      selector: targetSelector,
      count: document.querySelectorAll(targetSelector).length,
      bodyText: (document.body?.innerText || '').replace(/\s+/gu, ' ').slice(0, 500),
      samples: [...document.querySelectorAll('main p, article p, h1, h2, [itemprop="description"]')]
        .slice(0, 12).map((node) => ({tag: node.tagName, className: node.className, text: (node.textContent || '').trim().slice(0, 100)})),
    }), selector);
    throw new Error(`${error.message}\n目标 selector 诊断：${JSON.stringify(diagnostics)}`);
  }
  await page.waitForTimeout(1000);
}

async function waitForPageContract(page, requiredSelectors, forbiddenSelectors, interactionSelectors, timeout) {
  const contract = {required: requiredSelectors, forbidden: forbiddenSelectors, interactions: interactionSelectors};
  try {
    await waitFor(page, ({required, interactions}) => {
      const firstVisibleTextNode = (selector) => [...document.querySelectorAll(selector)].find((node) => {
        if (node.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' &&
          Boolean(node.textContent?.trim());
      });
      return required.every((selector) => Boolean(firstVisibleTextNode(selector))) &&
        interactions.every((selector) => document.querySelector(selector));
    }, timeout, contract);
  } catch (error) {
    const diagnostics = await page.evaluate(({required, forbidden, interactions}) => ({
      url: location.href,
      required: required.map((selector) => ({selector, count: document.querySelectorAll(selector).length})),
      forbidden: forbidden.map((selector) => ({selector, count: document.querySelectorAll(selector).length})),
      interactions: interactions.map((selector) => ({selector, count: document.querySelectorAll(selector).length})),
    }), contract);
    throw new Error(`${error.message}\n页面 contract 诊断：${JSON.stringify(diagnostics)}`);
  }
  await page.waitForTimeout(1000);
}

async function capturePageContract(
  page,
  requiredSelectors,
  forbiddenSelectors,
  interactionSelectors,
  dynamicForbiddenSelectors,
) {
  return page.evaluate(({required, forbidden, interactions, dynamicForbidden}) => {
    const firstVisibleTextNode = (selector) => [...document.querySelectorAll(selector)].find((node) => {
      if (node.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' &&
        Boolean(node.textContent?.trim());
    });
    const forbiddenState = forbidden.map((selector) => {
      const nodes = [...document.querySelectorAll(selector)]
        .filter((node) => !node.closest('.fluent-read-bilingual-content'));
      return {
        selector,
        dynamic: dynamicForbidden.includes(selector),
        count: nodes.length,
        translatedDescendants: nodes.reduce((count, node) =>
          count + node.querySelectorAll('.fluent-read-bilingual-content').length, 0),
        signatures: nodes.slice(0, 12).map((node) => ({
          tagName: node.tagName,
          id: node.id,
          role: node.getAttribute('role') || '',
          ariaLabel: node.getAttribute('aria-label') || '',
          value: 'value' in node ? String(node.value || '') : '',
          text: (node.textContent || '').replace(/\s+/gu, ' ').trim(),
        })),
      };
    });
    const requiredState = required.map((selector) => {
      const node = firstVisibleTextNode(selector);
      return {selector, minimumCount: document.querySelectorAll(selector).length, html: node?.outerHTML || ''};
    });
    const interactionState = interactions.map((selector) => {
      const nodes = [...document.querySelectorAll(selector)]
        .filter((node) => !node.closest('.fluent-read-bilingual-content'));
      const node = nodes.find((candidate) => {
        const rect = candidate.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }) || nodes[0];
      return {
        selector,
        minimumCount: nodes.length,
        tagName: node?.tagName || '',
        href: node instanceof HTMLAnchorElement ? node.href : '',
        type: node && 'type' in node ? String(node.type || '') : '',
        disabled: Boolean(node?.matches?.(':disabled')),
        ariaDisabled: node?.getAttribute?.('aria-disabled') || '',
        role: node?.getAttribute?.('role') || '',
      };
    });
    return {requiredState, forbiddenState, interactionState};
  }, {
    required: requiredSelectors,
    forbidden: forbiddenSelectors,
    interactions: interactionSelectors,
    dynamicForbidden: dynamicForbiddenSelectors,
  });
}

async function assertPageContract(page, baseline, requiredSelectors, expectedUrl, phase) {
  const state = await page.evaluate(({baselineState, required, url}) => {
    const firstVisibleTextNode = (selector) => [...document.querySelectorAll(selector)].find((node) => {
      if (node.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' &&
        Boolean(node.textContent?.trim());
    });
    const forbiddenState = baselineState.forbiddenState.map(({selector, dynamic}) => {
      const nodes = [...document.querySelectorAll(selector)]
        .filter((node) => !node.closest('.fluent-read-bilingual-content'));
      return {
        selector,
        dynamic,
        count: nodes.length,
        translatedDescendants: nodes.reduce((count, node) =>
          count + node.querySelectorAll('.fluent-read-bilingual-content').length, 0),
        signatures: nodes.slice(0, dynamic ? nodes.length : 12).map((node) => ({
          tagName: node.tagName,
          id: node.id,
          role: node.getAttribute('role') || '',
          ariaLabel: node.getAttribute('aria-label') || '',
          value: 'value' in node ? String(node.value || '') : '',
          text: (node.textContent || '').replace(/\s+/gu, ' ').trim(),
        })),
      };
    });
    const requiredState = required.map((selector) => ({
      selector,
      count: document.querySelectorAll(selector).length,
      exists: Boolean(firstVisibleTextNode(selector)),
    }));
    const interactionState = baselineState.interactionState.map(({selector}) => {
      const nodes = [...document.querySelectorAll(selector)]
        .filter((node) => !node.closest('.fluent-read-bilingual-content'));
      const initial = baselineState.interactionState.find((item) => item.selector === selector);
      const matchesInitialIdentity = (candidate) => {
        const href = candidate instanceof HTMLAnchorElement ? candidate.href : '';
        const type = candidate && 'type' in candidate ? String(candidate.type || '') : '';
        return candidate.tagName === initial?.tagName && href === initial?.href && type === initial?.type &&
          (candidate.getAttribute?.('role') || '') === initial?.role;
      };
      const node = nodes.find((candidate) => matchesInitialIdentity(candidate)) || nodes.find((candidate) => {
        const rect = candidate.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }) || nodes[0];
      const focusable = Boolean(node && !node.matches(':disabled') && (
        node.matches('a[href], button, input, select, textarea, summary, [contenteditable="true"]') ||
        node.tabIndex >= 0
      ));
      return {
        selector,
        count: nodes.length,
        tagName: node?.tagName || '',
        href: node instanceof HTMLAnchorElement ? node.href : '',
        type: node && 'type' in node ? String(node.type || '') : '',
        disabled: Boolean(node?.matches?.(':disabled')),
        ariaDisabled: node?.getAttribute?.('aria-disabled') || '',
        role: node?.getAttribute?.('role') || '',
        connected: Boolean(node?.isConnected),
        focusable,
      };
    });
    return {
      urlUnchanged: location.href === url,
      documentHealthy: document.readyState !== 'loading' && Boolean(document.documentElement?.isConnected) && Boolean(document.body?.isConnected),
      requiredState,
      forbiddenState,
      interactionState,
    };
  }, {baselineState: baseline, required: requiredSelectors, url: expectedUrl});

  const errors = [];
  if (!state.urlUnchanged) errors.push(`URL 已变化：${page.url()}`);
  if (!state.documentHealthy) errors.push('document/body 已失效');
  for (const current of state.requiredState) {
    const initial = baseline.requiredState.find(({selector}) => selector === current.selector);
    if (!current.exists || current.count < initial.minimumCount) {
      errors.push(`关键 selector 丢失：${current.selector}（${current.count}/${initial.minimumCount}）`);
    }
  }
  for (const current of state.forbiddenState) {
    const initial = baseline.forbiddenState.find(({selector}) => selector === current.selector);
    if (current.translatedDescendants !== 0) {
      errors.push(`forbidden DOM 出现译文：${JSON.stringify(current)}`);
      continue;
    }
    if (initial.dynamic) {
      const currentSignatures = new Set(current.signatures.map((signature) => JSON.stringify(signature)));
      const missingBaseline = initial.signatures.some((signature) =>
        !currentSignatures.has(JSON.stringify(signature)));
      if (current.count < initial.count || missingBaseline) {
        errors.push(`动态 forbidden DOM 基线丢失：${JSON.stringify({before: initial, after: current})}`);
      }
    } else if (JSON.stringify(current) !== JSON.stringify(initial)) {
      errors.push(`forbidden DOM 被修改：${JSON.stringify({before: initial, after: current})}`);
    }
  }
  for (const current of state.interactionState) {
    const initial = baseline.interactionState.find(({selector}) => selector === current.selector);
    const stable = current.count >= initial.minimumCount && current.tagName === initial.tagName &&
      current.href === initial.href && current.type === initial.type && current.disabled === initial.disabled &&
      current.ariaDisabled === initial.ariaDisabled && current.role === initial.role && current.connected &&
      (current.disabled || current.focusable);
    if (!stable) errors.push(`交互元素失效：${JSON.stringify({before: initial, after: current})}`);
  }
  if (errors.length > 0) throw new Error(`${phase} 页面完整性断言失败：${errors.join('；')}`);
  return state;
}

async function assertRequiredRestored(page, baseline, phase) {
  const restored = await page.evaluate((requiredState) => requiredState.map(({selector}) => {
    const node = [...document.querySelectorAll(selector)].find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && Boolean(candidate.textContent?.trim());
    });
    return {selector, html: node?.outerHTML || ''};
  }), baseline.requiredState);
  const expected = baseline.requiredState.map(({selector, html}) => ({selector, html}));
  if (JSON.stringify(restored) !== JSON.stringify(expected)) {
    throw new Error(`${phase} 未完整恢复原始 DOM：${JSON.stringify({expected, restored})}`);
  }
}

async function assertWrapperUniqueness(page, expectedTotal, phase) {
  const state = await page.evaluate(() => {
    const wrappers = [...document.querySelectorAll('.fluent-read-bilingual-content')];
    const parentCounts = new Map();
    for (const wrapper of wrappers) {
      parentCounts.set(wrapper.parentElement, (parentCounts.get(wrapper.parentElement) || 0) + 1);
    }
    return {
      total: wrappers.length,
      duplicateParents: [...parentCounts.values()].filter((count) => count > 1).length,
      nested: document.querySelectorAll('.fluent-read-bilingual-content .fluent-read-bilingual-content').length,
    };
  });
  if ((expectedTotal !== null && state.total !== expectedTotal) || state.duplicateParents !== 0 || state.nested !== 0) {
    throw new Error(`${phase} 出现缺失或重复 wrapper：${JSON.stringify({...state, expectedTotal})}`);
  }
  return state;
}

async function readTargetState(page, selector) {
  return page.evaluate((targetSelector) => {
    const target = document.querySelector(targetSelector);
    const wrappers = [...(target?.querySelectorAll('.fluent-read-bilingual-content') || [])];
    return {
      exists: Boolean(target),
      text: target?.textContent?.trim() || '',
      bilingualCount: wrappers.length,
      translationTexts: wrappers.map((wrapper) => wrapper.textContent?.trim() || ''),
    };
  }, selector);
}

async function waitForTranslationIdle(page, timeout, phase) {
  const ownedLoading = '.fluent-read-loading[data-fr-translation-owned="true"]';
  const ownedRetry = '.fluent-read-retry-wrapper[data-fr-translation-owned="true"]';
  // One provider request may consume 4 x 45s attempts plus retry backoff.
  const idleTimeout = Math.max(timeout, 210000);
  try {
    await page.waitForFunction(
      (selector) => document.querySelectorAll(selector).length === 0,
      ownedLoading,
      {timeout: idleTimeout},
    );
  } catch (error) {
    const diagnostics = await page.evaluate(({loadingSelector, retrySelector}) => {
      const describe = (node) => ({
        ownerTag: node.parentElement?.tagName || '',
        ownerId: node.parentElement?.id || '',
        ownerClass: typeof node.parentElement?.className === 'string' ? node.parentElement.className : '',
        ownerText: (node.parentElement?.textContent || '').replace(/\s+/gu, ' ').trim().slice(0, 240),
      });
      return {
        loading: [...document.querySelectorAll(loadingSelector)].map(describe),
        retries: [...document.querySelectorAll(retrySelector)].map(describe),
      };
    }, {loadingSelector: ownedLoading, retrySelector: ownedRetry});
    throw new Error(`${phase} 等待翻译请求结束超时：${error.message}\n${JSON.stringify(diagnostics)}`);
  }

  const retries = await page.evaluate((selector) => [...document.querySelectorAll(selector)].map((node) => ({
    ownerTag: node.parentElement?.tagName || '',
    ownerId: node.parentElement?.id || '',
    ownerClass: typeof node.parentElement?.className === 'string' ? node.parentElement.className : '',
    ownerText: (node.parentElement?.textContent || '').replace(/\s+/gu, ' ').trim().slice(0, 240),
  })), ownedRetry);
  if (retries.length > 0) throw new Error(`${phase} 存在终态翻译失败：${JSON.stringify(retries)}`);
}

// 全文翻译使用可视区懒加载。回归时主动滚过页面，触发所有长页面内容块，
// 然后等待插件的进行中任务和 loading 节点都清空，避免只验证到首屏。
async function scrollAndWaitFullPage(page, timeout, scrollContainerSelector, targetSelector) {
  const maxSteps = 40;
  const layout = await page.evaluate((selector) => {
    const container = selector ? document.querySelector(selector) : null;
    if (selector && !(container instanceof HTMLElement)) {
      throw new Error(`找不到滚动容器：${selector}`);
    }
    const windowDistance = Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0) -
      Math.max(window.innerHeight || 0, 480);
    return {
      viewport: container instanceof HTMLElement ? container.clientHeight : Math.max(window.innerHeight || 0, 480),
      maxDistance: container instanceof HTMLElement
        ? Math.max(0, container.scrollHeight - container.clientHeight)
        : Math.max(0, windowDistance),
    };
  }, scrollContainerSelector || '');
  const stepSize = Math.max(Math.floor(layout.viewport * 0.8), 400);
  const steps = Math.max(1, Math.min(maxSteps, Math.ceil(layout.maxDistance / stepSize)));

  for (let step = 0; step <= steps; step += 1) {
    const progress = step / steps;
    await page.evaluate(({ratio, selector}) => {
      const container = selector ? document.querySelector(selector) : null;
      if (container instanceof HTMLElement) {
        container.scrollTop = Math.max(0, container.scrollHeight - container.clientHeight) * ratio;
        return;
      }
      const pageHeight = Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0);
      window.scrollTo(0, Math.max(0, pageHeight - window.innerHeight) * ratio);
    }, {ratio: progress, selector: scrollContainerSelector || ''});
    await page.waitForTimeout(700);
    if (step > 0 && (step % 10 === 0 || step === steps)) {
      reportProgress(`全文滚动 ${step}/${steps}`);
    }
  }

  await waitForTranslationIdle(page, timeout, '页面滚动后');

  // 队列刚清空时再停留一小段时间，确认没有由最后一次 DOM 写入触发的重复请求。
  await page.waitForTimeout(800);
  await page.evaluate((selector) => {
    const container = selector ? document.querySelector(selector) : null;
    if (container instanceof HTMLElement) container.scrollTop = 0;
    else window.scrollTo(0, 0);
  }, scrollContainerSelector || '');

  // Returning to the first viewport starts another IntersectionObserver
  // round. Re-reveal the target and wait for the new lazy work before reading
  // state; otherwise a valid intermediate state looks like a lost translation.
  await revealFullPageTarget(page, targetSelector);
  await page.waitForFunction(
    (selector) => (document.querySelector(selector)?.querySelectorAll('.fluent-read-bilingual-content').length || 0) >= 1,
    targetSelector,
    {timeout},
  );
  await waitForTranslationIdle(page, timeout, '回到目标后');
  await page.waitForTimeout(300);
}

async function revealFullPageTarget(page, selector) {
  const target = page.locator(selector).first();
  try {
    await target.scrollIntoViewIfNeeded({timeout: 10000});
  } catch {
    // GitHub's virtualized React lists can keep an element in a transient
    // actionability state even though it is attached and readable. A direct
    // DOM scroll is sufficient here; all translation input still uses trusted
    // keyboard events rather than synthetic page events.
    await target.evaluate((node) => node.scrollIntoView({block: 'center', inline: 'nearest'}));
  }
  // Some sites remove a hidden animation marker from an IntersectionObserver
  // callback after the nearest scrolling container moves.
  await page.waitForTimeout(900);
}

async function readFullPageState(page, selector, requiredSelectors, fullCoverageSelectors, controlSelector) {
  return page.evaluate(({targetSelector, required, coverageSelectors, buttonSelector}) => {
    const wrappers = [...document.querySelectorAll('.fluent-read-bilingual-content')];
    const parents = new Set(wrappers.map((wrapper) => wrapper.parentElement));
    const target = document.querySelector(targetSelector);
    const requiredBilingual = required.map((requiredSelector) => {
      const node = [...document.querySelectorAll(requiredSelector)].find((candidate) => {
        if (candidate.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
        const rect = candidate.getBoundingClientRect();
        const style = getComputedStyle(candidate);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' &&
          Boolean(candidate.textContent?.trim());
      });
      const translations = [...(node?.querySelectorAll('.fluent-read-bilingual-content') || [])];
      return {
        selector: requiredSelector,
        exists: Boolean(node),
        bilingualCount: translations.length,
        translationTexts: translations.map((translation) => translation.textContent?.trim() || ''),
      };
    });
    const fullCoverage = coverageSelectors.map((coverageSelector) => {
      const nodes = [...document.querySelectorAll(coverageSelector)].filter((candidate) => {
        if (candidate.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
        const rect = candidate.getBoundingClientRect();
        const style = getComputedStyle(candidate);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' &&
          Boolean(candidate.textContent?.trim());
      });
      const translated = nodes.filter((node) => {
        const translations = [...node.querySelectorAll('.fluent-read-bilingual-content')];
        return translations.length > 0 &&
          translations.every((translation) => /[\u3400-\u9fff]/u.test(translation.textContent || ''));
      });
      return {selector: coverageSelector, visibleCount: nodes.length, translatedCount: translated.length};
    });
    return {
      totalBilingual: wrappers.length,
      uniqueWrapperParents: parents.size,
      targetBilingual: target?.querySelectorAll('.fluent-read-bilingual-content').length || 0,
      requiredBilingual,
      fullCoverage,
      controlTexts: buttonSelector
        ? [...document.querySelectorAll(buttonSelector)].map((node) => node.textContent?.trim() || '')
        : [],
    };
  }, {
    targetSelector: selector,
    required: requiredSelectors,
    coverageSelectors: fullCoverageSelectors,
    buttonSelector: controlSelector || '',
  });
}

async function toggleHover(page, target, selector, expectedCount, timeout) {
  await target.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  const box = await target.boundingBox();
  if (!box) throw new Error('悬浮翻译目标不可见');
  const x = box.x + Math.min(Math.max(box.width * 0.35, 8), Math.max(box.width - 8, 8));
  // Keep the pointer on the original first line. Bilingual mode appends a
  // second line, so using the post-translation vertical center can drift into
  // a neighbouring row on dense lists such as GitHub Pulls.
  const y = box.y + Math.min(Math.max(box.height * 0.2, 4), 12);
  await page.mouse.move(x, y);
  await page.keyboard.down('Control');
  await page.keyboard.up('Control');
  try {
    await page.waitForFunction(
      ({targetSelector, count}) => document.querySelector(targetSelector)?.querySelectorAll('.fluent-read-bilingual-content').length === count,
      {targetSelector: selector, count: expectedCount},
      {timeout},
    );
  } catch (error) {
    const diagnostics = await page.evaluate(({targetSelector, point}) => {
      const target = document.querySelector(targetSelector);
      return {
        url: location.href,
        text: target?.textContent?.trim() || '',
        bilingualCount: target?.querySelectorAll('.fluent-read-bilingual-content').length || 0,
        loadingCount: target?.querySelectorAll('.fluent-read-loading').length || 0,
        retryCount: target?.querySelectorAll('.fluent-read-retry-wrapper').length || 0,
        hitStack: document.elementsFromPoint(point.x, point.y).slice(0, 8).map((element) => ({
          tag: element.tagName,
          id: element.id,
          className: typeof element.className === 'string' ? element.className : '',
          text: (element.textContent || '').trim().slice(0, 120),
        })),
        translatedParents: [...document.querySelectorAll('.fluent-read-bilingual-content')].map((wrapper) =>
          (wrapper.parentElement?.textContent || '').trim().slice(0, 160)),
      };
    }, {targetSelector: selector, point: {x, y}});
    throw new Error(`${error.message}\n悬浮 case 诊断（期望 wrapper=${expectedCount}）：${JSON.stringify(diagnostics)}`);
  }
}

async function toggleFull(page) {
  // 全文翻译使用产品真实快捷键 Alt+T，而不是点击浮球或构造 KeyboardEvent。
  await page.keyboard.down('Alt');
  await page.keyboard.press('t');
  await page.keyboard.up('Alt');
}

async function captureEvidence(page, outputPath) {
  try {
    await page.screenshot({path: outputPath, fullPage: false, timeout: 10000});
  } catch (error) {
    process.stderr.write(`证据截图失败（不影响 DOM/交互断言）：${error.message}\n`);
  }
}

async function runHoverCase(page, selector, requiredSelectors, pageContract, timeout, artifactsDir) {
  const target = page.locator(selector).first();
  const targets = page.locator(selector);
  const initialUrl = page.url();
  const counts = [];
  const neighborCounts = [];
  const hasNeighbor = await targets.count() > 1;

  for (const expected of [1, 0, 1]) {
    await toggleHover(page, target, selector, expected, timeout);
    counts.push(await target.locator('.fluent-read-bilingual-content').count());
    neighborCounts.push(hasNeighbor ? await targets.nth(1).locator('.fluent-read-bilingual-content').count() : 0);
    if (neighborCounts.at(-1) !== 0) throw new Error(`悬浮 case 误翻译相邻节点：${JSON.stringify(neighborCounts)}`);
    await assertWrapperUniqueness(page, expected, `悬浮第 ${counts.length} 次切换`);
    await assertPageContract(page, pageContract, requiredSelectors, initialUrl, `悬浮第 ${counts.length} 次切换`);
    if (expected === 0) await assertRequiredRestored(page, pageContract, '悬浮恢复');
    if (artifactsDir && expected === 1) {
      const name = counts.length === 1 ? 'hover-first-translation.png' : 'hover-final-translation.png';
      await captureEvidence(page, path.join(artifactsDir, name));
    }
  }

  const translationText = (await target.locator('.fluent-read-bilingual-content').first().textContent() || '').trim();
  if (!/[\u3400-\u9fff]/u.test(translationText)) throw new Error(`悬浮译文没有中文：${translationText}`);
  return {counts, neighborCounts, translationText};
}

async function runFullCase(
  page,
  selector,
  requiredSelectors,
  fullCoverageSelectors,
  pageContract,
  controlSelector,
  scrollContainer,
  timeout,
  artifactsDir,
) {
  const initialUrl = page.url();
  await toggleFull(page);
  reportProgress('已触发首次全文翻译');
  await revealFullPageTarget(page, selector);
  try {
    await page.waitForFunction(
      (targetSelector) => (document.querySelector(targetSelector)?.querySelectorAll('.fluent-read-bilingual-content').length || 0) >= 1,
      selector,
      {timeout},
    );
  } catch (error) {
    const diagnostics = await page.evaluate((targetSelector) => {
      const targetNode = document.querySelector(targetSelector);
      return {
        totalBilingual: document.querySelectorAll('.fluent-read-bilingual-content').length,
        targetText: targetNode?.textContent?.trim() || '',
        targetBilingual: targetNode?.querySelectorAll('.fluent-read-bilingual-content').length || 0,
        targetLoading: targetNode?.querySelectorAll('.fluent-read-loading').length || 0,
        targetRetry: targetNode?.querySelectorAll('.fluent-read-retry-wrapper').length || 0,
        translatedNodes: [...document.querySelectorAll('.fluent-read-bilingual-content')].map((node) => ({
          text: node.textContent?.trim() || '',
          parent: node.parentElement?.outerHTML.slice(0, 500) || '',
        })),
        bodyText: (document.body?.innerText || '').slice(0, 1000),
      };
    }, selector);
    throw new Error(`${error.message}\n全文 case 诊断：${JSON.stringify(diagnostics)}`);
  }
  const translated = await readTargetState(page, selector);
  reportProgress('首次目标已翻译，开始滚动页面主滚动面');
  if (translated.bilingualCount < 1 || !translated.translationTexts.every((text) => /[\u3400-\u9fff]/u.test(text))) {
    throw new Error(`全文首次翻译状态异常：${JSON.stringify(translated)}`);
  }
  await scrollAndWaitFullPage(page, timeout, scrollContainer, selector);
  const translatedPage = await readFullPageState(
    page,
    selector,
    requiredSelectors,
    fullCoverageSelectors,
    controlSelector,
  );
  reportProgress(`首次全文稳定：${translatedPage.totalBilingual} 个 wrapper`);
  if (translatedPage.targetBilingual < 1 || translatedPage.totalBilingual < 1 ||
      translatedPage.uniqueWrapperParents !== translatedPage.totalBilingual ||
      translatedPage.requiredBilingual.some((item) => item.bilingualCount < 1 ||
        item.translationTexts.some((text) => !/[\u3400-\u9fff]/u.test(text))) ||
      translatedPage.fullCoverage.some((item) => item.visibleCount < 1 || item.translatedCount !== item.visibleCount)) {
    throw new Error(`全文滚动后状态异常：${JSON.stringify(translatedPage)}`);
  }
  await assertWrapperUniqueness(page, null, '全文首次翻译');
  await assertPageContract(page, pageContract, requiredSelectors, initialUrl, '全文首次翻译');
  if (controlSelector && (translatedPage.controlTexts.length === 0 ||
      translatedPage.controlTexts.some((text) => !/[\u3400-\u9fff]/u.test(text)))) {
    throw new Error(`全文按钮没有统一替换为译文：${JSON.stringify(translatedPage.controlTexts)}`);
  }
  if (artifactsDir) await captureEvidence(page, path.join(artifactsDir, 'full-first-translation.png'));

  await toggleFull(page);
  reportProgress('已触发全文恢复');
  await page.waitForFunction(
    () => document.querySelectorAll('.fluent-read-bilingual-content').length === 0,
    undefined,
    {timeout},
  );
  const restored = await readTargetState(page, selector);
  if (restored.bilingualCount !== 0) throw new Error(`全文恢复仍残留译文：${JSON.stringify(restored)}`);
  await assertWrapperUniqueness(page, 0, '全文恢复');
  await assertRequiredRestored(page, pageContract, '全文恢复');
  await assertPageContract(page, pageContract, requiredSelectors, initialUrl, '全文恢复');
  reportProgress('全文恢复完成');

  await toggleFull(page);
  reportProgress('已触发第二次全文翻译');
  await revealFullPageTarget(page, selector);
  await page.waitForFunction(
    (targetSelector) => (document.querySelector(targetSelector)?.querySelectorAll('.fluent-read-bilingual-content').length || 0) >= 1,
    selector,
    {timeout},
  );
  const retranslated = await readTargetState(page, selector);
  if (retranslated.bilingualCount < 1 || !retranslated.translationTexts.every((text) => /[\u3400-\u9fff]/u.test(text))) {
    throw new Error(`全文再次翻译状态异常：${JSON.stringify(retranslated)}`);
  }
  await scrollAndWaitFullPage(page, timeout, scrollContainer, selector);
  const retranslatedPage = await readFullPageState(
    page,
    selector,
    requiredSelectors,
    fullCoverageSelectors,
    controlSelector,
  );
  reportProgress(`第二次全文稳定：${retranslatedPage.totalBilingual} 个 wrapper`);
  if (retranslatedPage.targetBilingual < 1 || retranslatedPage.totalBilingual < 1 ||
      retranslatedPage.uniqueWrapperParents !== retranslatedPage.totalBilingual ||
      retranslatedPage.requiredBilingual.some((item) => item.bilingualCount < 1 ||
        item.translationTexts.some((text) => !/[\u3400-\u9fff]/u.test(text))) ||
      retranslatedPage.fullCoverage.some((item) => item.visibleCount < 1 || item.translatedCount !== item.visibleCount)) {
    throw new Error(`全文再次滚动后状态异常：${JSON.stringify(retranslatedPage)}`);
  }
  await assertWrapperUniqueness(page, null, '全文再次翻译');
  await assertPageContract(page, pageContract, requiredSelectors, initialUrl, '全文再次翻译');
  if (controlSelector && (retranslatedPage.controlTexts.length === 0 ||
      retranslatedPage.controlTexts.some((text) => !/[\u3400-\u9fff]/u.test(text)))) {
    throw new Error(`全文再次翻译按钮没有统一替换为译文：${JSON.stringify(retranslatedPage.controlTexts)}`);
  }
  if (artifactsDir) await captureEvidence(page, path.join(artifactsDir, 'full-final-translation.png'));
  return {translated, translatedPage, restored, retranslated, retranslatedPage};
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const extensionDir = path.resolve(args.extensionDir);
  if (!fs.existsSync(path.join(extensionDir, 'manifest.json'))) throw new Error('插件 manifest.json 不存在');
  if (!fs.existsSync(args.browserPath)) throw new Error(`浏览器不存在：${args.browserPath}`);

  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-site-case-'));
  assertDedicatedProfile(profileDir);
  const artifactsDir = args.artifactsDir ? path.resolve(args.artifactsDir) : null;
  if (artifactsDir) fs.mkdirSync(artifactsDir, {recursive: true});
  const {chromium} = loadPlaywright(args.playwrightRoot);
  let context;
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      executablePath: args.browserPath,
      headless: false,
      viewport: {width: 1280, height: 900},
      args: [
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`,
        ...(args.background ? ['--start-minimized', '--window-position=-10000,-10000'] : []),
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
    const page = await context.newPage();
    await page.goto(args.url, {waitUntil: 'domcontentloaded', timeout: args.timeout});
    reportProgress(`${args.case}/${args.mode} 页面已加载`);
    // 当前 main 默认关闭悬浮球，但 Control/Alt+T 快捷键仍独立工作；
    // 这里等待 content script 初始化，而不是要求 UI 浮球必须存在。
    await page.waitForTimeout(1000);
    await waitForStableTarget(page, args.selector, args.timeout);
    await waitForPageContract(
      page,
      args.requiredSelectors,
      args.forbiddenSelectors,
      args.interactionSelectors,
      args.timeout,
    );
    const pageContract = await capturePageContract(
      page,
      args.requiredSelectors,
      args.forbiddenSelectors,
      args.interactionSelectors,
      args.dynamicForbiddenSelectors,
    );
    const configResult = await readConfig(context, args.timeout);
    const config = configResult.config || {};
    const expectedHotkey = args.mode === 'hover' ? args.hoverHotkey : args.fullPageHotkey;
    if (config.service !== args.service) throw new Error(`服务不符：预期 ${args.service}，实际 ${config.service}`);
    if (Number(config.display) !== 1) throw new Error(`预期双语模式 display=1，实际 ${config.display}`);
    if (args.mode === 'hover' && config.hotkey !== expectedHotkey) throw new Error(`悬浮快捷键不符：${config.hotkey}`);
    if (args.mode === 'full' && config.floatingBallHotkey !== expectedHotkey) throw new Error(`全文快捷键不符：${config.floatingBallHotkey}`);
    await page.bringToFront();
    reportProgress(`${args.case}/${args.mode} 页面 contract 与扩展配置已就绪`);

    const result = args.mode === 'hover'
      ? await runHoverCase(
        page,
        args.selector,
        args.requiredSelectors,
        pageContract,
        args.timeout,
        artifactsDir,
      )
      : await runFullCase(
        page,
        args.selector,
        args.requiredSelectors,
        args.fullCoverageSelectors,
        pageContract,
        args.controlSelector,
        args.scrollContainer,
        args.timeout,
        artifactsDir,
      );
    process.stdout.write(`${JSON.stringify({
      ok: true,
      case: args.case,
      mode: args.mode,
      url: args.url,
      selector: args.selector,
      requiredSelectors: args.requiredSelectors,
      forbiddenSelectors: args.forbiddenSelectors,
      dynamicForbiddenSelectors: args.dynamicForbiddenSelectors,
      fullCoverageSelectors: args.fullCoverageSelectors,
      interactionSelectors: args.interactionSelectors,
      tier: args.tier,
      windowMode: args.background ? 'background-screen-off' : 'headed-isolated',
      service: config.service,
      display: config.display,
      screenshots: artifactsDir ? fs.readdirSync(artifactsDir).map((name) => path.join(artifactsDir, name)) : [],
      ...result,
    }, null, 2)}\n`);
  } finally {
    if (context) await context.close().catch(() => {});
    fs.rmSync(profileDir, {recursive: true, force: true});
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
