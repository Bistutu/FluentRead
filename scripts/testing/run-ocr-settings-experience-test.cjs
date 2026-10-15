'use strict';
/** OCR 设置专项：真实生产扩展、语言包下载与后台队列，验证设置同步和响应式展示。 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const arg = (name, fallback) => {const i = process.argv.indexOf(`--${name}`); return i < 0 ? fallback : process.argv[i + 1];};
const extensionDir = path.resolve(arg('extension-dir', '.output/chrome-mv3'));
const artifacts = path.resolve(arg('artifacts-dir', '/private/tmp/fluentread-ocr-settings-experience'));
const {chromium} = require(path.join(arg('playwright-root'), 'playwright'));
const {launchFocusSafePersistentContext, newPageWithoutForeground} = require(arg('focus-safe-helper'));
const profileDir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'fluentread-ocr-settings-'));
const identity = fs.lstatSync(profileDir), owner = crypto.randomUUID();
fs.writeFileSync(path.join(profileDir, '.owner'), owner, {flag:'wx'});
fs.mkdirSync(artifacts, {recursive:true});
const report = {scope:'production extension OCR settings, real language download and cache removal; real background queue observation',cases:[],screenshots:[],errors:[],requests:[],metrics:[]};
let launched, page, worker, extensionId, currentCase = 'launch';
async function newSettings(section = 'settings-image-translation') {
  const next = await newPageWithoutForeground(launched.context, 30000);
  next.on('pageerror', e => report.errors.push(e.message));
  await next.goto(`chrome-extension://${extensionId}/options.html#${section}`);
  if (section === 'settings-area-translation') {
    const details = next.locator('.area-ocr-details');
    await details.waitFor();
    if (!(await details.evaluate(element => element.open))) await details.locator('summary').click();
  }
  await next.locator('.image-ocr-count').waitFor();
  return next;
}
async function patch(values) {
  await page.evaluate(async values => {
    const {value: current} = await chrome.runtime.sendMessage({type:'configStorageRead',key:'local:config'});
    const response = await chrome.runtime.sendMessage({type:'persistConfig',mode:'patch',config:values,expected:Object.fromEntries(Object.keys(values).map(k=>[k,current[k]])),clientId:'ocr-settings-test',sequence:Date.now(),baseRevision:current.__fluentConfigRevision||0});
    if (!response.success) throw new Error(response.error);
  }, values);
}
async function waitState(code, state) {
  await page.locator(`[data-language="${code}"][data-state="${state}"]`).waitFor({timeout:180000});
}
async function shot(name) {
  await page.locator('.image-ocr-section').scrollIntoViewIfNeeded();
  const target=path.join(artifacts,`${name}.png`);
  await page.locator('.image-ocr-section').screenshot({path:target}); report.screenshots.push(target);
  report.metrics.push(await page.locator('.image-ocr-section').evaluate(element => ({width:innerWidth,sectionWidth:element.getBoundingClientRect().width,sectionHeight:element.getBoundingClientRect().height,overflow:element.scrollWidth>element.clientWidth,rows:[...element.querySelectorAll('.image-ocr-pack-card')].map(row=>row.getBoundingClientRect().height)})));
}
(async()=>{
  launched=await launchFocusSafePersistentContext({chromium,profileDir,browserPath:arg('browser-path','/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),headless:false,background:true,browserArgs:[`--disable-extensions-except=${extensionDir}`,`--load-extension=${extensionDir}`,'--no-first-run','--no-default-browser-check'],viewport:{width:1360,height:1050},timeout:30000});
  Object.assign(report,{launchMode:launched.launchMode,focusPolicy:launched.focusPolicy,windowPlacement:launched.windowPlacement});
  assert.equal(report.windowPlacement.browserFrontmost,false);
  worker=launched.context.serviceWorkers().find(w=>w.url().startsWith('chrome-extension://'))||await launched.context.waitForEvent('serviceworker');
  extensionId=new URL(worker.url()).host;
  const manifest=await worker.evaluate(()=>chrome.runtime.getManifest());
  report.manifest={version:manifest.version,popup:manifest.action.default_popup,options:manifest.options_page||manifest.options_ui?.page};

  page=await newSettings();
  currentCase='compact source-aware language list';
  await shot('00-auto-languages');
  await patch({theme:'light',uiLanguage:'zh-CN'});
  await page.locator('.image-ocr-source select').selectOption('fr');
  await page.waitForFunction(()=>document.querySelector('.image-ocr-summary p')?.textContent.includes('Français'));
  assert.equal(await page.locator('.image-ocr-pack-card').count(),2);
  await page.locator('.image-ocr-more').click();
  assert.equal(await page.locator('.image-ocr-pack-card').count(),8);
  await page.locator('.image-ocr-more').click();
  assert.equal(await page.locator('.image-ocr-required').count(),2);
  await shot('01-language-manager-light');report.cases.push(currentCase);
  currentCase='real background download, visible queue and close-reopen';
  await page.locator('.image-ocr-primary-action').click();
  await waitState('fra','downloading');await waitState('eng','queued');
  await shot('02-downloading-and-queued');
  const original=page;
  await original.close();
  page=await newSettings('settings-area-translation');
  await waitState('fra','ready');await waitState('eng','ready');
  assert.match(await page.locator('.image-ocr-count').innerText(),/2 个已下载/);
  await shot('03-ready-after-reopen');
  report.cases.push(currentCase);
  currentCase='shared state across image and area settings';
  const area=page;
  page=await newSettings();
  await waitState('fra','ready');await waitState('eng','ready');
  assert.equal(await page.locator('.image-ocr-source select').inputValue(),'fr');
  report.cases.push(currentCase);
  currentCase='persisted source language is reflected in the popup';
  const popup=await newPageWithoutForeground(launched.context,30000);
  popup.on('pageerror',e=>report.errors.push(e.message));
  await popup.goto(`chrome-extension://${extensionId}/${report.manifest.popup}`);
  await popup.locator('[data-testid="onboarding-language-step"]').waitFor();
  await popup.locator('.onboarding-language-option[data-language="zh-CN"]').click();
  await popup.locator('.onboarding-form .onboarding-confirm').click();
  await popup.locator('.language-pair > label').first().filter({hasText:/法语|Français/}).waitFor();
  const popupShot=path.join(artifacts,'07-popup-source-persisted.png');
  await popup.screenshot({path:popupShot});report.screenshots.push(popupShot);
  await popup.close();report.cases.push(currentCase);
  currentCase='remove one package and update the other settings page';
  await page.locator('[data-language="fra"] .image-ocr-remove').click();
  await waitState('fra','available');
  await area.locator('[data-language="fra"][data-state="available"]').waitFor({timeout:10000});
  await waitState('eng','ready');report.cases.push(currentCase);
  currentCase='dark theme and 390px layout';
  await patch({theme:'dark'});await page.waitForTimeout(200);
  await shot('04-language-manager-dark');
  await page.setViewportSize({width:390,height:900});await page.waitForTimeout(200);
  await shot('05-language-manager-narrow');
  assert.ok(report.metrics.every(m=>!m.overflow));
  assert.ok(report.metrics[0].rows.every(height=>height<=68));
  report.cases.push(currentCase);
  currentCase='English interface';
  await page.setViewportSize({width:1360,height:1050});
  await patch({uiLanguage:'en-US'});
  await page.locator('.image-ocr-heading h2').filter({hasText:'Local recognition languages'}).waitFor();
  await shot('06-language-manager-english');report.cases.push(currentCase);
  assert.deepEqual(report.errors,[]);report.success=true;
})().catch(async error=>{report.success=false;report.failure={case:currentCase,error:error.stack};process.exitCode=1;if(page&&!page.isClosed())await page.screenshot({path:path.join(artifacts,'failure.png')}).catch(()=>{});}).finally(async()=>{
  let closed=false;
  try{if(launched){await launched.close();closed=true;}}catch(e){report.cleanupError=e.message;process.exitCode=1;}
  if(closed){const stat=fs.lstatSync(profileDir);assert.ok(!stat.isSymbolicLink()&&stat.ino===identity.ino&&stat.dev===identity.dev);assert.equal(fs.readFileSync(path.join(profileDir,'.owner'),'utf8'),owner);fs.rmSync(profileDir,{recursive:true});report.profileRemoved=true;}
  else report.retainedProfile=profileDir;
  fs.writeFileSync(path.join(artifacts,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
});
