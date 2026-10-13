#!/usr/bin/env node

import {spawn} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath, pathToFileURL} from 'node:url';

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const BOOLEAN_FLAGS = new Set(['allow-network', 'browser', 'dry-run', 'headed', 'help', 'network']);
const VALUE_FLAGS = new Set([
    'artifacts-dir',
    'browser-path',
    'extension-dir',
    'focus-safe-helper',
    'playwright-root',
    'timeout',
]);
const TEST_GROUPS = ['architecture', 'unit', 'functional', 'regression'];

const LOCAL_BROWSER_FIXTURES = [
    {
        id: 'popup-first-run-height',
        label: 'fresh popup onboarding and main-content height regression',
        script: 'scripts/testing/run-popup-first-run-height-test.cjs',
        backgroundArgs: ['--background'],
        supportsHeaded: false,
    },
    {
        id: 'selection-trigger',
        label: 'selection trigger browser regression',
        script: 'scripts/run-selection-trigger-test.cjs',
        backgroundArgs: ['--background'],
        supportsHeaded: true,
    },
    {
        id: 'full-page-translation',
        label: 'full-page translation browser regression',
        script: 'scripts/run-full-page-translation-test.cjs',
        args: ['--verify-floating-ui', '--verify-loading-style-isolation'],
        backgroundArgs: ['--background'],
        supportsHeaded: true,
    },
    {
        id: 'translation-mutation',
        label: 'translation mutation and control ownership browser regression',
        script: 'scripts/testing/run-translation-mutation-test.cjs',
        backgroundArgs: ['--background'],
        supportsHeaded: false,
    },
    {
        id: 'fixed-height-translation',
        label: 'fixed-height bilingual layout browser regression',
        script: 'scripts/testing/run-fixed-height-translation-test.cjs',
        backgroundArgs: ['--background'],
        supportsHeaded: false,
    },
    {
        id: 'github-spacing',
        label: 'GitHub bilingual title spacing and metadata browser regression',
        script: 'scripts/testing/run-github-spacing-test.cjs',
        backgroundArgs: ['--background'],
        supportsHeaded: false,
    },
    {
        id: 'github-nested-list',
        label: 'GitHub nested Markdown list ownership browser regression',
        script: 'scripts/testing/run-github-nested-list-test.cjs',
        backgroundArgs: ['--background'],
        supportsHeaded: false,
    },
    {
        id: 'github-task-list',
        label: 'GitHub hydrated task list and source preservation browser regression',
        script: 'scripts/testing/run-github-task-list-test.cjs',
        backgroundArgs: ['--background'],
        supportsHeaded: false,
    },
    {
        id: 'video-subtitle-fixture',
        label: 'video subtitle fixture browser regression',
        script: 'scripts/run-video-subtitle-fixture-test.cjs',
        backgroundArgs: ['--background'],
        supportsHeaded: false,
    },
    {
        id: 'document-translation',
        label: 'document translation browser regression',
        script: 'scripts/run-document-translation-test.cjs',
        backgroundArgs: ['--background', 'true'],
        supportsHeaded: false,
    },
    {
        id: 'settings-center-ui',
        label: 'settings center UI browser regression',
        script: 'scripts/testing/run-settings-center-ui-test.cjs',
        backgroundArgs: ['--background'],
        supportsHeaded: false,
    },
    {
        id: 'glossary',
        label: 'glossary browser regression',
        script: 'scripts/run-glossary-test.cjs',
        backgroundArgs: ['--background'],
        supportsHeaded: false,
        supportsTimeout: false,
    },
    {
        id: 'privacy-boundary',
        label: 'privacy boundary browser regression',
        script: 'scripts/run-privacy-boundary-test.cjs',
        backgroundArgs: ['--background'],
        supportsHeaded: true,
    },
    {
        id: 'userscript-smoke',
        label: 'userscript browser smoke regression',
        script: 'scripts/run-userscript-smoke-test.cjs',
        artifact: '.output/userscript/fluent-read.user.js',
        backgroundArgs: ['--background'],
        supportsHeaded: true,
    },
];

const NETWORK_MATRIX = {
    id: 'site-translation-matrix',
    label: 'site translation network matrix',
    script: 'scripts/run-site-translation-matrix.cjs',
    backgroundArgs: ['--background'],
    supportsHeaded: true,
};

function printUsage() {
    console.log([
        '用法: node scripts/testing/run-full-regression.mjs [--dry-run] [--browser] [--network --allow-network] [options]',
        '',
        '默认/local 只执行确定性流水线：audit、prepare、compile、strict coverage、分组 Vitest、Chrome/Firefox/userscript build、docs/Storybook typecheck、build 与产物校验。',
        '',
        '显式门禁：',
        '  --browser                 追加本地真实浏览器 fixtures。',
        '  --network --allow-network 追加真实站点网络矩阵；两者必须同时出现。',
        '  --headed                  只在显式传入时允许 headed fixture，plan 中标注 foreground-authorized。',
        '  --dry-run                 输出执行 plan，不启动测试、构建、浏览器或网络。',
        '',
        '浏览器/网络参数：',
        '  --extension-dir <path>       默认 FLUENTREAD_EXTENSION_DIR 或 .output/chrome-mv3',
        '  --playwright-root <path>     默认 PLAYWRIGHT_ROOT',
        '  --browser-path <path>        默认 FLUENTREAD_BROWSER_PATH',
        '  --focus-safe-helper <path>   默认 FLUENTREAD_FOCUS_SAFE_HELPER 或仓库 helper',
        '  --artifacts-dir <path>       默认系统临时目录下的 fluentread-full-regression-*',
        '  --timeout <ms>               传给支持 timeout 的浏览器脚本',
    ].join('\n'));
}

function readOption(argv, index) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`无法识别参数：${token}`);
    const name = token.slice(2);
    if (BOOLEAN_FLAGS.has(name)) return {name, value: true, nextIndex: index};
    if (!VALUE_FLAGS.has(name)) throw new Error(`未知参数：${token}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`参数缺少值：${token}`);
    return {name, value, nextIndex: index + 1};
}

export function parseCli(argv, env = process.env, runtime = {}) {
    const options = {
        allowNetwork: false,
        browser: false,
        dryRun: false,
        headed: false,
        help: false,
        network: false,
        extensionDir: env.FLUENTREAD_EXTENSION_DIR || '.output/chrome-mv3',
        playwrightRoot: env.PLAYWRIGHT_ROOT || '',
        browserPath: env.FLUENTREAD_BROWSER_PATH || '',
        focusSafeHelper: env.FLUENTREAD_FOCUS_SAFE_HELPER || path.join(PROJECT_ROOT, 'scripts/testing/focus-safe-browser.cjs'),
        artifactsDir: env.FLUENTREAD_REGRESSION_ARTIFACTS_DIR ||
            path.join(os.tmpdir(), `fluentread-full-regression-${process.pid}-${runtime.now ?? Date.now()}`),
        timeout: env.FLUENTREAD_BROWSER_TIMEOUT || '',
    };

    for (let index = 0; index < argv.length; index += 1) {
        // pnpm run <script> -- <args> 会把分隔符原样传给 Node；它不是 runner 自身的选项。
        if (argv[index] === '--') continue;
        const {name, value, nextIndex} = readOption(argv, index);
        index = nextIndex;
        switch (name) {
            case 'allow-network':
                options.allowNetwork = true;
                break;
            case 'browser':
                options.browser = true;
                break;
            case 'dry-run':
                options.dryRun = true;
                break;
            case 'headed':
                options.headed = true;
                break;
            case 'help':
                options.help = true;
                break;
            case 'network':
                options.network = true;
                break;
            case 'artifacts-dir':
                options.artifactsDir = value;
                break;
            case 'browser-path':
                options.browserPath = value;
                break;
            case 'extension-dir':
                options.extensionDir = value;
                break;
            case 'focus-safe-helper':
                options.focusSafeHelper = value;
                break;
            case 'playwright-root':
                options.playwrightRoot = value;
                break;
            case 'timeout':
                options.timeout = value;
                break;
            default:
                throw new Error(`未知参数：--${name}`);
        }
    }

    return normalizeOptions(options);
}

function normalizeOptions(options) {
    const normalized = {
        ...options,
        artifactsDir: path.resolve(options.artifactsDir),
        extensionDir: path.resolve(options.extensionDir),
        focusSafeHelper: options.focusSafeHelper ? path.resolve(options.focusSafeHelper) : '',
        playwrightRoot: options.playwrightRoot ? path.resolve(options.playwrightRoot) : '',
        browserPath: options.browserPath ? path.resolve(options.browserPath) : '',
        timeout: options.timeout ? String(options.timeout) : '',
    };

    if (normalized.help) return normalized;
    if (normalized.allowNetwork && !normalized.network) {
        throw new Error('--allow-network 只能和 --network 同时使用，避免把授权标志误认为已运行网络矩阵');
    }
    if (normalized.network && !normalized.allowNetwork) {
        throw new Error('真实站点矩阵必须同时传入 --network 和 --allow-network');
    }
    if (normalized.headed && !normalized.browser && !normalized.network) {
        throw new Error('--headed 只对显式 --browser 或 --network 运行有效');
    }
    if ((normalized.browser || normalized.network) && !normalized.playwrightRoot) {
        throw new Error('浏览器/网络回归必须传入 --playwright-root 或设置 PLAYWRIGHT_ROOT');
    }
    if ((normalized.browser || normalized.network) && !normalized.browserPath) {
        throw new Error('浏览器/网络回归必须传入 --browser-path 或设置 FLUENTREAD_BROWSER_PATH');
    }
    if ((normalized.browser || normalized.network) && !normalized.focusSafeHelper) {
        throw new Error('后台浏览器/网络回归必须传入 --focus-safe-helper 或设置 FLUENTREAD_FOCUS_SAFE_HELPER');
    }
    return normalized;
}

function step({id, phase, label, command, args, policy = {}, gates = []}) {
    return {id, phase, label, command, args, gates, ...policy};
}

function deterministicSteps() {
    return [
        step({
            id: 'test-suite-audit',
            phase: 'local',
            label: 'test suite audit',
            command: 'node',
            args: ['scripts/testing/audit-test-suite.mjs'],
        }),
        step({
            id: 'wxt-prepare',
            phase: 'local',
            label: 'wxt prepare',
            command: 'pnpm',
            args: ['exec', 'wxt', 'prepare'],
        }),
        step({
            id: 'compile',
            phase: 'local',
            label: 'compile',
            command: 'pnpm',
            args: ['compile'],
        }),
        step({
            id: 'strict-coverage',
            phase: 'local',
            label: 'strict coverage',
            command: 'pnpm',
            args: ['exec', 'vitest', 'run', '--coverage', '--config', 'vitest.coverage.config.ts'],
        }),
        ...TEST_GROUPS.map((group) => step({
            id: `vitest-${group}`,
            phase: 'local',
            label: `grouped Vitest: ${group}`,
            command: 'node',
            args: ['scripts/testing/run-test-group.mjs', group],
        })),
        step({
            id: 'agent-bridge',
            phase: 'local',
            label: 'agent bridge public process protocol',
            command: 'node',
            args: ['--test', 'tests/agentBridge.test.mjs'],
        }),
        step({
            id: 'focus-safe-browser-lifecycle',
            phase: 'local',
            label: 'focus-safe browser ordinary and background context lifecycle',
            command: 'node',
            args: ['--test', '--test-concurrency=1',
                'tests/focusSafeBrowserOrdinaryLifecycle.test.mjs',
                'tests/focusSafeBrowserBackgroundSignal.test.mjs',
                'tests/focusSafeBrowserBackgroundLifecycle.test.mjs'],
        }),
        step({
            id: 'document-live-http-evidence',
            phase: 'local',
            label: 'document HTTP evidence decoder (offline node:test)',
            command: 'node',
            args: ['--test', 'tests/documentLiveHttpEvidence.test.mjs'],
        }),
        step({
            id: 'chrome-build',
            phase: 'local',
            label: 'chrome build',
            command: 'pnpm',
            args: ['build'],
        }),
        step({
            id: 'firefox-build',
            phase: 'local',
            label: 'firefox build',
            command: 'pnpm',
            args: ['build:firefox'],
        }),
        step({
            id: 'firefox-zip',
            phase: 'local',
            label: 'firefox release archives',
            command: 'pnpm',
            args: ['zip:firefox'],
        }),
        step({
            id: 'extension-manifest-verifier',
            phase: 'local',
            label: 'Chrome/Firefox manifest capability verifier',
            command: 'node',
            args: ['scripts/testing/verify-extension-manifests.mjs', '--require-firefox-archives'],
        }),
        step({
            id: 'userscript-build',
            phase: 'local',
            label: 'userscript build',
            command: 'pnpm',
            args: ['build:userscript'],
        }),
        step({
            id: 'userscript-verifier',
            phase: 'local',
            label: 'userscript verifier',
            command: 'node',
            args: ['scripts/verify-userscript-build.mjs'],
        }),
        step({
            id: 'docs-typecheck',
            phase: 'local',
            label: 'docs typecheck',
            command: 'pnpm',
            args: ['docs:typecheck'],
        }),
        step({
            id: 'storybook-typecheck',
            phase: 'local',
            label: 'storybook typecheck',
            command: 'pnpm',
            args: ['storybook:typecheck'],
        }),
        step({
            id: 'docs-build',
            phase: 'local',
            label: 'docs build',
            command: 'pnpm',
            args: ['docs:build'],
        }),
        step({
            id: 'storybook-build',
            phase: 'local',
            label: 'storybook build',
            command: 'pnpm',
            args: ['storybook:build'],
        }),
        step({
            id: 'storybook-verifier',
            phase: 'local',
            label: 'storybook artifact verifier',
            command: 'pnpm',
            args: ['storybook:check'],
        }),
        step({
            id: 'docs-verifier',
            phase: 'local',
            label: 'docs shipped artifact verifier',
            command: 'pnpm',
            args: ['docs:check'],
        }),
    ];
}

function browserFixtureArgs(fixture, options) {
    const args = [
        fixture.script,
        '--playwright-root', options.playwrightRoot,
        '--browser-path', options.browserPath,
        '--artifacts-dir', path.join(options.artifactsDir, fixture.id),
    ];
    if (fixture.artifact) {
        args.push('--artifact', path.resolve(PROJECT_ROOT, fixture.artifact));
    } else {
        args.push('--extension-dir', options.extensionDir);
    }
    if (options.timeout && fixture.supportsTimeout !== false) args.push('--timeout', options.timeout);
    if (fixture.args) args.push(...fixture.args);

    if (options.headed && fixture.supportsHeaded) {
        args.push('--headed');
    } else {
        args.push(...fixture.backgroundArgs);
        args.push('--focus-safe-helper', options.focusSafeHelper);
    }
    return args;
}

function browserPolicy(fixture, options) {
    if (options.headed && fixture.supportsHeaded) {
        return {
            launchMode: 'playwright-headed',
            focusPolicy: 'foreground-authorized',
            windowPlacement: {state: 'normal'},
        };
    }
    return {
        launchMode: 'macos-background-cdp',
        focusPolicy: 'launchservices-no-foreground',
        windowPlacement: {state: 'normal', mode: 'background-visible-no-focus'},
    };
}

function browserSteps(options) {
    return LOCAL_BROWSER_FIXTURES.map((fixture) => step({
        id: fixture.id,
        phase: 'browser',
        label: fixture.label,
        command: 'node',
        args: browserFixtureArgs(fixture, options),
        gates: ['--browser'],
        policy: {
            ...browserPolicy(fixture, options),
            artifactsDir: path.join(options.artifactsDir, fixture.id),
        },
    }));
}

function networkSteps(options) {
    const fixture = NETWORK_MATRIX;
    return [step({
        id: fixture.id,
        phase: 'network',
        label: fixture.label,
        command: 'node',
        args: [
            fixture.script,
            '--extension-dir', options.extensionDir,
            '--playwright-root', options.playwrightRoot,
            '--browser-path', options.browserPath,
            '--artifacts-dir', path.join(options.artifactsDir, fixture.id),
            '--allow-network',
            ...(options.timeout ? ['--timeout', options.timeout] : []),
            ...(options.headed && fixture.supportsHeaded
                ? ['--headed']
                : [...fixture.backgroundArgs, '--focus-safe-helper', options.focusSafeHelper]),
        ],
        gates: ['--network', '--allow-network'],
        policy: {
            ...browserPolicy(fixture, options),
            artifactsDir: path.join(options.artifactsDir, fixture.id),
            networkPolicy: 'explicit-allow-network',
        },
    })];
}

export function buildPlan(options) {
    const steps = deterministicSteps();
    if (options.browser) steps.push(...browserSteps(options));
    if (options.network) steps.push(...networkSteps(options));
    return {
        version: 2,
        mode: [
            'local',
            options.browser ? 'browser' : null,
            options.network ? 'network' : null,
            options.headed ? 'headed' : null,
        ].filter(Boolean).join('+'),
        dryRun: options.dryRun,
        artifactsDir: options.artifactsDir,
        policies: {
            local: 'deterministic',
            browser: options.browser ? 'explicit-browser-gate' : 'disabled',
            network: options.network ? 'explicit-network-and-allow-network-gates' : 'disabled',
            headed: options.headed ? 'foreground-authorized' : 'disabled',
        },
        steps,
    };
}

function run(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        console.log(`\n[regression] ${options.label || command} -> ${command} ${args.join(' ')}`);
        const child = spawn(command, args, {
            cwd: PROJECT_ROOT,
            env: process.env,
            stdio: 'inherit',
            shell: false,
        });
        child.once('error', reject);
        child.once('close', (code, signal) => resolve({code, signal}));
    });
}

async function runStep(currentStep) {
    const result = await run(currentStep.command, currentStep.args, {label: currentStep.label});
    if (result.code !== 0) {
        throw new Error(`${currentStep.label} 失败，退出码 ${result.code ?? `signal:${result.signal}`}`);
    }
}

export async function executePlan(plan) {
    if (plan.dryRun) {
        console.log(JSON.stringify(plan, null, 2));
        return;
    }
    for (const currentStep of plan.steps) {
        await runStep(currentStep);
    }
}

async function main(argv = process.argv.slice(2)) {
    const options = parseCli(argv);
    if (options.help) {
        printUsage();
        return;
    }
    await executePlan(buildPlan(options));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error(`[full-regression] ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    });
}
