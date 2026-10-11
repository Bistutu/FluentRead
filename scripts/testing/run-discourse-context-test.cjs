#!/usr/bin/env node
'use strict';
/**
 * @file scripts/testing/run-discourse-context-test.cjs
 * 文件职责：在自有临时 Edge profile 中验证篇章上下文的真实网页请求、翻译、失效与恢复闭环。
 * 主要内容：加载生产扩展和原创长文夹具，使用真实 Control 手势和有界 loopback OpenAI 响应检查后文证据、章节换义、术语保护、正文更新、路由、取消与重译，并保存 prompt、DOM 和截图。
 * 模块边界：仅通过现有配置消息与正常翻译入口访问生产行为；不读取日常浏览器 profile 或密钥，响应是确定性协议夹具，不能作为模型质量结论。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const {createHash} = require('node:crypto');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const execFileAsync = promisify(execFile);
const {guardBrowserClose} = require('./owned-browser-close.cjs');

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : process.argv[index + 1];
}
if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/testing/run-discourse-context-test.cjs --extension-dir PATH --playwright-root PATH --focus-safe-helper PATH --artifacts-dir PATH');
  process.exit(0);
}
for (const name of ['extension-dir', 'playwright-root', 'focus-safe-helper', 'artifacts-dir']) assert.ok(argument(name), `Missing --${name}`);
assert.equal(process.platform, 'darwin', 'The suite requires the macOS focus-safe helper');
assert.ok(!process.argv.includes('--headed'), 'This suite requires background focus isolation');
const extensionDir = path.resolve(argument('extension-dir'));
const artifactsDir = path.resolve(argument('artifacts-dir'));
const helperPath = path.resolve(argument('focus-safe-helper'));
const packages = path.resolve(argument('playwright-root'));
const fixturePath = path.resolve(__dirname, '../../tests/fixtures/discourse-context-long-article.json');
const corpus = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
const sourceRoot = path.resolve(__dirname, '../..');
const sourceFiles = [
  'src/services/translation/context/pageDiscourse.ts',
  'src/services/translation/context/discourse.ts',
  'src/services/translation/context/browser.ts',
  'src/services/translation/context/policy.ts',
  'src/services/translation/broker.ts',
  'src/services/translation/templates.ts',
  'src/services/translation/types.ts',
  'src/app/background/handlers/translation.ts',
  'src/app/translation/client.ts',
  'src/app/content/runtime.ts',
  'src/app/content/pageAvailability.ts',
  'src/platform/shadow-ui/pageBridgeCore.ts',
  'src/features/full-page-translation/content/translationRequest.ts',
  'src/features/full-page-translation/content/requestSession.ts',
  'src/features/full-page-translation/content/runtime.ts',
  'src/features/full-page-translation/content/liveTextTranslation.ts',
  'src/features/full-page-translation/content/orphanArtifacts.ts',
  'tests/fixtures/discourse-context-long-article.json',
  'scripts/testing/run-discourse-context-test.cjs',
  'scripts/testing/focus-safe-browser.cjs',
];
function hashFiles(root, files) {
  return files.map(relative => {
    const bytes = fs.readFileSync(path.join(root, relative));
    return {path:relative,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
  });
}
function productionFiles(directory, prefix = '') {
  return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry => {
    const relative = path.join(prefix,entry.name);
    return entry.isDirectory() ? productionFiles(path.join(directory,entry.name),relative) : [relative];
  }).sort();
}
const artifactBinding = {algorithm:'SHA256',capturedAt:new Date().toISOString(),source:hashFiles(sourceRoot,sourceFiles),production:hashFiles(extensionDir,productionFiles(extensionDir))};
assert.ok(!path.basename(extensionDir).includes('-dev'), 'A production extension is required');
const {chromium} = require(path.join(packages, 'playwright'));
const {launchFocusSafePersistentContext, newPageWithoutForeground, activateExtensionTabWithoutForeground} = require(helperPath);
const requests = [];
let delayMatch = '';
let delayMs = 0;
let activeRequests = 0;
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
function articleMarkup() {
  let section = '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(corpus.title)}</title><style>body{max-width:860px;margin:40px auto;padding:0 28px;font:19px/1.7 system-ui}p{margin:24px 0}h2{margin-top:48px}</style></head><body><main><article id="discourse-fixture"><h1>${escape(corpus.title)}</h1>${corpus.blocks.map(block => {
    const heading = block.section === section ? '' : `<h2>${escape(block.section)}</h2>`;
    section = block.section;
    return `${heading}<p id="${block.id}">${escape(block.source)}</p>`;
  }).join('')}</article></main></body></html>`;
}
const server = http.createServer(async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Headers', '*');
  if (request.method === 'OPTIONS') {response.writeHead(204); response.end(); return;}
  if (request.method === 'POST' && request.url === '/v1/chat/completions') {
    activeRequests += 1;
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const prompt = body.messages.filter(message => message.role === 'user').map(message => message.content).join('\n');
      const summary = !prompt.includes('SOURCE_BEGIN');
      const source = /SOURCE_BEGIN([\s\S]*?)SOURCE_END/u.exec(prompt)?.[1] || '';
      const record = {index: requests.length, summary, source, prompt, promptCharacters: prompt.length, receivedAt: Date.now(), completed:false};
      requests.push(record);
      if (delayMatch && source.includes(delayMatch)) await new Promise(resolve => setTimeout(resolve, delayMs));
      const translated = summary ? 'A control-plane review and a separately authored laboratory note use different local meanings for the same abbreviations.' : `测试译文：${source}`;
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({id:`discourse-${record.index}`,object:'chat.completion',created:1,model:'discourse-fixture',choices:[{index:0,message:{role:'assistant',content:translated},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:30,total_tokens:130}}));
      record.completed = true;
      record.completedAt = Date.now();
    } catch (error) {
      response.writeHead(400); response.end(JSON.stringify({error:{message:error.message}}));
    } finally {activeRequests -= 1;}
    return;
  }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.end(articleMarkup());
});
const timeout = Number(argument('timeout', '30000'));
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-discourse-edge-'));
const report = {ok:false,extensionDir,profileDir,artifactBinding,scope:'Production content lifecycle with authored long-form source and deterministic OpenAI transport',cases:[],screenshots:[],focusChecks:[],consoleErrors:[],requests,limits:['Mock translations validate protocol and lifecycle, not model language quality.','Temporary Edge only; Firefox and live cloud services are outside this suite.']};
let launched;
let page;
let launchAttempted = false;
let primaryError;
const wait = async (predicate, label) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 60));
  }
  throw new Error(`Timed out waiting for ${label}`);
};
async function main() {
  fs.mkdirSync(artifactsDir, {recursive:true});
  try {
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const base = `http://127.0.0.1:${server.address().port}`;
    launchAttempted = true;
    launched = await launchFocusSafePersistentContext({chromium,profileDir,browserPath:argument('browser-path','/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),background:true,headless:false,displayTarget:'secondary',viewport:{width:1280,height:900},timeout,browserArgs:[`--disable-extensions-except=${extensionDir}`,`--load-extension=${extensionDir}`,'--no-first-run','--no-default-browser-check']});
    guardBrowserClose(launched, profileDir);
    Object.assign(report,{launchMode:launched.launchMode,focusPolicy:launched.focusPolicy,windowPlacement:launched.windowPlacement});
    assert.equal(report.launchMode,'macos-background-cdp');
    assert.equal(report.focusPolicy,'launchservices-no-foreground');
    assert.equal(report.windowPlacement.mode,'background-visible-no-focus');
    assert.equal(report.windowPlacement.browserFrontmost,false);
    const context = launched.context;
    const assertFocus = async label => {
      const session = await context.browser().newBrowserCDPSession();
      try {
        const {processInfo} = await session.send('SystemInfo.getProcessInfo');
        const browserPid = processInfo.find(process=>process.type==='browser')?.id;
        const {stdout} = await execFileAsync('/usr/bin/osascript',['-l','JavaScript','-e',"ObjC.import('AppKit'); const app=$.NSWorkspace.sharedWorkspace.frontmostApplication; JSON.stringify({pid:Number(app.processIdentifier)});"],{timeout:5000});
        const frontmost = JSON.parse(stdout.trim());
        assert.ok(Number.isInteger(browserPid)&&Number.isInteger(frontmost?.pid),'Unable to verify foreground isolation');
        assert.notEqual(browserPid,frontmost.pid,`Test browser took foreground focus at ${label}`);
        report.focusChecks.push({label,browserFrontmost:false});
      } finally {await session.detach();}
    };
    const worker = context.serviceWorkers().find(worker=>worker.url().startsWith('chrome-extension://')) || await context.waitForEvent('serviceworker',{timeout});
    const extensionOrigin = `chrome-extension://${new URL(worker.url()).host}`;
    const captureErrors = (target,surface) => {
      target.on('console',message=>{if(message.type()==='error') report.consoleErrors.push({surface,message:message.text()});});
      target.on('pageerror',error=>report.consoleErrors.push({surface,message:error.message}));
    };
    captureErrors(worker,'worker');
    const control = await newPageWithoutForeground(context,timeout);
    captureErrors(control,'options');
    await control.goto(`${extensionOrigin}/${manifest.options_ui?.page || manifest.options_page}`,{waitUntil:'domcontentloaded'});
    await control.locator('.workspace').waitFor({timeout});
    let sequence = 0;
    const patch = async values => control.evaluate(async ({values,sequence})=>{
      const read = await chrome.runtime.sendMessage({type:'configStorageRead',key:'local:config'});
      if(!read?.success) throw new Error(read?.error || 'Unable to read temporary configuration');
      const current = typeof read.value==='string' ? JSON.parse(read.value):read.value;
      const expected = Object.fromEntries(Object.keys(values).map(key=>[key,current[key]]));
      const saved = await chrome.runtime.sendMessage({type:'persistConfig',mode:'patch',config:values,expected,clientId:'discourse-context-browser',sequence});
      if(!saved?.success) throw new Error(saved?.error || 'Unable to save temporary configuration');
    },{values,sequence:++sequence});
    const service = 'custom:discourse-fixture';
    await patch({on:true,service,to:'zh-Hans',from:'en',display:1,hotkey:'Control',uiLanguage:'zh-CN',uiLanguageSetupCompleted:true,enableAIContext:true,enableAIMultiSegment:false,useCache:true,theme:'light',customOpenAIProviders:[{id:service,name:'Discourse Protocol Fixture',endpoint:`${base}/v1`,models:['discourse-fixture']}],model:{[service]:'discourse-fixture'},requireApiKey:{[`v2:${JSON.stringify([service,'discourse-fixture'])}`]:false},user_role:{[service]:'Translate into {{to}}. Return translation only. SOURCE_BEGIN{{origin}}SOURCE_END'}});
    page = await newPageWithoutForeground(context,timeout);
    captureErrors(page,'article');
    await page.goto(`${base}/article`,{waitUntil:'domcontentloaded'});
    await page.locator('#fluent-read-page-styles').waitFor({state:'attached',timeout});
    await activateExtensionTabWithoutForeground(context,page,timeout);
    const tabId = await control.evaluate(async url=>(await chrome.tabs.query({url}))[0]?.id,page.url());
    assert.ok(Number.isInteger(tabId),'Unable to find the isolated article tab');
    const restore = async () => {
      const result = await control.evaluate(id=>chrome.tabs.sendMessage(id,{type:'contextMenuTranslate',action:'restore'}),tabId);
      assert.ok(result?.success !== false,result?.error || 'Restore rejected');
      await wait(async()=>await page.locator('.fluent-read-bilingual-content').count()===0,'all translations restored');
    };
    const hover = async id => {
      const target = page.locator(`#${id}`);
      await target.scrollIntoViewIfNeeded();
      const rectangle = await target.boundingBox();
      assert.ok(rectangle,`Missing paragraph ${id}`);
      const x = rectangle.x+Math.min(rectangle.width-10,75);
      const y = rectangle.y+Math.min(rectangle.height-8,24);
      await page.mouse.move(x,y); await page.mouse.click(x,y);
      await page.keyboard.down('Control'); await page.keyboard.up('Control');
    };
    const translate = async id => {
      const before = requests.length;
      await hover(id);
      await wait(async()=>await page.locator(`#${id} .fluent-read-bilingual-content`).count()===1,`translation ${id}`);
      return requests.slice(before).find(request=>!request.summary);
    };
    const shot = async name => {
      await assertFocus(name);
      const file = path.join(artifactsDir,`${name}.png`);
      await page.screenshot({path:file,animations:'disabled',caret:'initial'});
      report.screenshots.push(file);
    };
    await translate('software-definition');
    await translate('software-rag-definition');
    const late = await translate('software-late-use');
    assert.ok(late,'Late passage must have a real provider request');
    assert.ok(late.prompt.includes('Session Stitching Protocol'),'Late passage context lost its earlier SSP definition');
    assert.ok(late.prompt.includes('Retrieval-Augmented Generation'),'Late passage context lost its earlier RAG definition');
    assert.ok(!late.prompt.includes('Signal Sampling Probe'),'Later chapter must not override the software meaning');
    report.cases.push('Late software passage receives bounded earlier definitions');
    await shot('software-late-use');
    const lab = await translate('lab-late-use');
    assert.ok(lab.prompt.includes('Signal Sampling Probe'),'Lab passage needs the local SSP definition');
    assert.ok(lab.prompt.includes('Red-Amber-Green'),'Lab passage needs the local RAG definition');
    assert.ok(!lab.prompt.includes('Session Stitching Protocol'),'Conflicting SSP meanings must stay in separate chapters');
    report.cases.push('Same abbreviations retain chapter-local meanings');
    await shot('lab-late-use');
    await patch({glossaryEnabled:true,glossaryLibraries:[{id:'discourse-confirmed',name:'Confirmed reading terms',enabled:true,sourceLanguage:'en',targetLanguage:'zh-Hans',domains:[],entries:[{id:'sable',source:'Sable',target:'赛布尔',caseSensitive:true},{id:'generation-fence',source:'generation fence',target:'代际隔离栅栏',caseSensitive:false}]}]});
    await translate('software-pronoun');
    const confirmedText = await page.locator('#software-pronoun .fluent-read-bilingual-content').innerText();
    assert.ok(confirmedText.includes('赛布尔') && confirmedText.includes('代际隔离栅栏'),'Confirmed user terms must be restored after protected transport');
    report.cases.push('User-confirmed terms outrank automatic references');
    await restore();
    await page.evaluate(()=>{document.querySelector('#software-definition').textContent='In the revised software chapter, SSP means Source Snapshot Protocol. This definition replaces the earlier name.';});
    const changed = await translate('software-late-use');
    assert.ok(changed.prompt.includes('Source Snapshot Protocol'),'A source update must rebuild the definition evidence');
    assert.ok(!changed.prompt.includes('Session Stitching Protocol'),'Updated source must evict stale definition evidence');
    report.cases.push('Dynamic source replacement invalidates earlier evidence');
    await restore();
    delayMatch = 'He asked for another run'; delayMs = 1400;
    await hover('ambiguity-late-use');
    await wait(()=>requests.some(request=>request.source.includes(delayMatch)&&!request.completed),'delayed request in flight');
    await restore();
    await wait(()=>activeRequests===0,'canceled response settles');
    assert.equal(await page.locator('#ambiguity-late-use .fluent-read-bilingual-content').count(),0,'Canceled late result must not publish');
    delayMatch='';delayMs=0;
    await translate('ambiguity-late-use');
    report.cases.push('Cancel rejects late output and retry remains usable');
    await restore();
    await page.evaluate(()=>{history.pushState({},'','/different-article');document.title='A different article';document.querySelector('#discourse-fixture').innerHTML='<h1>A different article</h1><h2>Independent chapter</h2><p id="other-definition">Here SSP means Solar Sensor Package. It is not the software method.</p><p id="other-use">SSP measured the daylight during this independent experiment.</p>';});
    const other = await translate('other-use');
    assert.ok(other.prompt.includes('Solar Sensor Package'),'A changed article must use its own definition');
    assert.ok(!other.prompt.includes('Source Snapshot Protocol')&&!other.prompt.includes('Session Stitching Protocol')&&!other.prompt.includes('Signal Sampling Probe'),'A new article must not inherit earlier knowledge');
    report.cases.push('SPA route and article replacement isolate material identity');
    await shot('different-article');
    await restore();
    await translate('other-use');
    assert.equal(await page.locator('#other-use .fluent-read-bilingual-content').count(),1);
    report.cases.push('Restore and retranslate produce one current translation');
    await restore();
    report.wrapperDom = await page.evaluate(()=>{
      history.pushState({},'','/wrapped-late-chapter');
      document.title='A late chapter with wrapped paragraphs';
      const wrap=(text,id='')=>`<div><div><div><p${id?` id="${id}"`:''}>${text}</p></div></div></div>`;
      const article=document.querySelector('#discourse-fixture');
      article.innerHTML='<h1>A late chapter with wrapped paragraphs</h1><h2>Opening</h2>'
        +Array.from({length:90},(_,index)=>wrap(`Background paragraph ${index}.`)).join('')
        +'<h2>Laboratory</h2>'+wrap('AP means action potential.','wrapped-definition')
        +wrap('AP regulates readings.','wrapped-use');
      const definition=document.querySelector('#wrapped-definition');
      const use=document.querySelector('#wrapped-use');
      const parentTags=[];
      for(let current=use.parentElement;current&&current!==article;current=current.parentElement) parentTags.push(current.tagName);
      return {backgroundBlocks:90,parentTags,definitionBeforeUse:definition.compareDocumentPosition(use),useAfterDefinition:use.compareDocumentPosition(definition)};
    });
    assert.deepEqual(report.wrapperDom.parentTags,['DIV','DIV','DIV']);
    assert.equal(report.wrapperDom.definitionBeforeUse,4,'Real DOM must place the definition before the later wrapped paragraph');
    assert.equal(report.wrapperDom.useAfterDefinition,2,'Real DOM must place the later wrapped paragraph after the definition');
    await translate('wrapped-definition');
    const wrapped=await translate('wrapped-use');
    assert.ok(wrapped,'Wrapped later paragraph must have a real provider request');
    const wrappedJson=/<discourse_evidence>\s*([\s\S]*?)\s*<\/discourse_evidence>/u.exec(wrapped.prompt)?.[1];
    assert.ok(wrappedJson,'Wrapped later paragraph lost its discourse reference');
    const wrappedReference=JSON.parse(wrappedJson);
    assert.ok(wrappedReference.evidence.some(item=>item.kind==='definition'&&item.source==='AP means action potential.'),'Wrapped paragraph lost the adjacent source definition');
    assert.ok(wrappedReference.evidence.some(item=>item.kind==='previous_machine'&&item.source==='AP means action potential.'&&item.translation==='测试译文：AP means action potential.'),'Wrapped paragraph lost the verified earlier machine wording');
    assert.ok(wrappedJson.length<=2400,'Wrapped reference exceeded its character budget');
    report.wrapperEvidence={referenceCharacters:wrappedJson.length,section:wrappedReference.section,evidence:wrappedReference.evidence};
    report.cases.push('After 90 blocks, three nested wrappers preserve adjacent definitions and previous machine wording');
    await page.locator('#wrapped-use').evaluate(element=>element.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'}));
    await shot('wrapped-late-use');
    await restore();
    await page.evaluate(()=>{
      window.__discourseNativeAnchorEvents=[];
      document.addEventListener('fluentread-route-change',()=>window.__discourseNativeAnchorEvents.push({href:location.href,at:Date.now()}));
      history.pushState({},'','/ordinary-anchor-material');
      document.title='Ordinary reading anchors';
      document.querySelector('#discourse-fixture').innerHTML='<h1>Ordinary reading anchors</h1><h2>People</h2>'
        +'<a id="ordinary-anchor-link" href="#anchor-use">Read the next passage</a> '
        +'<a id="pending-anchor-link" href="#anchor-next">Read the final passage</a>'
        +'<p id="anchor-person">Aurora is the lead scientist.</p>'
        +'<p id="anchor-use">Aurora returned to the laboratory.</p>'
        +'<p id="anchor-delay">Aurora checked the apparatus.</p>'
        +'<p id="anchor-next">Aurora continued the reading.</p>';
    });
    await translate('anchor-person');
    const beforeAnchorUrl=page.url();
    await page.locator('#ordinary-anchor-link').click();
    await wait(()=>page.url().endsWith('#anchor-use'),'ordinary native anchor navigation');
    await wait(()=>page.evaluate(()=>window.__discourseNativeAnchorEvents.some(event=>event.href.endsWith('#anchor-use'))),'production ordinary-anchor route event');
    const anchorUse=await translate('anchor-use');
    const referenceFor=request=>{
      const json=/<discourse_evidence>\s*([\s\S]*?)\s*<\/discourse_evidence>/u.exec(request.prompt)?.[1];
      assert.ok(json,'Anchor passage lost its discourse reference');
      assert.ok(json.length<=2400,'Anchor reference exceeded its character budget');
      return {characters:json.length,...JSON.parse(json)};
    };
    const anchorReference=referenceFor(anchorUse);
    assert.ok(anchorReference.evidence.some(item=>item.kind==='previous_machine'&&item.source==='Aurora is the lead scientist.'&&item.translation==='测试译文：Aurora is the lead scientist.'),'Ordinary anchor jump discarded previously committed person wording');
    delayMatch='Aurora checked the apparatus.';delayMs=1400;
    const delayedIndex=requests.length;
    await hover('anchor-delay');
    await wait(()=>requests.slice(delayedIndex).some(request=>!request.summary&&request.source===delayMatch&&!request.completed),'anchor delayed translation in flight');
    const pendingBeforeAnchorUrl=page.url();
    await page.locator('#pending-anchor-link').click();
    await wait(()=>page.url().endsWith('#anchor-next'),'ordinary anchor navigation during translation');
    await wait(()=>page.evaluate(()=>window.__discourseNativeAnchorEvents.some(event=>event.href.endsWith('#anchor-next'))),'production pending-anchor route event');
    await wait(async()=>await page.locator('#anchor-delay .fluent-read-bilingual-content').count()===1,'in-flight result publishes after ordinary anchor');
    delayMatch='';delayMs=0;
    const anchorNext=await translate('anchor-next');
    const nextReference=referenceFor(anchorNext);
    assert.ok(nextReference.evidence.some(item=>item.kind==='previous_machine'&&item.source==='Aurora checked the apparatus.'&&item.translation==='测试译文：Aurora checked the apparatus.'),'Ordinary anchor jump prevented late result from becoming later evidence');
    report.anchorEvidence={navigation:'Native href link clicks; production route events observed without manual dispatch',beforeAnchorUrl,afterAnchorUrl:pendingBeforeAnchorUrl,pendingBeforeAnchorUrl,pendingAfterAnchorUrl:page.url(),routeEvents:await page.evaluate(()=>window.__discourseNativeAnchorEvents),committedPersonReference:anchorReference,inFlightResultReference:nextReference};
    report.cases.push('Native ordinary anchor jumps preserve person wording and pending-result evidence');
    await page.locator('#anchor-next').evaluate(element=>element.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'}));
    await shot('ordinary-anchor-use');
    const pageContexts = requests.filter(request=>!request.summary).map(request=>/<webpage_context>([\s\S]*?)<\/webpage_context>/u.exec(request.prompt)?.[1] || '');
    report.contextCharacters = pageContexts.map(context=>context.length);
    report.translationRequests = requests.filter(request=>!request.summary).length;
    report.summaryRequests = requests.filter(request=>request.summary).length;
    report.maxContextCharacters = Math.max(...report.contextCharacters);
    // 4,000 字符生产参考块加固定边界说明；此断言覆盖实际发往模型的请求而非内部常量。
    assert.ok(report.maxContextCharacters<=4300,`Context budget exceeded: ${report.maxContextCharacters}`);
    report.dom = await page.content();
    await assertFocus('suite-complete');
    assert.deepEqual(hashFiles(sourceRoot,sourceFiles),artifactBinding.source,'Source files changed during the acceptance run');
    assert.deepEqual(hashFiles(extensionDir,productionFiles(extensionDir)),artifactBinding.production,'Production files changed during the acceptance run');
    report.completedAt=new Date().toISOString();
    report.ok=true;
  } catch (error) {
    primaryError=error;report.failure=error.message;
    if(page&&!page.isClosed()) await page.screenshot({path:path.join(artifactsDir,'failure.png'),caret:'initial'}).catch(()=>{});
    throw error;
  } finally {
    const cleanupErrors=[];
    let browserClosed=false;
    if(launched) await launched.close().then(()=>{browserClosed=true;}).catch(error=>cleanupErrors.push(error));
    if(server.listening) await new Promise(resolve=>server.close(resolve));
    if(browserClosed) fs.rmSync(profileDir,{recursive:true,force:true});
    else if(!launchAttempted) fs.rmdirSync(profileDir);
    if(cleanupErrors.length) {report.ok=false;report.cleanupErrors=cleanupErrors.map(error=>error.message);}
    fs.writeFileSync(path.join(artifactsDir,'report.json'),JSON.stringify(report,null,2));
    if(report.dom) fs.writeFileSync(path.join(artifactsDir,'final.html'),report.dom);
    if(!primaryError&&cleanupErrors.length) throw cleanupErrors[0];
  }
  console.log(JSON.stringify({ok:report.ok,cases:report.cases,summaryRequests:report.summaryRequests,translationRequests:report.translationRequests,maxContextCharacters:report.maxContextCharacters,artifactsDir},null,2));
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
