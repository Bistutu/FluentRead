#!/usr/bin/env node
/**
 * @file scripts/testing/run-web-mutation-lifecycle-test.cjs
 * 文件职责：用正式扩展和真实页面手势验证 SPA 规则、开放 Shadow DOM 的动态发现、恢复和资源释放。
 * 主要内容：原创本地域名夹具仅改宿主 DOM；微软 HTTP 响应受控。真实 Alt+T、pushState 链接、保护和重插按钮，保存逐阶段 DOM、截图、可信输入、请求和原生焦点证据；CDP GC 与弱引用验证活会话不再强持有卸载组件。
 * 模块边界：不修改 production bundle、不调用翻译内部函数、不连接日常 profile；规则改变按正式 app 契约结束旧会话，同规则导航则继续当前会话。结果不代表实站或真实供应商。
 */
'use strict';
if (require.main === module && process.argv.includes('--help')) {
  console.log('node scripts/testing/run-web-mutation-lifecycle-test.cjs --extension-dir .output/chrome-mv3 --playwright-root PATH --focus-safe-helper scripts/testing/focus-safe-browser.cjs --artifacts-dir PATH');
  process.exit(0);
}
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createRequire} = require('node:module');
const {guardBrowserClose, getGuardedBrowserPid} = require('./owned-browser-close.cjs');
const {assertFreshProductionExtension} = require('../run-site-translation-test.cjs');
const projectRoot = path.resolve(__dirname, '../..');
const fixtureHost = 'mutation-lifecycle.example.com';

function parseArgs(argv) {
  const args = {extensionDir: path.join(projectRoot,'.output/chrome-mv3'), helperPath: path.join(__dirname,'focus-safe-browser.cjs'),
    browserPath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', timeout: 30000, display: 'secondary'};
  const names = {'--extension-dir':'extensionDir','--playwright-root':'playwrightRoot','--focus-safe-helper':'helperPath',
    '--artifacts-dir':'artifactsDir','--browser-path':'browserPath','--timeout':'timeout','--display':'display'};
  for (let index=0; index<argv.length; index++) {
    if (argv[index] === '--background') continue;
    assert.ok(names[argv[index]] && argv[index+1] && !argv[index+1].startsWith('--'), `未知参数或缺少值：${argv[index]}`);
    args[names[argv[index]]] = argv[++index];
  }
  for (const name of ['extensionDir','playwrightRoot','helperPath','artifactsDir']) {
    assert.ok(args[name], `缺少 --${name}`); args[name] = path.resolve(args[name]);
  }
  args.timeout = Number(args.timeout);
  assert.ok(Number.isFinite(args.timeout) && args.timeout >= 5000 && args.timeout <= 120000, 'timeout 应为 5000–120000ms');
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const helper = require(args.helperPath);
  for (const name of ['launchFocusSafePersistentContext','newPageWithoutForeground','activateExtensionTabWithoutForeground','startFocusEventMonitor']) {
    assert.equal(typeof helper[name], 'function', `focus helper 缺少 ${name}`);
  }
  const {chromium} = createRequire(path.join(args.playwrightRoot,'__web_mutation_test__.cjs'))('playwright');
  const report = {ok:false, scope:'authored-local-domain-fixture-production-extension', provider:'controlled-microsoft-transport',
    profileMode:'new-temporary-profile', artifactsDir:args.artifactsDir, steps:[], errors:[], focusEvents:[],
    limitations:['Authored DOM and controlled HTTP responses do not prove live-site or translation quality.',
      'Different matching site rules intentionally end the old full-page session; a new real Alt+T starts the new rule.',
      'This run covers isolated desktop Edge, including a narrow viewport; it is not Firefox or a mobile device.']};
  fs.mkdirSync(args.artifactsDir,{recursive:true});
  const save = () => fs.writeFileSync(path.join(args.artifactsDir,'report.json'),JSON.stringify(report,null,2));
  let profileDir, session, context, worker, popup, page, monitor, browserPid, sequence=0, primaryError, launchAttempted=false;
  const installedWorkers = new WeakMap();
  const installWorker = target => {
    if (!installedWorkers.has(target)) installedWorkers.set(target,target.evaluate(() => {
      const state = {requests:[],active:0};
      globalThis.__webMutationTransport = state;
      const translations = new Map([
        ['A stable article paragraph stays readable while the application changes routes.','应用切换路由时，这段正文应保持稳定可读。'],
        ['This delayed article paragraph becomes available after the route-specific marker changes.','当前路由的标记更新后，这段延迟正文才进入翻译范围。'],
        ['This component paragraph becomes available when its own route marker changes.','组件的路由标记更新后，其内部正文才进入翻译范围。'],
      ]);
      globalThis.fetch = async (input,init) => {
        const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
        if (url.hostname !== 'edge.microsoft.com' || url.pathname !== '/translate/translatetext') throw new Error(`External worker fetch disabled: ${url.origin}`);
        const texts = JSON.parse(init?.body ?? await input.text());
        state.requests.push({at:Date.now(),texts}); state.active++;
        try {return new Response(JSON.stringify(texts.map(text => {
          const translated=translations.get(text.trim());
          if (!translated) throw new Error(`Unexpected fixture source: ${text}`);
          return {translations:[{text:translated}]};
        })),
          {status:200,headers:{'content-type':'application/json'}});} finally {state.active--;}
      };
    }));
    return installedWorkers.get(target);
  };
  const assertFocus = () => {
    if (monitor?.error) throw monitor.error;
    assert.equal(monitor?.events.some(event => event.pid === browserPid),false,'测试浏览器抢占了前台');
  };
  const patchConfig = async updates => {
    const result = await popup.evaluate(async ({updates,sequence}) => {
      const read = await chrome.runtime.sendMessage({type:'configStorageRead',key:'local:config'});
      if (!read.success) throw new Error(read.error || 'Configuration read failed');
      const config = typeof read.value === 'string' ? JSON.parse(read.value) : read.value;
      return chrome.runtime.sendMessage({type:'persistConfig',mode:'patch',config:updates,
        expected:Object.fromEntries(Object.keys(updates).map(key => [key,config[key]])),clientId:'web-mutation-lifecycle',
        sequence,baseRevision:config.__fluentConfigRevision});
    },{updates,sequence:++sequence});
    assert.equal(result.success,true,JSON.stringify(result));
  };
  const toggle = async () => {
    assertFocus(); await helper.activateExtensionTabWithoutForeground(context,page,args.timeout);
    await page.keyboard.down('Alt'); try {await page.keyboard.press('t');} finally {await page.keyboard.up('Alt');}
  };
  const click = async selector => {
    assertFocus(); await helper.activateExtensionTabWithoutForeground(context,page,args.timeout);
    await page.locator(selector).click({timeout:args.timeout});
  };
  const hoverToggle = async () => {
    assertFocus(); await helper.activateExtensionTabWithoutForeground(context,page,args.timeout);
    const owner=page.locator('#shadow-gated'); await owner.scrollIntoViewIfNeeded();
    const point=await owner.evaluate(node => {
      const text=[...node.childNodes].find(child => child.nodeType===3 && child.textContent.trim());
      if(!text) throw new Error('Shadow paragraph has no original text');
      const range=document.createRange();range.selectNodeContents(text);
      const rect=[...range.getClientRects()].find(rect => rect.width>10 && rect.height>10 && rect.top>=0 && rect.bottom<=innerHeight);
      if(!rect) throw new Error('Shadow source is outside viewport');
      return {x:rect.left+8,y:rect.top+rect.height/2};
    });
    await page.mouse.move(point.x,point.y); await page.mouse.click(point.x,point.y);
    await page.keyboard.down('Control'); await page.keyboard.up('Control');
  };
  const snapshot = async () => ({...await page.evaluate(() => window.webMutationFixture.snapshot()),
    transport:await worker.evaluate(() => globalThis.__webMutationTransport)});
  const waitCounts = async (counts, connected = true) => page.waitForFunction(({counts,connected}) => {
    const state = window.webMutationFixture.snapshot();
    return Object.entries(counts).every(([selector,count]) => {
      const owner = state.owners.find(item => item.selector === selector);
      return owner && owner.count === count && (!connected || owner.connected);
    });
  },{counts,connected},{timeout:args.timeout});
  const checkSnapshot = state => {
    assert.equal(state.nested,0,'存在嵌套译文');
    state.owners.forEach(owner => {
      assert.ok(owner.count <= 1,`${owner.selector} 重复译文`);
      owner.wrappers.forEach(translation => {
        assert.match(translation.text,/[\u3400-\u9fff]/u,'缺少受控中文译文');
        assert.equal(translation.display,'block',`${owner.selector} 缺少公共双语换行样式`);
        assert.equal(translation.marginTop,'8px',`${owner.selector} 原译文间距未生效`);
        assert.equal(translation.fontWeight,'700',`${owner.selector} 加粗预设未生效`);
      });
    });
    state.guards.forEach(guard => {assert.equal(guard.intact,true,`${guard.selector} 保护区改变`); assert.equal(guard.owned,0);});
  };
  const record = async (name,screenshot=true) => {
    assertFocus(); const state = await snapshot(); checkSnapshot(state);
    report.steps.push({name,...state});
    fs.writeFileSync(path.join(args.artifactsDir,`${name}.html`),await page.content());
    fs.writeFileSync(path.join(args.artifactsDir,`${name}.json`),JSON.stringify(state,null,2));
    if (screenshot) await page.screenshot({path:path.join(args.artifactsDir,`${name}.png`),caret:'initial'});
    save(); process.stdout.write(`${name}: ${state.owners.map(owner => `${owner.selector}=${owner.count}`).join(', ')}\n`);
    return state;
  };
  try {
    report.buildFreshness = assertFreshProductionExtension(args.extensionDir,projectRoot);
    report.build = Object.fromEntries(['manifest.json','content-scripts/content.js'].map(name => [name,
      {sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(args.extensionDir,name))).digest('hex')} ]));
    profileDir=fs.mkdtempSync(path.join(os.tmpdir(),'fluentread-web-mutation-lifecycle-')); report.profileDir=profileDir;
    monitor=helper.startFocusEventMonitor({onEvent:event => report.focusEvents.push(event),onError:error => report.errors.push(`focus: ${error.message}`)});
    await monitor.ready;
    launchAttempted=true;
    session=await helper.launchFocusSafePersistentContext({chromium,profileDir,browserPath:args.browserPath,background:true,headless:false,
      viewport:{width:1280,height:900},displayTarget:args.display,timeout:args.timeout,
      browserArgs:[`--disable-extensions-except=${args.extensionDir}`,`--load-extension=${args.extensionDir}`,'--no-first-run','--no-default-browser-check']});
    guardBrowserClose(session,profileDir); browserPid=await getGuardedBrowserPid(session); context=session.context;
    Object.assign(report,{browserPid,browserVersion:await context.browser().version(),launchMode:session.launchMode,
      focusPolicy:session.focusPolicy,windowPlacement:session.windowPlacement});
    assert.equal(report.launchMode,'macos-background-cdp'); assert.equal(report.focusPolicy,'launchservices-no-foreground');
    assert.equal(report.windowPlacement.mode,'background-visible-no-focus'); assert.equal(report.windowPlacement.browserFrontmost,false);
    assertFocus();
    context.on('serviceworker',target => {void installWorker(target).catch(error => report.errors.push(error.message));});
    worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker',{timeout:args.timeout}); await installWorker(worker);
    const fixture=fs.readFileSync(path.join(projectRoot,'tests/fixtures/translation-pages/web-mutation-lifecycle.html'),'utf8');
    await context.route('**/*',route => {
      const request=route.request(),url=new URL(request.url());
      if (url.hostname===fixtureHost && request.isNavigationRequest()) return route.fulfill({status:200,contentType:'text/html',body:fixture});
      return ['https:','http:'].includes(url.protocol) ? route.abort('blockedbyclient') : route.continue();
    });
    popup=await helper.newPageWithoutForeground(context,args.timeout);
    await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`,{waitUntil:'domcontentloaded'});
    report.config={on:true,service:'microsoft',from:'en',to:'zh-Hans',display:1,style:1,autoTranslate:false,alwaysTranslateDomains:[],
      hotkey:'Control',floatingBallHotkey:'Alt+T',fullPageTranslationMode:'all',translationScope:'content',useCache:false,
      enableAIContext:false,enableAIMultiSegment:false,pageTitleTranslationEnabled:false,glossaryEnabled:false,
      uiLanguage:'zh-CN',uiLanguageSetupCompleted:true,disableFloatingBall:true,disableSelectionTranslator:true,selectionTranslatorMode:'disabled',
      siteAdaptation:{enabled:true,disabledRuleIds:[],custom:{version:1,rules:['a','b'].map(route => ({
        id:`mutation-route-${route}`,name:`Lifecycle route ${route}`,match:{hosts:[fixtureHost],paths:[`/route-${route}*`]},mode:'focus',
        content:[{css:['#stable',`[data-route-${route}="ready"] + p`]}],protect:['header','pre','code'],
      }))}}};
    await patchConfig(report.config);
    page=await helper.newPageWithoutForeground(context,args.timeout);
    page.on('pageerror',error => report.errors.push(error.stack || error.message));
    await page.goto(`https://${fixtureHost}/route-a`,{waitUntil:'domcontentloaded',timeout:args.timeout});
    await page.locator('#fluent-read-page-styles').waitFor({state:'attached',timeout:args.timeout});
    await page.waitForFunction(() => Boolean(window.webMutationFixture));
    await record('01-source');
    await toggle(); await waitCounts({'#stable':1,'#light-gated':0,'#shadow-gated':0});
    await click('#ready'); await waitCounts({'#stable':1,'#light-gated':1,'#shadow-gated':1});
    await record('02-route-a-translated');
    await click('#route-b'); await page.waitForURL(`https://${fixtureHost}/route-b`);
    await waitCounts({'#stable':0,'#light-gated':0,'#shadow-gated':0});
    const changed=await record('03-route-b-restored');
    changed.owners.forEach(owner => assert.equal(owner.restored,true,`${owner.selector} 换规则后未完整恢复`));
    await toggle(); await waitCounts({'#stable':1,'#light-gated':0,'#shadow-gated':0});
    await click('#ready'); await waitCounts({'#stable':1,'#light-gated':1,'#shadow-gated':1});
    const routeB=await record('04-route-b-translated');
    await patchConfig({translationAppearance:{textColor:'#1d4ed8'}});
    await page.waitForFunction(() => window.webMutationFixture.snapshot().owners.every(owner =>
      owner.wrappers.length===1 && owner.wrappers[0].color==='rgb(29, 78, 216)'),null,{timeout:args.timeout});
    await record('04b-appearance-synced');
    await patchConfig({translationAppearance:{}});
    await page.waitForFunction(() => window.webMutationFixture.snapshot().owners.every(owner =>
      owner.wrappers.every(wrapper => wrapper.color!=='rgb(29, 78, 216)')),null,{timeout:args.timeout});
    await click('#route-b-next'); await page.waitForURL(`https://${fixtureHost}/route-b/next`);
    await page.waitForTimeout(750);
    const sameRule=await record('05-same-rule-navigation');
    assert.deepEqual(sameRule.owners.map(owner => owner.wrappers.map(item => item.id)),routeB.owners.map(owner => owner.wrappers.map(item => item.id)),'同规则SPA重建了已提交译文');
    assert.equal(sameRule.transport.requests.length,routeB.transport.requests.length,'同规则SPA多发请求');
    await click('#protect'); await waitCounts({'#stable':1,'#light-gated':0,'#shadow-gated':0}); await record('06-protected');
    await click('#unprotect'); await waitCounts({'#stable':1,'#light-gated':1,'#shadow-gated':1}); await record('07-unprotected');
    await click('#detach'); await waitCounts({'#stable':1,'#light-gated':1,'#shadow-gated':0},false);
    const detached=await record('08-detached'); assert.equal(detached.componentConnected,false);
    await page.waitForTimeout(700); assert.equal((await snapshot()).transport.requests.length,detached.transport.requests.length,'断连组件继续请求');
    await click('#reattach'); await waitCounts({'#stable':1,'#light-gated':1,'#shadow-gated':1}); await record('09-reattached');
    await toggle(); await waitCounts({'#stable':0,'#light-gated':0,'#shadow-gated':0});
    const restored=await record('10-restored'); restored.owners.forEach(owner => assert.equal(owner.restored,true,`${owner.selector} 原始HTML未恢复`));
    assert.equal(restored.owned,0,'恢复后残留扩展翻译工件');
    await toggle(); await waitCounts({'#stable':1,'#light-gated':1,'#shadow-gated':1}); await record('11-retranslated');
    await page.setViewportSize({width:390,height:844}); await page.emulateMedia({colorScheme:'dark'});
    await page.waitForTimeout(700); const narrow=await record('12-narrow-dark');
    assert.equal(narrow.horizontalOverflow,false,'窄屏出现页面横向溢出');
    narrow.owners.forEach(owner => owner.wrappers.forEach(item => assert.equal(item.withinOwnerWidth,true,`${owner.selector} 译文横向溢出`)));
    await page.locator('#shadow-gated').scrollIntoViewIfNeeded(); await record('12a-narrow-shadow-visible');
    await page.setViewportSize({width:1280,height:900}); await page.emulateMedia({colorScheme:'light'});
    await toggle(); await waitCounts({'#stable':0,'#light-gated':0,'#shadow-gated':0});
    assert.equal((await snapshot()).shadowStyleCount,0,'全文恢复后未清理开放根中的自有样式');
    await hoverToggle(); await waitCounts({'#stable':0,'#light-gated':0,'#shadow-gated':1});
    const hover=await record('12b-shadow-hover'); assert.equal(hover.shadowStyleCount,1,'悬浮入口未独立安装样式');
    await hoverToggle(); await waitCounts({'#stable':0,'#light-gated':0,'#shadow-gated':0});
    await toggle(); await waitCounts({'#stable':1,'#light-gated':1,'#shadow-gated':1});
    await page.evaluate(() => window.webMutationFixture.rememberStyle());
    await patchConfig({on:false});
    await waitCounts({'#stable':0,'#light-gated':0,'#shadow-gated':0});
    await page.waitForTimeout(700);
    const cleanupCdp=await context.newCDPSession(page);
    try {
      report.styleCollection=[];
      for (let attempt=0;attempt<8;attempt++) {
        await cleanupCdp.send('HeapProfiler.collectGarbage'); await page.waitForTimeout(100);
        const collected=await page.evaluate(() => window.webMutationFixture.styleReleased());
        report.styleCollection.push({attempt,...collected});
      }
    } finally {await cleanupCdp.detach();}
    assert.equal(report.styleCollection.at(-1)?.hostConnected,true,'停用GC检查必须保留页面宿主');
    assert.equal(report.styleCollection.at(-1)?.styleCollected,true,'停用后旧installer仍持有样式节点');
    await record('12c-disabled-style-collected');
    await patchConfig({on:true});
    await page.locator('#fluent-read-page-styles').waitFor({state:'attached',timeout:args.timeout}); await page.waitForTimeout(300);
    await toggle(); await waitCounts({'#stable':1,'#light-gated':1,'#shadow-gated':1});
    const restarted=await record('12d-reenabled'); assert.equal(restarted.shadowStyleCount,1,'重启后样式重复');
    await click('#drop'); await page.waitForTimeout(900);
    const cdp=await context.newCDPSession(page);
    try {
      report.collection=[];
      for (let attempt=0;attempt<8;attempt++) {
        await cdp.send('HeapProfiler.collectGarbage'); await page.waitForTimeout(100);
        const collected=await page.evaluate(() => window.webMutationFixture.released());
        report.collection.push({attempt,...collected});
        if (collected?.hostCollected && collected.rootCollected) break;
      }
    } finally {await cdp.detach();}
    const collected=report.collection.at(-1);
    assert.equal(collected?.hostCollected,true,'活翻译会话仍强持有已卸载组件');
    assert.equal(collected?.rootCollected,true,'活翻译会话仍强持有已卸载ShadowRoot');
    await record('13-component-collected');
    await toggle(); await waitCounts({'#stable':0,'#light-gated':0});
    const final=await record('14-final-restored');
    final.owners.forEach(owner => assert.equal(owner.restored,true)); assert.equal(final.owned,0);
    assert.deepEqual(final.actions.map(action => action.action),['ready','#route-b','ready','#route-b-next','#protect','#unprotect','detach','reattach','drop']);
    assert.ok(final.actions.every(action => action.trusted),'存在非可信页面交互');
    assert.equal(final.transport.active,0); report.requests=final.transport.requests;
    const ended=final.lifecycle.filter(item => item.event==='fluentread-translation-ended').length;
    assert.ok(ended>=3,'缺少规则切换与恢复的结束事件');
    await patchConfig({on:false});
    await page.reload({waitUntil:'domcontentloaded'}); await page.waitForTimeout(500);
    await click('#ready'); await page.waitForTimeout(500);
    const disabled=await record('15-disabled-reload'); assert.equal(disabled.owned,0);
    assert.equal(disabled.transport.requests.length,final.transport.requests.length,'禁用重载后仍发翻译请求');
    assert.deepEqual(report.errors,[]); assertFocus(); report.ok=true;
  } catch(error) {
    primaryError=error; report.error=error.stack || String(error);
    if(page && !page.isClosed()) {
      report.failure=await snapshot().catch(() => null);
      await page.screenshot({path:path.join(args.artifactsDir,'failure.png'),caret:'initial'}).catch(() => {});
      const html=await page.content().catch(() => null); if(html) fs.writeFileSync(path.join(args.artifactsDir,'failure.html'),html);
    }
  } finally {
    const cleanup=async (name,operation) => {
      try {await operation();} catch(error) {report.ok=false; (report.cleanupErrors ||= []).push({name,error:error.stack || String(error)}); primaryError ||= error;}
    };
    let closed=false;
    await cleanup('browser',async () => {if(session) {await session.close();closed=true;report.browserClosed=true;}});
    await cleanup('focus-monitor',async () => {if(monitor) {await monitor.stop();report.focusEvents=monitor.events;assertFocus();}});
    await cleanup('profile',async () => {
      if(profileDir && closed) {fs.rmSync(profileDir,{recursive:true,force:true,maxRetries:5,retryDelay:200});report.profileRemoved=true;}
      else if(profileDir && !launchAttempted) {fs.rmdirSync(profileDir);report.profileRemoved=true;}
      else if(profileDir) report.retainedProfile=profileDir;
    });
    save();
  }
  if(primaryError) throw primaryError;
  process.stdout.write(JSON.stringify({ok:report.ok,steps:report.steps.length,artifactsDir:args.artifactsDir,profileRemoved:report.profileRemoved})+'\n');
}
if(require.main===module) main().catch(error => {process.stderr.write(`${error.stack || error}\n`);process.exitCode=1;});
module.exports={parseArgs};
