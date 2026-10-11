import {afterEach, describe, expect, it, vi} from 'vitest';
import {parseHTML} from 'linkedom';
import {preparePageDiscourseContext, resetPageDiscourseContext} from '@/src/services/translation/context/pageDiscourse';

function article(html: string, url = 'https://example.test/one') {
    const {document} = parseHTML(`<html><body><article>${html}</article></body></html>`);
    Object.defineProperty(document, 'location', {value: {href: url}, configurable: true});
    // linkedom 在不同嵌套容器里的 compareDocumentPosition 会双向返回 PRECEDING；按实际树顺序校正夹具。
    let positions = new WeakMap<Node, number>();
    const refreshPositions = () => {
        positions = new WeakMap(); let index = 0;
        const visit = (node: Node) => {positions.set(node, index++); for (const child of Array.from(node.childNodes)) visit(child);};
        visit(document);
    };
    refreshPositions();
    const normalized = new WeakSet<Element>();
    const normalizePosition = (node: Node) => {
        if (node.nodeType !== 1 || normalized.has(node as Element)) return;
        const element = node as Element;
        normalized.add(element);
        element.compareDocumentPosition = (other: Node) => {
            if (element === other) return 0;
            if (!element.isConnected || !other.isConnected || other.ownerDocument !== document) return 1;
            if (element.contains(other)) return 20;
            if (other.contains(element)) return 10;
            if (!positions.has(element) || !positions.has(other)) refreshPositions();
            return positions.get(element)! < positions.get(other)! ? 4 : 2;
        };
    };
    // linkedom 不执行 TreeWalker filter；本夹具按浏览器规则剪枝，生产浏览器另行核对。
    document.createTreeWalker = ((root: Node, _show: number, filter: {acceptNode(node: Node): number}) => {
        const nodes: Node[] = [];
        normalizePosition(root);
        const visit = (node: Node) => {
            for (const child of Array.from(node.childNodes)) {
                normalizePosition(child);
                if (filter.acceptNode(child) === 2) continue;
                nodes.push(child); visit(child);
            }
        };
        visit(root); let index = 0;
        return {nextNode: () => nodes[index++] ?? null};
    }) as typeof document.createTreeWalker;
    return document;
}
const context = (doc: Document, selector = '#later', language = 'en:zh', signal?: AbortSignal) => {
    const owner = doc.querySelector(selector)!;
    return preparePageDiscourseContext(owner, [owner.textContent!], language, signal);
};
afterEach(resetPageDiscourseContext);

describe('有界网页篇章适配', () => {
    it('无章节标题的相邻段落移动焦点时保留人物原文与既有译法，不把窗口移动当正文改写', () => {
        const doc = article('<p id="previous">Aurora is the lead scientist.</p><p id="later">Aurora returned to the laboratory.</p>');
        const previous = context(doc, '#previous'); previous.commit(['曙光是首席科学家。']);
        const later = context(doc).context;
        expect(later).toContain('曙光是首席科学家。');
        expect(JSON.parse(later).evidence).toEqual(expect.arrayContaining([
            expect.objectContaining({kind: 'previous_machine', source: 'Aurora is the lead scientist.', translation: '曙光是首席科学家。'}),
        ]));
    });

    it('无标题文章的相邻段落各有布局容器时仍能沿用同一人物的既有译法', () => {
        const doc = article('<section><div><p id="previous">Aurora is the lead scientist.</p></div><div><p id="later">Aurora returned to the laboratory.</p></div></section>');
        const previous = context(doc, '#previous'); previous.commit(['曙光是首席科学家。']);
        expect(context(doc).context).toContain('曙光是首席科学家。');
    });

    it.each([
        '<form><p id="later">private input</p></form>',
        '<div contenteditable="true"><p id="later">private draft</p></div>',
        '<div hidden><p id="later">hidden source</p></div>',
        '<p id="later" data-fr-translation-owned="true">extension translation</p>',
    ])('误路由到隐藏、编辑或扩展所有者时不创建参考或译法记录：%s', html => {
        const doc = article('<p id="safe">AP means safe context.</p>' + html);
        const owner = doc.querySelector('#later')!;
        const privateTicket = preparePageDiscourseContext(owner, ['private source'], 'en:zh');
        expect(privateTicket.context).toBe('');
        privateTicket.commit(['不应进入篇章的私人译文']);
        expect(context(doc, '#safe').context).not.toContain('私人译文');
    });

    it('扩展译文更新不作废材料，真正的定义改写只通知一次正文变更', () => {
        const doc = article('<h2>Network</h2><p id="definition">AP means admission permit.</p><p id="later">AP retries traffic.</p>');
        const owner = doc.querySelector('#later')!;
        const changed = vi.fn();
        const prepare = () => preparePageDiscourseContext(owner, ['AP retries traffic.'], 'en:zh', undefined, changed);
        prepare();
        doc.querySelector('#definition')!.insertAdjacentHTML('beforeend', '<span data-fr-translation-owned="true">private model output</span>');
        const afterTranslation = prepare();
        expect(afterTranslation.context).not.toContain('private model output');
        expect(changed).not.toHaveBeenCalled();
        doc.querySelector('#definition')!.textContent = 'AP means access point.';
        expect(prepare().context).toContain('access point');
        expect(changed).toHaveBeenCalledOnce();
        prepare();
        expect(changed).toHaveBeenCalledOnce();
    });

    it('密集长文相邻焦点移动不因预算边界截断触发正文变更或删除已有译法', () => {
        const long = (index: number) => `<p>Background ${index}: ${'x'.repeat(1000)}</p>`;
        const doc = article('<h2>Opening</h2>' + Array.from({length: 200}, (_, index) => long(index)).join('')
            + '<h2>Lab</h2>' + Array.from({length: 45}, (_, index) => long(index + 200)).join('')
            + '<p id="previous">Aurora is the lead scientist.</p><p id="later">Aurora returned to the laboratory.</p>');
        const changed = vi.fn();
        const previous = doc.querySelector('#previous')!;
        const ticket = preparePageDiscourseContext(previous, [previous.textContent!], 'en:zh', undefined, changed);
        ticket.commit(['曙光是首席科学家。']);
        const later = doc.querySelector('#later')!;
        const reference = preparePageDiscourseContext(later, [later.textContent!], 'en:zh', undefined, changed).context;
        expect(reference).toContain('曙光是首席科学家。');
        expect(reference.length).toBeLessThanOrEqual(2400);
        expect(changed).not.toHaveBeenCalled();
    });

    it('当前原文的节点数量超过证明预算时仍能阅读，但不提交未经完整复验的译法', () => {
        const doc = article('<h2>Network</h2><p id="previous">AP is a controller.' + '<i>x</i>'.repeat(5000) + '</p><p id="later">AP continues.</p>');
        const ticket = context(doc, '#previous');
        expect(ticket.context.length).toBeLessThanOrEqual(2400);
        ticket.commit(['不完整原文证明的译法']);
        expect(context(doc).context).not.toContain('不完整原文证明');
    });

    it.each([80, 1000])('长文跳转积累超过记忆预算后保留当前材料，焦点移动不伪造正文改写（每段 %i 字）', length => {
        const paragraphs = Array.from({length: 600}, (_, index) => `<p id="p${index}">Background ${index}: ${'x'.repeat(length)}</p>`).join('');
        const doc = article('<h2>Opening</h2>' + paragraphs);
        const changed = vi.fn();
        for (const index of [150, 350, 550, 151]) {
            const owner = doc.querySelector(`#p${index}`)!;
            const ticket = preparePageDiscourseContext(owner, [owner.textContent!], 'en:zh', undefined, changed);
            expect(ticket.context.length).toBeLessThanOrEqual(2400);
            expect(JSON.parse(ticket.context).position).toBeTruthy();
        }
        expect(changed).not.toHaveBeenCalled();
    });

    it('当前段的单槽原文可作为提交证明，普通扩展译文不进入原文或阻止有效回写', () => {
        const doc = article('<h2>Lab</h2><div id="previous"><span class="fluent-read-single-slot" data-fr-translation-owned="true">Aurora is the scientist.</span><span data-fr-translation-owned="true">private model output</span></div><p id="later">Aurora returned.</p>');
        const owner = doc.querySelector('#previous')!;
        const ticket = preparePageDiscourseContext(owner, ['Aurora is the scientist.'], 'en:zh');
        ticket.commit(['曙光是这位科学家。']);
        const reference = context(doc).context;
        expect(reference).toContain('曙光是这位科学家。');
        expect(reference).not.toContain('private model output');
    });

    it('当前单元包含大量短段落时块预算依然有界，并排除可编辑内容', () => {
        const doc = article('<div id="later">' + '<p>x</p>'.repeat(300) + '<form><p>private draft</p></form><p>Aurora continues.</p></div>');
        const owner = doc.querySelector('#later')!;
        const ticket = preparePageDiscourseContext(owner, ['x'.repeat(300) + 'Aurora continues.'], 'en:zh');
        expect(ticket.context.length).toBeLessThanOrEqual(2400);
        expect(ticket.context).not.toContain('private draft');
    });

    it('标题之前的引言不继承后面的章节译法，文档根候选也有安全的正文作用域', () => {
        const doc = article('<p id="intro">AP means admission permit.</p><h2>Network</h2><p id="previous">AP means access point.</p><p id="later">AP connects devices.</p>');
        const previous = context(doc, '#previous'); previous.commit(['接入点。']);
        expect(context(doc, '#intro').context).not.toContain('接入点。');
        const root = doc.documentElement;
        expect(preparePageDiscourseContext(root, [root.textContent!], 'en:zh').context.length).toBeLessThanOrEqual(2400);
    });

    it('相邻布局容器内有多个章节标题时跟随最近的章节，不把较早同名缩写合并', () => {
        const doc = article('<div><h2>Permits</h2><p id="previous">AP means admission permit.</p><h2>Network</h2><p>AP means access point.</p></div><p id="later">AP connects devices.</p>');
        context(doc, '#previous').commit(['准入许可旧章译法']);
        const reference = context(doc).context;
        expect(reference).toContain('access point');
        expect(reference).not.toContain('准入许可旧章译法');
    });

    it('无文章容器时使用body和Document URL，缺失body时安静降级', () => {
        const doc = article('<h2>Network</h2><p id="previous">AP means access point.</p><p id="later">AP connects devices.</p>');
        const root = doc.querySelector('article')!;
        root.replaceWith(...Array.from(root.childNodes));
        Object.defineProperty(doc, 'location', {value: undefined, configurable: true});
        Object.defineProperty(doc, 'URL', {value: 'https://example.test/fallback', configurable: true});
        expect(context(doc).context).toContain('access point');
        const previous = context(doc, '#previous'); previous.commit(['AP 代表接入点。']);
        expect(context(doc).context).toContain('AP 代表接入点。');
        Object.defineProperty(doc, 'body', {value: null, configurable: true});
        const empty = context(doc);
        expect(empty.context).toBe('');
        empty.commit(['不存在正文的译法']);
    });

    it('缺失location和Document URL时用当前正文隔离材料，读取及提交不抛异常', () => {
        const doc = article('<p id="previous">AP means access point.</p><p id="later">AP connects devices.</p>');
        Object.defineProperty(doc, 'location', {value: undefined, configurable: true});
        Object.defineProperty(doc, 'URL', {value: undefined, configurable: true});
        const previous = context(doc, '#previous'); previous.commit(['没有URL的接入点译法']);
        expect(context(doc).context).toContain('没有URL的接入点译法');
        const next = article('<p id="later">AP continues in another document.</p>');
        Object.defineProperty(next, 'location', {value: undefined, configurable: true});
        Object.defineProperty(next, 'URL', {value: undefined, configurable: true});
        expect(context(next).context).not.toContain('没有URL的接入点译法');
    });

    it('后文带定义与位置，已译段落复用且扩展译文及输入不进入采集', () => {
        const doc = article('<h2>Network</h2><p id="definition">AP means admission permit.</p><p id="previous">AP regulates traffic.</p><p id="later">AP rejects traffic.</p><form><p>AP means secret password.</p></form>');
        const previous = context(doc, '#previous'); previous.commit(['准入许可控制流量。']);
        doc.querySelector('#previous')!.insertAdjacentHTML('beforeend', '<span data-fr-translation-owned="true" class="fluent-read-bilingual-content">AP means poisoned translation.</span>');
        const later = context(doc).context;
        expect(later).toContain('admission permit');
        expect(later).toContain('准入许可');
        expect(later).not.toContain('secret password');
        expect(later).not.toContain('poisoned');
        expect(JSON.parse(later).position).toContain('block');
    });
    it('同URL原文更新、路由、语言、正文root替换使旧回写失效', () => {
        const doc = article('<h2>Network</h2><p id="previous">AP means admission permit.</p><p id="later">AP rejects traffic.</p>');
        const old = context(doc, '#previous');
        doc.querySelector('#previous')!.textContent = 'AP means access point.';
        old.commit(['旧译法']);
        expect(context(doc).context).toContain('access point');
        expect(context(doc).context).not.toContain('旧译法');
        const route = context(doc, '#previous'); doc.location.href = 'https://example.test/two';
        const currentRoute = context(doc, '#previous'); currentRoute.commit(['本页接入点译法']);
        route.commit(['前页译法']);
        expect(context(doc).context).not.toContain('前页译法');
        expect(context(doc).context).toContain('本页接入点译法');
        const language = context(doc, '#previous');
        const japanese = context(doc, '#previous', 'en:ja'); japanese.commit(['AP はアクセスポイントです。']);
        language.commit(['旧语种']);
        expect(context(doc, '#later', 'en:ja').context).not.toContain('旧语种');
        expect(context(doc, '#later', 'en:ja').context).toContain('AP はアクセスポイントです。');
        const removed = context(doc, '#previous'); doc.querySelector('article')!.innerHTML = '<p id="later">A different article.</p>'; removed.commit(['已移除']);
        expect(context(doc).context).not.toContain('已移除');
    });

    it('普通锚点跳转保留已经提交的译法，在途结果也能进入同篇新锚点上下文', () => {
        const doc = article('<p id="settled">Aurora is the lead scientist.</p><p id="previous">Aurora leads the laboratory.</p><p id="later">Aurora returned.</p>', 'https://example.test/book#introduction');
        context(doc, '#settled').commit(['曙光是首席科学家。']);
        const inFlight = context(doc, '#previous');
        doc.location.href = 'https://example.test/book#chapter-two';
        const owner = doc.querySelector('#later')!;
        const changed = vi.fn();
        const afterAnchor = preparePageDiscourseContext(owner, [owner.textContent!], 'en:zh', undefined, changed);
        expect(afterAnchor.context).toContain('曙光是首席科学家。');
        inFlight.commit(['曙光带领实验室。']);
        const reference = context(doc).context;
        expect(reference).toContain('曙光是首席科学家。');
        expect(reference).toContain('曙光带领实验室。');
        expect(changed).not.toHaveBeenCalled();
    });

    it.each(['#/', '#!/'])('真实hash路由%s更换材料，旧译法与在途结果不影响新路由的译法', prefix => {
        const doc = article('<p id="settled">Aurora is the lead scientist.</p><p id="previous">Aurora leads the laboratory.</p><p id="later">Aurora returned.</p>', `https://example.test/book${prefix}one`);
        context(doc, '#settled').commit(['旧路由的曙光译法']);
        const inFlight = context(doc, '#previous');
        doc.location.href = `https://example.test/book${prefix}two`;
        expect(context(doc).context).not.toContain('旧路由的曙光译法');
        context(doc, '#previous').commit(['新路由的极光译法']);
        inFlight.commit(['旧路由的迟到结果']);
        const reference = context(doc).context;
        expect(reference).toContain('新路由的极光译法');
        expect(reference).not.toContain('旧路由的曙光译法');
        expect(reference).not.toContain('旧路由的迟到结果');
    });
    it('取消、重置、隐藏正文及无正文不保存译法', () => {
        const doc = article('<p id="previous">Sable is a queue.</p><p id="later">Sable continues.</p>');
        const abort = new AbortController(); const ticket = context(doc, '#previous', 'en:zh', abort.signal); abort.abort(); ticket.commit(['污染']);
        expect(context(doc).context).not.toContain('污染');
        expect(context(doc, '#later', 'en:zh', abort.signal).context).toBe('');
        const reset = context(doc, '#previous'); resetPageDiscourseContext(); reset.commit(['旧会话']);
        expect(context(doc).context).not.toContain('旧会话');
        doc.querySelector('article')!.setAttribute('hidden', '');
        expect(context(doc).context).toBe('');
        doc.querySelector('article')!.remove();
        const outside = doc.createElement('p'); outside.textContent = 'outside';
        expect(preparePageDiscourseContext(outside, ['outside'], 'en:zh').context).toBe('');
    });
    it('深处章节窗口能采集当前定义，单槽light DOM只保留原文，超限依然有界', () => {
        const doc = article('<h2>Opening</h2>' + '<p>Background data.</p>'.repeat(290)
            + '<h2>Lab</h2><p id="previous">AP means action potential.</p><p id="later">AP regulates readings.</p>');
        doc.querySelector('#previous')!.innerHTML = '<span class="fluent-read-single-slot" data-fr-translation-owned="true">AP means action potential.</span>';
        const ticket = context(doc); expect(ticket.context).toContain('action potential');
        expect(ticket.context.length).toBeLessThanOrEqual(2400);
        doc.querySelector('#previous')!.remove();
        ticket.commit(['已变更']);
        expect(context(doc).context).not.toContain('已变更');
    });

    it('正文前64块之外的相邻段落各有多层布局容器时保留当前定义和已译依据', () => {
        const wrap = (source: string, id = '') => `<div><div><div><p${id ? ` id="${id}"` : ''}>${source}</p></div></div></div>`;
        const doc = article('<h2>Opening</h2>' + Array.from({length: 90}, (_, index) => wrap(`Background ${index}.`)).join('')
            + '<h2>Lab</h2>' + wrap('AP means action potential.', 'previous') + wrap('AP regulates readings.', 'later'));
        context(doc, '#previous').commit(['AP 表示动作电位。']);
        const reference = context(doc).context;
        expect(reference).toContain('action potential');
        expect(reference).toContain('AP 表示动作电位。');
        expect(reference.length).toBeLessThanOrEqual(2400);
    });

    it('超过八层的单子容器不无限向外寻找邻段，深层候选仍返回有界参考', () => {
        const wrap = (source: string, id = '') => '<div>'.repeat(12) + `<p${id ? ` id="${id}"` : ''}>${source}</p>` + '</div>'.repeat(12);
        const doc = article('<h2>Opening</h2>' + Array.from({length: 90}, (_, index) => wrap(`Background ${index}.`)).join('')
            + wrap('Luma is the scientist in a deeply nested sibling.', 'previous') + wrap('Luma returned.', 'later'));
        context(doc, '#previous').commit(['深层兄弟节点里的人物译法']);
        const reference = context(doc).context;
        expect(reference.length).toBeLessThanOrEqual(2400);
        expect(reference).not.toContain('scientist in a deeply nested sibling');
        expect(reference).not.toContain('深层兄弟节点里的人物译法');
    });
    it('在途长段尾部更新不把千字前缀相同的旧译文提交为篇章依据', () => {
        const doc = article('<h2>Network</h2><p id="previous">AP controls ' + 'source data '.repeat(110) + ' old tail.</p><p id="later">AP continues.</p>');
        const owner = doc.querySelector('#previous')!;
        const ticket = context(doc, '#previous');
        owner.textContent = owner.textContent!.replace('old tail', 'updated tail'); ticket.commit(['迟到译法']);
        expect(context(doc).context).not.toContain('迟到译法');
        owner.textContent = 'AP controls ' + 'x'.repeat(70000);
        const oversized = context(doc, '#previous'); oversized.commit(['超预算译法']);
        expect(context(doc).context).not.toContain('超预算译法');
    });

    it('已经提交的长段在千字之后改写，也会清除后文引用的旧译文依据', () => {
        const doc = article('<h2>Network</h2><p id="previous">AP controls ' + 'source data '.repeat(110) + ' old tail.</p><p id="later">AP continues.</p>');
        const owner = doc.querySelector('#previous')!;
        const first = context(doc, '#previous'); first.commit(['初次控制器译法。']);
        const previous = context(doc, '#previous'); previous.commit(['旧尾部对应的控制器译法。']);
        expect(context(doc).context).toContain('旧尾部对应的控制器译法。');
        expect(context(doc).context).not.toContain('初次控制器译法。');
        owner.textContent = owner.textContent!.replace('old tail', 'updated tail');
        expect(context(doc).context).not.toContain('旧尾部对应的控制器译法。');
    });

    it('已译原文从页面移除时撤销对应依据并通知正文变化', () => {
        const doc = article('<p id="previous">AP means access point.</p><p id="later">AP continues.</p>');
        context(doc, '#previous').commit(['已删除定义的译法']);
        doc.querySelector('#previous')!.remove();
        const owner = doc.querySelector('#later')!;
        const changed = vi.fn();
        const reference = preparePageDiscourseContext(owner, [owner.textContent!], 'en:zh', undefined, changed).context;
        expect(reference).not.toContain('已删除定义的译法');
        expect(changed).toHaveBeenCalledOnce();
    });

    it.each([{length: 80, tag: 'div'}, {length: 2000, tag: 'p'}])('已译来源超过条数或总字符预算后仍可引用刚验证的结果（%j）', ({length, tag}) => {
        const doc = article(Array.from({length: 70}, (_, index) => `<${tag} id="p${index}">AP controls station ${index}. ${'x'.repeat(length)}</${tag}>`).join('') + '<p id="later">AP continues.</p>');
        for (let index = 0; index < 70; index++) context(doc, `#p${index}`).commit([`接入点处理站点 ${index}。`]);
        const reference = context(doc).context;
        expect(reference.length).toBeLessThanOrEqual(2400);
        expect(reference).toContain('接入点处理站点 69。');
    });

    it('多个已译单元的总核验节点超限时撤销无法完整检查的依据', () => {
        const doc = article('<p id="first">AP controls station one.' + '<i>x</i>'.repeat(2500) + '</p><p id="second">AP controls station two.' + '<i>x</i>'.repeat(2500) + '</p><p id="later">AP continues.</p>');
        context(doc, '#first').commit(['第一个站点译法']);
        context(doc, '#second').commit(['无法在总节点预算内复验的第二站点译法']);
        const reference = context(doc).context;
        expect(reference.length).toBeLessThanOrEqual(2400);
        expect(reference).not.toContain('无法在总节点预算内复验');
    });

    it('节点及字符预算截断仍保留当前位置，无TreeWalker时静默降级', () => {
        const doc = article('<div>' + '<span>long text</span>'.repeat(9000) + '</div><div id="later">A current passage.</div>');
        expect(context(doc).context.length).toBeLessThanOrEqual(2400);
        const large = article('<p>' + 'x'.repeat(100000) + '</p><p id="later">Current.</p>');
        expect(context(large).context.length).toBeLessThanOrEqual(2400);
        Object.defineProperty(large, 'createTreeWalker', {value: undefined});
        expect(context(large).context).toBe('');
    });
});
