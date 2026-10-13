#!/usr/bin/env node
'use strict';

/**
 * @file scripts/testing/run-popup-key-information-test.cjs
 * 文件职责：对生产 Popup 的默认服务、配置模型及首屏操作生成限定范围的真实浏览器证据。
 * 主要内容：覆盖中英文、亮暗主题与三种皮肤，长自定义名称、非模型/本地服务、多功能分配、静态提醒，以及原有抽屉和模块顺序。
 * 模块边界：只启动自己拥有的临时后台浏览器，不执行翻译、连接检查或模型下载；普通扩展标签页几何不代表原生工具栏、Firefox 或线上供应商。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {guardBrowserClose, getGuardedBrowserPid} = require('./owned-browser-close.cjs');
const execFileAsync = promisify(execFile);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function argumentsFor(argv) {
    const arg = (name, fallback) => {const index = argv.indexOf(`--${name}`);return index < 0 ? fallback : argv[index + 1];};
    const phase = arg('phase', 'optimized');
    assert(['baseline', 'optimized'].includes(phase), '--phase must be baseline or optimized');
    const runtime = arg('playwright-root', process.env.PLAYWRIGHT_ROOT);
    assert(runtime, 'Pass --playwright-root or set PLAYWRIGHT_ROOT');
    const args = {phase, playwrightRoot:path.resolve(runtime), extensionDir:path.resolve(arg('extension-dir', '.output/chrome-mv3')),
        artifactsDir:path.resolve(arg('artifacts-dir', path.join(os.tmpdir(), `fluentread-popup-key-information-${phase}`))),
        focusSafeHelper:path.resolve(arg('focus-safe-helper', path.join(__dirname, 'focus-safe-browser.cjs'))),
        browserPath:arg('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'), displayTarget:arg('display', 'secondary')};
    assert(!args.extensionDir.endsWith('-dev'), 'Use a production extension directory');
    assert(fs.existsSync(path.join(args.extensionDir, 'manifest.json')), 'Extension manifest is missing');
    return args;
}

async function until(predicate, label, timeout = 15000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {if (await predicate()) return;await pause(60);}
    throw new Error(`${label}: timeout`);
}

async function layout(page) {
    return page.evaluate(() => {
        const rect = element => {
            if (!element) return null;const r = element.getBoundingClientRect();
            return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};
        };
        const shell = document.querySelector('.popup-shell'), summary = document.querySelector('[data-testid="popup-feature-services"]');
        const name = summary.querySelector('.provider-summary-heading > strong'), model = summary.querySelector('.provider-summary-model');
        const primary = document.querySelector('[data-testid="page-translation"]'), reminder = document.querySelector('.credential-warning');
        const shellRect = rect(shell), primaryRect = rect(primary);
        const visible = r => Boolean(r && r.width > 0 && r.height > 0 && r.left >= Math.max(0,shellRect.left)-1 &&
            r.right <= Math.min(innerWidth,shellRect.right)+1 && r.top >= Math.max(0,shellRect.top)-1 && r.bottom <= Math.min(innerHeight,shellRect.bottom)+1);
        const nameLines = [];
        if (name) {const range = document.createRange();range.selectNodeContents(name);for (const r of range.getClientRects()) nameLines.push({left:r.left,right:r.right,top:r.top,bottom:r.bottom});}
        const reminderStyle = reminder && getComputedStyle(reminder);
        return {width:shellRect.width,height:shellRect.height,viewport:{width:innerWidth,height:innerHeight},
            scrollHeight:shell.scrollHeight,clientHeight:shell.clientHeight,scrollTop:shell.scrollTop,
            horizontalOverflow:document.documentElement.scrollWidth > innerWidth+1 || shell.scrollWidth > shell.clientWidth+1,
            summary:rect(summary),summaryLabel:summary.getAttribute('aria-label'),summaryTitle:summary.title,
            name:name?.textContent || '',nameRect:rect(name),nameLines,model:model?.textContent || '',modelRect:rect(model),modelTitle:model?.title || '',
            modelLineHeight:model ? parseFloat(getComputedStyle(model).lineHeight) : 0,
            defaultIcons:summary.querySelectorAll('.provider-avatar:not(.provider-overflow)').length,
            additionalServices:summary.querySelector('.provider-overflow')?.textContent || '',
            primary:primaryRect,primaryCount:document.querySelectorAll('[data-testid="page-translation"]').length,primaryVisible:visible(primaryRect),
            reminder:reminder ? {rect:rect(reminder),text:reminder.textContent,role:reminder.getAttribute('role'),animationName:reminderStyle.animationName,
                animationDuration:reminderStyle.animationDuration,boxShadow:reminderStyle.boxShadow,settingsButtons:reminder.querySelectorAll('button').length} : null,
            modules:[...document.querySelectorAll('[data-popup-module]')].map(element => element.dataset.popupModule),
            siteNested:Boolean(document.querySelector('[data-popup-module="siteRule"]')?.closest('.hero-card')),
            dark:document.documentElement.classList.contains('dark'),skin:shell.dataset.interfaceSkin};
    });
}

async function main(args) {
    fs.mkdirSync(args.artifactsDir, {recursive:true});
    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-popup-key-information-'));
    const {chromium} = require(path.join(args.playwrightRoot, 'playwright'));
    const helper = require(args.focusSafeHelper);
    const manifest = JSON.parse(fs.readFileSync(path.join(args.extensionDir, 'manifest.json'), 'utf8'));
    assert(manifest.action?.default_popup && manifest.background?.service_worker, 'Expected production MV3 popup and worker');
    const report = {ok:false,phase:args.phase,artifact:'production',extensionDir:args.extensionDir,reportPath:path.join(args.artifactsDir,'report.json'),cases:[],layouts:[],screenshots:[],consoleErrors:[],httpAttempts:[],focusSamples:[],
        evidenceBoundary:'Production Chromium extension in owned background tabs at intrinsic Popup width and a maximum 560px viewport. Controlled configuration, no translation/connection/download actions. This does not prove native-toolbar geometry, live providers, model readiness, FPS, Firefox runtime or page actions. HTTP accounting begins after initial fixture hydration; startup HTTP attempts are recorded separately.',startupHttpAttempts:[]};
    let session, context, control, origin, worker, browserPid, measured = false, launchAttempted = false;
    const customId = 'custom:popup-summary';
    const longName = 'Private endpoint with a deliberately long descriptive name';
    const longModel = 'organization/very-long-configured-model-name-with-variant-and-version';
    const tokens = {openai:'synthetic-popup-fixture',[customId]:'synthetic-popup-fixture',deepseek:'synthetic-popup-fixture'};
    const observe = page => {
        page.on('pageerror', error => report.consoleErrors.push({url:page.url(),message:error.message}));
        page.on('console', message => {if (message.type() === 'error') report.consoleErrors.push({url:page.url(),message:message.text()});});
    };
    async function focusSample(label) {
        const {stdout} = await execFileAsync('/usr/bin/osascript', ['-l','JavaScript','-e',
            "ObjC.import('AppKit'); const a=$.NSWorkspace.sharedWorkspace.frontmostApplication; JSON.stringify({pid:Number(a.processIdentifier),name:ObjC.unwrap(a.localizedName)});"], {timeout:5000});
        const actual = JSON.parse(stdout.trim());report.focusSamples.push({label,...actual});
        assert.notEqual(actual.pid, browserPid, `${label}: owned test browser took foreground focus`);
    }
    async function read() {
        const result = await control.evaluate(() => chrome.runtime.sendMessage({type:'configStorageRead',key:'local:config'}));
        assert(result?.success && result.value, 'Read authoritative public configuration');return result.value;
    }
    async function seed(values, credentials = false, label = 'fixture') {
        const current = await read();
        const result = await control.evaluate(({values,current,credentials}) => chrome.runtime.sendMessage({type:'persistConfig',
            mode:credentials ? 'replace' : 'patch',config:credentials ? {...current,...values} : values,
            expected:Object.fromEntries(Object.keys(values).map(key => [key,current[key]])),
            baseRevision:credentials ? current.__fluentConfigRevision || 0 : undefined,clientId:`popup-key-${crypto.randomUUID()}`,sequence:1}), {values,current,credentials});
        assert.equal(result?.success, true, result?.error || 'Save controlled fixture configuration');
        const checked = Object.keys(values).filter(key => !['token','apiKeys'].includes(key));
        let saved;
        try {
            await until(async () => {saved = await read();return checked.every(key => JSON.stringify(saved[key]) === JSON.stringify(values[key]));}, `${label}: fixture hydration`);
        } catch (error) {
            // 仅记录有限的公开夹具信息；不输出完整配置、凭据、headers 或请求体。
            const limited = value => typeof value === 'string' ? value.slice(0,160) : null;
            const provider = list => (list || []).slice(0,4).map(item => ({id:limited(item.id),name:limited(item.name),models:(item.models || []).slice(0,8).map(limited)}));
            const modelMismatch = key => Object.entries(values[key] || {}).filter(([id,value]) => saved?.[key]?.[id] !== value).slice(0,8)
                .map(([id,value]) => ({id:limited(id),expected:limited(value),actual:limited(saved?.[key]?.[id])}));
            const mismatchFields = checked.filter(key => JSON.stringify(saved?.[key]) !== JSON.stringify(values[key]));
            (report.seedFailures ||= []).push({label,mismatchFields,service:{expected:limited(values.service ?? current.service),actual:limited(saved?.service)},
                requestedProviders:provider(values.customOpenAIProviders),savedProviders:provider(saved?.customOpenAIProviders),
                modelMismatch:modelMismatch('model'),documentModelMismatch:modelMismatch('documentModel')});
            throw new Error(`${error.message}; mismatched public fields: ${mismatchFields.join(', ')}`, {cause:error});
        }
    }
    async function closePage(page) {
        const tab = await page.evaluate(async () => (await chrome.tabs.getCurrent()).id);
        await control.evaluate(async id => {const anchor = await chrome.tabs.getCurrent();await chrome.tabs.update(anchor.id,{active:true});await chrome.tabs.remove(id);},tab);
    }
    async function openPopup() {
        const page = await helper.newPageWithoutForeground(context,30000);observe(page);
        await page.setViewportSize({width:400,height:560});
        await page.goto(`${origin}/${manifest.action.default_popup}`, {waitUntil:'domcontentloaded'});
        await helper.activateExtensionTabWithoutForeground(context,page);
        await page.locator('.popup-shell[data-config-ready="true"]').waitFor();
        await page.evaluate(() => document.fonts.ready);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        // Match the toolbar's content-sized viewport, without scrolling to a target or enlarging past its normal cap.
        const r = await page.locator('.popup-shell').evaluate(element => {const r=element.getBoundingClientRect();return {width:Math.ceil(r.width),height:Math.ceil(r.height)};});
        await page.setViewportSize({width:r.width,height:Math.min(560,r.height)});
        return page;
    }
    async function capture(name, values, expectation, credentials = false) {
        await seed(values,credentials,name);const configured = await read(), page = await openPopup();
        try {
            const metrics = await layout(page);report.layouts.push({caseName:name,...metrics});
            assert(metrics.width <= 400 && metrics.height <= 560 && !metrics.horizontalOverflow, `${name}: Popup overflows horizontally`);
            assert.equal(metrics.scrollTop,0, `${name}: fresh Popup must start at its real initial position`);
            assert.equal(metrics.primaryCount,1, `${name}: one page translation action`);
            assert(metrics.primaryVisible, `${name}: primary translation must be completely visible initially`);
            assert.equal(metrics.dark,values.theme === 'dark',`${name}: actual theme`);
            if (args.phase === 'optimized') {
                assert.equal(metrics.name,expectation.name,`${name}: default service is readable on the home screen`);
                assert.equal(metrics.model,expectation.model,`${name}: only applicable configured model is shown`);
                assert(metrics.nameRect?.height > 0 && metrics.nameLines.length, `${name}: service name has rendered text`);
                assert(metrics.nameLines.every(r => r.left >= metrics.nameRect.left-1 && r.right <= metrics.nameRect.right+1 && r.bottom <= metrics.nameRect.bottom+1), `${name}: service name is not clipped`);
                assert.equal(metrics.defaultIcons,1,`${name}: icons leave room for key text`);
                if (expectation.model) {
                    assert(metrics.modelRect?.height > 0,`${name}: model has visible height`);
                    assert(metrics.modelRect.height <= metrics.modelLineHeight*2+1,`${name}: long model uses at most two lines`);
                    assert(metrics.modelTitle.endsWith(expectation.model) && metrics.summaryLabel.includes(expectation.model),`${name}: complete configured model is available`);
                }
                if (expectation.contentOwnership) {
                    assert.equal(metrics.modelTitle,'Configured model: 文',`${name}: title preserves the exact saved model`);
                    assert(metrics.summaryLabel.includes(' · 文 · Configured model: 文') && metrics.summaryTitle.includes(' · 文 · Configured model: 文'),`${name}: accessible summary preserves user-owned content`);
                }
                if (expectation.extra) assert.equal(metrics.additionalServices,expectation.extra,`${name}: unique extra-service count`);
                if (expectation.reminder) {
                    assert(metrics.reminder?.role === 'alert' && metrics.reminder.settingsButtons === 1,`${name}: reminder keeps alert and settings action`);
                    assert.equal(metrics.reminder.animationName,'none',`${name}: reminder has no decorative animation`);
                }
            }
            assert.deepEqual(await read(),configured,`${name}: home inspection must preserve authoritative public configuration`);
            await focusSample(`before ${name}`);
            const file = path.join(args.artifactsDir,`${args.phase}-${name}.png`);await page.screenshot({path:file});report.screenshots.push(file);
            await focusSample(`after ${name}`);report.cases.push({name,pass:true});
            return page;
        } catch (error) {await closePage(page);throw error;}
    }
    try {
        launchAttempted = true;
        session = await helper.launchFocusSafePersistentContext({chromium,profileDir,browserPath:args.browserPath,headless:false,background:true,displayTarget:args.displayTarget,
            viewport:{width:1440,height:960},timeout:30000,browserArgs:[`--disable-extensions-except=${args.extensionDir}`,`--load-extension=${args.extensionDir}`,'--no-first-run','--no-default-browser-check']});
        guardBrowserClose(session,profileDir);context=session.context;browserPid=await getGuardedBrowserPid(session);
        Object.assign(report,{launchMode:session.launchMode,focusPolicy:session.focusPolicy,windowPlacement:session.windowPlacement});
        assert.equal(session.launchMode,'macos-background-cdp');assert.equal(session.focusPolicy,'launchservices-no-foreground');
        assert.equal(session.windowPlacement?.mode,'background-visible-no-focus');assert.equal(session.windowPlacement?.browserFrontmost,false);
        context.on('request',request => {if (/^https?:/u.test(request.url())) {
            const url = new URL(request.url()), item = {origin:url.origin,path:url.pathname,method:request.method()};
            (measured ? report.httpAttempts : report.startupHttpAttempts).push(item);
        }});
        await context.route(/^https?:/u,route => route.abort());
        await until(async () => {
            for (const candidate of context.serviceWorkers()) {
                if (!candidate.url().endsWith(`/${manifest.background.service_worker}`)) continue;
                const loaded = await candidate.evaluate(() => {const m=chrome.runtime.getManifest();return {name:m.name,version:m.version,popup:m.action?.default_popup};}).catch(() => null);
                if (loaded?.name === manifest.name && loaded.version === manifest.version && loaded.popup === manifest.action.default_popup) {worker=candidate;report.loadedManifest=loaded;return true;}
            }return false;
        },'exact production worker',30000);
        worker.on('console',message => {if(message.type() === 'error') report.consoleErrors.push({url:worker.url(),message:message.text()});});
        await worker.evaluate(() => {
            globalThis.__popupKeyHttpAttempts = [];
            const original = fetch;
            globalThis.fetch = (input,init) => {
                const value = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
                if (/^https?:/u.test(value)) {const url=new URL(value);globalThis.__popupKeyHttpAttempts.push({origin:url.origin,path:url.pathname,method:init?.method || 'GET'});return Promise.reject(new Error('Popup UI proof blocks remote requests'));}
                return original(input,init);
            };
        });
        origin=`chrome-extension://${new URL(worker.url()).host}`;
        control = await helper.newPageWithoutForeground(context,30000);observe(control);
        await control.goto(`${origin}/icon/128.png`,{waitUntil:'domcontentloaded'});
        const initial = await read();
        const models = {...initial.model,openai:'gpt-4.1-mini',google:'stale-ai-model',localTranslation:'fluentread/opus-zh-en',[customId]:longModel};
        const base = {on:true,uiLanguageSetupCompleted:true,interfaceFont:'system',theme:'light',interfaceSkin:'default',uiLanguage:'zh-CN',
            service:'openai',model:models,from:'auto',to:'zh-Hans',enableAIContext:false,autoTranslate:false,alwaysTranslateDomains:[],disabledExtensionDomains:[],
            customOpenAIProviders:[{id:customId,name:longName,endpoint:'https://example.test/v1/chat/completions',models:[longModel]}],
            customBody:{...initial.customBody,[customId]:'{"model":"request-body-override"}'},
            popupModuleOrder:['translation','siteRule','quickFeatures','footer'],quickTranslationProfiles:[],
            interfaceVisibility:{...initial.interfaceVisibility,popupQuickFeatures:true,popupSiteRule:true,popupFooter:true},
            ...Object.fromEntries(['hoverTranslationService','selectionTranslationService','documentService','inputBoxTranslationService','videoService','imageTranslationService','areaTranslationService'].map(key => [key,''])),
            harness:{...initial.harness,service:''},writing:{...initial.writing,service:''},token:tokens,
            apiKeys:Object.fromEntries(Object.entries(tokens).map(([key,value]) => [key,[value]]))};
        await seed(base,true);measured=true;
        for (const language of ['zh-CN','en-US']) for (const theme of ['light','dark']) for (const skin of ['default','minimal','compact']) {
            const page = await capture(`${language}-${theme}-${skin}`,{uiLanguage:language,theme,interfaceSkin:skin,service:'openai'}, {name:'OpenAI',model:'gpt-4.1-mini'});
            // The same summary button still opens the existing real services drawer; inspection changes no public configuration.
            if (skin === 'default') {
                const before=await read();await page.locator('[data-testid="popup-feature-services"]').click();
                await page.locator('.popup-service-overview').waitFor();
                assert.equal(await page.locator('[data-testid="popup-feature-services"]').getAttribute('aria-expanded'),'true');
                assert((await page.locator('[data-feature-service="default"]').getAttribute('aria-label')).includes('gpt-4.1-mini'));
                await page.locator('.service-panel-close').click();await page.locator('.popup-service-overview').waitFor({state:'hidden'});
                assert.equal(await page.locator('[data-testid="popup-feature-services"]').getAttribute('aria-expanded'),'false');
                assert.deepEqual(await read(),before,'drawer inspection must preserve public configuration');
                report.cases.push({name:`${language}-${theme}-drawer`,pass:true});await focusSample('drawer close');
            }
            await closePage(page);
        }
        for (const language of ['zh-CN','en-US']) {
            const common={uiLanguage:language,theme:'dark',interfaceSkin:'compact'};
            for (const [id,values,expectation] of [
                ['long-custom',{service:customId},{name:longName,model:longModel}],
                ['non-model',{service:'google'},{name:language === 'zh-CN' ? '谷歌翻译' : 'Google Translate',model:''}],
                ['local-model',{service:'localTranslation'},{name:language === 'zh-CN' ? '本地模型翻译' : 'Local model translation',model:'fluentread/opus-zh-en'}],
                ['assigned',{service:'openai',hoverTranslationService:'deepseek',selectionTranslationService:'google'},{name:'OpenAI',model:'gpt-4.1-mini',extra:'+2'}],
            ]) {
                const page=await capture(`${language}-dark-${id}`,{...common,hoverTranslationService:'',selectionTranslationService:'',...values},expectation);await closePage(page);
            }
            const empty={...tokens,openai:''};
            const page=await capture(`${language}-dark-reminder`,{...common,service:'openai',hoverTranslationService:'',selectionTranslationService:'',
                token:empty,apiKeys:Object.fromEntries(Object.entries(empty).map(([key,value]) => [key,value ? [value] : []]))}, {name:'OpenAI',model:'gpt-4.1-mini',reminder:true},true);
            await closePage(page);
            await seed({token:tokens,apiKeys:Object.fromEntries(Object.entries(tokens).map(([key,value]) => [key,[value]]))},true);
        }
        // 真实英文词典把“文”用于其它 UI 缩写；这个合法的自定义名称/模型必须仍显示原值。
        // baseline 只记录旧摘要，不要求当时不存在的名称、模型或归属保护，避免将预期旧缺口当总失败。
        const beforeOwnedContent=await read();
        const ownedContent=await capture('en-US-dark-custom-content',{uiLanguage:'en-US',theme:'dark',interfaceSkin:'compact',service:customId,
            customOpenAIProviders:[{id:customId,name:'文',endpoint:'https://example.test/v1/chat/completions',models:['文']}],
            // 模型目录会保护文档的已选模型；同步这份夹具的网页/文档选择，避免旧长模型被合法补回。
            model:{...beforeOwnedContent.model,[customId]:'文'},documentModel:{...beforeOwnedContent.documentModel,[customId]:'文'}}, {name:'文',model:'文',contentOwnership:true});
        await closePage(ownedContent);
        for (const [id,order,visibility,nested] of [
            ['reordered',['siteRule','translation','quickFeatures','footer'],{popupQuickFeatures:true,popupSiteRule:true,popupFooter:true},false],
            ['hidden',['quickFeatures','footer','translation','siteRule'],{popupQuickFeatures:false,popupSiteRule:true,popupFooter:false},true],
        ]) {
            const page=await capture(`en-US-light-${id}`,{uiLanguage:'en-US',theme:'light',interfaceSkin:'default',service:'openai',popupModuleOrder:order,
                interfaceVisibility:{...initial.interfaceVisibility,...visibility}}, {name:'OpenAI',model:'gpt-4.1-mini'});
            const actual=await layout(page),expected=order.filter(module => module === 'translation' || visibility[`popup${module[0].toUpperCase()}${module.slice(1)}`]);
            assert.deepEqual(actual.modules,expected,`${id}: saved module order/visibility`);assert.equal(actual.siteNested,nested,`${id}: adjacent site rule nesting`);
            await closePage(page);
        }
        report.httpAttempts.push(...await worker.evaluate(() => globalThis.__popupKeyHttpAttempts || []));
        assert.equal(report.httpAttempts.length,0,'Popup-only inspection must not attempt HTTP');assert.equal(report.consoleErrors.length,0,'No console errors');
        await focusSample('final');report.ok=true;
    } catch (error) {report.failure=String(error.stack || error);throw error;}
    finally {
        let closed=false;
        if(session) {try {await session.close();closed=true;report.ownedBrowserClosed=true;} catch(error) {report.ok=false;report.closeError=String(error.stack || error);process.exitCode=1;}}
        if(closed || !launchAttempted) {fs.rmSync(profileDir,{recursive:true,force:true});report.profileRemoved=true;}
        else {report.retainedProfile=profileDir;}
        fs.writeFileSync(path.join(args.artifactsDir,'report.json'),JSON.stringify(report,null,2));
    }
    return report;
}

if(process.argv.includes('--help')) {
    console.log('Production Popup summary proof: --extension-dir DIR --playwright-root DIR --artifacts-dir DIR [--phase baseline|optimized] [--browser-path FILE] [--focus-safe-helper FILE] [--display secondary]');
} else if(require.main === module) {
    main(argumentsFor(process.argv)).then(report => console.log(JSON.stringify({ok:report.ok,layouts:report.layouts.length,cases:report.cases.length,report:report.reportPath})))
        .catch(error => {console.error(error.stack || error);process.exitCode=1;});
}

module.exports={argumentsFor,layout};
