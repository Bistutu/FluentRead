const PANEL_ID = 'fluent-read-debug-panel';
const TOGGLE_KEY_COMBO = { ctrl: true, shift: true, key: 'd' };
let panel: HTMLDivElement | null = null;
let isVisible = false;
const expandedSections = new Set<string>();

function createStyles(): HTMLStyleElement {
    const style = document.createElement('style');
    style.textContent = `
#${PANEL_ID} {
    position: fixed;
    bottom: 16px;
    right: 16px;
    width: 620px;
    max-height: 75vh;
    background: #1a1b26;
    border: 1px solid #3b3d57;
    border-radius: 10px;
    color: #a9b1d6;
    font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
    font-size: 12px;
    line-height: 1.5;
    z-index: 2147483647;
    overflow: hidden;
    box-shadow: 0 12px 40px rgba(0,0,0,0.5);
    display: flex;
    flex-direction: column;
    animation: fr-debug-in 0.2s ease-out;
}
@keyframes fr-debug-in {
    from { opacity: 0; transform: translateY(12px); }
    to { opacity: 1; transform: translateY(0); }
}
.fr-dbg-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    background: #24283b;
    border-bottom: 1px solid #3b3d57;
    user-select: none;
}
.fr-dbg-header-title {
    font-weight: 600;
    color: #7aa2f7;
    font-size: 13px;
}
.fr-dbg-header-hint {
    color: #565f89;
    font-size: 11px;
    margin-left: 8px;
}
.fr-dbg-close {
    background: none;
    border: none;
    color: #565f89;
    font-size: 18px;
    cursor: pointer;
    padding: 0 4px;
    line-height: 1;
}
.fr-dbg-close:hover { color: #f7768e; }
.fr-dbg-body {
    overflow-y: auto;
    padding: 10px 14px;
    flex: 1;
}
.fr-dbg-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    margin-bottom: 10px;
    padding-bottom: 8px;
    border-bottom: 1px solid #292e42;
}
.fr-dbg-meta-item {
    color: #565f89;
}
.fr-dbg-meta-item span {
    color: #c0caf5;
}
.fr-dbg-section {
    margin-bottom: 8px;
}
.fr-dbg-section-header {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    padding: 5px 0;
    color: #7aa2f7;
    font-weight: 600;
    font-size: 12px;
    user-select: none;
}
.fr-dbg-section-header:hover { color: #bb9af7; }
.fr-dbg-section-arrow {
    transition: transform 0.15s;
    font-size: 10px;
}
.fr-dbg-section-arrow.collapsed { transform: rotate(-90deg); }
.fr-dbg-section-body {
    background: #24283b;
    border-radius: 6px;
    padding: 8px 10px;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 240px;
    overflow-y: auto;
    color: #9ece6a;
    margin-bottom: 4px;
}
.fr-dbg-section-body.collapsed { display: none; }
.fr-dbg-section-body.lang-json {
    color: #2ac3de;
}
.fr-dbg-empty {
    text-align: center;
    padding: 30px 0;
    color: #565f89;
}
.fr-dbg-error {
    color: #f7768e;
}
.fr-dbg-response {
    color: #e0af68;
}
.fr-dbg-badge {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    margin-left: 6px;
}
.fr-dbg-badge-ok { background: #1a2b24; color: #9ece6a; }
.fr-dbg-badge-err { background: #2b1a1a; color: #f7768e; }
`;
    return style;
}

function extractFromRequest(req: any): { systemPrompt: string; userContent: string; model: string } {
    if (!req) return { systemPrompt: '', userContent: '', model: '' };
    let systemPrompt = '';
    let userContent = '';
    let model = req.model || '';

    if (Array.isArray(req.messages)) {
        for (const msg of req.messages) {
            if (msg.role === 'system') systemPrompt = msg.content;
            if (msg.role === 'user') userContent = msg.content;
        }
    }

    if (req.system && !systemPrompt) {
        systemPrompt = req.system;
    }

    if (req.contents) {
        for (const c of req.contents) {
            if (c.role === 'user') {
                for (const p of c.parts || []) {
                    if (p.text) userContent = p.text;
                }
            }
        }
    }

    if (req.query) {
        userContent = req.query;
    }

    return { systemPrompt, userContent, model };
}

function escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function section(id: string, title: string, content: string, cls: string = '', defaultCollapsed: boolean = false): string {
    const collapsed = expandedSections.has(id) ? false : defaultCollapsed;
    return `<div class="fr-dbg-section">
    <div class="fr-dbg-section-header" data-section="${id}">
        <span class="fr-dbg-section-arrow${collapsed ? ' collapsed' : ''}">&#9660;</span>
        ${title}
    </div>
    <div class="fr-dbg-section-body ${cls}${collapsed ? ' collapsed' : ''}" data-body="${id}">${escapeHtml(content)}</div>
</div>`;
}

function renderEntry(entry: any): string {
    if (!entry) {
        return '<div class="fr-dbg-empty">No translation data yet. Trigger a translation first.</div>';
    }

    const { systemPrompt, userContent, model } = extractFromRequest(entry.request);
    const time = new Date(entry.timestamp).toLocaleTimeString();
    const dur = entry.duration != null ? `${entry.duration}ms` : '...';
    const statusBadge = entry.error
        ? '<span class="fr-dbg-badge fr-dbg-badge-err">ERROR</span>'
        : '<span class="fr-dbg-badge fr-dbg-badge-ok">OK</span>';

    let html = `<div class="fr-dbg-meta">
        <div class="fr-dbg-meta-item">Service: <span>${escapeHtml(entry.service || '')}</span></div>
        <div class="fr-dbg-meta-item">Model: <span>${escapeHtml(model)}</span></div>
        <div class="fr-dbg-meta-item">Time: <span>${time}</span></div>
        <div class="fr-dbg-meta-item">Duration: <span>${dur}</span></div>
        ${statusBadge}
    </div>`;

    if (systemPrompt) {
        html += section('sys', 'System Prompt', systemPrompt, '', true);
    }

    if (userContent) {
        html += section('user', 'User Content', userContent);
    }

    if (entry.origin) {
        html += section('origin', 'Origin (raw)', entry.origin, 'lang-json', true);
    }

    if (entry.response) {
        html += section('resp', 'Response', entry.response, 'fr-dbg-response');
    }

    if (entry.error) {
        html += section('err', 'Error', entry.error, 'fr-dbg-error');
    }

    if (entry.request) {
        html += section('raw', 'Full Request Body', JSON.stringify(entry.request, null, 2), 'lang-json', true);
    }

    return html;
}

function toggleSection(header: HTMLElement): void {
    const id = header.dataset.section;
    if (!id) return;
    const body = panel!.querySelector(`[data-body="${id}"]`) as HTMLElement;
    const arrow = header.querySelector('.fr-dbg-section-arrow') as HTMLElement;
    const collapsing = body && !body.classList.contains('collapsed');
    if (body) body.classList.toggle('collapsed');
    if (arrow) arrow.classList.toggle('collapsed');
    if (collapsing) expandedSections.delete(id); else expandedSections.add(id);
}

async function fetchAndRender(): Promise<void> {
    if (!panel || !isVisible) return;
    try {
        const entry = await browser.runtime.sendMessage({ type: 'getDebugLatest' });
        const body = panel.querySelector('.fr-dbg-body') as HTMLElement;
        if (body) body.innerHTML = renderEntry(entry);
    } catch {}
}

function createPanel(): HTMLDivElement {
    const el = document.createElement('div');
    el.id = PANEL_ID;
    el.className = 'notranslate';
    el.innerHTML = `
        <div class="fr-dbg-header">
            <div>
                <span class="fr-dbg-header-title">FluentRead Debug</span>
                <span class="fr-dbg-header-hint">Ctrl+Shift+D to toggle</span>
            </div>
            <button class="fr-dbg-close" title="Close">&times;</button>
        </div>
        <div class="fr-dbg-body">
            <div class="fr-dbg-empty">Waiting for translation data...</div>
        </div>`;
    el.querySelector('.fr-dbg-close')!.addEventListener('click', hide);
    el.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const header = target.closest('.fr-dbg-section-header') as HTMLElement;
        if (header) toggleSection(header);
    });
    return el;
}

function show(): void {
    if (!panel) {
        document.head.appendChild(createStyles());
        panel = createPanel();
        document.body.appendChild(panel);
    }
    panel.style.display = 'flex';
    isVisible = true;
    fetchAndRender();
}

function hide(): void {
    if (panel) panel.style.display = 'none';
    isVisible = false;
}

function toggle(): void {
    if (isVisible) hide(); else show();
}

export function initDebugPopup(): void {
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'd') {
            e.preventDefault();
            e.stopPropagation();
            toggle();
        }
    });
}
