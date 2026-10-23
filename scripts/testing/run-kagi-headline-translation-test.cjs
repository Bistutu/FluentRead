#!/usr/bin/env node
// Kagi News issue #1045：生产扩展、真实站点与确定性微软响应的专项回归。
// 只创建临时后台 Edge；原生交互预检先确认站点已水合，测试不代表在线供应商质量。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const args = {};
for (let index = 2; index < process.argv.length; index++) {
  const token = process.argv[index];
  if (token === '--allow-network') {args.allowNetwork = true; continue;}
  if (!token.startsWith('--') || !process.argv[index + 1] || process.argv[index + 1].startsWith('--')) throw new Error(`Invalid argument: ${token}`);
  args[token.slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())] = process.argv[++index];
}
for (const key of ['extensionDir', 'playwrightRoot', 'artifactsDir']) if (!args[key]) throw new Error(`Missing --${key.replace(/[A-Z]/gu, letter => `-${letter.toLowerCase()}`)}`);
if (!args.allowNetwork) throw new Error('Real-site test requires --allow-network');
const root = path.resolve(args.projectRoot || path.join(__dirname, '../..'));
const packages = path.resolve(args.playwrightRoot);
const {chromium} = require(path.join(packages, 'playwright'));
const helper = require(path.resolve(args.focusSafeHelper || path.join(root, 'scripts/testing/focus-safe-browser.cjs')));
const {installControlledProvider, isControlledTranslationForSource} = require(path.join(root, 'scripts/site-translation/controlled-provider.cjs'));
const extensionDir = path.resolve(args.extensionDir);
const output = path.resolve(args.artifactsDir);
fs.mkdirSync(output, {recursive:true});
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-kagi-1045-'));
const report = {ok:false, url:'https://news.kagi.com/world/latest', profileMode:'fresh-temporary', stages:[]};
let launched, page, provider;
const selector = 'article[data-story-id] button[aria-label="Expand story"], article[data-story-id] button[aria-label="Collapse story"]';
async function persist(context, updates, sequence=10) {
  const worker = context.serviceWorkers()[0];
  const popup = await helper.newPageWithoutForeground(context);
  try {
    await popup.goto(`chrome-extension://${new URL(worker.url()).host}/popup.html`);
    const response = await popup.evaluate(async ({updates,sequence}) => {
      const stored = await chrome.runtime.sendMessage({type:'configStorageRead',key:'local:config'});
      const config = typeof stored.value === 'string' ? JSON.parse(stored.value) : stored.value;
      return chrome.runtime.sendMessage({type:'persistConfig',mode:'patch',config:updates,
        expected:Object.fromEntries(Object.keys(updates).map(key=>[key,config[key]])),
        clientId:'kagi-1045-browser',sequence,baseRevision:config.__fluentConfigRevision});
    }, {updates,sequence});
    assert.equal(response.success,true,JSON.stringify(response));
  } finally {await popup.close(); await helper.activateExtensionTabWithoutForeground(context,page);}
}
async function fullToggle(){await page.keyboard.down('Alt');await page.keyboard.press('t');await page.keyboard.up('Alt');}
async function count(){return page.locator(selector).first().locator('.fluent-read-bilingual-content').count();}
async function waitCount(expected){await page.waitForFunction(({selector,expected})=>document.querySelector(selector)?.querySelectorAll('.fluent-read-bilingual-content').length===expected,{selector,expected},{timeout:45000});}
async function assertHeadlineSource(source, phase, headline = page.locator(selector).first()){
  const output = await headline.locator('.fluent-read-bilingual-content').textContent();
  assert.ok(isControlledTranslationForSource(output, source), `${phase}: controlled headline response does not match complete source`);
}
async function snapshot(name){
  console.error(name);
  const state=await page.evaluate(selector=>({url:location.href,headlines:[...document.querySelectorAll(selector)].slice(0,4).map(node=>({text:node.textContent,html:node.outerHTML,rect:(()=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})(),display:getComputedStyle(node).display})),wrappers:document.querySelectorAll('.fluent-read-bilingual-content').length}),selector);
  report.stages.push({name,...state});
  fs.writeFileSync(path.join(output,`${name}.html`),await page.content());
  await page.screenshot({path:path.join(output,`${name}.png`),fullPage:false});
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
}
(async()=>{
 try {
   assert.ok(fs.existsSync(path.join(extensionDir,'manifest.json')),'production build absent');
   launched=await helper.launchFocusSafePersistentContext({chromium,profileDir:profile,
     browserPath:args.browserPath || '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',headless:false,background:true,
     browserArgs:[`--disable-extensions-except=${extensionDir}`,`--load-extension=${extensionDir}`,'--no-first-run','--no-default-browser-check'],
     viewport:{width:1280,height:900},displayTarget:'secondary',timeout:30000});
   const context=launched.context;
   page=await helper.newPageWithoutForeground(context);
   report.pageErrors=[];report.failedRequests=[];
   page.on('pageerror',error=>report.pageErrors.push(error.message));
   page.on('requestfailed',request=>report.failedRequests.push({url:request.url(),failure:request.failure()?.errorText}));
   await page.goto(report.url,{waitUntil:'domcontentloaded',timeout:45000});
   await page.locator(selector).first().waitFor({state:'visible',timeout:30000});
   provider=await installControlledProvider(context,helper.newPageWithoutForeground,30000);
   {await helper.activateExtensionTabWithoutForeground(context,page);await page.waitForSelector('#fluent-read-page-styles',{state:'attached'});}
   await page.waitForTimeout(1500);
   {
     await page.waitForLoadState('networkidle',{timeout:20000}).then(()=>report.hostNetworkIdle=true,()=>report.hostNetworkIdle=false);
     await page.locator(selector).first().click();
     await page.waitForURL(url=>url.pathname!=='/world/latest',{waitUntil:'domcontentloaded',timeout:20000});
     await page.locator(selector).first().focus();await page.keyboard.press('Enter');
     await page.waitForURL(url=>url.pathname==='/world/latest',{waitUntil:'domcontentloaded',timeout:20000});
     report.nativePreflight=true;
     await page.evaluate(()=>{window.__frKagiClickProbe=[];for(const capture of [true,false])document.addEventListener('click',event=>{const button=event.target.closest?.('button[aria-label="Expand story"],button[aria-label="Collapse story"]');if(button)window.__frKagiClickProbe.push({capture,target:event.target.outerHTML.slice(0,180),defaultPrevented:event.defaultPrevented,isTrusted:event.isTrusted});},capture);});
   }
   await snapshot('before');
   {
     await persist(context,{translationScope:'content',fullPageTranslationMode:'viewport'});
     const original=await page.locator(selector).first().textContent();
     const originalTitle=await page.locator(selector).first().locator('span[dir]').textContent();
     const originalMarkAll=await page.locator('button[aria-label^="Mark all "]').first().textContent();
     const originalArticle=await page.locator('article[data-story-id]').first().evaluate(node=>node.outerHTML);
     await fullToggle();await waitCount(1);assert.ok((await page.locator(selector).first().textContent()).includes(original));
     await assertHeadlineSource(originalTitle, 'content-scope');
     await snapshot('content-scope-bilingual');
     await fullToggle();await waitCount(0);assert.equal(await page.locator(selector).first().textContent(),original);
     report.contentScopeCounts=[1,0];
     await persist(context,{translationScope:'all'},11);
     const fullCounts=[];
     for(const expected of [1,0,1]){
       await fullToggle();await waitCount(expected);fullCounts.push(await count());
       if(expected===0)assert.equal(await page.locator(selector).first().textContent(),original);
       else await assertHeadlineSource(originalTitle, 'full-toggle');
     }
     report.fullCounts=fullCounts;
     assert.ok((await page.locator(selector).first().textContent()).includes(original));
     assert.equal(await page.locator('.fluent-read-bilingual-content .fluent-read-bilingual-content').count(),0);
     await snapshot('full-bilingual');
     const markAll=page.locator('button[aria-label^="Mark all "]').first();
     await markAll.scrollIntoViewIfNeeded();
     await page.waitForFunction(original=>document.querySelector('button[aria-label^="Mark all "]')?.textContent !== original,originalMarkAll,{timeout:30000});
     report.ordinaryButton={text:await markAll.textContent(),wrappers:await markAll.locator('.fluent-read-bilingual-content').count()};
     assert.equal(report.ordinaryButton.wrappers,0);
     assert.ok(isControlledTranslationForSource(report.ordinaryButton.text, originalMarkAll), 'ordinary button response source mismatch');
     await page.locator(selector).first().scrollIntoViewIfNeeded();
     report.titleGeometry=await page.locator(selector).first().evaluate(button=>{
       const span=button.querySelector('span[dir]');const translation=span?.querySelector('.fluent-read-bilingual-content');
       const tr=translation?.getBoundingClientRect();const r=span?.getBoundingClientRect();
       return {insideTitleSpan:!!translation,buttonChildren:button.children.length,titleHeight:r?.height,translationHeight:tr?.height,translationTop:tr?.top,titleTop:r?.top};
     });
     assert.equal(report.titleGeometry.insideTitleSpan,true);
     assert.ok(report.titleGeometry.translationTop>report.titleGeometry.titleTop+15,'translation should appear below original title');
     await page.locator(selector).first().click();
     await page.waitForURL(url=>url.pathname!=='/world/latest',{waitUntil:'domcontentloaded'});
     await page.waitForTimeout(1500);
     assert.equal(await count(),1);await assertHeadlineSource(originalTitle, 'native-navigation');
     await snapshot('expanded-translated');
     await page.locator(selector).first().focus();await page.keyboard.press('Enter');
     await page.waitForURL(url=>url.pathname==='/world/latest',{waitUntil:'domcontentloaded'});
     await page.waitForTimeout(1000);assert.equal(await count(),1);await assertHeadlineSource(originalTitle, 'native-navigation');
     await snapshot('keyboard-enter-collapsed');
     await page.locator(selector).first().focus();await page.keyboard.press('Space');
     await page.waitForURL(url=>url.pathname!=='/world/latest',{waitUntil:'domcontentloaded'});
     await page.waitForTimeout(1000);assert.equal(await count(),1);await assertHeadlineSource(originalTitle, 'native-navigation');
     await snapshot('keyboard-space-expanded');
     await page.locator(selector).first().click({position:{x:25,y:12}});await page.waitForURL(url=>url.pathname==='/world/latest',{waitUntil:'domcontentloaded'});
     await page.waitForTimeout(1000);assert.equal(await count(),1);await assertHeadlineSource(originalTitle, 'native-navigation');
     await page.evaluate(html=>{
       const template=document.createElement('template');template.innerHTML=html;
       const article=template.content.firstElementChild;article.id='fr-kagi-dynamic-probe';article.dataset.storyId='fr-probe';
       article.querySelector('button[aria-label="Expand story"] span[dir]').textContent='Dynamic newsroom coverage expands after midnight';
       document.querySelector('article[data-story-id]').after(article);
     },originalArticle);
     await page.locator('#fr-kagi-dynamic-probe').scrollIntoViewIfNeeded();
     await page.waitForFunction(()=>document.querySelector('#fr-kagi-dynamic-probe .fluent-read-bilingual-content'),null,{timeout:30000});
     report.dynamicInsertion={wrappers:await page.locator('#fr-kagi-dynamic-probe button[aria-label="Expand story"] .fluent-read-bilingual-content').count(),scope:'simulated host DOM insertion on live page'};
     assert.equal(report.dynamicInsertion.wrappers,1);
     await assertHeadlineSource('Dynamic newsroom coverage expands after midnight', 'dynamic-insertion', page.locator('#fr-kagi-dynamic-probe button[aria-label="Expand story"]'));
     await snapshot('dynamic-insertion');
     await page.locator(selector).first().scrollIntoViewIfNeeded();
     await persist(context,{display:0},12);await waitCount(0);
     const single=page.locator(selector).first().locator('.fluent-read-single-slot');
     await single.first().waitFor({state:'visible'});
     report.singlePresentation=await single.evaluateAll(hosts=>hosts.map(host=>({label:host.getAttribute('aria-label'),source:host.textContent,closedShadow:host.shadowRoot===null,rect:{width:host.getBoundingClientRect().width,height:host.getBoundingClientRect().height}})));
     assert.ok(report.singlePresentation.every(host=>isControlledTranslationForSource(host.label,host.source)&&host.closedShadow&&host.rect.width>0&&host.rect.height>0));
     const session=await page.context().newCDPSession(page);
     const {root:dom}=await session.send('DOM.getDocument',{depth:-1,pierce:true});
     const singleTexts=[];
     const walk=node=>{if(node.attributes?.includes('fluent-read-single-slot')){
       for(const shadow of node.shadowRoots||[]){const text=[];const visit=n=>{if(['STYLE','SCRIPT'].includes(n.nodeName))return;if(n.nodeType===3)text.push(n.nodeValue);for(const child of n.children||[])visit(child);};visit(shadow);const source=[];const visitSource=n=>{if(n.nodeType===3)source.push(n.nodeValue);for(const child of n.children||[])visitSource(child);};for(const child of node.children||[])visitSource(child);singleTexts.push({type:shadow.shadowRootType,text:text.join(''),source:source.join('')});}
       }for(const child of node.children||[])walk(child);for(const shadow of node.shadowRoots||[])walk(shadow);};walk(dom);await session.detach();
     report.singleShadowEvidence=singleTexts;
     assert.ok(report.singlePresentation.every(host=>singleTexts.some(slot=>slot.type==='closed'&&slot.source===host.source&&slot.text===host.label&&isControlledTranslationForSource(slot.text,slot.source))));
     await snapshot('single-mode');
     assert.equal(await page.locator(selector).first().locator('.fluent-read-bilingual-content').count(),0);
     await persist(context,{display:1},13);await waitCount(1);await assertHeadlineSource(originalTitle, 'bilingual-restored');await snapshot('bilingual-restored');
     await fullToggle();await waitCount(0);assert.equal(await page.locator(selector).first().textContent(),original);
     assert.equal(await page.locator('#fr-kagi-dynamic-probe .fluent-read-bilingual-content').count(),0);
     assert.match(await page.locator('#fr-kagi-dynamic-probe button[aria-label="Expand story"]').textContent(),/Dynamic newsroom/u);
     await page.locator('#fr-kagi-dynamic-probe').evaluate(node=>node.remove());
     const hoverCounts=[];
     for(const expected of [1,0,1,0]){
       await page.locator(selector).first().scrollIntoViewIfNeeded();
       const point=await page.locator(selector).first().evaluate(button=>{
         const span=button.querySelector('span[dir]');const text=[...span.childNodes].find(node=>node.nodeType===3&&node.textContent.trim());
         const range=document.createRange();range.setStart(text,1);range.setEnd(text,Math.min(5,text.length));
         const rect=range.getBoundingClientRect();return{x:rect.x+rect.width/2,y:rect.y+rect.height/2};
       });
       await page.mouse.move(point.x,point.y);await page.waitForTimeout(250);
       await page.keyboard.down('Control');await page.keyboard.up('Control');await waitCount(expected);hoverCounts.push(await count());
       if(expected===1)await assertHeadlineSource(originalTitle, 'hover-toggle');
     }
     report.hoverCounts=hoverCounts;
     await snapshot('hover-restored');
     const category=page.locator('.category-tabs .category-tab').filter({hasText:/^Technology$/u}).filter({visible:true}).first();
     report.category={selected:await category.textContent(),before:page.url()};
     await category.click();await page.waitForURL(url=>!url.pathname.startsWith('/world/'),{waitUntil:'domcontentloaded'});
     await page.locator(selector).first().waitFor({state:'visible'});
     const categoryOriginal=await page.locator(selector).first().textContent();
     const categoryTitle=await page.locator(selector).first().locator('span[dir]').textContent();
     await fullToggle();await waitCount(1);assert.ok((await page.locator(selector).first().textContent()).includes(categoryOriginal));
     await assertHeadlineSource(categoryTitle, 'category-navigation');
     await snapshot('category-bilingual');await fullToggle();await waitCount(0);
     assert.equal(await page.locator(selector).first().textContent(),categoryOriginal);
     report.category={...report.category,after:page.url(),counts:[1,0],restored:true};
     report.provider=await provider.snapshot();
   }
   report.ok=true;
 }catch(error){report.error=error.stack;if(page&&!page.isClosed()){report.clickProbe=await page.evaluate(()=>window.__frKagiClickProbe).catch(()=>null);await snapshot('failure').catch(()=>{});}process.exitCode=1;}
 finally {
   if(launched){report.launchMode=launched.launchMode;report.focusPolicy=launched.focusPolicy;report.windowPlacement=launched.windowPlacement;}
   provider?.dispose();
   try{await launched?.close();report.cleanup='owned-browser-closed';fs.rmSync(profile,{recursive:true,force:true});}catch(error){report.cleanupError=error.stack;process.exitCode=1;}
   fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
   console.log(JSON.stringify({ok:report.ok,error:report.error,contentScopeCounts:report.contentScopeCounts,fullCounts:report.fullCounts,hoverCounts:report.hoverCounts,category:report.category,provider:report.provider,launchMode:report.launchMode,focusPolicy:report.focusPolicy,windowPlacement:report.windowPlacement,cleanup:report.cleanup,report:path.join(output,'report.json')},null,2));
 }
})();
