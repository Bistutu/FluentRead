import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';

const PROJECT_ROOT = resolve(__dirname, '..');
const RUNNER = resolve(PROJECT_ROOT, 'scripts/testing/run-full-regression.mjs');
const BROWSER_ARGS = [
    '--playwright-root', '/tmp/fluentread-playwright-runtime',
    '--browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '--focus-safe-helper', 'scripts/focus-safe-browser.cjs',
    '--extension-dir', '.output/chrome-mv3',
    '--artifacts-dir', '/tmp/fluentread-regression-artifacts',
];

function runRunner(args: string[]) {
    return spawnSync(process.execPath, [RUNNER, ...args], {
        cwd: PROJECT_ROOT,
        encoding: 'utf8',
        env: {
            ...process.env,
            FLUENTREAD_BROWSER_PATH: '',
            FLUENTREAD_EXTENSION_DIR: '',
            FLUENTREAD_FOCUS_SAFE_HELPER: '',
            FLUENTREAD_REGRESSION_ARTIFACTS_DIR: '',
            PLAYWRIGHT_ROOT: '',
        },
    });
}

function dryRun(args: string[]) {
    const result = runRunner(['--dry-run', ...args]);
    expect(result.status, result.stderr).toBe(0);
    return JSON.parse(result.stdout);
}

describe('full regression runner', () => {
    it('accepts the package-manager argument separator before runner flags', () => {
        const plan = dryRun(['--', '--artifacts-dir', '/tmp/fluentread-pnpm-separator']);

        expect(plan.mode).toBe('local');
        expect(plan.artifactsDir).toBe('/tmp/fluentread-pnpm-separator');
    });

    it('defaults to the deterministic local plan only', () => {
        const plan = dryRun(['--artifacts-dir', '/tmp/fluentread-local-only']);

        expect(plan.mode).toBe('local');
        expect(plan.policies).toMatchObject({
            local: 'deterministic',
            browser: 'disabled',
            network: 'disabled',
            headed: 'disabled',
        });
        expect(plan.steps.map((step: {id: string}) => step.id)).toEqual([
            'test-suite-audit',
            'wxt-prepare',
            'compile',
            'strict-coverage',
            'vitest-architecture',
            'vitest-unit',
            'vitest-functional',
            'vitest-regression',
            'agent-bridge',
            'focus-safe-browser-lifecycle',
            'document-live-http-evidence',
            'chrome-build',
            'firefox-build',
            'firefox-zip',
            'extension-manifest-verifier',
            'userscript-build',
            'userscript-verifier',
            'docs-typecheck',
            'storybook-typecheck',
            'docs-build',
            'storybook-build',
            'storybook-verifier',
            'docs-verifier',
        ]);
        const firefoxZip = plan.steps.find((step: {id: string}) => step.id === 'firefox-zip');
        expect(plan.steps.find((step: {id: string}) => step.id === 'agent-bridge')).toMatchObject({
            command: 'node', args: ['--test', 'tests/agentBridge.test.mjs'],
        });
        expect(plan.steps.find((step: {id: string}) => step.id === 'focus-safe-browser-lifecycle')).toMatchObject({
            phase: 'local', command: 'node', args: ['--test', '--test-concurrency=1',
                'tests/focusSafeBrowserOrdinaryLifecycle.test.mjs',
                'tests/focusSafeBrowserBackgroundSignal.test.mjs',
                'tests/focusSafeBrowserBackgroundLifecycle.test.mjs'],
        });
        expect(plan.steps.filter((step: {id: string}) => step.id === 'document-live-http-evidence')).toEqual([
            expect.objectContaining({phase: 'local', command: 'node', args: ['--test', 'tests/documentLiveHttpEvidence.test.mjs']}),
        ]);
        const manifestVerifier = plan.steps.find(
            (step: {id: string}) => step.id === 'extension-manifest-verifier',
        );
        expect(firefoxZip).toMatchObject({command: 'pnpm', args: ['zip:firefox']});
        expect(manifestVerifier).toMatchObject({
            command: 'node',
            args: ['scripts/testing/verify-extension-manifests.mjs', '--require-firefox-archives'],
        });
        expect(plan.steps.some((step: {phase: string}) => step.phase === 'browser' || step.phase === 'network')).toBe(false);
    });

    it('requires explicit network and allow-network gates together', () => {
        const missingAllow = runRunner(['--dry-run', '--network', ...BROWSER_ARGS]);
        expect(missingAllow.status).not.toBe(0);
        expect(missingAllow.stderr).toContain('--network 和 --allow-network');

        const strayAllow = runRunner(['--dry-run', '--allow-network']);
        expect(strayAllow.status).not.toBe(0);
        expect(strayAllow.stderr).toContain('--allow-network 只能和 --network 同时使用');
    });

    it('passes focus-safe background and isolated artifacts to local browser fixtures', () => {
        const plan = dryRun(['--browser', ...BROWSER_ARGS]);
        const browserSteps = plan.steps.filter((step: {phase: string}) => step.phase === 'browser');

        expect(browserSteps).toHaveLength(14);
        expect(browserSteps.map((step: {id: string}) => step.id)).toEqual([
            'popup-first-run-height',
            'selection-trigger',
            'full-page-translation',
            'translation-mutation',
            'fixed-height-translation',
            'github-spacing',
            'github-nested-list',
            'github-task-list',
            'video-subtitle-fixture',
            'document-translation',
            'settings-center-ui',
            'glossary',
            'privacy-boundary',
            'userscript-smoke',
        ]);
        for (const step of browserSteps) {
            expect(step.gates).toEqual(['--browser']);
            expect(step.args).toContain('--focus-safe-helper');
            expect(step.args).toContain(resolve(PROJECT_ROOT, 'scripts/focus-safe-browser.cjs'));
            expect(step.args).toContain('--background');
            expect(step.args).toContain('--artifacts-dir');
            expect(step.artifactsDir).toBe(`/tmp/fluentread-regression-artifacts/${step.id}`);
            expect(step.focusPolicy).toBe('launchservices-no-foreground');
            expect(step.windowPlacement.state).toBe('normal');
            expect(step.launchMode).toBe('macos-background-cdp');
            expect(step.windowPlacement.mode).toBe('background-visible-no-focus');
        }

        const userscriptSmoke = browserSteps.find((step: {id: string}) => step.id === 'userscript-smoke');
        const fullPageTranslation = browserSteps.find((step: {id: string}) => step.id === 'full-page-translation');
        expect(fullPageTranslation).toBeDefined();
        expect(fullPageTranslation!.args).toContain('--verify-floating-ui');
        expect(fullPageTranslation!.args).toContain('--verify-loading-style-isolation');
        expect(userscriptSmoke).toBeDefined();
        expect(userscriptSmoke!.args).toContain('--artifact');
        expect(userscriptSmoke!.args).toContain(resolve(PROJECT_ROOT, '.output/userscript/fluent-read.user.js'));
        expect(userscriptSmoke!.args).not.toContain('--extension-dir');
        const stepIds = plan.steps.map((step: {id: string}) => step.id);
        expect(stepIds.indexOf('userscript-build')).toBeLessThan(stepIds.indexOf('userscript-smoke'));
        expect(stepIds.indexOf('userscript-verifier')).toBeLessThan(stepIds.indexOf('userscript-smoke'));

        expect(plan.steps.some((step: {phase: string}) => step.phase === 'network')).toBe(false);
    });

    it('keeps glossary background-only with supported arguments and its own artifact directory', () => {
        const plan = dryRun(['--browser', '--headed', '--timeout', '45000', ...BROWSER_ARGS]);
        const glossary = plan.steps.find((step: {id: string}) => step.id === 'glossary');

        expect(glossary).toMatchObject({
            phase: 'browser',
            command: 'node',
            gates: ['--browser'],
            artifactsDir: '/tmp/fluentread-regression-artifacts/glossary',
            launchMode: 'macos-background-cdp',
            focusPolicy: 'launchservices-no-foreground',
            windowPlacement: {state: 'normal', mode: 'background-visible-no-focus'},
            args: [
                'scripts/run-glossary-test.cjs',
                '--playwright-root', '/tmp/fluentread-playwright-runtime',
                '--browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
                '--artifacts-dir', '/tmp/fluentread-regression-artifacts/glossary',
                '--extension-dir', resolve(PROJECT_ROOT, '.output/chrome-mv3'),
                '--background',
                '--focus-safe-helper', resolve(PROJECT_ROOT, 'scripts/focus-safe-browser.cjs'),
            ],
        });
        expect(glossary.args).not.toContain('--timeout');
        expect(glossary.args).not.toContain('--headed');
        const fullPage = plan.steps.find((step: {id: string}) => step.id === 'full-page-translation');
        expect(fullPage.args).toContain('--timeout');
        expect(fullPage.args).toContain('45000');
        expect(plan.steps.findIndex((step: {id: string}) => step.id === 'chrome-build'))
            .toBeLessThan(plan.steps.findIndex((step: {id: string}) => step.id === 'glossary'));
    });

    it('runs the site matrix only behind network plus allow-network gates', () => {
        const plan = dryRun(['--network', '--allow-network', ...BROWSER_ARGS]);
        const networkSteps = plan.steps.filter((step: {phase: string}) => step.phase === 'network');

        expect(plan.policies.network).toBe('explicit-network-and-allow-network-gates');
        expect(networkSteps).toHaveLength(1);
        expect(networkSteps[0].id).toBe('site-translation-matrix');
        expect(networkSteps[0].gates).toEqual(['--network', '--allow-network']);
        expect(networkSteps[0].args).toContain('--allow-network');
        expect(networkSteps[0].args).toContain('--focus-safe-helper');
        expect(networkSteps[0].args).toContain('--background');
        expect(networkSteps[0].networkPolicy).toBe('explicit-allow-network');
        expect(plan.steps.some((step: {phase: string}) => step.phase === 'browser')).toBe(false);
    });

    it('marks headed mode as foreground-authorized only when explicitly requested', () => {
        const plan = dryRun(['--browser', '--headed', ...BROWSER_ARGS]);
        const browserSteps = plan.steps.filter((step: {phase: string}) => step.phase === 'browser');
        const headedSteps = browserSteps.filter((step: {args: string[]}) => step.args.includes('--headed'));
        const backgroundSteps = browserSteps.filter((step: {args: string[]}) => !step.args.includes('--headed'));

        expect(plan.policies.headed).toBe('foreground-authorized');
        expect(headedSteps.map((step: {id: string}) => step.id)).toEqual([
            'selection-trigger',
            'full-page-translation',
            'privacy-boundary',
            'userscript-smoke',
        ]);
        expect(headedSteps.every((step: {focusPolicy: string}) => step.focusPolicy === 'foreground-authorized')).toBe(true);
        expect(backgroundSteps.map((step: {id: string}) => step.id)).toEqual([
            'popup-first-run-height',
            'translation-mutation',
            'fixed-height-translation',
            'github-spacing',
            'github-nested-list',
            'github-task-list',
            'video-subtitle-fixture',
            'document-translation',
            'settings-center-ui',
            'glossary',
        ]);
        expect(backgroundSteps.every((step: {args: string[]}) => step.args.includes('--focus-safe-helper'))).toBe(true);
    });
});
