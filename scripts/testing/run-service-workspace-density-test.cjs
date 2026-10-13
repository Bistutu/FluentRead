#!/usr/bin/env node
/**
 * @file scripts/testing/run-service-workspace-density-test.cjs
 * 文件职责：在生产扩展和临时后台 Edge 中采集服务工作区的空间、滚动与目录布局读取证据。
 * 主要内容：基线与优化矩阵、目录标题/数量与新增按钮的无重叠边界、服务浏览不改默认值、搜索与折叠导航、手机配置可达、模型弹层和跨 frame 的逐帧几何读取计数。
 * 模块边界：只操作本次临时 profile；使用合成配置，禁止 HTTP provider 请求、连接检查和模型下载；耗时只作为当前环境证据。
 */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const {performance} = require('node:perf_hooks');
const {createRequire} = require('node:module');
const {guardBrowserClose} = require('./owned-browser-close.cjs');
const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : process.argv[index + 1];
};
if (process.argv.includes('--help')) {
  console.log('Required: --extension-dir <production directory> --playwright-root <node packages> --artifacts-dir <directory>\nOptional: --phase baseline|optimized --baseline-report <baseline/report.json> --focus-safe-helper <helper.cjs> --browser-path <Edge binary> --display secondary');
  process.exit(0);
}
for (const field of ['extension-dir', 'playwright-root', 'artifacts-dir']) assert(arg(field), `Missing --${field}`);
const phase = arg('phase', 'baseline');
assert(['baseline', 'optimized'].includes(phase), 'Invalid --phase');
if (phase === 'optimized') assert(arg('baseline-report'), 'Optimized phase requires --baseline-report');
const baseline = arg('baseline-report') ? JSON.parse(fs.readFileSync(arg('baseline-report'), 'utf8')) : null;
if (baseline) assert(baseline.ok && baseline.phase === 'baseline', 'Expected successful baseline report');
const extensionDir = path.resolve(arg('extension-dir'));
const artifacts = path.resolve(arg('artifacts-dir'));
const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
assert(manifest.action?.default_popup && (manifest.options_page || manifest.options_ui?.page), 'Manifest lacks extension UI');
assert(!extensionDir.endsWith('-dev'), 'This suite requires production output');
const {chromium} = createRequire(path.join(path.resolve(arg('playwright-root')), 'service-workspace-density.cjs'))('playwright');
const helper = require(path.resolve(arg('focus-safe-helper', path.join(__dirname, 'focus-safe-browser.cjs'))));
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-service-density-'));
fs.mkdirSync(artifacts, {recursive: true});
const viewports = [{width:1440,height:900},{width:1024,height:700},{width:820,height:600},{width:390,height:720},{width:1440,height:480}];
const report = {
  ok:false, phase, extensionDir, build:'production', scope:'service-workspace-density-only',
  evidence:'Real production MV3 extension in isolated background Edge; synthetic configuration; no connection tests or model downloads.',
  cases:[], layoutMetrics:[], scrollPerformance:[], operationTimes:[], screenshots:[], consoleErrors:[], baselineKnownFailures:[],
  blockedHttpRequests:[], fixturePersistence:[], persistenceCases:[], quickClose:{tested:false}, crossPageSync:{tested:false}, latestWriteWins:{tested:false},
  unverified:['Firefox runtime','provider connection or quality','model downloads','hardware-independent performance'],
};
const save = () => fs.writeFileSync(path.join(artifacts,'report.json'),JSON.stringify(report,null,2));

// BrowserContext init scripts also run in child frames. Preserve native RAF and
// keep measurement reads out of the counters by disabling the probe first.
function installProbe() {
  if (globalThis.__frServiceDensityProbe) return;
  const nativeRect = Element.prototype.getBoundingClientRect;
  const nativeRaf = requestAnimationFrame.bind(globalThis);
  const probe = globalThis.__frServiceDensityProbe = {active:false, frame:0, frames:[], nativeRaf};
  Element.prototype.getBoundingClientRect = function(...args) {
    if (probe.active) {
      const scroller = this.matches('.service-groups');
      const group = this.matches('[data-service-section]');
      if (scroller || group) {
        const bucket = probe.frames[probe.frame] ||= {frame:probe.frame,scrollerReads:0,groupReads:0};
        bucket[scroller ? 'scrollerReads' : 'groupReads'] += 1;
      }
    }
    return Reflect.apply(nativeRect,this,args);
  };
}

async function main() {
  let session, page, worker, launchAttempted = false;
  try {
    launchAttempted = true;
    session = await helper.launchFocusSafePersistentContext({chromium,profileDir,
      browserPath:arg('browser-path','/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
      headless:false,background:true,displayTarget:arg('display','secondary'),viewport:viewports[0],timeout:30000,
      browserArgs:[`--disable-extensions-except=${extensionDir}`,`--load-extension=${extensionDir}`,'--no-first-run','--no-default-browser-check']});
    guardBrowserClose(session,profileDir);
    Object.assign(report,{launchMode:session.launchMode,focusPolicy:session.focusPolicy,windowPlacement:session.windowPlacement});
    assert.equal(report.launchMode,'macos-background-cdp');
    assert.equal(report.focusPolicy,'launchservices-no-foreground');
    assert.equal(report.windowPlacement.mode,'background-visible-no-focus');
    assert.equal(report.windowPlacement.browserFrontmost,false);
    const context = session.context;
    context.setDefaultTimeout(15000);
    await context.addInitScript(installProbe);
    await context.route(/^https?:\/\//,route => {
      const url = new URL(route.request().url());
      report.blockedHttpRequests.push({surface:'page',origin:url.origin,path:url.pathname});
      return route.abort('blockedbyclient');
    });
    worker = context.serviceWorkers().find(candidate => candidate.url().startsWith('chrome-extension://'))
      || await context.waitForEvent('serviceworker',{timeout:30000});
    worker.on('console',message => {if (message.type()==='error') report.consoleErrors.push({surface:'worker',message:message.text()});});
    await worker.evaluate(() => {
      globalThis.__frDensityBlockedHttp = [];
      const original = fetch.bind(globalThis);
      globalThis.fetch = (input,init) => {
        const value = typeof input === 'string' ? input : input?.url || String(input);
        if (/^https?:\/\//u.test(value)) {
          const url = new URL(value);
          globalThis.__frDensityBlockedHttp.push({surface:'worker',origin:url.origin,path:url.pathname});
          return Promise.reject(new Error('Service density suite forbids provider/model network traffic'));
        }
        return original(input,init);
      };
    });
    report.networkGuard = 'Page HTTP routing and worker fetch guard installed before fixture/UI actions; browser bootstrap before worker discovery is not attributed.';
    const origin = `chrome-extension://${new URL(worker.url()).host}`;
    const optionsUrl = `${origin}/${manifest.options_page || manifest.options_ui.page}#settings-services`;
    page = await helper.newPageWithoutForeground(context,30000);
    page.on('pageerror',error => report.consoleErrors.push({surface:'options',message:error.message}));
    page.on('console',message => {if(message.type()==='error') report.consoleErrors.push({surface:'options',message:message.text()});});
    await page.goto(`${origin}/${manifest.action.default_popup}`,{waitUntil:'domcontentloaded'});
    await page.locator('.popup-shell[data-config-ready="true"], .language-onboarding, .onboarding-card').first().waitFor({state:'visible'});
    const readConfig = () => page.evaluate(async () => {
      const result=await chrome.runtime.sendMessage({type:'configStorageRead',key:'local:config'});
      if (!result?.success) throw new Error('Configuration read failed');
      return typeof result.value==='string' ? JSON.parse(result.value) : result.value;
    });
    let fixtureSequence=Date.now();
    const seed = async patch => {
      for(let attempt=0;attempt<2;attempt++) {
        const current=await readConfig();
        const config={...current,...patch,
          token:{...current.token,...(patch.token||{})},
          proxy:{...current.proxy,...(patch.proxy||{})},
          apiKeys:{...current.apiKeys,...(patch.apiKeys||{})}};
        const response=await page.evaluate(({config,sequence,baseRevision}) => chrome.runtime.sendMessage({type:'persistConfig',config,
          clientId:'service-workspace-density-fixture',sequence,baseRevision}),
        {config,sequence:++fixtureSequence,baseRevision:current.__fluentConfigRevision});
        report.fixturePersistence.push({success:response?.success===true,code:typeof response?.code==='string'?response.code:null,conflict:Boolean(response?.conflict)});
        if(response?.success)return;
      }
      save();throw new Error('Synthetic configuration save failed after fresh-read retry; see sanitized fixturePersistence');
    };
    await seed({on:true,uiLanguage:'zh-CN',uiLanguageSetupCompleted:true,service:'freeTranslation',theme:'light',customOpenAIProviders:[],
      token:{...(await readConfig()).token,openai:'density-fixture-key'},useCache:false});
    await page.goto(optionsUrl,{waitUntil:'domcontentloaded'});
    await helper.activateExtensionTabWithoutForeground(context,page);
    let frame;
    const findFrame = async () => {
      await page.waitForFunction(() => Boolean(document.querySelector('.service-catalog')) || [...document.querySelectorAll('iframe')].length>0);
      const deadline=Date.now()+15000;
      while(Date.now()<deadline) {
        for(const candidate of page.frames()) if(await candidate.locator('.service-catalog:visible').count()) return candidate;
        await page.waitForTimeout(50);
      }
      throw new Error('Visible service catalog missing in all frames');
    };
    frame=await findFrame();
    const catalog = () => frame.locator('.service-catalog:visible');
    const directory = () => catalog().locator('.service-groups');
    const mobileToggle = () => catalog().locator('.mobile-directory-toggle');
    const search = () => catalog().locator('.catalog-search input');
    const time = async (id,action) => {const start=performance.now();const result=await action();report.operationTimes.push({id,elapsedMs:performance.now()-start,evidence:'Host and browser action latency in this test environment; no speed guarantee.'});return result;};
    const showDirectory = async () => {if(await mobileToggle().isVisible() && await mobileToggle().getAttribute('aria-expanded')==='false') await mobileToggle().click();};
    const closeDirectory = async () => {if(await mobileToggle().isVisible() && await mobileToggle().getAttribute('aria-expanded')==='true') await mobileToggle().click();};
    const select = async value => {
      await showDirectory();
      await search().fill(value);
      await catalog().locator(`[data-service-value="${value}"]`).click();
      await frame.waitForFunction(value => document.querySelector('.service-catalog')?.dataset.editingService===value,value);
      if(await search().isVisible()) await search().fill('');
      await closeDirectory();
      assert.equal(await catalog().getAttribute('data-default-service'),'freeTranslation','Browsing changed default DOM state');
      assert.equal((await readConfig()).service,'freeTranslation','Browsing changed persisted default');
    };
    const configurationAtTop = () => frame.waitForFunction(() => {
      const catalog=document.querySelector('.service-catalog');
      return catalog?.getClientRects().length && [...catalog.querySelectorAll('.service-detail, .catalog-layout')].every(node => node.scrollTop<=1);
    },null,{timeout:2000});
    const shot = async name => {
      await helper.activateExtensionTabWithoutForeground(context,page);
      await frame.evaluate(async () => {
        await Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations!==Infinity).map(animation => animation.finished.catch(()=>{})));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      const file=path.join(artifacts,`${name}.png`); await page.screenshot({path:file,fullPage:false}); report.screenshots.push(file);
    };
    const metrics = id => frame.evaluate(id => {
      const box = node => {
        if(!node) return null;
        const rect=node.getBoundingClientRect(),style=getComputedStyle(node);
        return {x:rect.x,y:rect.y,top:rect.top,bottom:rect.bottom,left:rect.left,right:rect.right,width:rect.width,height:rect.height,
          clientHeight:node.clientHeight,scrollHeight:node.scrollHeight,scrollTop:node.scrollTop,clientWidth:node.clientWidth,scrollWidth:node.scrollWidth,
          overflowY:style.overflowY,paddingY:parseFloat(style.paddingTop)+parseFloat(style.paddingBottom),marginY:parseFloat(style.marginTop)+parseFloat(style.marginBottom)};
      };
      const cat=document.querySelector('.service-catalog'),detail=cat.querySelector('.service-detail');
      const key=detail.querySelector('.api-key-entry input, [data-api-key-list] input[type="password"]');
      const detailBox=box(detail),keyBox=box(key);
      const textRects = node => {
        if(!node)return [];
        const range=document.createRange();range.selectNodeContents(node);
        return [...range.getClientRects()].filter(rect=>rect.width>0&&rect.height>0).map(rect=>({left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:rect.width,height:rect.height}));
      };
      const heading=cat.querySelector('.rail-heading'),addButton=heading?.querySelector('.service-add-button');
      const headingBox=box(heading),railBox=box(cat.querySelector('.service-rail')),addButtonBox=box(addButton);
      const titleNode=heading?.querySelector('strong'),countNode=heading?.querySelector('.service-count');
      const titleRanges=textRects(titleNode),countRanges=textRects(countNode),addTextRanges=textRects(addButton?.querySelector('span'));
      const overlaps=(a,b)=>Boolean(a&&b&&Math.min(a.right,b.right)-Math.max(a.left,b.left)>.5&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>.5);
      const fits=(rect,bounds)=>Boolean(bounds&&rect.left>=bounds.left-1&&rect.right<=bounds.right+1&&rect.top>=bounds.top-1&&rect.bottom<=bounds.bottom+1);
      const headingIssues=[];
      if(headingBox?.height>0) {
        if(titleRanges.some(rect=>overlaps(rect,addButtonBox)))headingIssues.push('title-overlaps-add-button');
        if(countRanges.some(rect=>overlaps(rect,addButtonBox)))headingIssues.push('count-overlaps-add-button');
        if(titleRanges.some(rect=>countRanges.some(count=>overlaps(rect,count))))headingIssues.push('title-overlaps-count');
        if([...titleRanges,...countRanges].some(rect=>!fits(rect,headingBox)||!fits(rect,railBox)))headingIssues.push('heading-text-overflow');
        if(addButtonBox&&(!fits(addButtonBox,headingBox)||!fits(addButtonBox,railBox)))headingIssues.push('add-button-overflow');
        if(addTextRanges.some(rect=>!fits(rect,addButtonBox)))headingIssues.push('add-button-text-clipped');
        if([...titleRanges,...countRanges,...(addButtonBox?[addButtonBox]:[])].some(rect=>rect.left< -1||rect.right>innerWidth+1))headingIssues.push('heading-viewport-overflow');
      }
      const railHeading={box:headingBox,rail:railBox,title:box(titleNode),count:box(countNode),addButton:addButtonBox,
        titleRanges,countRanges,addTextRanges,issues:headingIssues};
      const clipping=[];let parent=key?.parentElement;
      while(parent){const style=getComputedStyle(parent);if(/auto|scroll|hidden|clip/u.test(style.overflowY))clipping.push(box(parent));parent=parent.parentElement;}
      const visibleKey=keyBox && keyBox.width>0 && keyBox.height>0 && keyBox.bottom>0 && keyBox.top<innerHeight && clipping.every(rect => keyBox.bottom>rect.top && keyBox.top<rect.bottom);
      return {id,viewport:{width:innerWidth,height:innerHeight},defaultService:cat.dataset.defaultService,editingService:cat.dataset.editingService,
        catalog:box(cat),detail:detailBox,hero:box(detail.querySelector('.detail-hero')),model:box(detail.querySelector('.model-section')),
        configuration:box(detail.querySelector('.service-configuration-slot')),firstKey:keyBox,firstKeyVisible:Boolean(visibleKey),
        firstKeyContentY:keyBox ? keyBox.top-detailBox.top+detail.scrollTop : null,
        document:{scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight},
        viewportOverflowX:document.documentElement.scrollWidth>innerWidth+1,viewportOverflowY:document.documentElement.scrollHeight>innerHeight+1,
        directory:box(cat.querySelector('.service-groups')),railHeading,
        rows:[...cat.querySelectorAll('.service-groups [data-service-value]')].filter(node => node.getClientRects().length).map(node => {
          const strong=node.querySelector('strong'),rowBox=box(node),labelBox=box(strong),style=strong?getComputedStyle(strong):null;
          const range=document.createRange();if(strong)range.selectNodeContents(strong);
          const labelRects=strong?[...range.getClientRects()].map(rect=>({left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:rect.width,height:rect.height})):[];
          const lineHeight=style?parseFloat(style.lineHeight):null;
          return {service:node.dataset.serviceValue,label:strong?.textContent.trim(),...rowBox,labelBox,labelRects,lineHeight,
            singleLine:Boolean(labelBox&&lineHeight&&labelBox.height<=lineHeight+1),
            labelFitsRow:labelRects.every(rect=>rect.left>=rowBox.left-1&&rect.right<=rowBox.right+1&&rect.top>=rowBox.top-1&&rect.bottom<=rowBox.bottom+1),
            labelOverflowX:Boolean(strong&&strong.clientWidth>0&&strong.scrollWidth>strong.clientWidth+1),
            labelOverflowY:Boolean(strong&&strong.clientHeight>0&&strong.scrollHeight>strong.clientHeight+1)};
        })};
    },id);
    const measureScroll = async id => {
      await showDirectory();
      await search().fill('');
      await directory().evaluate(node => {node.scrollTop=0;node.dispatchEvent(new WheelEvent('wheel',{deltaY:1,bubbles:true}));});
      for(const candidate of page.frames()) await candidate.evaluate(() => {const p=globalThis.__frServiceDensityProbe;if(p){p.frame=0;p.frames=[];p.active=true;}});
      const motion=await frame.evaluate(async () => {
        const node=document.querySelector('.service-groups'),p=globalThis.__frServiceDensityProbe;
        if(!p)throw new Error('Frame RAF/geometry probe missing');
        const max=node.scrollHeight-node.clientHeight,start=performance.now();
        for(let index=0;index<48;index++) {
          await new Promise(resolve => p.nativeRaf(resolve));
          p.frame=index;
          node.scrollTop=max*(index<24 ? index/23 : (47-index)/23);
        }
        await new Promise(resolve => p.nativeRaf(resolve));
        p.active=false;
        return {maxScroll:max,frames:48,durationMs:performance.now()-start,finalScrollTop:node.scrollTop};
      });
      const frameReports=[];
      for(const candidate of page.frames()) {
        const data=await candidate.evaluate(() => {const p=globalThis.__frServiceDensityProbe;if(!p)return null;p.active=false;return {url:location.href,frames:p.frames.filter(Boolean)};});
        if(data)frameReports.push(data);
      }
      const buckets=frameReports.flatMap(entry => entry.frames),totalGroupReads=buckets.reduce((sum,item)=>sum+item.groupReads,0),totalScrollerReads=buckets.reduce((sum,item)=>sum+item.scrollerReads,0);
      const sample={id,motion,frames:frameReports,totalGroupReads,totalScrollerReads,totalReads:totalGroupReads+totalScrollerReads,
        maxReadsPerFrame:Math.max(0,...buckets.map(item=>item.groupReads+item.scrollerReads)),
        evidence:'Element.getBoundingClientRect calls on directory scroller/groups only, counted per native RAF bucket in every frame; excludes metrics and screenshots.'};
      report.scrollPerformance.push(sample);
      if(phase==='optimized') {
        const old=baseline.scrollPerformance.find(item=>item.id===id);assert(old,'Matching measured baseline directory scroll missing');
        const previous=old.totalReads??old.totalGroupReads+old.totalScrollerReads;
        sample.baseline={totalReads:previous,reduction:previous-sample.totalReads};
        if(previous>0)assert(sample.totalReads<previous,`Directory rectangle reads did not decrease from measured baseline: ${id} (${previous} -> ${sample.totalReads})`);
        else assert.equal(sample.totalReads,0,`Directory introduced rectangle reads over zero-read baseline: ${id}`);
      }
      assert(motion.maxScroll>0,'Directory is not independently scrollable');
      await closeDirectory();
    };
    const interactions = async id => {
      await showDirectory(); await search().fill('deepseek');
      const found=await catalog().locator('.service-groups [data-service-value]:visible').evaluateAll(nodes=>nodes.map(node=>node.dataset.serviceValue));
      assert.deepEqual(found,['deepseek'],'Service search failed');
      await catalog().locator('[data-service-value="deepseek"]').click(); await showDirectory(); await search().fill('');
      const section=catalog().locator('[data-service-section="ai-providers"]');
      const toggle=section.locator('.directory-section-toggle');
      if(await toggle.getAttribute('aria-expanded')==='true')await toggle.click();
      assert.equal(await section.locator('[data-service-value]:visible').count(),0,'Collapsed group kept services visible');
      const link=catalog().locator('[data-service-group-link="ai-providers"]');
      if(await link.isVisible()) {
        await link.click();
        await frame.waitForFunction(() => document.querySelector('[data-service-group-link="ai-providers"]')?.getAttribute('aria-current')==='location');
        assert.equal(await toggle.getAttribute('aria-expanded'),'true','Navigation did not expand collapsed group');
        const navigationStart=performance.now();
        await frame.evaluate(() => {globalThis.__frDensityNavigationPosition=null;});
        let navigationError=null;
        try {
          await frame.waitForFunction(() => {
            const node=document.querySelector('.service-groups'),group=node?.querySelector('[data-service-section="ai-providers"]');
            if(!node||!group)return false;
            const offset=group.getBoundingClientRect().top-node.getBoundingClientRect().top;
            const atEnd=node.scrollTop+node.clientHeight>=node.scrollHeight-2;
            const previous=globalThis.__frDensityNavigationPosition;
            const stable=previous&&Math.abs(previous.scrollTop-node.scrollTop)<.1 ? previous.stable+1 : 0;
            globalThis.__frDensityNavigationPosition={scrollTop:node.scrollTop,stable};
            return stable>=2&&(Math.abs(offset)<=3||atEnd);
          },null,{timeout:2000,polling:'raf'});
        } catch(error) {navigationError=String(error.message);}
        const navigation=await directory().evaluate(node => {const group=node.querySelector('[data-service-section="ai-providers"]');return {
          offset:group.getBoundingClientRect().top-node.getBoundingClientRect().top,atEnd:node.scrollTop+node.clientHeight>=node.scrollHeight-2,
          scrollTop:node.scrollTop,clientHeight:node.clientHeight,scrollHeight:node.scrollHeight,
          current:document.querySelector('[data-service-group-link][aria-current]')?.dataset.serviceGroupLink};});
        navigation.elapsedMs=performance.now()-navigationStart;
        report.operationTimes.push({id:`navigation-scroll-${id}`,elapsedMs:navigation.elapsedMs,position:navigation,evidence:'Bounded wait for actual settled scroll and target group position; environment evidence only.'});
        if(navigationError) {
          if(phase==='baseline')report.baselineKnownFailures.push({id,action:'navigation-scroll',state:navigation,error:navigationError});
          else assert.fail(`Navigation did not settle at target group: ${id} ${JSON.stringify(navigation)}`);
        }
      } else {await toggle.click();assert.equal(await toggle.getAttribute('aria-expanded'),'true');}
      await select('openai');
      if(phase==='optimized')await configurationAtTop();
      const key=catalog().locator('.api-key-entry input').first(); await key.scrollIntoViewIfNeeded(); await key.focus();
      assert.equal(await key.evaluate(node=>document.activeElement===node),true,'Configuration is unreachable after closing mobile directory');
      if(await mobileToggle().isVisible())assert.equal(await mobileToggle().getAttribute('aria-expanded'),'false','Mobile directory did not close');
      const model=catalog().getByTestId('model-picker-trigger');
      assert.equal(await model.count(),1,'OpenAI model picker must remain available');
      {
        const selected=await model.innerText();await model.click();
        const panel=frame.locator('.model-picker-panel:visible');await panel.waitFor();
        const modelSearch=panel.locator('.model-picker-search input');await modelSearch.fill('no-density-fixture-model');
        assert.equal(await panel.locator('.model-picker-chip').count(),0,'Model search ignored query');
        await modelSearch.fill('');assert(await panel.locator('.model-picker-chip').count()>0,'Model clear search failed');
        await modelSearch.press('Escape');await panel.waitFor({state:'hidden'});
        assert.equal(await model.innerText(),selected,'Inspecting model picker changed model');
      }
      // 外部入口不会像目录按钮那样通过 Playwright 自动滚入视口，
      // 因而能检验产品是否清空真正的窄屏 catalog-layout 滚动区。
      if(await mobileToggle().isVisible() && phase==='optimized') {
        for(const round of ['changed-service','same-service']) {
          const scroll=await catalog().locator('.catalog-layout').evaluate(node => {
            node.scrollTop=node.scrollHeight;
            return {scrollTop:node.scrollTop,maxScroll:node.scrollHeight-node.clientHeight};
          });
          assert(scroll.maxScroll>0 && scroll.scrollTop>0,`${round}: No long mobile configuration to exercise`);
          await frame.locator('.mobile-settings-navigation').selectOption('settings-general');
          await frame.getByTestId('configure-default-translation-service').click();
          await frame.waitForFunction(() => document.querySelector('.service-catalog')?.dataset.editingService==='freeTranslation');
          await configurationAtTop();
          report.cases.push({id:`external-configuration-${round}-${id}`,before:scroll,actualScrollerReset:true});
        }
        await select('openai');
        await configurationAtTop();
      }
      assert.equal((await readConfig()).service,'freeTranslation');
      report.cases.push({id:`interaction-${id}`,search:true,fold:true,groupNavigation:await link.isVisible(),mobileConfigurationReachable:true,modelSearchAndClose:true,browsingPreservesDefault:true});
    };
    for(const language of ['zh-CN','en-US']) for(const theme of ['light','dark']) {
      await seed({uiLanguage:language,theme}); await page.reload({waitUntil:'domcontentloaded'});frame=await findFrame();
      for(const viewport of viewports) {
        const id=`${language}-${theme}-${viewport.width}x${viewport.height}`;
        await page.setViewportSize(viewport);await helper.activateExtensionTabWithoutForeground(context,page);
        await time(`select-openai-${id}`,()=>select('openai'));
        if(phase==='optimized')await configurationAtTop();
        await frame.evaluate(() => new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        await showDirectory();await search().fill('');const rowState=await metrics(id);await closeDirectory();const state=await metrics(id);state.rows=rowState.rows;state.directory=rowState.directory;state.railHeading=rowState.railHeading;
        report.layoutMetrics.push(state);save();
        assert.equal(state.viewportOverflowX,false,`Horizontal viewport overflow: ${id}`);
        assert.equal(state.viewportOverflowY,false,`Outer document scrolls: ${id}`);
        assert(state.firstKey,'OpenAI first API key missing');
        assert(state.model?.height>0,'OpenAI model selection must remain visible');
        if(phase==='baseline'&&state.railHeading.issues.length)report.baselineKnownFailures.push({id,action:'rail-heading-layout',state:state.railHeading});
        if(phase==='optimized') {
          assert(state.railHeading.box?.height>0&&state.railHeading.addButton?.height>0,`Directory heading/actions missing: ${id}`);
          assert(state.railHeading.titleRanges.length&&state.railHeading.countRanges.length,`Directory title/count text metrics missing: ${id}`);
          assert.deepEqual(state.railHeading.issues,[],`Directory heading overlaps or overflows: ${id} ${JSON.stringify(state.railHeading)}`);
          assert(state.hero.paddingY+state.hero.marginY<=28.1,`Hero consumes too much vertical spacing: ${id}`);
          for(const row of state.rows) {
            assert(row.height>=43.9,`Directory row ${row.service} lost the minimum hit target: ${id}`);
            assert(row.labelFitsRow&&!row.labelOverflowX&&!row.labelOverflowY,`Directory name ${row.service} is clipped: ${id}`);
          }
          const shortRows=state.rows.filter(row=>row.singleLine&&['openai','deepseek','google','deepL','gemini','claude','grok'].includes(row.service));
          assert(shortRows.length>=4,`Common short service rows missing: ${id}`);
          for(const row of shortRows)assert(row.height>=43.9&&row.height<=50.1,`Directory row ${row.service} is ${row.height}px: ${id}`);
          const old=baseline.layoutMetrics.find(item=>item.id===id);assert(old?.firstKey,'Matching baseline first API key missing');
          state.baseline={firstKeyContentY:old.firstKeyContentY,firstKeyVisible:old.firstKeyVisible,improvementPx:old.firstKeyContentY-state.firstKeyContentY};
          assert(state.firstKeyContentY<old.firstKeyContentY-1,`Core first API key did not move earlier: ${id}`);
        }
        await shot(`layout-${id}`);
        await measureScroll(id);
        if(viewport.width===1440&&viewport.height===900 || viewport.width===390)await time(`interactions-${id}`,()=>interactions(id));
      }
    }
    const final=await readConfig();
    report.persistenceCases.push({id:'browsing-search-fold-layout-model-inspection',expected:'freeTranslation',actual:final.service,passed:final.service==='freeTranslation'});
    report.blockedHttpRequests.push(...await worker.evaluate(()=>globalThis.__frDensityBlockedHttp||[]));
    assert.equal(report.blockedHttpRequests.length,0,'UI unexpectedly attempted HTTP provider/model traffic');
    assert.deepEqual(report.consoleErrors,[]);
    report.ok=true;
  } catch(error) {
    report.error=error.stack;process.exitCode=1;
    if(page&&!page.isClosed())try{const file=path.join(artifacts,'failure.png');await page.screenshot({path:file,fullPage:false});report.screenshots.push(file);}catch(failure){report.failureScreenshotError=String(failure);}
  } finally {
    let closed=false;
    try{if(session){await session.close();closed=true;}}catch(error){report.ok=false;process.exitCode=1;(report.cleanupErrors||=[]).push(String(error.stack||error));}
    if(closed||!launchAttempted)fs.rmSync(profileDir,{recursive:true,force:true});else report.retainedProfile=profileDir;
    save();console.log(JSON.stringify({ok:report.ok,phase:report.phase,cases:report.cases.length,layouts:report.layoutMetrics.length,scrollSamples:report.scrollPerformance.length,report:path.join(artifacts,'report.json'),error:report.error||null}));
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
