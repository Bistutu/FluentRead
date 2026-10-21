/**
 * @file src/features/section-translation/content/reminder.ts
 * 文件职责：在页面角落提供翻译已记住区域的轻量按钮和本页关闭操作，不抢夺阅读焦点。
 * 主要内容：使用隔离的封闭 ShadowRoot、可访问区域数量和真实按钮，正常状态不重复说明；等待期间防止重复提交，失败才显示简短重试提示，成功、关闭或所属规则取消时清理节点及监听器；全部文案通过 textContent 写入。
 * 模块边界：只渲染提醒，不读取配置或定位页面元素；翻译与规则生命周期由 remembered 运行时传入。
 */
import reminderStyles from './reminder.css?inline';

export function showSectionReminder(options: {
    count: number;
    text(key: string, params?: Readonly<Record<string, string | number>>): string;
    translate(): Promise<void>;
    dismiss(): void;
    signal: AbortSignal;
}): void {
    if (options.signal.aborted) return;
    const host = document.createElement('fluent-read-section-reminder');
    host.setAttribute('data-fluent-read-ui', 'section-reminder');
    host.setAttribute('translate', 'no');
    for (const [key, value] of Object.entries({position: 'fixed', inset: 'auto 16px 16px auto', display: 'block', width: 'max-content', 'max-width': 'calc(100vw - 32px)', margin: '0', padding: '0', border: '0', 'z-index': '2147483646', transform: 'none', opacity: '1', visibility: 'visible', 'pointer-events': 'auto'})) {
        host.style.setProperty(key, value, 'important');
    }
    const root = host.attachShadow({mode: 'closed'});
    const style = document.createElement('style');
    style.textContent = reminderStyles;
    const row = document.createElement('div');
    row.className = 'fr-section-reminder';
    row.setAttribute('role', 'region');
    row.setAttribute('aria-label', options.text('sectionTranslation.picker.title'));
    const label = document.createElement('span');
    label.className = 'fr-section-reminder-text';
    label.setAttribute('role', 'status');
    label.hidden = true;
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'fr-section-reminder-action';
    action.textContent = options.text('sectionTranslation.rules.translate');
    if (options.count > 1) {
        action.setAttribute('aria-label', options.text('sectionTranslation.rules.translateCount', {count: options.count}));
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'fr-section-reminder-close';
    close.textContent = '×';
    close.setAttribute('aria-label', options.text('sectionTranslation.rules.dismiss'));
    const dispose = (): void => {
        options.signal.removeEventListener('abort', dispose);
        host.remove();
    };
    options.signal.addEventListener('abort', dispose, {once: true});
    close.addEventListener('click', event => {
        if (!event.isTrusted) return;
        options.dismiss();
        dispose();
    });
    action.addEventListener('click', async event => {
        if (!event.isTrusted || action.disabled) return;
        action.disabled = true;
        label.hidden = true;
        label.textContent = '';
        row.setAttribute('aria-busy', 'true');
        try {
            await options.translate();
            if (!options.signal.aborted && host.isConnected) {
                options.dismiss();
                dispose();
            }
        } catch {
            if (!options.signal.aborted) {
                label.textContent = options.text('sectionTranslation.rules.translateFailed');
                label.hidden = false;
                action.disabled = false;
            }
        } finally { row.removeAttribute('aria-busy'); }
    });
    row.append(label, action, close);
    root.append(style, row);
    document.documentElement.append(host);
}
