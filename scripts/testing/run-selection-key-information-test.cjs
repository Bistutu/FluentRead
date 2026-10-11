#!/usr/bin/env node
'use strict';

// Targeted production-card evidence. This creates one owned, background Edge
// page and uses deterministic local translation/learning responses. It never
// connects to a user's browser or asserts live provider/audio quality.
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {createRequire} = require('node:module');
const support = require('../run-selection-trigger-test.cjs');
const {guardBrowserClose, getGuardedBrowserPid} = require('./owned-browser-close.cjs');
const execFileAsync = promisify(execFile);

const SOURCE = [
    'Different printing sequences lead to different filament switching sequences.',
    'Before a new layer begins, the printer checks which material is needed for every part.',
    'A small change in the order can reduce the amount of material that must be flushed.',
    'The operator still needs to inspect the first layer carefully and confirm that it adheres.',
    'A useful plan keeps the important settings visible while detailed explanations remain available.',
    'When the original passage is long, readers should see the translated meaning immediately.',
    'They can then compare each sentence with the unchanged source at their own pace.',
    'The same reading card should keep its chosen position as new information arrives.',
    'Controls should remain readable when the card is made narrower on a small display.',
    'Moving the card should follow the pointer smoothly without changing the surrounding page.',
].join(' ');
const TRANSLATION = '不同的打印顺序会改变耗材切换顺序。先确认关键设置，再按需查看完整原文。';
const ANSWER = '### 读懂\n\n打印顺序会影响耗材切换。关键设置和译文应先显示，完整原文仍可随时查看。\n\n' +
    '手动选择的卡片位置和尺寸应在流式解释期间保持稳定。 '.repeat(18);
const SHORT_SOURCE = 'A curious reader explores new ideas.';
const SHORT_ANSWER = '### 读懂\n\n这位读者好奇地探索新想法。';
const FIXTURE_URL = 'https://example.com/fluentread-selection-key-information';
const DRAG_TARGET = '.fr-study-navigation';
const TOOLBAR_LABELS = {
    'zh-CN':['翻译','读懂','词性与句法','用法','练习','记录'],
    'en-US':['Translation','Understand','Parts of speech & syntax','Usage','Practice','History'],
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (condition, message) => {if (!condition) throw new Error(message);};
const classNode = cls => node => support.hasCdpClass(node, cls);

function argumentsFor(argv) {
    const arg = (name, fallback) => {
        const index = argv.indexOf(`--${name}`);
        return index < 0 ? fallback : argv[index + 1];
    };
    const phase = arg('phase', 'optimized');
    assert(['baseline', 'optimized'].includes(phase), '--phase must be baseline or optimized');
    const runtime = arg('playwright-root', process.env.PLAYWRIGHT_ROOT);
    assert(runtime, 'Pass --playwright-root or set PLAYWRIGHT_ROOT');
    const result = {
        phase, blankSpace:argv.includes('--blank-space'), playwrightRoot: path.resolve(runtime), englishFirst:argv.includes('--english-first'),
        extensionDir: path.resolve(arg('extension-dir', '.output/chrome-mv3')),
        artifactsDir: path.resolve(arg('artifacts-dir', path.join(os.tmpdir(), `fluentread-selection-key-information-${phase}`))),
        focusSafeHelper: path.resolve(arg('focus-safe-helper', path.join(__dirname, 'focus-safe-browser.cjs'))),
        browserPath: arg('browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
        displayTarget: arg('display', 'secondary'),
    };
    assert(fs.existsSync(path.join(result.extensionDir, 'manifest.json')), 'Extension manifest is missing');
    assert(fs.existsSync(result.browserPath), 'Edge executable is missing');
    return result;
}

function fixtureHtml(source = SOURCE) {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Selection card fixture</title>
<style>html{color-scheme:light}body{margin:20px;font:13px/1.65 system-ui;color:#263248;background:#fff}
#fixture{max-width:1120px}#target{margin:0 0 16px}#neighbor{margin:0 0 16px}#spacer{height:1800px}</style></head>
<body><main id="fixture"><p id="target">${source}</p><p id="neighbor">This paragraph and the selected original must remain unchanged.</p><div id="spacer"></div></main></body></html>`;
}

async function poll(predicate, message, timeout = 12000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        if (await predicate()) return;
        await sleep(80);
    }
    throw new Error(message);
}

async function ui(page, fn, argument) {
    const state = await support.getSelectionUiTree(page);
    const card = support.findCdpNode(state.root, classNode('fr-translation-tooltip'));
    assert(card, 'Selection card is missing');
    const {object} = await state.session.send('DOM.resolveNode', {nodeId: card.nodeId});
    try {
        const result = await state.session.send('Runtime.callFunctionOn', {
            objectId: object.objectId, functionDeclaration: fn.toString(),
            arguments: [{value: argument}], returnByValue: true, awaitPromise: true,
        });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ': ' + (result.exceptionDetails.exception?.description || ''));
        return result.result.value;
    } finally {
        await state.session.send('Runtime.releaseObject', {objectId: object.objectId});
    }
}

async function hostState(page) {
    return page.evaluate(() => {
        const box = element => {
            const r = element.getBoundingClientRect();
            return {left:r.left, top:r.top, width:r.width, height:r.height};
        };
        return {html:document.querySelector('#fixture').outerHTML, text:document.querySelector('#target').textContent,
            target:box(document.querySelector('#target')), neighbor:box(document.querySelector('#neighbor')),
            scrollX, scrollY, language:document.documentElement.lang};
    });
}

function hostUnchanged(before, after) {
    return before.html === after.html && before.text === after.text && before.language === after.language &&
        before.scrollX === after.scrollX && before.scrollY === after.scrollY &&
        ['target','neighbor'].every(node => ['left','top','width','height'].every(key => Math.abs(before[node][key] - after[node][key]) < .5));
}

async function layout(page) {
    return ui(page, function() {
        const rect = element => {
            if (!element) return null;
            const r = element.getBoundingClientRect();
            return {left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height};
        };
        const card = rect(this), toolbarElement = this.querySelector('.fr-study-toolbar'), toolbar = rect(toolbarElement);
        const contentElement = [...this.querySelectorAll('.fr-tooltip-content')].find(element => getComputedStyle(element).display !== 'none');
        const content = rect(contentElement), original = this.querySelector('.fr-original-text pre');
        const translated = this.querySelector('.fr-translation-result pre');
        let firstLine = null;
        if (translated?.firstChild) {
            const walker = document.createTreeWalker(translated, NodeFilter.SHOW_TEXT);
            const range = document.createRange(), textRects = [];
            // Vue fragment anchors can be empty text nodes before the actual
            // SpeechFollowText words. Read every nonempty text node rather than
            // mistaking its first one-character Han token for a complete line.
            for (let text = walker.nextNode(); text; text = walker.nextNode()) {
                if (!text.textContent.trim()) continue;
                range.selectNodeContents(text);
                for (const r of range.getClientRects()) {
                    if (r.width > 0 && r.height > 0) textRects.push({left:r.left,top:r.top,right:r.right,bottom:r.bottom});
                }
            }
            const first = textRects.sort((a,b) => a.top - b.top || a.left - b.left)[0];
            if (first) {
                const row = textRects.filter(r => Math.abs(r.top - first.top) <= 1 && Math.abs(r.bottom - first.bottom) <= 1);
                const left = Math.min(...row.map(r => r.left)), right = Math.max(...row.map(r => r.right));
                const top = Math.min(...row.map(r => r.top)), bottom = Math.max(...row.map(r => r.bottom));
                firstLine = {left,top,right,bottom,width:right-left,height:bottom-top};
            }
        }
        const keyVisibleHeight = firstLine && content ? Math.max(0, Math.min(firstLine.bottom, content.bottom, card.bottom, innerHeight) - Math.max(firstLine.top, content.top, card.top, 0)) : 0;
        const keyVisibleWidth = firstLine && content ? Math.max(0, Math.min(firstLine.right, content.right, card.right, innerWidth) - Math.max(firstLine.left, content.left, card.left, 0)) : 0;
        const focused = this.getRootNode().activeElement;
        const buttons = [...toolbarElement.querySelectorAll('button')].map(button => {
            const r = rect(button);
            return {label:button.textContent.trim(), title:button.title, rect:r, focused:focused === button,
                clipped:button.scrollWidth > button.clientWidth + 1,
                inToolbar:r.left >= toolbar.left - 1 && r.right <= toolbar.right + 1 && r.top >= toolbar.top - 1 && r.bottom <= toolbar.bottom + 1};
        });
        return {card, toolbar, content, firstLine, keyVisibleHeight, keyVisibleWidth,
            originalText:original?.textContent || '', translationText:translated?.textContent || '',
            originalCopies:this.querySelectorAll('.fr-original-text pre').length,
            toolbarRows:new Set(buttons.map(button => Math.round(button.rect.top))).size,
            toolbarScrollLeft:toolbarElement.scrollLeft, toolbarScrollWidth:toolbarElement.scrollWidth,
            toolbarClientWidth:toolbarElement.clientWidth, contentScrollTop:contentElement?.scrollTop, buttons,
            dark:this.classList.contains('fr-dark-theme'), viewport:{width:innerWidth,height:innerHeight}};
    });
}

async function readingBodyLayout(page) {
    return ui(page, function() {
        const rect = element => {
            if (!element) return null;
            const r = element.getBoundingClientRect();
            return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};
        };
        const result = this.querySelector('.fr-reading-result');
        const answer = this.querySelector('.fr-reading-answer');
        const markdown = answer?.querySelector('.fr-reading-markdown');
        // Direct Markdown paragraph blocks are answer prose. Source paragraphs,
        // headings and follow-up controls cannot satisfy the body assertion.
        const paragraphs = markdown ? [...markdown.children].filter(element => element.tagName === 'P') : [];
        const paragraph = paragraphs.find(element => element.textContent.trim());
        let firstBodyLine = null;
        if (paragraph) {
            const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
            const range = document.createRange(), textRects = [];
            for (let text = walker.nextNode(); text; text = walker.nextNode()) {
                if (!text.textContent.trim()) continue;
                range.selectNodeContents(text);
                for (const r of range.getClientRects()) {
                    if (r.width > 0 && r.height > 0) textRects.push({left:r.left,top:r.top,right:r.right,bottom:r.bottom});
                }
            }
            const first = textRects.sort((a,b) => a.top - b.top || a.left - b.left)[0];
            if (first) {
                const row = textRects.filter(r => Math.abs(r.top - first.top) <= 1 && Math.abs(r.bottom - first.bottom) <= 1);
                const left = Math.min(...row.map(r => r.left)), right = Math.max(...row.map(r => r.right));
                const top = Math.min(...row.map(r => r.top)), bottom = Math.max(...row.map(r => r.bottom));
                firstBodyLine = {left,top,right,bottom,width:right-left,height:bottom-top};
            }
        }
        const card = rect(this), resultRect = rect(result), content = rect(this.querySelector('.fr-reading-content'));
        let resultViewport = null;
        if (resultRect && content) {
            const left = Math.max(resultRect.left,content.left,card.left,0), right = Math.min(resultRect.right,content.right,card.right,innerWidth);
            const top = Math.max(resultRect.top,content.top,card.top,0), bottom = Math.min(resultRect.bottom,content.bottom,card.bottom,innerHeight);
            resultViewport = {left,top,right,bottom,width:Math.max(0,right-left),height:Math.max(0,bottom-top)};
        }
        const visibleBodyWidth = firstBodyLine && resultViewport ? Math.max(0,Math.min(firstBodyLine.right,resultViewport.right)-Math.max(firstBodyLine.left,resultViewport.left)) : 0;
        const visibleBodyHeight = firstBodyLine && resultViewport ? Math.max(0,Math.min(firstBodyLine.bottom,resultViewport.bottom)-Math.max(firstBodyLine.top,resultViewport.top)) : 0;
        return {card,resultRect,resultViewport,firstBodyLine,visibleBodyWidth,visibleBodyHeight,
            paragraphTag:paragraph?.tagName || null, firstParagraphText:paragraph?.textContent || '',
            bodyParagraphs:paragraphs.map(element => element.textContent), fullAnswerText:markdown?.textContent || '',
            headings:markdown ? [...markdown.querySelectorAll('h1,h2,h3,h4,h5,h6')].map(element => element.textContent) : [],
            busy:answer?.getAttribute('aria-busy'), resultScrollTop:result?.scrollTop,
            resultClientHeight:result?.clientHeight, resultScrollHeight:result?.scrollHeight,
            status:this.querySelector('.fr-reading-status')?.textContent || ''};
    });
}

async function blankSpaceLayout(page) {
    return ui(page, function() {
        const box = element => {if (!element) return null; const r=element.getBoundingClientRect(); return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
        const content=[...this.querySelectorAll('.fr-tooltip-content')].find(element=>getComputedStyle(element).display!=='none');
        const status=this.querySelector('.fr-playing-status'), source=this.querySelector('.fr-reading-source');
        const form=this.querySelector('.fr-reading-result .fr-reading-followup'), result=this.querySelector('.fr-reading-result');
        const card=box(this), visible=box(content), followup=box(form);
        return {card,content:visible,status:box(status),statusDisplay:status?getComputedStyle(status).display:null,
            statusText:status?.textContent.trim()||'',preparing:status?.getAttribute('aria-busy')==='true',
            idleBottomSpace:Math.max(0,card.bottom-1-visible.bottom),
            spareAfterFollowup:followup?Math.max(0,visible.bottom-followup.bottom):null,
            sourceVisible:!!source&&getComputedStyle(source).display!=='none',sourceText:source?.querySelector('p')?.textContent||'',
            result:box(result),resultClientHeight:result?.clientHeight,resultScrollHeight:result?.scrollHeight,
            hasReturn:!!this.querySelector('.fr-reading-source button'),scrollTop:result?.scrollTop};
    });
}

function silentWav() {
    const bytes=24000*10*2, buffer=Buffer.alloc(44+bytes);
    buffer.write('RIFF',0); buffer.writeUInt32LE(36+bytes,4); buffer.write('WAVEfmt ',8); buffer.writeUInt32LE(16,16);
    buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(1,22);buffer.writeUInt32LE(24000,24);buffer.writeUInt32LE(48000,28);
    buffer.writeUInt16LE(2,32);buffer.writeUInt16LE(16,34);buffer.write('data',36);buffer.writeUInt32LE(bytes,40);return buffer;
}

async function clickUi(page, selector) {
    const point=await ui(page,function(selector){const element=this.querySelector(selector);if(!element)throw new Error('Missing '+selector);element.scrollIntoView({block:'nearest'});const r=element.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};},selector);
    await page.mouse.click(point.x,point.y);
}

async function pointFor(page, selector) {
    return ui(page, function(selector) {
        const element = this.querySelector(selector);
        if (!element) throw new Error(`Missing gesture target ${selector}`);
        const r = element.getBoundingClientRect();
        const point = {x: selector === '.fr-study-navigation' ? r.left + 7 * (r.width / element.offsetWidth) : r.left + r.width / 2, y:r.top + r.height / 2};
        if (selector === '.fr-study-navigation') {
            const hit = this.getRootNode().elementFromPoint(point.x,point.y);
            if (!hit || !hit.closest('.fr-study-navigation') || hit.closest('button,a,input,textarea,select,[contenteditable]')) {
                throw new Error('Drag point does not hit noninteractive navigation padding');
            }
            if (hit !== element && !element.contains(hit)) throw new Error('Drag navigation is obscured');
        }
        return point;
    }, selector);
}

async function trustedGesture(page, selector, dx, dy, moves = 12, burst = false) {
    const {session} = await support.getSelectionUiTree(page);
    const point = await pointFor(page, selector);
    await session.send('Input.dispatchMouseEvent', {type:'mouseMoved', x:point.x, y:point.y, button:'none', buttons:0});
    await session.send('Input.dispatchMouseEvent', {type:'mousePressed', x:point.x, y:point.y, button:'left', buttons:1, clickCount:1});
    const dispatch = index => session.send('Input.dispatchMouseEvent', {type:'mouseMoved',
        x:point.x + dx * index / moves, y:point.y + dy * index / moves, button:'left', buttons:1});
    if (burst) await Promise.all(Array.from({length:moves}, (_, index) => dispatch(index + 1)));
    else for (let index = 1; index <= moves; index++) await dispatch(index);
    // Immediate release intentionally exercises the last buffered move flush.
    await session.send('Input.dispatchMouseEvent', {type:'mouseReleased', x:point.x + dx, y:point.y + dy, button:'left', buttons:0, clickCount:1});
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    return {requestedMoves:moves, start:point, end:{x:point.x + dx, y:point.y + dy}};
}

async function manualCard(page, width, height) {
    let state = await layout(page);
    await trustedGesture(page, DRAG_TARGET, 24 - state.card.left, 24 - state.card.top);
    state = await layout(page);
    await trustedGesture(page, '[data-resize-edge="se"]', width - state.card.width, height - state.card.height);
    return layout(page);
}

async function toolbarKeyboard(page) {
    await ui(page, function() {this.querySelector('.fr-study-toolbar button').focus({preventScroll:true});});
    const focus = [];
    for (let index = 0; index < 6; index++) {
        if (index) await page.keyboard.press('Tab');
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
        const current = await layout(page);
        focus.push({index, focusedIndex:current.buttons.findIndex(button => button.focused),
            label:current.buttons.find(button => button.focused)?.label,
            visible:current.buttons.find(button => button.focused)?.inToolbar === true,
            scrollLeft:current.toolbarScrollLeft});
    }
    return focus;
}

async function readingKeyboardState(page) {
    return ui(page, function() {
        const rect = element => {
            if (!element) return null;
            const r = element.getBoundingClientRect();
            return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};
        };
        const root = this.getRootNode(), active = root.activeElement, card = rect(this);
        const visibility = element => {
            if (!element) return {visible:false};
            const diagnose=element === active, clippingAncestors=[];
            const r = rect(element), clip = {left:Math.max(card.left,0),top:Math.max(card.top,0),right:Math.min(card.right,innerWidth),bottom:Math.min(card.bottom,innerHeight)};
            for (let parent = element.parentElement; parent && parent !== this.parentElement; parent = parent.parentElement) {
                const style = getComputedStyle(parent), p = rect(parent);
                const clipsX=/(auto|scroll|hidden|clip)/.test(style.overflowX), clipsY=/(auto|scroll|hidden|clip)/.test(style.overflowY);
                if (clipsX) {clip.left=Math.max(clip.left,p.left+parent.clientLeft);clip.right=Math.min(clip.right,p.left+parent.clientLeft+parent.clientWidth);}
                if (clipsY) {clip.top=Math.max(clip.top,p.top+parent.clientTop);clip.bottom=Math.min(clip.bottom,p.top+parent.clientTop+parent.clientHeight);}
                if (diagnose && (clipsX || clipsY)) clippingAncestors.push({tag:parent.tagName,className:parent.className,rect:p,
                    overflowX:style.overflowX,overflowY:style.overflowY,clientLeft:parent.clientLeft,clientTop:parent.clientTop,
                    clientWidth:parent.clientWidth,clientHeight:parent.clientHeight,scrollWidth:parent.scrollWidth,scrollHeight:parent.scrollHeight,
                    scrollLeft:parent.scrollLeft,scrollTop:parent.scrollTop,padding:[style.paddingTop,style.paddingRight,style.paddingBottom,style.paddingLeft],
                    border:[style.borderTopWidth,style.borderRightWidth,style.borderBottomWidth,style.borderLeftWidth],clipPath:style.clipPath});
            }
            const finish=(visible,reason,hits=[]) => ({visible,...(diagnose ? {visibilityDiagnostic:{reason,clip,clippingAncestors,hits,
                devicePixelRatio,viewport:{width:innerWidth,height:innerHeight},visualViewport:globalThis.visualViewport ? {scale:visualViewport.scale,offsetLeft:visualViewport.offsetLeft,offsetTop:visualViewport.offsetTop} : null}} : {})});
            if (r.width <= 0 || r.height <= 0 || r.left < clip.left-1 || r.right > clip.right+1 || r.top < clip.top-1 || r.bottom > clip.bottom+1) return finish(false,'clipping-bounds');
            const x=(r.left+r.right)/2, y=(r.top+r.bottom)/2;
            const hits=[[x,y],[r.left+3,y],[r.right-3,y],[x,r.top+3],[x,r.bottom-3]].map(([px,py]) => {
                const hit = root.elementFromPoint(px,py);
                const pass=hit === element || element.contains(hit);
                if (!diagnose) return {pass};
                const style=hit ? getComputedStyle(hit) : null;
                return {x:px,y:py,pass,hit:hit ? {tag:hit.tagName,id:hit.id,className:typeof hit.className === 'string' ? hit.className : '',
                    label:(hit.getAttribute('aria-label') || (hit.matches('button,summary,input') ? hit.textContent : '') || '').trim().slice(0,80),
                    rect:rect(hit),pointerEvents:style.pointerEvents,position:style.position,zIndex:style.zIndex} : null};
            });
            return finish(hits.every(hit=>hit.pass),hits.every(hit=>hit.pass) ? 'fully-visible' : 'hit-test-mismatch',hits);
        };
        const tools=this.querySelector('.fr-reading-tools'), summary=tools?.querySelector('summary');
        const menu=tools?.querySelector('.fr-reading-tool-list'), buttons=menu ? [...menu.querySelectorAll('button')] : [];
        const result=this.querySelector('.fr-reading-result'), input=this.querySelector('.fr-reading-followup input');
        const study=[...this.querySelectorAll('.fr-study-toolbar button')];
        return {card,focus:{tag:active?.tagName || null,label:active?.getAttribute('aria-label') || active?.textContent?.trim() || '',
                owned:!!active && this.contains(active),summary:active === summary,input:active === input,menuIndex:buttons.indexOf(active),studyIndex:study.indexOf(active)},
            summary:{rect:rect(summary),...visibility(summary)},
            menu:{open:tools?.open === true,position:menu ? getComputedStyle(menu).position : null,inReadingScroll:!!menu && !!result?.contains(menu),
                buttons:buttons.map(button => ({label:button.textContent.trim(),disabled:button.disabled,tabIndex:button.tabIndex,rect:rect(button),...visibility(button),
                    clipped:button.scrollWidth>button.clientWidth+1 || button.scrollHeight>button.clientHeight+1}))},
            input:{value:input?.value ?? null,disabled:input?.disabled,...visibility(input),rect:rect(input)},resultScrollTop:result?.scrollTop};
    });
}

// Start with the trusted learning-action focus already established by the
// stream case. Every following focus/scroll change must come from native keys.
async function readingControlsKeyboard(page, screenshot) {
    const evidence={snapshots:[],menuTabs:[],events:[],returnedToTranslation:false};
    await ui(page, function() {
        const state={events:[]}, card=this;
        state.listener=event => {
            if (!['Tab','Enter',' ','Escape','Backspace'].includes(event.key)) return;
            const active=card.getRootNode().activeElement;
            state.events.push({key:event.key,shift:event.shiftKey,trusted:event.isTrusted,
                atSummary:active === card.querySelector('.fr-reading-tools summary'),atInput:active === card.querySelector('.fr-reading-followup input')});
        };
        this.__frReadingKeyboardEvidence=state;
        this.ownerDocument.addEventListener('keydown',state.listener,true);
    });
    const snapshot=async(stage,key) => {
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const state=await readingKeyboardState(page);
        evidence.snapshots.push({stage,key,...state});
        return state;
    };
    const press=async(key,stage) => {await page.keyboard.press(key);return snapshot(stage,key);};
    const seek=async(key,predicate,stage,budget) => {
        for (let index=0;index<budget;index++) {
            const state=await press(key,`${stage}-${index+1}`);
            if (predicate(state)) return state;
        }
        return null;
    };
    try {
        evidence.start=await snapshot('start');
        evidence.summary=await seek('Tab',state=>state.focus.summary,'summary-tab',16);
        if (!evidence.summary || evidence.summary.menu.open) return evidence;
        evidence.enter=await press('Enter','summary-native-enter');
        if (!evidence.enter.menu.open || !evidence.enter.focus.summary) return evidence;
        await screenshot('manual-learning-tools-enter');
        evidence.escapeAfterEnter=await press('Escape','summary-native-escape');
        if (evidence.escapeAfterEnter.menu.open || !evidence.escapeAfterEnter.focus.summary) return evidence;
        evidence.space=await press('Space','summary-native-space');
        if (!evidence.space.menu.open || !evidence.space.focus.summary) return evidence;
        for (let index=0;index<evidence.space.menu.buttons.length;index++) {
            const state=await press('Tab',`menu-tab-${index+1}`);
            evidence.menuTabs.push({expectedIndex:index,...state});
            if (state.focus.menuIndex !== index) break;
        }
        await screenshot('manual-learning-tools-tab');
        const last=evidence.snapshots.at(-1);
        if (!last.focus.owned || !last.menu.open) return evidence;
        evidence.escapeAfterMenu=await press('Escape','menu-native-escape');
        if (evidence.escapeAfterMenu.menu.open || !evidence.escapeAfterMenu.focus.summary) return evidence;
        evidence.followup=await seek('Tab',state=>state.focus.input,'followup-tab',16);
        if (!evidence.followup || evidence.followup.input.disabled) return evidence;
        evidence.typedText='Keyboard access verified';
        await page.keyboard.type(evidence.typedText);
        evidence.typed=await snapshot('followup-native-type');
        await screenshot('manual-learning-followup-keyboard');
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
        evidence.cleared=await press('Backspace','followup-native-clear');
        if (!evidence.cleared.focus.input || evidence.cleared.input.value !== '') return evidence;
        evidence.translationFocus=await seek('Shift+Tab',state=>state.focus.studyIndex === 0,'return-translation-tab',24);
        if (!evidence.translationFocus) return evidence;
        await page.keyboard.press('Enter');
        await snapshot('translation-native-return','Enter');
        evidence.returnedToTranslation=await ui(page, function() {return this.querySelector('.fr-study-toolbar button')?.getAttribute('aria-pressed') === 'true' && getComputedStyle(this.querySelector('.fr-reading-content')).display === 'none';});
        return evidence;
    } finally {
        evidence.events=await ui(page, function() {
            const state=this.__frReadingKeyboardEvidence;
            if (!state) return [];
            this.ownerDocument.removeEventListener('keydown',state.listener,true);
            delete this.__frReadingKeyboardEvidence;
            return state.events;
        });
    }
}

async function toolbarWheel(page, {deltaX = 0, deltaY = 2000} = {}) {
    await ui(page, function() {this.querySelector('.fr-study-toolbar').scrollLeft = 0;});
    const before = await layout(page), hostBefore = await hostState(page);
    const {session} = await support.getSelectionUiTree(page);
    await session.send('Input.dispatchMouseEvent', {type:'mouseWheel',
        x:before.toolbar.left + before.toolbar.width / 2, y:before.toolbar.top + before.toolbar.height / 2,
        button:'none', buttons:0, deltaX, deltaY});
    await sleep(100);
    const hostAfter = await hostState(page);
    const tree = await support.getSelectionUiTree(page);
    // A chained host scroll may auto-dismiss the baseline card. Preserve that
    // observation instead of losing the host-scroll evidence to a missing-card
    // exception. Optimized assertions below require the card to remain present.
    const after = support.findCdpNode(tree.root, classNode('fr-translation-tooltip')) ? await layout(page) : null;
    return {input:{deltaX,deltaY}, cardPresent:!!after,
        overflows:before.toolbarScrollWidth > before.toolbarClientWidth + 1,
        beforeScrollLeft:before.toolbarScrollLeft, afterScrollLeft:after?.toolbarScrollLeft ?? null,
        rightmostVisible:after?.buttons.at(-1)?.inToolbar === true,
        hostUnchanged:hostUnchanged(hostBefore, hostAfter),
        host:{beforeScroll:{x:hostBefore.scrollX,y:hostBefore.scrollY}, afterScroll:{x:hostAfter.scrollX,y:hostAfter.scrollY},
            htmlUnchanged:hostBefore.html === hostAfter.html, textUnchanged:hostBefore.text === hostAfter.text,
            targetDelta:delta(hostBefore.target,hostAfter.target), neighborDelta:delta(hostBefore.neighbor,hostAfter.neighbor)}};
}

// DOM reads work in any world, but prototype counting must use the extension's
// isolated world. Find chrome.runtime.id there, then resolve the SAME card into
// that execution context. Never report main-world counters as content reads.
async function geometryProbe(page, extensionId) {
    const {session, root} = await support.getSelectionUiTree(page);
    const contexts = new Map();
    const created = ({context}) => contexts.set(context.id, context);
    session.on('Runtime.executionContextCreated', created);
    await session.send('Runtime.enable');
    let selected;
    try {
        for (const context of contexts.values()) {
            if (context.auxData?.isDefault) continue;
            try {
                const result = await session.send('Runtime.evaluate', {contextId:context.id,
                    expression:'globalThis.chrome?.runtime?.id || null', returnByValue:true});
                if (result.result.value === extensionId) {selected = context; break;}
            } catch { /* A destroyed context cannot provide measurement evidence. */ }
        }
    } finally {session.off('Runtime.executionContextCreated', created);}
    if (!selected) return {available:false, reason:'No verified extension isolated execution context; browser behavior only. Use lifecycle fake-RAF tests for frame coalescing proof.'};
    const card = support.findCdpNode(root, classNode('fr-translation-tooltip'));
    const {object} = await session.send('DOM.resolveNode', {nodeId:card.nodeId, executionContextId:selected.id});
    const invoke = async fn => {
        const result = await session.send('Runtime.callFunctionOn', {objectId:object.objectId,
            functionDeclaration:fn.toString(), returnByValue:true, awaitPromise:true});
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        return result.result.value;
    };
    try {
        await invoke(function() {
            const card = this, originals = {
                box:Element.prototype.getBoundingClientRect,
                rangeBox:Range.prototype.getBoundingClientRect, rangeRects:Range.prototype.getClientRects,
            };
            const state = {cardReads:0, rangeReads:0, synchronousMoveReads:0, deliveredMoves:0,
                frames:0, inMove:false, enabled:true, writesByFrame:{}, running:true};
            Element.prototype.getBoundingClientRect = function(...args) {
                if (state.enabled && this === card) {state.cardReads++; if (state.inMove) state.synchronousMoveReads++;}
                return originals.box.apply(this, args);
            };
            for (const [name, key] of [['getBoundingClientRect','rangeBox'],['getClientRects','rangeRects']]) {
                Range.prototype[name] = function(...args) {if (state.enabled) state.rangeReads++; return originals[key].apply(this,args);};
            }
            const onMove = event => {
                if (!state.enabled || !event.isTrusted || event.buttons !== 1) return;
                state.deliveredMoves++; state.inMove = true;
            };
            // Register after Vue's bubble listener. Microtasks are unsuitable:
            // Chromium may run them between capture and bubble callbacks.
            const endMove = () => {state.inMove = false;};
            card.addEventListener('pointermove', onMove, true);
            card.addEventListener('pointermove', endMove);
            const observer = new MutationObserver(records => {
                if (state.enabled) state.writesByFrame[state.frames] = (state.writesByFrame[state.frames] || 0) + records.length;
            });
            observer.observe(card, {attributes:true, attributeFilter:['style']});
            const tick = () => {if (state.running) {state.frames++; state.frameId = requestAnimationFrame(tick);}};
            state.frameId = requestAnimationFrame(tick);
            state.restore = () => {
                state.running = false; state.enabled = false; cancelAnimationFrame(state.frameId); observer.disconnect();
                card.removeEventListener('pointermove', onMove, true);
                card.removeEventListener('pointermove', endMove);
                Element.prototype.getBoundingClientRect = originals.box;
                Range.prototype.getBoundingClientRect = originals.rangeBox;
                Range.prototype.getClientRects = originals.rangeRects;
            };
            globalThis.__frKeyInfoGeometryProbe = state;
        });
        return {available:true, context:{id:selected.id, name:selected.name, origin:selected.origin, auxData:selected.auxData},
            finish:async () => {
                try {
                    return await invoke(function() {
                        const state = globalThis.__frKeyInfoGeometryProbe;
                        state.enabled = false;
                        const result = {cardReads:state.cardReads, rangeReads:state.rangeReads,
                            synchronousMoveReads:state.synchronousMoveReads, deliveredMoves:state.deliveredMoves,
                            frames:state.frames, styleMutationsByFrame:state.writesByFrame};
                        state.restore(); delete globalThis.__frKeyInfoGeometryProbe; return result;
                    });
                } finally {await session.send('Runtime.releaseObject', {objectId:object.objectId});}
            }};
    } catch (error) {
        await session.send('Runtime.releaseObject', {objectId:object.objectId});
        return {available:false, reason:`Isolated-world probe could not be installed: ${error.message}`};
    }
}

async function beginStreamSamples(page) {
    await ui(page, function() {
        const card = this, state = {active:true, samples:[]};
        const tick = () => {
            const r = card.getBoundingClientRect();
            state.samples.push({left:r.left, top:r.top, width:r.width, height:r.height});
            if (state.active) state.id = requestAnimationFrame(tick);
        };
        globalThis.__frKeyInfoStreamSamples = state; tick();
    });
}

async function finishStreamSamples(page) {
    return ui(page, function() {
        const state = globalThis.__frKeyInfoStreamSamples;
        state.active = false; cancelAnimationFrame(state.id);
        const samples = state.samples; delete globalThis.__frKeyInfoStreamSamples; return samples;
    });
}

function delta(before, after) {
    return Object.fromEntries(['left','top','width','height'].map(key => [key, after[key] - before[key]]));
}

async function main(argv = process.argv.slice(2)) {
    const args = argumentsFor(argv);
    const {chromium} = createRequire(path.join(args.playwrightRoot, 'package.json'))('playwright');
    const helper = require(args.focusSafeHelper);
    for (const name of ['launchFocusSafePersistentContext','newPageWithoutForeground','activateExtensionTabWithoutForeground']) assert(typeof helper[name] === 'function', `Missing focus-safe API ${name}`);
    fs.mkdirSync(args.artifactsDir, {recursive:true});
    const report = {phase:args.phase, blankSpace:args.blankSpace, audio:{fixtureRequests:0,muted:true,listeningVerified:false}, ok:false, extensionDir:args.extensionDir, englishFirst:args.englishFirst,
        manifestSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(args.extensionDir, 'manifest.json'))).digest('hex'),
        providerEvidence:'Production extension, controlled local translation and AI fixtures; no live provider, audio-quality, or account proof.',
        measurementLimits:'Trusted CDP input may be coalesced by Chromium. Requested moves are not delivered-event counts. DOM snapshots use main-world objects; read counters require a verified extension isolated world and positive controls. An unavailable probe fails this suite. Style MutationObserver records are not a per-frame work proof; fake-RAF lifecycle tests supply that proof.',
        cases:[], checks:[], screenshots:[], consoleErrors:[], consoleMessages:[], fixtureRequests:[], knownBaselineFailures:[], baselineContentMismatches:[], translationRequests:0, aiRequests:0,
        blockedExternalRequests:[], actualExternalResponses:[], cleanupErrors:[], focusSamples:[]};
    const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-selection-key-information-'));
    let fixtureSource=SOURCE, fixtureAnswer=ANSWER;
    let session, context, worker, page, server, browserPid, launchAttempted = false, activeProbe;
    const check = (name, pass, details, afterOnly = false) => {
        const required = !afterOnly || args.phase === 'optimized';
        report.checks.push({name, pass:!!pass, required, details});
        if (required && !pass) throw new Error(name);
    };
    const checkTranslationText = (name, actual, details = {}) => {
        if (args.phase === 'baseline' && actual !== TRANSLATION && !report.baselineContentMismatches.some(item => item.requestOrdinal === report.translationRequests && item.actual === actual)) {
            const knownLegacyScan = actual === TRANSLATION.replace(/文/g, 'D');
            const mismatch = {classification:knownLegacyScan ? 'body-content-legacy-ui-scan' : 'unclassified-rendered-content-mismatch',
                requestOrdinal:report.translationRequests, expected:TRANSLATION, actual, ...details,
                providerEvidence:'The controlled local provider returned the unchanged fixture. This rendered-content mismatch is separate from provider transport failure.'};
            report.baselineContentMismatches.push(mismatch);
            if (knownLegacyScan) report.knownBaselineFailures.push(mismatch);
        }
        check(name, actual === TRANSLATION, {expected:TRANSLATION, actual, ...details}, true);
    };
    const focusSample = async label => {
        const {stdout} = await execFileAsync('/usr/bin/osascript', ['-l','JavaScript','-e',
            "ObjC.import('AppKit'); const a=$.NSWorkspace.sharedWorkspace.frontmostApplication; JSON.stringify({pid:Number(a.processIdentifier),name:ObjC.unwrap(a.localizedName)});"], {timeout:5000});
        const actual = JSON.parse(stdout.trim());
        report.focusSamples.push({label,name:actual.name,pid:actual.pid});
        assert(Number.isSafeInteger(browserPid) && browserPid > 0 && Number.isSafeInteger(actual.pid) && actual.pid > 0,
            `${label}: foreground PID or guarded browser ownership is unavailable`);
        assert(actual.pid !== browserPid, `${label}: owned test browser took foreground focus`);
    };
    const screenshot = async name => {
        const file = path.join(args.artifactsDir, `${args.phase}-${name}.png`);
        await focusSample(`${name}:before-screenshot`);
        try {await page.screenshot({path:file, fullPage:false}); report.screenshots.push(file);}
        finally {await focusSample(`${name}:after-screenshot`);}
    };
    try {
        server = http.createServer(async (request, response) => {
            response.setHeader('access-control-allow-origin', '*');
            if (request.method === 'OPTIONS') {response.writeHead(204).end(); return;}
            if (request.url === '/tts-token') {response.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({t:'fixture-tts-token',r:'fixture'}));return;}
            if (request.url === '/audio') {report.audio.fixtureRequests++; for await(const chunk of request) {} await sleep(600); response.writeHead(200,{'content-type':'audio/wav'}).end(silentWav());return;}
            if (request.url === '/translate') {
                report.translationRequests++; let body = '';
                for await (const chunk of request) body += chunk;
                try {
                    const input = JSON.parse(body);
                    report.fixtureRequests.push({ordinal:report.translationRequests, sourceTexts:input, responseText:TRANSLATION});
                    response.writeHead(200, {'content-type':'application/json'}).end(JSON.stringify(input.map(() => ({translations:[{text:TRANSLATION, to:'zh-Hans'}]}))));
                } catch {response.writeHead(400).end('Invalid fixture request');}
                return;
            }
            if (request.url === '/v1/chat/completions') {
                report.aiRequests++; for await (const chunk of request) {};
                response.writeHead(200, {'content-type':'text/event-stream'});
                for (const part of fixtureAnswer.match(/[\s\S]{1,28}/g)) {
                    if (response.destroyed) return;
                    response.write('data: ' + JSON.stringify({id:'key-info-fixture', choices:[{index:0, delta:{content:part}, finish_reason:null}]}) + '\n\n');
                    await sleep(35);
                }
                response.end('data: ' + JSON.stringify({choices:[{index:0,delta:{},finish_reason:'stop'}]}) + '\n\ndata: [DONE]\n\n');
                return;
            }
            response.writeHead(404).end('Fixture not found');
        });
        await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
        const port = server.address().port;
        launchAttempted = true;
        session = await helper.launchFocusSafePersistentContext({chromium, profileDir,
            browserPath:args.browserPath, headless:false, background:true, displayTarget:args.displayTarget,
            viewport:{width:1440,height:960}, timeout:30000,
            browserArgs:[`--disable-extensions-except=${args.extensionDir}`,`--load-extension=${args.extensionDir}`,'--no-first-run','--no-default-browser-check','--mute-audio']});
        guardBrowserClose(session, profileDir);
        context = session.context;
        browserPid = await getGuardedBrowserPid(session);
        report.ownedBrowserPid = browserPid;
        await focusSample('after-launch-ownership');
        Object.assign(report, {launchMode:session.launchMode, focusPolicy:session.focusPolicy, windowPlacement:session.windowPlacement});
        check('background launch preserves user focus', session.launchMode === 'macos-background-cdp' &&
            session.focusPolicy === 'launchservices-no-foreground' && session.windowPlacement?.browserFrontmost === false, session.windowPlacement);
        await context.route(/^https?:\/\//, async route => {
            const url = route.request().url();
            if (url.startsWith(FIXTURE_URL)) return route.fulfill({contentType:'text/html', body:fixtureHtml(fixtureSource)});
            if (url.startsWith(`http://127.0.0.1:${port}/`)) return route.continue();
            report.blockedExternalRequests.push({origin:new URL(url).origin, path:new URL(url).pathname});
            return route.abort('blockedbyclient');
        });
        context.on('response', response => {
            const url = response.url();
            if (/^https?:/.test(url) && !url.startsWith(FIXTURE_URL) && !url.startsWith(`http://127.0.0.1:${port}/`)) {
                report.actualExternalResponses.push({origin:new URL(url).origin, path:new URL(url).pathname});
            }
        });
        ({worker, extensionId:report.extensionId} = await support.waitForWorker(context));
        await worker.evaluate(({translationUrl, localOrigin}) => {
            const native = globalThis.fetch.bind(globalThis);
            globalThis.__frKeyInfoNativeFetch = native;
            globalThis.__frKeyInfoFetchStats = {translationRewrites:0, requests:[], blocked:[]};
            globalThis.fetch = (input, init) => {
                const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
                if (url.startsWith('https://edge.microsoft.com/translate/translatetext')) {
                    const wire = new URL(url);
                    globalThis.__frKeyInfoFetchStats.translationRewrites++;
                    globalThis.__frKeyInfoFetchStats.requests.push({sourceLanguage:wire.searchParams.get('from'),targetLanguage:wire.searchParams.get('to'),method:init?.method});
                    return native(translationUrl, init);
                }
                if (url.startsWith('https://dev.microsofttranslator.com/apps/endpoint')) return native(localOrigin+'/tts-token',init);
                if (url.startsWith('https://fixture.tts.speech.microsoft.com/')) return native(localOrigin+'/audio',init);
                if (!/^https?:/.test(url) || url.startsWith(localOrigin + '/')) return native(input, init);
                const parsed = new URL(url);
                globalThis.__frKeyInfoFetchStats.blocked.push({origin:parsed.origin, path:parsed.pathname});
                return Promise.reject(new Error('External fetch blocked by owned selection fixture'));
            };
        }, {translationUrl:`http://127.0.0.1:${port}/translate`, localOrigin:`http://127.0.0.1:${port}`});
        page = context.pages().find(candidate => candidate.url().startsWith('about:blank#fluentread-background-')) ||
            await helper.newPageWithoutForeground(context);
        page.on('pageerror', error => report.consoleErrors.push(error.message));
        page.on('console', message => {
            if (['warning','error'].includes(message.type()) && report.consoleMessages.length < 100) report.consoleMessages.push({type:message.type(),text:message.text()});
        });
        check('one temporary page is reused', context.pages().length === 1, {pages:context.pages().map(candidate => candidate.url())});
        let requestConfig;
        const configure = async (locale, theme) => {
            await page.goto(`chrome-extension://${report.extensionId}/popup.html`);
            await page.locator('.popup-shell[data-config-ready="true"]').waitFor({timeout:30000});
            const saved = await support.readStoredConfig(page);
            const verified = await support.patchStoredConfig(page, {on:true, uiLanguage:locale, uiLanguageSetupCompleted:true, theme,
                service:'microsoft', from:'auto', to:'zh-Hans', selectionTranslatorMode:'bilingual',
                selectionTranslatorPresentation:'card', selectionTranslatorTrigger:'icon', selectionTranslatorDelay:0,
                hotkey:'none', floatingBallHotkey:'none', useCache:false, selectionTtsMode:'online-first',
                harness:{...saved.harness, enabled:true, service:'custom:key-info-fixture', model:'key-info-fixture', trigger:'click', actions:['meaning','grammar','usage','practice']},
                customOpenAIProviders:[{id:'custom:key-info-fixture', name:'Local key information fixture',
                    endpoint:`http://127.0.0.1:${port}/v1/chat/completions`, models:['key-info-fixture']}],
                token:{'custom:key-info-fixture':'fixture-token'}, model:{...saved.model,'custom:key-info-fixture':'key-info-fixture'}});
            requestConfig = Object.fromEntries(['uiLanguage','theme','service','selectionTranslationService','from','to','selectionTranslatorMode','selectionTranslatorTrigger','selectionTranslatorBidirectional','__fluentConfigRevision'].map(key => [key,verified[key]]));
        };
        const open = async (source=SOURCE) => {
            fixtureSource=source;
            await page.goto(FIXTURE_URL);
            await page.locator('#fluent-read-selection-translator-container').waitFor({state:'attached', timeout:30000});
            const before = await hostState(page);
            await helper.activateExtensionTabWithoutForeground(context, page);
            await page.locator('#target').click({position:{x:5,y:5}});
            await support.selectTextWithDomRange(page, '#target', source.length);
            await poll(async () => support.findCdpNode((await support.getSelectionUiTree(page)).root, classNode('fr-selection-indicator')), 'Selection indicator missing');
            await support.clickSelectionIndicator(page);
            try {
                await poll(async () => {
                    const state = await support.getSelectionUiTree(page);
                    const card = support.findCdpNode(state.root, classNode('fr-translation-tooltip'));
                    if (!card) return false;
                    return ui(page, function() {
                        return !!this.querySelector('.fr-translation-result pre')?.textContent.trim() && !this.querySelector('.fr-loading-state');
                    });
                }, 'Controlled ordinary translation did not finish');
                // Let Vue rendering and the UI-localization observer settle;
                // readiness is separate from the exact content-preservation
                // assertion, so an established baseline scan bug is recorded.
                await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
                const actual = await ui(page, function() {return this.querySelector('.fr-translation-result pre')?.textContent || '';});
                checkTranslationText(`ordinary translation ${report.translationRequests} exactly preserves the provider fixture`, actual, {requestConfig});
            } catch (error) {
                const diagnostics = {requestConfig, expectedTranslation:TRANSLATION, translationRequests:report.translationRequests,
                    fixtureRequests:report.fixtureRequests.slice(), consoleMessages:report.consoleMessages.slice()};
                try {
                    diagnostics.card = await ui(page, function() {
                        const translated = this.querySelector('.fr-translation-result pre');
                        const original = this.querySelector('.fr-original-text pre');
                        return {className:this.className, fullText:this.textContent, translationText:translated?.textContent || '',
                            originalText:original?.textContent || '', labels:[...this.querySelectorAll('.fr-study-toolbar button')].map(button => button.textContent.trim()),
                            translatedTokenTexts:[...this.querySelectorAll('.fr-translation-result .fr-speech-word')].map(token => token.textContent),
                            status:[...this.querySelectorAll('.fr-loading-state,.fr-error-state,.fr-inline-error,[role="status"]')].map(element => ({className:element.className,text:element.textContent})),
                            standaloneHeader:!!this.querySelector('.fr-tooltip-header'),targetLanguageControl:!!this.querySelector('[data-target-language]')};
                    });
                    diagnostics.actualEqualsFixture = diagnostics.card.translationText === TRANSLATION;
                    diagnostics.originalEqualsFixture = diagnostics.card.originalText === SOURCE;
                } catch (diagnosticError) {diagnostics.cardError = diagnosticError.message;}
                try {
                    diagnostics.worker = await worker.evaluate(async () => {
                        const stored = (await chrome.storage.local.get('config')).config;
                        let config = stored;
                        if (typeof stored === 'string') {try {config = JSON.parse(stored);} catch {config = {};}}
                        return {fetch:globalThis.__frKeyInfoFetchStats, config:Object.fromEntries(['uiLanguage','theme','service','selectionTranslationService','from','to','selectionTranslatorMode','selectionTranslatorTrigger','selectionTranslatorBidirectional','__fluentConfigRevision'].map(key => [key,config?.[key]]))};
                    });
                } catch (diagnosticError) {diagnostics.workerError = diagnosticError.message;}
                report.openFailure = diagnostics;
                try {await screenshot(`ordinary-translation-timeout-${requestConfig.uiLanguage}-${requestConfig.theme}`);}
                catch (diagnosticError) {diagnostics.screenshotError = diagnosticError.message;}
                throw error;
            }
            return before;
        };
        // Optional ordering aid for a cold first-English diagnosis. Every
        // required locale/theme/width combination still runs if this passes.
        const initialLocale = args.englishFirst ? 'en-US' : 'zh-CN';
        await configure(initialLocale, 'light');
        await page.setViewportSize({width:1440,height:960});
        let hostBefore = await open();
        const normal = await layout(page);
        const normalFocus = await toolbarKeyboard(page), normalWheel = await toolbarWheel(page);
        report.cases.push({name:'normal-long-original', locale:initialLocale, theme:'light', metrics:normal,focus:normalFocus,wheel:normalWheel});
        checkTranslationText('normal ordinary translation exactly matches the fixture', normal.translationText, {locale:initialLocale,theme:'light'});
        check('ordinary translation does not request AI', report.aiRequests === 0, {aiRequests:report.aiRequests});
        check('full ordinary original is retained', normal.originalCopies === 1 && normal.originalText === SOURCE, normal.originalText);
        check('normal complete first translated line is visible', normal.keyVisibleHeight >= normal.firstLine?.height - 1 && normal.keyVisibleWidth >= normal.firstLine?.width - 1, normal, true);
        check('normal localized toolbar preserves complete ordered actions', JSON.stringify(normal.buttons.map(button => button.label)) === JSON.stringify(TOOLBAR_LABELS[initialLocale]) && normal.buttons.every(button => !button.clipped), {locale:initialLocale,buttons:normal.buttons});
        check('normal toolbar is one row and keyboard-accessible', normal.toolbarRows === 1 && normal.toolbar.height <= 44 && normalFocus.every((item,index) => item.focusedIndex === index && item.visible), {toolbar:normal.toolbar,focus:normalFocus}, true);
        check('normal toolbar wheel reaches the rightmost action', !normalWheel.overflows || normalWheel.afterScrollLeft > 0 && normalWheel.rightmostVisible, normalWheel, true);
        check('normal toolbar wheel leaves host scroll and layout unchanged', normalWheel.hostUnchanged, normalWheel);
        await screenshot('normal-long-original');

        // Measure an unresized drag: older code reads the card on every move in
        // this case. The separately resized stream case does not hide that cost.
        const anchor = (await layout(page)).card;
        await trustedGesture(page, DRAG_TARGET, 24 - anchor.left, 24 - anchor.top);
        const beforeDrag = (await layout(page)).card;
        activeProbe = await geometryProbe(page, report.extensionId);
        const probeMetadata = {available:activeProbe.available, context:activeProbe.context, reason:activeProbe.reason};
        report.dragProbe = probeMetadata;
        check('extension isolated-world drag probe is available', activeProbe.available, probeMetadata);
        const gesture = await trustedGesture(page, DRAG_TARGET, 36, 20, 60, true);
        const counts = await activeProbe.finish();
        activeProbe = null;
        const afterDrag = (await layout(page)).card;
        report.drag = {...gesture, probe:probeMetadata, counts, delta:delta(beforeDrag, afterDrag)};
        check('trusted drag delivered pointer moves and measured its initial card geometry', counts.deliveredMoves > 0 && counts.cardReads >= 1, report.drag);
        check('pointerup applies the final accepted drag move', Math.abs(afterDrag.left - beforeDrag.left - 36) < 1 && Math.abs(afterDrag.top - beforeDrag.top - 20) < 1, report.drag);
        check('buffered moves do not read card geometry synchronously', counts.synchronousMoveReads === 0, counts, true);
        check('anchored drag does not re-read selected range', counts.rangeReads === 0, counts, true);
        check('drag leaves original host text layout and scroll unchanged', hostUnchanged(hostBefore, await hostState(page)));
        await screenshot('trusted-burst-drag');

        // Resize the viewport while an unresized card has a captured drag. The
        // old capture must not move/clamp the new automatic card width later.
        const resizeInput = (await support.getSelectionUiTree(page)).session;
        const resizePoint = await pointFor(page, DRAG_TARGET);
        await resizeInput.send('Input.dispatchMouseEvent', {type:'mouseMoved',x:resizePoint.x,y:resizePoint.y,button:'none',buttons:0});
        await resizeInput.send('Input.dispatchMouseEvent', {type:'mousePressed',x:resizePoint.x,y:resizePoint.y,button:'left',buttons:1,clickCount:1});
        await page.setViewportSize({width:360,height:640});
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const resizedBefore = (await layout(page)).card, resizedHost = await hostState(page);
        await resizeInput.send('Input.dispatchMouseEvent', {type:'mouseMoved',x:resizePoint.x+70,y:resizePoint.y+30,button:'left',buttons:1});
        await resizeInput.send('Input.dispatchMouseEvent', {type:'mouseReleased',x:resizePoint.x+70,y:resizePoint.y+30,button:'left',buttons:0,clickCount:1});
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const resizedAfter = (await layout(page)).card;
        report.viewportResizeDuringGesture = {before:resizedBefore,after:resizedAfter,delta:delta(resizedBefore,resizedAfter)};
        check('viewport resize cancels stale captured drag geometry', Object.values(report.viewportResizeDuringGesture.delta).every(value => Math.abs(value) < 1) &&
            resizedAfter.left >= 0 && resizedAfter.right <= 360, report.viewportResizeDuringGesture, true);
        check('post-resize stale pointer leaves host layout and scroll unchanged', hostUnchanged(resizedHost, await hostState(page)));
        await screenshot('viewport-resize-midgesture');

        // Three card widths × two locales × two themes. The initial normal
        // light capture above supplies the twelfth combination.
        const matrix = [];
        for (const [locale, language] of [['zh-CN','zh'],['en-US','en']]) {
            for (const theme of ['light','dark']) {
                if (locale !== initialLocale || theme !== 'light') matrix.push({name:`${language}-${theme}-normal`,locale,theme,normal:true,width:388,viewport:{width:1440,height:960}});
                for (const [width,height] of [[280,180],[360,200]]) matrix.push({name:`${language}-${theme}-${width}x${height}`,locale,theme,width,height,viewport:{width:390,height:800}});
            }
        }
        for (const scenario of matrix) {
            await configure(scenario.locale, scenario.theme);
            await page.setViewportSize(scenario.viewport);
            hostBefore = await open();
            const metrics = scenario.normal ? await layout(page) : await manualCard(page, scenario.width, scenario.height);
            const focus = await toolbarKeyboard(page);
            const wheel = await toolbarWheel(page);
            report.cases.push({...scenario, metrics, focus, wheel});
            checkTranslationText(`${scenario.name}: ordinary translation exactly matches the fixture`, metrics.translationText, {locale:scenario.locale,theme:scenario.theme});
            check(`${scenario.name}: actual card size`, Math.abs(metrics.card.width - scenario.width) < 1 &&
                (scenario.normal || Math.abs(metrics.card.height - scenario.height) < 1), metrics.card);
            check(`${scenario.name}: locale theme applied`, metrics.dark === (scenario.theme === 'dark'), {dark:metrics.dark});
            check(`${scenario.name}: full source retained`, metrics.originalText === SOURCE && metrics.originalCopies === 1);
            check(`${scenario.name}: complete first translated line visible without scrolling`, metrics.keyVisibleHeight >= metrics.firstLine?.height - 1 && metrics.keyVisibleWidth >= metrics.firstLine?.width - 1 && metrics.contentScrollTop === 0, metrics, true);
            check(`${scenario.name}: toolbar one row without clipped labels`, metrics.toolbarRows === 1 && metrics.toolbar.height <= 44 && metrics.buttons.length === 6 && metrics.buttons.every(button => !button.clipped), metrics.buttons, true);
            check(`${scenario.name}: actual localized labels and semantic order`, JSON.stringify(metrics.buttons.map(button => button.label)) === JSON.stringify(TOOLBAR_LABELS[scenario.locale]),
                {locale:scenario.locale,expected:TOOLBAR_LABELS[scenario.locale],actual:metrics.buttons.map(button => button.label)});
            check(`${scenario.name}: keyboard reaches every complete toolbar action`, focus.every((item,index) => item.focusedIndex === index && item.visible), focus, true);
            check(`${scenario.name}: toolbar wheel reaches the rightmost action`, !wheel.overflows || wheel.afterScrollLeft > 0 && wheel.rightmostVisible, wheel, true);
            check(`${scenario.name}: toolbar wheel preserves host scroll and layout`, wheel.hostUnchanged, wheel);
            check(`${scenario.name}: original host stays unchanged`, hostUnchanged(hostBefore, await hostState(page)));
            await screenshot(scenario.name);
        }

        // The same physically resized card enters the actual local learning
        // stream. No settings/learning-center/record workflows are included.
        const beforeStream = (await layout(page)).card;
        const aiBefore = report.aiRequests;
        await beginStreamSamples(page);
        await ui(page, function() {this.querySelector('.fr-study-toolbar button').focus({preventScroll:true});});
        await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
        await poll(() => ui(page, function() {return !![...this.querySelectorAll('.fr-reading-answer .fr-reading-markdown > p')].find(paragraph => paragraph.textContent.trim());}), 'Local learning stream did not produce an answer paragraph', 20000);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const streamingBody = await readingBodyLayout(page);
        report.learningBodySnapshots = [{stage:'streaming-first-paragraph',metrics:streamingBody}];
        await screenshot('manual-learning-body-streaming');
        check('streamed learning answer has at least 48px of visible reading viewport', streamingBody.resultViewport?.height >= 48, streamingBody, true);
        check('streamed learning answer shows the complete first body paragraph line', streamingBody.paragraphTag === 'P' &&
            streamingBody.visibleBodyWidth >= streamingBody.firstBodyLine?.width - 1 && streamingBody.visibleBodyHeight >= streamingBody.firstBodyLine?.height - 1, streamingBody, true);
        await poll(() => ui(page, function() {return !!this.querySelector('.fr-reading-answer[aria-busy="false"]');}), 'Local learning stream did not finish', 20000);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const completedBody = await readingBodyLayout(page);
        report.learningBodySnapshots.push({stage:'completed',metrics:completedBody});
        const samples = await finishStreamSamples(page);
        const streamDeltas = samples.map(sample => delta(beforeStream, sample));
        report.learningStream = {aiRequests:report.aiRequests - aiBefore, sampleCount:samples.length,
            maxDelta:Object.fromEntries(['left','top','width','height'].map(key => [key,Math.max(0,...streamDeltas.map(item => Math.abs(item[key])))]))};
        await screenshot('manual-learning-stream');
        check('one explicit learning action uses one local stream', report.aiRequests - aiBefore === 1, report.learningStream);
        check('manual card geometry survives all learning stream frames', Object.values(report.learningStream.maxDelta).every(value => value < 1), report.learningStream);
        check('completed learning answer has at least 48px of visible reading viewport', completedBody.resultViewport?.height >= 48, completedBody, true);
        check('completed learning answer shows the complete first body paragraph line', completedBody.paragraphTag === 'P' &&
            completedBody.visibleBodyWidth >= completedBody.firstBodyLine?.width - 1 && completedBody.visibleBodyHeight >= completedBody.firstBodyLine?.height - 1, completedBody, true);
        const expectedParagraphs = ANSWER.split('\n\n').filter(block => !block.startsWith('#')).map(block => block.trim());
        check('learning answer retains every complete fixture body paragraph', JSON.stringify(completedBody.bodyParagraphs.map(text => text.trim())) === JSON.stringify(expectedParagraphs),
            {expected:expectedParagraphs,actual:completedBody.bodyParagraphs});
        const keyboardHostBefore=await hostState(page), keyboardCardBefore=(await layout(page)).card, keyboardAiBefore=report.aiRequests;
        const keyboard=await readingControlsKeyboard(page,screenshot);
        report.learningKeyboard=keyboard;
        check('learning tools summary is reached by native Tab and fully visible at 32px', keyboard.summary?.focus.summary && keyboard.summary.summary.visible &&
            Math.abs(keyboard.summary.summary.rect?.width-32)<1 && Math.abs(keyboard.summary.summary.rect?.height-32)<1, keyboard.summary, true);
        check('learning tools open with native Enter and Space and close with Escape', keyboard.enter?.menu.open && !keyboard.escapeAfterEnter?.menu.open &&
            keyboard.space?.menu.open && keyboard.escapeAfterMenu?.menu.open === false && keyboard.escapeAfterMenu.focus.summary, keyboard, true);
        // 工具菜单沿用已有浮层设计，不挤占正文或改变手动卡片尺寸；逐项可见性仍由下方真实 Tab 断言验证。
        check('expanded learning tools overlay outside the reading scroll flow', keyboard.space?.menu.position === 'absolute' && !keyboard.space.menu.inReadingScroll, keyboard.space, true);
        check('native Tab reaches every enabled learning tool fully within clipping ancestors', keyboard.space?.menu.buttons.length > 0 &&
            keyboard.space.menu.buttons.every(button=>!button.disabled && button.tabIndex>=0) && keyboard.menuTabs.length === keyboard.space.menu.buttons.length &&
            keyboard.menuTabs.every((state,index)=>state.focus.menuIndex === index && state.menu.buttons[index]?.visible && !state.menu.buttons[index].clipped), keyboard.menuTabs, true);
        check('native Tab reaches the visible followup and typing and clearing preserve its value', keyboard.followup?.focus.input && keyboard.followup.input.visible &&
            keyboard.typed?.focus.input && keyboard.typed.input.value === keyboard.typedText && keyboard.typed.input.visible && keyboard.cleared?.focus.input && keyboard.cleared.input.value === '',
            {followup:keyboard.followup,typed:keyboard.typed,cleared:keyboard.cleared}, true);
        check('native navigation events are trusted and activate the actual summary', keyboard.events.length > 0 && keyboard.events.every(event=>event.trusted) &&
            keyboard.events.some(event=>event.atSummary && event.key === 'Enter') && keyboard.events.some(event=>event.atSummary && event.key === ' '), keyboard.events, true);
        check('native reverse Tab returns to translation after clearing the unsent followup', keyboard.returnedToTranslation, keyboard.translationFocus, true);
        check('keyboard tools and unsent followup do not request another AI answer', report.aiRequests === keyboardAiBefore, {before:keyboardAiBefore,after:report.aiRequests});
        check('manual card geometry survives every learning keyboard step', keyboard.snapshots.every(state=>Object.values(delta(keyboardCardBefore,state.card)).every(value=>Math.abs(value)<1)), keyboard.snapshots.map(state=>({stage:state.stage,delta:delta(keyboardCardBefore,state.card)})));
        check('learning keyboard leaves host text layout and scroll unchanged', hostUnchanged(keyboardHostBefore,await hostState(page)));
        // Baseline records missing new navigation expectations above. Its old
        // return contract still runs, but this cleanup is never reachability evidence.
        if (!keyboard.returnedToTranslation) {
            await ui(page, function() {this.querySelector('.fr-study-toolbar button').focus({preventScroll:true});});
            await page.keyboard.press('Enter');
        }
        const returned = await layout(page);
        checkTranslationText('returned ordinary translation exactly matches the fixture', returned.translationText, {locale:'en-US',theme:'dark'});
        check('returning to translation retains the complete original and manual geometry', returned.originalText === SOURCE && Object.values(delta(beforeStream, returned.card)).every(value => Math.abs(value) < 1), returned);
        check('learning stream does not mutate or scroll the host', hostUnchanged(hostBefore, await hostState(page)));
        await screenshot('manual-return-to-translation');

        // Both axes must remain inside the overflowed navigation strip. A
        // horizontal overscroll rule alone can still chain its vertical wheel
        // component to the host. Run last so baseline observations cannot
        // invalidate the independent drag/stream checks above.
        const diagonalWheel = await toolbarWheel(page, {deltaX:30,deltaY:120});
        report.diagonalToolbarWheel = {name:'en-dark-360x200-diagonal-wheel',...diagonalWheel};
        check('diagonal toolbar wheel uses a genuinely overflowing strip', diagonalWheel.overflows, diagonalWheel, true);
        check('diagonal toolbar wheel moves its own horizontal scroll', diagonalWheel.cardPresent && diagonalWheel.afterScrollLeft > diagonalWheel.beforeScrollLeft, diagonalWheel, true);
        check('diagonal toolbar wheel leaves host scroll HTML and geometry unchanged', diagonalWheel.hostUnchanged, diagonalWheel, true);
        await screenshot('diagonal-toolbar-wheel');
        if (args.blankSpace) {
            report.blankSpaceCases=[];
            fixtureAnswer=SHORT_ANSWER;
            for (const locale of ['zh-CN','en-US']) for (const theme of ['light','dark']) {
                for (const variant of ['auto','narrow-auto','manual-280','manual-360']) {
                    const name=`short-${locale}-${theme}-${variant}`;
                    await configure(locale,theme);
                    await page.setViewportSize(variant==='auto'?{width:1440,height:960}:{width:390,height:800});
                    const host=await open(SHORT_SOURCE);
                    if (variant.startsWith('manual')) await manualCard(page,variant==='manual-280'?280:360,variant==='manual-280'?180:200);
                    const ordinary=await blankSpaceLayout(page);
                    check(`${name}: idle audio leaves no bottom strip`,ordinary.status.height<1&&ordinary.idleBottomSpace<2,ordinary,true);
                    await screenshot(name+'-translation');
                    const audioEvidence=[];
                    if (locale==='zh-CN'&&theme==='light'&&['auto','manual-360'].includes(variant)) {
                        for (const kind of ['source','translation']) {
                            const before=await blankSpaceLayout(page);
                            await beginStreamSamples(page);
                            await clickUi(page,kind==='source'?'.fr-original-text .fr-text-audio-btn':'.fr-translation-result .fr-text-audio-btn');
                            await poll(()=>ui(page,function(){return this.querySelector('.fr-playing-status')?.getAttribute('aria-busy')==='true';}),'Audio preparing UI missing');
                            const preparing=await blankSpaceLayout(page);
                            await screenshot(name+'-'+kind+'-preparing');
                            await poll(()=>ui(page,function(){return !!this.querySelector('.fr-playing-status button[aria-label="停止播放"]');}),'Audio playback UI missing',20000);
                            const playing=await blankSpaceLayout(page);
                            await screenshot(name+'-'+kind+'-playing');
                            await clickUi(page,'.fr-playing-status button[aria-label="停止播放"]');
                            await poll(()=>ui(page,function(){return this.querySelector('.fr-playing-status')?.classList.contains('is-idle');}),'Audio did not stop');
                            await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
                            const stopped=await blankSpaceLayout(page),frames=await finishStreamSamples(page);
                            const maxDelta=Object.fromEntries(['left','top','width','height'].map(key=>[key,Math.max(...frames.map(frame=>Math.abs(frame[key]-before.card[key])))]));
                            const evidence={kind,before,preparing,playing,stopped,frameCount:frames.length,maxDelta};audioEvidence.push(evidence);
                            check(`${name}: ${kind} prepare play stop preserves every outer frame`,Object.values(maxDelta).every(value=>value<1),evidence);
                            check(`${name}: ${kind} active dock leaves body above controls`,playing.status.height>=30&&playing.content.bottom<=playing.status.top+1&&playing.content.height>=32,playing);
                            check(`${name}: ${kind} stop returns full content height`,Math.abs(before.content.height-stopped.content.height)<1&&stopped.idleBottomSpace<2,stopped,true);
                        }
                    }
                    const before=ordinary.card;
                    await beginStreamSamples(page);
                    await ui(page,function(){this.querySelector('.fr-study-toolbar button').focus({preventScroll:true});});
                    await page.keyboard.press('Tab');await page.keyboard.press('Enter');
                    await poll(()=>ui(page,function(){return !!this.querySelector('.fr-reading-answer[aria-busy="false"]');}),'Short learning did not complete',20000);
                    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
                    const reading=await blankSpaceLayout(page),body=await readingBodyLayout(page),frames=await finishStreamSamples(page);
                    const geometryDelta=Object.fromEntries(['left','top','width','height'].map(key=>[key,Math.max(...frames.map(frame=>Math.abs(frame[key]-before[key])))]));
                    check(`${name}: complete short answer survives render`,body.firstParagraphText==='这位读者好奇地探索新想法。',body);
                    check(`${name}: complete answer first line visible`,body.visibleBodyWidth>=body.firstBodyLine.width-1&&body.visibleBodyHeight>=body.firstBodyLine.height-1,body,true);
                    check(`${name}: learning has no idle bottom strip`,reading.idleBottomSpace<2,reading,true);
                    check(`${name}: source is collapsed by default`,!reading.sourceVisible,reading,true);
                    if (variant.startsWith('manual')) check(`${name}: manual stream keeps outer size`,Object.values(geometryDelta).every(value=>value<1),geometryDelta);
                    else check(`${name}: short answer fits naturally without a vacant screen`,reading.card.height<330&&reading.spareAfterFollowup<24&&reading.resultScrollHeight<=reading.resultClientHeight+2,reading,true);
                    await screenshot(name+'-learning');
                    let sourceEvidence;
                    if (args.phase==='optimized'&&locale==='zh-CN'&&theme==='light'&&variant==='auto') {
                        await clickUi(page,'.fr-reading-tools summary');
                        await clickUi(page,'.fr-reading-tools button:first-of-type');
                        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
                        const expanded=await blankSpaceLayout(page);
                        check('short learning: source comparison opens with exact original',expanded.sourceVisible&&expanded.sourceText===SHORT_SOURCE&&expanded.hasReturn&&expanded.scrollTop===0,expanded);
                        await screenshot('short-source-comparison');
                        await clickUi(page,'.fr-reading-source button');
                        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
                        const returned=await blankSpaceLayout(page);
                        check('short learning: return closes comparison and recovers compact answer',!returned.sourceVisible&&Math.abs(returned.card.height-reading.card.height)<1&&returned.scrollTop===0,returned);
                        sourceEvidence={expanded,returned};
                    }
                    check(`${name}: all UI states preserve host`,hostUnchanged(host,await hostState(page)));
                    report.blankSpaceCases.push({name,locale,theme,variant,ordinary,reading,body,geometryDelta,audioEvidence,sourceEvidence});
                }
            }
            // Exercise auto long-content overflow independently of a manual resize.
            fixtureAnswer=ANSWER;
            await configure('zh-CN','light');await page.setViewportSize({width:1440,height:960});const host=await open();
            await ui(page,function(){this.querySelectorAll('.fr-study-toolbar button')[1].click();});
            await poll(()=>ui(page,function(){return !!this.querySelector('.fr-reading-answer[aria-busy="false"]');}),'Long auto learning missing',20000);
            const long=await blankSpaceLayout(page),body=await readingBodyLayout(page);report.autoLongLearning={long,body};
            check('long auto learning stays within viewport cap',long.card.height<=520&&long.card.bottom<=960,long);
            check('long auto learning scrolls inside the reading viewport',long.resultScrollHeight>long.resultClientHeight+10&&body.visibleBodyHeight>=body.firstBodyLine.height-1,long);
            await ui(page,function(){this.querySelector('.fr-reading-result').scrollTop=99999;});
            const bottom=await blankSpaceLayout(page);
            check('long auto learning follow-up is reachable without host scroll',bottom.spareAfterFollowup<24&&hostUnchanged(host,await hostState(page)),bottom);
            await screenshot('auto-long-learning-bottom');
        }
        report.workerFetch = await worker.evaluate(() => globalThis.__frKeyInfoFetchStats);
        check('no external page request was attempted', report.blockedExternalRequests.length === 0, report.blockedExternalRequests);
        check('no external provider fetch was attempted', report.workerFetch.blocked.length === 0, report.workerFetch.blocked);
        check('no external provider response reached the fixture', report.actualExternalResponses.length === 0, report.actualExternalResponses);
        check('Microsoft translation pipeline used the local fixture', report.translationRequests > 0 && report.workerFetch.translationRewrites === report.translationRequests, report.workerFetch);
        check('one page remained throughout the suite', context.pages().length === 1);
        check('no uncaught page errors', report.consoleErrors.length === 0, report.consoleErrors);
        report.ok = true;
    } catch (error) {
        report.error = error.stack || String(error);
    } finally {
        if (activeProbe?.available) {
            try {await activeProbe.finish();} catch (error) {report.cleanupErrors.push(`probe: ${error.message}`);}
        }
        if (worker) {
            try {await worker.evaluate(() => {if (globalThis.__frKeyInfoNativeFetch) globalThis.fetch = globalThis.__frKeyInfoNativeFetch; delete globalThis.__frKeyInfoNativeFetch;});}
            catch (error) {report.cleanupErrors.push(`worker fixture: ${error.message}`);}
        }
        let closed = false;
        if (session) {
            try {await session.close(); closed = true; report.ownedBrowserClosed = true;}
            catch (error) {report.cleanupErrors.push(`owned browser: ${error.message}`);}
        }
        if (closed || !launchAttempted) {fs.rmSync(profileDir, {recursive:true, force:true}); report.profileRemoved = true;}
        else report.retainedProfile = profileDir;
        if (server) await new Promise(resolve => {server.close(resolve); server.closeAllConnections?.();});
        if (report.cleanupErrors.length) report.ok = false;
        fs.writeFileSync(path.join(args.artifactsDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    }
    console.log(JSON.stringify({ok:report.ok, phase:report.phase, cases:report.cases.length,
        checks:report.checks.length, observedBaselineFailures:report.checks.filter(item => !item.required && !item.pass).map(item => item.name),
        report:path.join(args.artifactsDir, 'report.json'), error:report.error, cleanupErrors:report.cleanupErrors}, null, 2));
    if (!report.ok) process.exitCode = 1;
    return report;
}

if (require.main === module) main().catch(error => {console.error(error.stack || error); process.exitCode = 1;});
module.exports = {main, argumentsFor, SOURCE, TRANSLATION};
