/**
 * @file tests/popupStartupFeedback.test.ts
 * 文件职责：验证 Popup 配置或模块加载期间的轻量启动反馈不会重置偏好或泄露失败详情。
 * 主要内容：真实 DOM 中的慢读取提示、失败替换、手动重新打开、语言选择、无容器以及卸载和页面关闭后的迟到调用隔离。
 * 模块边界：只测试纯 DOM 启动占位和可控时间；不加载 Vue、配置存储、浏览器页面或真实网络。
 */
import {parseHTML} from 'linkedom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createPopupStartupFeedback} from '@/src/app/popup/startupFeedback';

let document: Document, window: ReturnType<typeof parseHTML>['window'];
let feedback: ReturnType<typeof createPopupStartupFeedback> | undefined;
const reload = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();reload.mockClear();
  const dom = parseHTML('<html><body><div id="app"><div class="original-spinner">Loading</div></div></body></html>');
  document = dom.document;window = dom.window;
  vi.stubGlobal('document', document);vi.stubGlobal('window', window);vi.stubGlobal('navigator', {language: 'zh-CN'});
  vi.stubGlobal('location', {reload});
});
afterEach(() => {feedback?.dispose();feedback = undefined;vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();});

describe('popup startup recovery feedback', () => {
  it('keeps the original startup placeholder for fast reads and presents one manual recovery after five seconds', () => {
    feedback = createPopupStartupFeedback('#app');
    vi.advanceTimersByTime(4999);expect(document.querySelector('.original-spinner')).not.toBeNull();
    expect(document.querySelector('button')).toBeNull();expect(reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    const root = document.querySelector('#app')!;
    expect(root.textContent).toContain('正在读取设置');expect(root.textContent).toContain('偏好会保留');
    expect(root.querySelector('[role=status]')).not.toBeNull();expect(root.querySelectorAll('button')).toHaveLength(1);
    vi.advanceTimersByTime(60_000);expect(root.querySelectorAll('button')).toHaveLength(1);expect(reload).not.toHaveBeenCalled();
    root.querySelector('button')!.dispatchEvent(new window.Event('click'));expect(reload).toHaveBeenCalledOnce();
  });

  it('replaces a slow-load message with safe failure guidance and never exposes errors or private configuration', () => {
    feedback = createPopupStartupFeedback('#app');vi.advanceTimersByTime(5000);
    (feedback.fail as (error?: unknown) => void)(new Error('Bearer SECRET https://private.example/body?token=SECRET'));
    const root = document.querySelector('#app')!;
    expect(root.textContent).toContain('暂时无法打开流畅阅读');
    expect(root.innerHTML).not.toMatch(/SECRET|Bearer|private\.example|token|Error|stack/);
    expect(root.querySelectorAll('section')).toHaveLength(1);expect(root.querySelectorAll('button')).toHaveLength(1);
    vi.advanceTimersByTime(60_000);expect(root.textContent).toContain('暂时无法打开流畅阅读');expect(reload).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shows failure immediately and cancels the pending slow-load replacement', () => {
    feedback = createPopupStartupFeedback('#app');vi.advanceTimersByTime(1000);feedback.fail();
    const root = document.querySelector('#app')!;
    const failure = root.innerHTML;vi.advanceTimersByTime(60_000);
    expect(root.innerHTML).toBe(failure);expect(root.textContent).not.toContain('正在读取设置');
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['en-US', 'pt-BR', ''])('uses a comprehensible English fallback for %s', language => {
    vi.stubGlobal('navigator', {language});feedback = createPopupStartupFeedback('#app');vi.advanceTimersByTime(5000);
    expect(document.querySelector('#app')!.textContent).toContain('Still loading your settings');
    feedback.fail();expect(document.querySelector('#app')!.textContent).toContain('Could not open FluentRead');
    expect(document.querySelector('button')!.textContent).toBe('Reopen');
  });

  it.each([
    {locale: 'zh-CN', waiting: '正在读取设置…', failed: '暂时无法打开流畅阅读', detail: '已保存的偏好会保留', button: '重新打开'},
    {locale: 'en-US', waiting: 'Still loading your settings…', failed: 'Could not open FluentRead', detail: 'Saved preferences are preserved', button: 'Reopen'},
    {locale: 'ja-JP', waiting: '設定を読み込んでいます…', failed: 'FluentReadを開けませんでした', detail: '保存した設定は保持されています', button: '開き直す'},
    {locale: 'ko-KR', waiting: '설정을 불러오는 중…', failed: 'FluentRead를 열 수 없습니다', detail: '저장한 설정은 유지됩니다', button: '다시 열기'},
    {locale: 'fr-FR', waiting: 'Chargement de vos paramètres…', failed: 'Impossible d’ouvrir FluentRead', detail: 'Vos préférences sont conservées', button: 'Rouvrir'},
    {locale: 'ru-RU', waiting: 'Загружаем настройки…', failed: 'Не удалось открыть FluentRead', detail: 'Сохранённые настройки не изменились', button: 'Открыть снова'},
    {locale: 'es-ES', waiting: 'Cargando tu configuración…', failed: 'No se pudo abrir FluentRead', detail: 'Tus preferencias se conservan', button: 'Volver a abrir'},
  ])('renders waiting, safe failure and manual recovery in $locale', ({locale, waiting, failed, detail, button}) => {
    vi.stubGlobal('navigator', {language: locale});feedback = createPopupStartupFeedback('#app');
    vi.advanceTimersByTime(5000);expect(document.querySelector('strong')!.textContent).toBe(waiting);
    expect(document.querySelector('p')!.textContent).toContain(detail);expect(document.querySelector('button')!.textContent).toBe(button);
    feedback.fail();expect(document.querySelector('strong')!.textContent).toBe(failed);
    expect(document.querySelector('p')!.textContent).toContain(detail);expect(reload).not.toHaveBeenCalled();
    document.querySelector('button')!.dispatchEvent(new window.Event('click'));expect(reload).toHaveBeenCalledOnce();
  });

  it.each([['FR-ca', 'Rouvrir'], ['es-MX', 'Volver a abrir'], ['JA_jp', '開き直す']])('routes browser language variant %s using its primary language', (language, label) => {
    vi.stubGlobal('navigator', {language});feedback = createPopupStartupFeedback('#app');feedback.fail();
    expect(document.querySelector('button')!.textContent).toBe(label);expect(navigator.language).toBe(language);
  });

  it('supports Chinese browser locale variants without persisting or changing any language preference', () => {
    vi.stubGlobal('navigator', {language: 'zh-TW'});feedback = createPopupStartupFeedback('#app');feedback.fail();
    expect(document.querySelector('button')!.textContent).toBe('重新打开');
    expect(navigator.language).toBe('zh-TW');
  });

  it.each(['dispose', 'pagehide'] as const)('%s prevents late failures, timer writes and old recovery buttons from acting', cause => {
    feedback = createPopupStartupFeedback('#app');vi.advanceTimersByTime(5000);
    const button = document.querySelector('button')!;
    if (cause === 'dispose') feedback.dispose();else window.dispatchEvent(new window.Event('pagehide'));
    document.querySelector('#app')!.textContent = 'New app owns this root';
    feedback.fail();vi.advanceTimersByTime(60_000);button.dispatchEvent(new window.Event('click'));
    expect(document.querySelector('#app')!.textContent).toBe('New app owns this root');
    expect(reload).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
  });

  it('can be disposed before the five-second timer and handles a missing root safely', () => {
    feedback = createPopupStartupFeedback('#app');feedback.dispose();
    vi.advanceTimersByTime(60_000);expect(document.querySelector('.original-spinner')).not.toBeNull();
    feedback = createPopupStartupFeedback('#missing');
    expect(() => {vi.advanceTimersByTime(5000);feedback!.fail();}).not.toThrow();
    expect(document.querySelector('.original-spinner')).not.toBeNull();expect(reload).not.toHaveBeenCalled();
  });
});
