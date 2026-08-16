#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {connect} from '../node_modules/.pnpm/web-ext-run@0.2.4/node_modules/web-ext-run/lib/firefox/remote.js';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
    const key = process.argv[index];
    if (!key.startsWith('--')) continue;
    args.set(key.slice(2), process.argv[index + 1] || '');
    index += 1;
}

const port = Number(args.get('port') || 50593);
const artifactsDir = path.resolve(args.get('artifacts-dir') || '/private/tmp/fluentread-firefox-persistence-20260816');
fs.mkdirSync(artifactsDir, {recursive: true});

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function packetFromError(error) {
    const message = String(error?.message || error);
    const start = message.indexOf('{');
    if (start < 0) return null;
    try {
        return JSON.parse(message.slice(start));
    } catch {
        return null;
    }
}

async function selectedTab(client) {
    const response = await client.request('listTabs');
    return response.tabs.find(tab => tab.selected) || response.tabs[0];
}

async function selectedFrame(client) {
    const tab = await selectedTab(client);
    const target = await client.request({to: tab.actor, type: 'getTarget'});
    return {tab, frame: target.frame};
}

async function evaluate(client, frame, source) {
    let resultPacket;
    const onError = error => {
        const packet = packetFromError(error);
        if (packet?.type === 'evaluationResult') resultPacket = packet;
    };
    client.on('error', onError);
    try {
        const response = await client.request({
            to: frame.consoleActor,
            type: 'evaluateJSAsync',
            text: source,
            frameActor: frame.actor,
        });
        const deadline = Date.now() + 10000;
        while (!resultPacket && Date.now() < deadline) await sleep(25);
        if (!resultPacket) throw new Error(`Firefox RDP evaluation timeout: ${response.resultID}`);
        if (resultPacket.hasException) throw new Error(`Firefox RDP evaluation failed: ${JSON.stringify(resultPacket)}`);
        return resultPacket.result;
    } finally {
        client.off('error', onError);
    }
}

async function evaluateJson(client, frame, source) {
    const value = await evaluate(client, frame, `JSON.stringify(${source})`);
    const serialized = value && typeof value === 'object' && 'value' in value ? value.value : value;
    if (typeof serialized !== 'string') return serialized;
    return JSON.parse(serialized);
}

async function evaluateAsyncJson(client, frame, source) {
    const marker = '__fluentReadRdpAsyncResult';
    await evaluate(client, frame, `(() => {
        globalThis.${marker} = {pending: true};
        Promise.resolve().then(() => (${source})).then(
            value => { globalThis.${marker} = {pending: false, value}; },
            error => { globalThis.${marker} = {pending: false, error: String(error)}; },
        );
        return true;
    })()`);
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        const current = await selectedFrame(client);
        const state = await evaluateJson(client, current.frame, `globalThis.${marker}`);
        if (!state?.pending) {
            if (state?.error) throw new Error(`Firefox async evaluation failed: ${state.error}`);
            return state?.value;
        }
        await sleep(50);
    }
    throw new Error('Firefox async evaluation timeout');
}

async function navigate(client, url) {
    const current = await selectedFrame(client);
    await client.request({to: current.frame.actor, type: 'navigateTo', url});
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        try {
            const next = await selectedFrame(client);
            if (next.frame.url === url) return next;
        } catch {
            // The browsing context is replaced during navigation.
        }
        await sleep(100);
    }
    throw new Error(`Firefox RDP navigation timeout: ${url}`);
}

async function waitForDom(client, predicate, label) {
    const deadline = Date.now() + 15000;
    let lastError;
    while (Date.now() < deadline) {
        try {
            const current = await selectedFrame(client);
            const value = await evaluateJson(client, current.frame, predicate);
            if (value) return {current, value};
        } catch (error) {
            lastError = error;
        }
        await sleep(100);
    }
    throw new Error(`Firefox RDP DOM wait timeout: ${label}; ${lastError?.message || ''}`);
}

async function main() {
    console.error(`[firefox-test] connecting to ${port}`);
    const firefox = await connect(port);
    const client = firefox.client;
    const result = {
        ok: false,
        browser: 'Firefox',
        port,
        artifactsDir,
        browserBootstrap: {
            firstRunDetected: false,
            firstRunBlocked: false,
            remainingDialogs: [],
        },
        persistenceCases: {
            before: 'zh-Hans',
            after: null,
            quickClose: false,
            crossPageSync: false,
            latestWriteWins: false,
        },
        errors: [],
        evidence: [],
    };

    try {
        const initial = await selectedFrame(client);
        console.error(`[firefox-test] initial ${initial.frame.url}`);
        result.browserBootstrap.initialTab = {
            url: initial.frame.url,
            title: initial.frame.title,
        };
        if (initial.frame.url.includes('about:welcome') || initial.frame.url.includes('spotlight')) {
            result.browserBootstrap.firstRunDetected = true;
            result.browserBootstrap.firstRunBlocked = true;
            throw new Error('Firefox runner remained on a first-run page; no UI click was attempted');
        }

        const addons = await client.request('listAddons');
        const addon = addons.addons.find(item => item.temporarilyInstalled && item.name === '流畅阅读');
        if (!addon) throw new Error('Firefox runner did not install the temporary FluentRead add-on');
        const extensionBase = addon.manifestURL.replace(/\/manifest\.json$/, '');
        const popupUrl = `${extensionBase}/popup.html`;
        const optionsUrl = `${extensionBase}/options.html`;
        result.extensionId = addon.id;
        console.error(`[firefox-test] addon ${addon.id}`);

        console.error(`[firefox-test] navigate popup ${popupUrl}`);
        let current = await navigate(client, popupUrl);
        console.error(`[firefox-test] popup navigation complete ${current.frame.url}`);
        const popup = await waitForDom(client, `document.querySelector('.popup-shell')`, 'popup mount');
        result.popup = await evaluateJson(client, popup.current.frame, `({
            title: document.title,
            url: location.href,
            shell: Boolean(document.querySelector('.popup-shell')),
            target: document.querySelectorAll('.language-pair select')[1]?.value || null,
            text: document.body?.innerText?.slice(0, 1200) || ''
        })`);
        result.evidence.push({step: 'popup-loaded', url: popup.current.frame.url, ...result.popup});

        console.error(`[firefox-test] navigate options ${optionsUrl}`);
        current = await navigate(client, optionsUrl);
        console.error(`[firefox-test] options navigation complete ${current.frame.url}`);
        const options = await waitForDom(client, `document.querySelector('.settings-app')`, 'options mount');
        result.options = await evaluateJson(client, options.current.frame, `({
            title: document.title,
            url: location.href,
            app: Boolean(document.querySelector('.settings-app')),
            target: document.querySelector('[aria-label="默认目标语言"]')?.parentElement?.parentElement?.querySelector('.el-select__selected-item:not(.el-select__input-wrapper)')?.textContent?.trim() || null
        })`);
        // Allow configReady/hydration and the first storage echo to settle before editing.
        await sleep(500);

        const selectLanguage = async (label) => {
            const before = await selectedFrame(client);
            await evaluate(client, before.frame, `(() => {
                const input = document.querySelector('[aria-label="默认目标语言"]');
                if (!(input instanceof HTMLElement)) throw new Error('target language combobox not found');
                input.click();
                return true;
            })()`);
            await waitForDom(client, `document.querySelector('[aria-label="默认目标语言"]')?.getAttribute('aria-expanded') === 'true'`, `open target language ${label}`);
            const open = await selectedFrame(client);
            const clicked = await evaluateJson(client, open.frame, `(() => {
                const options = [...document.querySelectorAll('[role="option"]')];
                const option = options.find(item => item.textContent?.trim() === ${JSON.stringify(label)});
                if (!(option instanceof HTMLElement)) return false;
                option.click();
                return true;
            })()`);
            if (!clicked) throw new Error(`target language option not found: ${label}`);
            await waitForDom(client, `document.querySelector('[aria-label="默认目标语言"]')?.parentElement?.parentElement?.querySelector('.el-select__selected-item:not(.el-select__input-wrapper)')?.textContent?.trim() === ${JSON.stringify(label)}`, `selected target language ${label}`);
        };

        await selectLanguage('英语');
        await selectLanguage('日语');
        const beforeClose = await selectedFrame(client);
        result.persistenceCases.optionsLabel = await evaluateJson(client, beforeClose.frame, `document.querySelector('[aria-label="默认目标语言"]')?.parentElement?.parentElement?.querySelector('.el-select__selected-item:not(.el-select__input-wrapper)')?.textContent?.trim() || null`);
        const storageDeadline = Date.now() + 5000;
        do {
            result.persistenceCases.storageBeforeClose = await evaluateAsyncJson(client, beforeClose.frame, `browser.storage.local.get(null).then(all => { const value = all.config || all['local:config']; return {keys: Object.keys(all), to: value?.to, revision: value?.__fluentConfigRevision}; })`);
            if (result.persistenceCases.storageBeforeClose.to === 'ja') break;
            await sleep(100);
        } while (Date.now() < storageDeadline);

        // Trigger the real short-lifecycle path without touching the visible browser:
        // navigating the same extension tab away fires pagehide/unmount, then opens the
        // popup again in that same browsing context.
        console.error('[firefox-test] quick close via extension navigation');
        await navigate(client, popupUrl);
        result.persistenceCases.quickClose = true;
        const reopened = await waitForDom(client, `document.querySelector('.popup-shell')`, 'popup reopen');
        result.persistenceCases.after = await evaluateJson(client, reopened.current.frame, `document.querySelectorAll('.language-pair select')[1]?.value || null`);
        result.persistenceCases.storageAfterClose = await evaluateAsyncJson(client, reopened.current.frame, `browser.storage.local.get(null).then(all => { const value = all.config || all['local:config']; return {keys: Object.keys(all), to: value?.to, revision: value?.__fluentConfigRevision}; })`);
        result.persistenceCases.crossPageSync = result.persistenceCases.after === 'ja';
        result.persistenceCases.latestWriteWins = result.persistenceCases.crossPageSync;
        result.evidence.push({step: 'popup-reopen', url: reopened.current.frame.url, target: result.persistenceCases.after, storage: result.persistenceCases.storageAfterClose});
        if (!result.persistenceCases.crossPageSync) throw new Error(`Firefox config did not persist across close/reopen: ${JSON.stringify(result.persistenceCases)}`);

        result.ok = true;
    } catch (error) {
        result.errors.push(String(error?.stack || error?.message || error));
        throw error;
    } finally {
        fs.writeFileSync(path.join(artifactsDir, 'firefox-config-persistence.json'), `${JSON.stringify(result, null, 2)}\n`);
        firefox.disconnect();
    }

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch(error => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
});
