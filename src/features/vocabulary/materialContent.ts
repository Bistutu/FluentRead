/**
 * @file src/features/vocabulary/materialContent.ts
 * 文件职责：在获准网页恢复本地材料的原段落或视频时间，并维护主动打开材料的阅读位置。
 * 主要内容：仅本地标识进入地址，后台核对来源后读取定位；动态内容有界等待，按当前界面语言提示歧义和失效位置，关闭及卸载撤销迟到响应、监听与计时器。
 * 模块边界：使用配置公开服务与框架无关的界面翻译函数，不读取其他来源材料，不扫描或保存整页正文，不自动收藏新材料；文档恢复由文档页通过公共定位合同接入。
 */
import {materialCapture, materialGeneration, materialResolve} from './materialClient';
import type {MaterialLocator, MaterialRecord} from './materialProtocol';
import {canonicalMaterialUrl, normalizeMaterialSource} from './materialModel';
import {MATERIAL_RESUME_PARAMETER} from './materialSource';
import {getVideoLearningSource} from '@/src/features/video-subtitle/content/public';
import {config} from '@/src/services/config/store';
import {translateLegacyText} from '@/src/core/i18n';

const PROSE = 'p,li,blockquote,dd,dt,figcaption,h1,h2,h3,h4,h5,h6';
const EXCLUDED = '[data-fluent-read-ui],.fluent-read-bilingual-content,input,textarea,select,nav,aside,[contenteditable]:not([contenteditable="false"]),[hidden],[aria-hidden="true"]';
const normalize = (text: string) => text.replace(/\s+/gu, ' ').trim();
const SESSION_KEY = 'fluentread.material.resume';

/** 重复原句必须由上下文唯一消歧；找不到时不滚到相似但错误的段落。 */
export function locateMaterialParagraph(doc: Document, locator: MaterialLocator): HTMLElement | undefined {
    const quote = normalize(locator.quote || '');
    if (!quote) return;
    const matches: HTMLElement[] = [];
    const identified = locator.paragraphId ? doc.getElementById(locator.paragraphId) : null;
    const candidates = identified ? [identified, ...Array.from(doc.querySelectorAll<HTMLElement>(PROSE)).filter(node => node !== identified)] : Array.from(doc.querySelectorAll<HTMLElement>(PROSE));
    for (const node of candidates.slice(0, 6000)) {
        if (node.closest(EXCLUDED)) continue;
        const text = normalize(node.textContent || '');
        let index = -1;
        let occurrence = text.indexOf(quote);
        while (occurrence >= 0) {
            if ((!locator.prefix || normalize(text.slice(0, occurrence)).endsWith(normalize(locator.prefix)))
                && (!locator.suffix || normalize(text.slice(occurrence + quote.length)).startsWith(normalize(locator.suffix)))) {index = occurrence; break;}
            occurrence = text.indexOf(quote, occurrence + Math.max(1, quote.length));
        }
        if (index < 0) continue;
        if (node === identified) return node;
        if (!matches.some(previous => previous.contains(node) || node.contains(previous))) matches.push(node);
        if (matches.length > 1) return;
    }
    return matches.length === 1 ? matches[0] : undefined;
}

export function mountMaterialContent(doc: Document, signal: AbortSignal, enabled: () => boolean): () => void {
    const view = doc.defaultView;
    if (!view) return () => {};
    let disposed = false;
    let epoch = 0;
    let active: MaterialRecord | undefined;
    let activeGeneration = 0;
    let activeUrl = '';
    let restoringPosition = false;
    let observer: MutationObserver | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let scrollTimer: ReturnType<typeof setTimeout> | undefined;
    let notice: HTMLElement | undefined;
    let lastPosition = '';
    let lastVideoSave = 0;
    const forgetSession = () => {try {view.sessionStorage?.removeItem(SESSION_KEY);} catch { /* 站点禁用会话存储时只保留当前阅读。 */ }};
    const rememberSession = (id: string, url: string) => {try {view.sessionStorage?.setItem(SESSION_KEY, JSON.stringify({id, url}));} catch { /* 仅保存本地标识，存储不可用不阻断恢复。 */ }};
    const sessionMaterial = (): string | undefined => {
        try {
            const text = view.sessionStorage?.getItem(SESSION_KEY);
            if (!text) return;
            const stored = JSON.parse(text) as {id?: unknown; url?: unknown};
            if (typeof stored?.id === 'string' && stored.id.length > 0 && stored.id.length < 256 && stored.url === canonicalMaterialUrl(view.location.href)) return stored.id;
        } catch { /* 损坏标识或站点禁用存储均忽略，不信任页面提供的正文。 */ }
        forgetSession();
    };
    const current = (owner: number, url: string) => !disposed && !signal.aborted && enabled() && owner === epoch && canonicalMaterialUrl(view.location.href) === url;
    const stopWaiting = () => {observer?.disconnect(); observer = undefined; clearTimeout(timeout); restoringPosition = false;};
    const showNotice = (message: string) => {
        notice = doc.createElement('div');
        notice.setAttribute('data-fluent-read-ui', 'material-resume'); notice.setAttribute('role', 'status');
        notice.style.cssText = 'position:fixed;bottom:20px;left:20px;right:20px;max-width:520px;z-index:2147483647;padding:12px 16px;border:1px solid #9ca3af;border-radius:12px;background:Canvas;color:CanvasText;box-shadow:0 4px 24px #0002;font:14px/1.5 system-ui;display:flex;gap:12px;align-items:center';
        const text = doc.createElement('span'); text.textContent = translateLegacyText(message, config.uiLanguage);
        const close = doc.createElement('button'); close.type = 'button'; close.textContent = translateLegacyText('关闭', config.uiLanguage); close.style.cssText = 'background:transparent;color:inherit;border:1px solid currentColor;border-radius:6px;padding:4px 8px;white-space:nowrap';
        close.addEventListener('click', () => {notice?.remove(); notice = undefined;}, {once: true});
        notice.append(text, close); doc.body.append(notice);
    };
    const materialVideos = (record: MaterialRecord): HTMLVideoElement[] => Array.from(doc.querySelectorAll('video')).filter(video => {
        const url = getVideoLearningSource(video, view.location, doc).sourceUrl;
        const identities = [record.identityKey, ...(record.aliases || [])];
        try {
            if (url) return identities.includes(normalizeMaterialSource({kind: 'video', url}).identityKey);
            // 其他视频网页没有站点专用适配器时，仅同一规范地址上的唯一媒体可恢复。
            const platformHost = /(?:^|\.)(?:youtube\.com|youtu\.be|x\.com|twitter\.com)$/u;
            if (doc.querySelectorAll('video').length !== 1 || platformHost.test(view.location.hostname) || platformHost.test(new URL(record.source.url || view.location.href).hostname)) return false;
            return identities.includes(normalizeMaterialSource({kind: 'video', url: view.location.href}).identityKey);
        } catch {return false;}
    });
    const restore = (record: MaterialRecord): boolean => {
        if (!record.locator) return true;
        if (record.kind === 'video') {
            const videos = materialVideos(record).filter(video => video.readyState > 0);
            // 复用字幕学习当前媒体来源，X 多视频绝不根据 DOM 顺序猜测。
            if (videos.length !== 1) return false;
            const video = videos[0]; const time = (record.locator.startMs || 0) / 1000;
            if (!Number.isFinite(video.duration) || time >= video.duration) return false;
            try {video.pause(); video.currentTime = time; video.scrollIntoView({block: 'center', behavior: 'instant'}); return true;} catch {return false;}
        }
        const paragraph = locateMaterialParagraph(doc, record.locator);
        if (!paragraph) return false;
        paragraph.scrollIntoView({block: 'center', behavior: 'instant'});
        if (typeof paragraph.animate === 'function') paragraph.animate([{outline: '3px solid #4f80ff', outlineOffset: '4px'}, {outline: '3px solid transparent', outlineOffset: '4px'}], {duration: 2400});
        return true;
    };
    const load = async (id: string, resume: boolean) => {
        const owner = ++epoch; stopWaiting(); active = undefined; activeGeneration = 0; lastPosition = '';
        const url = canonicalMaterialUrl(view.location.href);
        try {
            const [record, generation] = await Promise.all([materialResolve(id), materialGeneration()]);
            if (!current(owner, url)) return;
            if (!record) {forgetSession(); throw new Error('材料不存在');}
            active = record; activeUrl = url; activeGeneration = generation;
            rememberSession(id, url);
            if (!resume || restore(record)) return;
            restoringPosition = true;
            let queued = false;
            const tryAgain = () => {
                if (queued) return; queued = true;
                view.requestAnimationFrame(() => {queued = false; if (!current(owner, url)) {stopWaiting(); return;} if (restore(record)) stopWaiting();});
            };
            observer = new MutationObserver(tryAgain); observer.observe(doc.body, {childList: true, subtree: true});
            timeout = setTimeout(() => {stopWaiting(); if (current(owner, url)) showNotice(record.kind === 'video' ? '未能恢复视频时间。请确认原视频仍可播放，再从学习材料重新打开。' : '原段落已变化或无法唯一定位。材料与原句仍保留，可在页面内搜索原句，或从学习材料更新来源。');}, 8000);
        } catch {if (current(owner, url)) {forgetSession(); if (resume) showNotice('材料已移除、来源不匹配或当前隐私设置禁止读取。请从学习工作区检查来源并重新打开。');}}
    };
    const savePosition = async () => {
        const record = active; const owner = epoch; const url = canonicalMaterialUrl(view.location.href);
        const capturedAt = Date.now();
        if (!record || url !== activeUrl || !current(owner, url) || record.kind === 'document') return;
        let locator: MaterialLocator | undefined;
        let sourceUrl = url;
        if (record.kind === 'video') {
            const videos = materialVideos(record);
            if (videos.length === 1 && Number.isFinite(videos[0].currentTime)) {locator = {kind: 'video', startMs: Math.floor(videos[0].currentTime * 1000)};
                sourceUrl = getVideoLearningSource(videos[0], view.location, doc).sourceUrl || url;}
        } else {
            const node = Array.from(doc.querySelectorAll<HTMLElement>(PROSE)).slice(0, 6000).find(element => !element.closest(EXCLUDED) && element.getBoundingClientRect().bottom > 0 && element.getBoundingClientRect().top < view.innerHeight && normalize(element.textContent || '').length >= 20);
            if (node) locator = {kind: 'text', quote: normalize(node.textContent!).slice(0, 6000), ...(node.id ? {paragraphId: node.id} : {})};
        }
        if (!locator || JSON.stringify(locator) === lastPosition) return;
        const generation = activeGeneration;
        try {await materialCapture({source: {...record.source, url: sourceUrl}, locator, positionOnly: true, generation, capturedAt}); if (current(owner, url)) lastPosition = JSON.stringify(locator);} catch { /* 归档、清空与隐私设置优先，不复活已删除材料。 */ }
    };
    const onScroll = () => {clearTimeout(scrollTimer); scrollTimer = setTimeout(() => {void savePosition();}, 1200);};
    const onTime = () => {if (Date.now() - lastVideoSave < 5000) return; lastVideoSave = Date.now(); void savePosition();};
    const onLeave = () => {clearTimeout(scrollTimer); void savePosition();};
    const onCaptured = (event: Event) => {const id = (event as CustomEvent<unknown>).detail; if (typeof id === 'string' && id.length < 256) void load(id, false);};
    const onMediaReady = () => {if (restoringPosition && active?.kind === 'video' && current(epoch, activeUrl) && restore(active)) stopWaiting();};
    const onRoute = () => {if (active && canonicalMaterialUrl(view.location.href) !== activeUrl) {epoch++; active = undefined; forgetSession(); stopWaiting(); clearTimeout(scrollTimer); notice?.remove();}};
    doc.addEventListener('scroll', onScroll, {capture: true, passive: true});
    doc.addEventListener('pause', onScroll, true);
    doc.addEventListener('timeupdate', onTime, true);
    doc.addEventListener('loadedmetadata', onMediaReady, true);
    doc.addEventListener('fluentread-material-captured', onCaptured);
    view.addEventListener('popstate', onRoute); view.addEventListener('hashchange', onRoute);
    view.addEventListener('pagehide', onLeave, true);
    const target = new URL(view.location.href); const id = target.searchParams.get(MATERIAL_RESUME_PARAMETER);
    if (id) {target.searchParams.delete(MATERIAL_RESUME_PARAMETER); view.history.replaceState(view.history.state, '', target.href); void load(id, true);}
    else {const rememberedId = sessionMaterial(); if (rememberedId) void load(rememberedId, true);}
    const dispose = () => {if (disposed) return; disposed = true; epoch++; stopWaiting(); clearTimeout(scrollTimer); notice?.remove(); doc.removeEventListener('scroll', onScroll, true); doc.removeEventListener('pause', onScroll, true); doc.removeEventListener('timeupdate', onTime, true); doc.removeEventListener('loadedmetadata', onMediaReady, true); doc.removeEventListener('fluentread-material-captured', onCaptured); view.removeEventListener('popstate', onRoute); view.removeEventListener('hashchange', onRoute); view.removeEventListener('pagehide', onLeave, true); signal.removeEventListener('abort', dispose);};
    signal.addEventListener('abort', dispose, {once: true}); if (signal.aborted) dispose();
    return dispose;
}
