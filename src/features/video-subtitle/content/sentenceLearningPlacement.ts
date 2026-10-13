/**
 * @file src/features/video-subtitle/content/sentenceLearningPlacement.ts
 * 文件职责：管理播放器内学习卡的边界和本次页面会话拖动位置，避免缩放或全屏迁移丢失位置。
 * 主要内容：按用户的默认角落定位内容自适应面板；仅在尺寸变化、外观变更或主动拖动时更新坐标，拖动以剩余可移动空间的比例记忆，保留播放器底部控制区并合并每帧指针更新。
 * 模块边界：只操作调用方拥有的面板节点，不查找网页视频、不更改媒体时间/速度、不保存学习数据或全局配置；host 负责创建、同媒体迁移与最终销毁。
 */
import {normalizeVideoSentenceLearningAppearance, type VideoSentenceLearningAppearance} from '@/src/core/config/videoSentenceLearningAppearance';

export type VideoLearningDragPosition = {x: number; y: number};
const GAP = 8;
const CONTROLS = 56;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** 比例只描述剩余可移动空间；大/小播放器与不同角落都保证整个面板在可见范围内。 */
export function getVideoLearningPlacement(input: {
    playerWidth: number; playerHeight: number; panelWidth: number; panelHeight: number;
    position: VideoSentenceLearningAppearance['position']; dragged?: VideoLearningDragPosition;
}): {left: number; top: number; maxHeight: number; compact: boolean} {
    const maxHeight = Math.max(0, input.playerHeight - GAP - CONTROLS);
    const travelX = Math.max(0, input.playerWidth - GAP * 2 - input.panelWidth);
    const travelY = Math.max(0, maxHeight - input.panelHeight);
    const x = input.dragged ? clamp(input.dragged.x, 0, 1) : input.position.endsWith('right') ? 1 : 0;
    const y = input.dragged ? clamp(input.dragged.y, 0, 1) : input.position.startsWith('bottom') ? 1 : 0;
    return {left: GAP + travelX * x, top: GAP + travelY * y, maxHeight, compact: maxHeight <= 340};
}

export function createVideoSentenceLearningPlacement(options: {
    host: HTMLElement; player: HTMLElement; appearance: VideoSentenceLearningAppearance;
    initialPosition?: VideoLearningDragPosition;
    onDragPosition(position: VideoLearningDragPosition | undefined): void;
}): {syncPlayer(player: HTMLElement): void; setAppearance(appearance: VideoSentenceLearningAppearance): void; destroy(): void} {
    const {host} = options;
    const doc = host.ownerDocument;
    const win = doc.defaultView!;
    let player = options.player;
    let appearance = options.appearance;
    let dragged = options.initialPosition;
    let frame: number | undefined;
    let active = true;
    let drag: {id: number; x: number; y: number; left: number; top: number; scaleX: number; scaleY: number} | undefined;
    let pointer: {x: number; y: number} | undefined;
    const readBounds = () => {
        const rect = player.getBoundingClientRect();
        const width = player.clientWidth || rect.width;
        const height = player.clientHeight || rect.height;
        const panelRect = host.getBoundingClientRect();
        const scaleX = rect.width && width ? rect.width / width : 1;
        const scaleY = rect.height && height ? rect.height / height : 1;
        return {width, height, panelWidth: Math.min(appearance.width, Math.max(0, width - GAP * 2)),
            panelHeight: Math.min(panelRect.height / scaleY, Math.max(0, height - GAP - CONTROLS)), scaleX, scaleY};
    };
    const paint = () => {
        frame = undefined;
        if (!active) return;
        const bounds = readBounds();
        if (drag && pointer) {
            const travelX = Math.max(0, bounds.width - GAP * 2 - bounds.panelWidth);
            const travelY = Math.max(0, bounds.height - GAP - CONTROLS - bounds.panelHeight);
            dragged = {
                x: travelX ? clamp((drag.left - GAP + (pointer.x - drag.x) / drag.scaleX) / travelX, 0, 1) : 0,
                y: travelY ? clamp((drag.top - GAP + (pointer.y - drag.y) / drag.scaleY) / travelY, 0, 1) : 0,
            };
            options.onDragPosition(dragged);
        }
        const next = getVideoLearningPlacement({playerWidth: bounds.width, playerHeight: bounds.height,
            panelWidth: bounds.panelWidth, panelHeight: bounds.panelHeight, position: appearance.position, dragged});
        Object.assign(host.style, {left: `${next.left}px`, top: `${next.top}px`, right: 'auto', bottom: 'auto', overflow: 'visible',
            width: `${bounds.panelWidth}px`, maxHeight: `${next.maxHeight}px`});
        host.style.setProperty('--fluent-read-video-learning-max-height', `${next.maxHeight}px`);
        host.dataset.compact = String(next.compact || appearance.layout === 'compact');
    };
    const schedule = () => { if (active && frame === undefined) frame = win.requestAnimationFrame(paint); };
    const stopDrag = () => { drag = undefined; pointer = undefined; delete host.dataset.dragging; };
    const onDown = (event: PointerEvent) => {
        const target = event.target as Element;
        if (event.button !== 0 || !target.closest?.('[data-learning-drag-handle]') || target.closest('button,input,textarea,select,a,summary')) return;
        const bounds = readBounds();
        const current = getVideoLearningPlacement({playerWidth: bounds.width, playerHeight: bounds.height,
            panelWidth: bounds.panelWidth, panelHeight: bounds.panelHeight, position: appearance.position, dragged});
        drag = {id: event.pointerId, x: event.clientX, y: event.clientY, left: current.left, top: current.top,
            scaleX: bounds.scaleX, scaleY: bounds.scaleY};
        host.dataset.dragging = 'true';
        event.preventDefault(); event.stopPropagation();
    };
    const onMove = (event: PointerEvent) => {
        if (!drag || drag.id !== event.pointerId) return;
        pointer = {x: event.clientX, y: event.clientY}; schedule();
        event.preventDefault(); event.stopPropagation();
    };
    const onUp = (event: PointerEvent) => {
        if (!drag || drag.id !== event.pointerId) return;
        if (frame !== undefined) { win.cancelAnimationFrame(frame); paint(); }
        stopDrag();
    };
    const observer = typeof win.ResizeObserver === 'function' ? new win.ResizeObserver(schedule) : undefined;
    observer?.observe(player); observer?.observe(host);
    host.addEventListener('pointerdown', onDown, true);
    doc.addEventListener('pointermove', onMove, true);
    doc.addEventListener('pointerup', onUp, true);
    doc.addEventListener('pointercancel', onUp, true);
    win.addEventListener('resize', schedule);
    paint();
    return {
        syncPlayer(next) {
            if (!active) return;
            if (next !== player) { observer?.unobserve(player); player = next; observer?.observe(player); stopDrag(); }
            schedule();
        },
        setAppearance(next) {
            if (!active) return;
            if (appearance.position !== next.position) { dragged = undefined; options.onDragPosition(undefined); stopDrag(); }
            appearance = next; schedule();
        },
        destroy() {
            if (!active) return;
            active = false;
            if (frame !== undefined) win.cancelAnimationFrame(frame);
            observer?.disconnect(); stopDrag();
            host.removeEventListener('pointerdown', onDown, true);
            doc.removeEventListener('pointermove', onMove, true);
            doc.removeEventListener('pointerup', onUp, true);
            doc.removeEventListener('pointercancel', onUp, true);
            win.removeEventListener('resize', schedule);
        },
    };
}

/** composition root 注入配置端口；关闭重开仍保留本页拖动位置，配置通知仅在外观变化时触发布局。 */
export function createVideoLearningPlacementOwner(read: () => unknown, subscribe: (listener: () => void) => () => void): {
    place(host: HTMLElement, player: HTMLElement): {syncPlayer(player: HTMLElement): void; destroy(): void};
    dispose(): void;
} {
    let active = true;
    let appearance = normalizeVideoSentenceLearningAppearance(read());
    let dragged: VideoLearningDragPosition | undefined;
    let current: ReturnType<typeof createVideoSentenceLearningPlacement> | undefined;
    const unsubscribe = subscribe(() => {
        if (!active) return;
        const next = normalizeVideoSentenceLearningAppearance(read());
        if (JSON.stringify(next) !== JSON.stringify(appearance)) {
            if (next.position !== appearance.position) dragged = undefined;
            appearance = next; current?.setAppearance(next);
        }
    });
    return {
        place(host, player) {
            if (!active) return {syncPlayer() {}, destroy() {}};
            current?.destroy();
            const placement = createVideoSentenceLearningPlacement({host, player, appearance,
                initialPosition: dragged, onDragPosition: position => { dragged = position; }});
            current = placement;
            return {syncPlayer: placement.syncPlayer, destroy() {
                placement.destroy(); if (current === placement) current = undefined;
            }};
        },
        dispose() {
            if (!active) return;
            active = false; unsubscribe(); current?.destroy(); current = undefined;
        },
    };
}
