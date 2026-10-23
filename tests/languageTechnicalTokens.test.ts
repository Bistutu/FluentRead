/**
 * @file tests/languageTechnicalTokens.test.ts
 * 识别副本的技术标识符规则：URL、邮箱、提及、行内代码、路径、文件名、UUID、提交哈希、版本号、带版本名称、
 * 代码标识符和字母数字编号在不同位置、大小写、标点与中日韩相邻边界下被遮蔽；普通外语词、单级斜杠组合、
 * 伪哈希和被大写的句子不得被当作标识符；明确中文读音角色的 IPA 注音有界遮蔽，普通外语、无角色注音和跨行保留；非 Latin 正文中 Latin 词的角色与权重。
 */
import {describe, expect, it} from 'vitest';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {shouldSkipTranslationForTarget} from '@/src/core/language/detect';
import {identifyTextLanguage} from '@/src/core/language/identify';
import {
    classifyEmbeddedLatinWord,
    createLanguageDetectionCopy,
    isAcronymWord,
    isMixedCaseName,
} from '@/src/core/language/technicalTokens';

function masked(text: string): string {
    return createLanguageDetectionCopy(text).text.replace(/\s+/gu, ' ').trim();
}

describe('结构化标识符遮蔽', () => {
    it.each([
        ['url', 'https://github.com/solidSpoon/DashPlayer/commit/84522b3ff33401f87da8d5d7c4510ea5453e40ef'],
        ['url-query', 'https://example.com/a?b=c&d=e#frag'],
        ['url-www', 'www.example.org/path'],
        ['url-ftp', 'ftp://files.example.net/pub/file'],
        ['domain', 'github.com/foo/bar'],
        ['domain-plain', 'docs.example.dev'],
        ['email', 'support@example.com'],
        ['mention', '@solidSpoon'],
        ['inline-code', '`npm run build --watch`'],
        ['path-relative', 'src/core/language/detect.ts'],
        ['path-root', '/usr/local/bin'],
        ['path-home', '~/Library/Caches'],
        ['path-windows', 'C:\\Users\\Public\\file.txt'],
        ['file', 'README.md'],
        ['file-dotted', 'vite.config.ts'],
        ['file-dotfile', '.gitignore.lock'],
        ['file-js-name', 'Node.js'],
        ['uuid', '123e4567-e89b-12d3-a456-426614174000'],
        ['hash-short', '84522b3'],
        ['hash-upper', '84522B3'],
        ['hash-long', '84522b3ff33401f87da8d5d7c4510ea5453e40ef'],
        ['hash-sha256', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
        ['version', 'v2.3.1'],
        ['version-prerelease', '1.0.0-beta.2+build.5'],
        ['model', 'GPT-6'],
        ['model-suffix', 'GPT-6 Sol'],
        ['model-space-version', 'Claude 3.5 Sonnet'],
        ['model-size', 'Llama-3.1-70B-Instruct'],
        ['model-joined', 'Qwen2.5-7B'],
        ['model-variant', 'GPT-4o-mini'],
        ['model-prefix', 'OpenAI GPT-6'],
        ['product', 'iPhone 15 Pro Max'],
        ['member-call', 'console.log()'],
        ['member-chain', 'window.location.href'],
        ['function-call', 'translate(text)'],
        ['snake-case', 'max_retry_count'],
        ['cli-flag', '--force-rebuild'],
        ['placeholder', '{{userName}}'],
        ['template', '${value}'],
        ['html-tag', '<div class="note">'],
        ['alphanumeric', 'H100'],
        ['alphanumeric-dash', 'COVID-19'],
        ['alphanumeric-underscore', 'x86_64'],
        ['alphanumeric-broken-hash', '84522b3g'],
    ])('%s 标识符在中文句首、句中、句尾和紧贴汉字时均被遮蔽', (_kind, token) => {
        for (const text of [`${token} 已发布`, `详见 ${token} 说明`, `请查看 ${token}`, `推出${token}系列`, `（${token}）`]) {
            const copy = createLanguageDetectionCopy(text);
            expect(copy.text).not.toMatch(/[A-Za-z]{2,}/u);
            expect(copy.identifiers + copy.versionedNames).toBeGreaterThan(0);
            expect(copy.text).toContain(text.replace(token, '').replace(/\s+/gu, ' ').trim().slice(0, 1));
        }
    });

    it('识别副本不修改原字符串，只返回新文本和计数', () => {
        const source = '云端模型清单允许清空 (84522b3)';
        const copy = createLanguageDetectionCopy(source);
        expect(source).toBe('云端模型清单允许清空 (84522b3)');
        expect(copy).toEqual({text: '云端模型清单允许清空 ( )', identifiers: 1, versionedNames: 0});
    });

    it('先匹配 URL 与路径，避免其中的版本或文件名被拆成零散字母', () => {
        expect(createLanguageDetectionCopy('下载 https://example.com/v2.3.1/app.zip 后安装')).toEqual({
            text: '下载   后安装', identifiers: 1, versionedNames: 0,
        });
        expect(masked('See docs/guide/v1.2/README.md now')).toBe('See now');
    });

    it('NFD 输入先规范为 NFC，带附加符号的 Latin 字母不会被拆开', () => {
        expect(createLanguageDetectionCopy('Cafe\u0301 ouvert').text).toBe('Café ouvert');
    });
});

describe('Markdown 链接目标与相邻正文', () => {
    it.each([
        'https://example.com', 'www.example.com/path', 'example.com/guide',
        'https://example.com/a_(b)', 'example.com/a_(b_(c))',
        String.raw`https://example.com/a\)b`, String.raw`https://example.com/a\(b`,
        String.raw`https://example.com/a\\`,
        'https://example.com/a?x=1&y=2#part',
    ])('目标 %s 之外的正文完整保留，混合段落不能被跳过', target => {
        const source = `This is a link to [read the manual](${target})请保存设置后重启浏览器。`;
        const copy = createLanguageDetectionCopy(source);
        expect(copy.text).toBe('This is a link to [read the manual]( )请保存设置后重启浏览器。');
        expect(copy.identifiers).toBe(1);
        expect(identifyTextLanguage(source).status).toBe('mixed');
        expect(shouldSkipTranslationForTarget(source, 'en')).toBe(false);
        expect(shouldSkipTranslationForTarget(source, 'zh-Hans')).toBe(false);
        expect(source).toBe(`This is a link to [read the manual](${target})请保存设置后重启浏览器。`);
    });

    it.each([
        '[说明]( https://example.com)Retry。',
        '![说明](https://example.com/picture.png)Retry。',
        '[外层[内层]说明](https://example.com)Retry。',
        '[说明](https://example.com "帮助标题")Retry。',
        '[说明](<https://example.com>)Retry。',
    ])('标签、标题和紧贴外语不会被目标掩盖：%s', link => {
        const source = `请先阅读使用说明${link}`;
        expect(createLanguageDetectionCopy(source).text).toContain('Retry');
        expect(createLanguageDetectionCopy(source).text).toContain('说明');
        expect(shouldSkipTranslationForTarget(source, 'zh-Hans')).toBe(false);
    });

    it.each([
        '[read the manual](https://example.com请保存设置后重启浏览器。',
        '[read the manual](example.com/guide请保存设置后重启浏览器。',
        '[read the manual](https://example.com/a_(b)请保存设置后重启浏览器。',
        String.raw`[read the manual](https://example.com/a\)请保存设置后重启浏览器。`,
        '[read the manual](https://example.com/请保存设置后重启浏览器\\',
    ])('不完整目标保留不确定正文，不能猜测闭合位置：%s', link => {
        const source = `This is a link to ${link}`;
        expect(createLanguageDetectionCopy(source).text).toContain('请保存设置后重启浏览器');
        expect(shouldSkipTranslationForTarget(source, 'en')).toBe(false);
    });

    it('连续目标、空目标和带空格标题的边界互不影响', () => {
        const source = '[one](https://example.com)后续[two](example.org/path)正文[empty]()保留';
        expect(createLanguageDetectionCopy(source)).toEqual({
            text: '[one]( )后续[two]( )正文[empty]()保留', identifiers: 2, versionedNames: 0,
        });
        expect(createLanguageDetectionCopy('[说明](https://example.com "帮助标题")后续').text)
            .toBe('[说明](  "帮助标题")后续');
        expect(createLanguageDetectionCopy('https://example.com [未完成](   ').text).toBe('  [未完成](   ');
        expect(createLanguageDetectionCopy('[说明](https://example.com>保留正文').text).toBe('[说明]( >保留正文');
        expect(createLanguageDetectionCopy('[说明](a.www.example.com)保留正文').text).toBe('[说明](a. )保留正文');
    });

    it('无空格连续三万个链接在独立进程中有界完成并保留全部标签', () => {
        const sourcePath = resolve('src/core/language/technicalTokens.ts');
        // 加载真实生产模块；独立进程超时防止退化的匹配阻塞整个测试运行。
        const loader = `
            import fs from 'node:fs';
            import {createRequire} from 'node:module';
            const require = createRequire(process.cwd() + '/package.json');
            const ts = require('typescript');
            const source = fs.readFileSync(process.argv[1], 'utf8');
            const output = ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext}}).outputText;
            const {createLanguageDetectionCopy} = await import('data:text/javascript;base64,' + Buffer.from(output).toString('base64'));
            const copy = createLanguageDetectionCopy('[x](https://example.com)'.repeat(30000) + '正文');
            console.log(JSON.stringify({identifiers: copy.identifiers, complete: copy.text === '[x]( )'.repeat(30000) + '正文'}));
        `;
        const child = spawnSync(process.execPath, ['--input-type=module', '-e', loader, sourcePath], {
            encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024,
        });
        expect(child.error, child.stderr).toBeUndefined();
        expect(child.status, child.stderr).toBe(0);
        expect(JSON.parse(child.stdout)).toEqual({identifiers: 30000, complete: true});
    }, 10_000);
});

describe('带版本名称的边界', () => {
    it.each([
        ['GPT-6 Sol', 1], ['GPT-6 Sol.', 1], ['GPT-6 Sol。', 1], ['GPT-6系列', 1], ['推出GPT-6', 1],
        ['Claude 3.5 Sonnet', 1], ['Gemini 2.5 Pro', 1], ['Llama 3.1 70B Instruct', 1], ['iOS 18', 1],
        ['macOS 15 Sequoia', 1], ['Windows 11', 1], ['GPT-6 Sol 以及更小的 GPT-6 模型', 2],
    ])('%s 计为 %i 个名称并完整遮蔽', (text, count) => {
        const copy = createLanguageDetectionCopy(text);
        expect(copy.versionedNames).toBe(count);
        expect(copy.text).not.toMatch(/[A-Za-z]/u);
    });

    it.each([
        ['GPT-6 Sol Please translate this sentence.', 'Please translate this sentence.'],
        ['GPT-6，Sol 仍需要翻译', '，Sol 仍需要翻译'],
        ['GPT-6 模型，Sol 这个词需要翻译', '模型，Sol 这个词需要翻译'],
        ['GPT-6 Sol ERROR PLEASE RETRY', 'error please retry'],
        ['Released Claude 3.5 today', 'Released today'],
        ['GPT-6 Café', 'Café'],
        ['GPT-6 Sol5 发布', '发布'],
    ])('只吸收紧邻的一个首字母大写后缀：%s', (text, rest) => {
        expect(masked(text)).toBe(rest);
    });

    it('吸收后缀后与后续名称重叠的匹配不重复计数', () => {
        expect(createLanguageDetectionCopy('GPT-6 Sol 7 发布')).toEqual({text: '  7 发布', identifiers: 0, versionedNames: 1});
    });

    it('名称前缀只接受缩写或内部大写厂商名，普通首字母大写词不被吞掉', () => {
        expect(masked('OpenAI GPT-6 发布')).toBe('发布');
        expect(masked('Welcome Chapter 3')).toBe('Welcome');
    });

    it('超过 48 个字符的伪名称不作为名称遮蔽，其字母仍需由后续规则判断', () => {
        const longName = `${'A'.repeat(52)}-6 Sol`;
        const copy = createLanguageDetectionCopy(`预计将推出 ${longName} 模型`);
        expect(copy.versionedNames).toBe(0);
        expect(copy.text).toContain('Sol');
    });
});

describe('普通正文不能被误当标识符', () => {
    it.each([
        'Welcome to the settings page.',
        'and/or', 'ASS/SSA', 'TCP/IP', 'input/output', 'e.g. this', 'i.e. that',
        'decade', 'abcdefa', 'deadbeef', 'well-known', 'state-of-the-art', "aujourd'hui", 'Wi-Fi',
        'Chapter', 'Ελληνικά', 'Добро пожаловать', 'مرحبا بكم',
    ])('%s 保持原样', text => {
        const copy = createLanguageDetectionCopy(text);
        expect(copy.text).toBe(text);
        expect(copy.identifiers).toBe(0);
        expect(copy.versionedNames).toBe(0);
    });

    it('三个及以上连续全大写词还原为普通词，两个缩写仍保留缩写形态', () => {
        expect(createLanguageDetectionCopy('ERROR PLEASE RETRY').text).toBe('error please retry');
        expect(createLanguageDetectionCopy('AI API SDK').text).toBe('ai api sdk');
        expect(createLanguageDetectionCopy('AI API').text).toBe('AI API');
        expect(createLanguageDetectionCopy('错误：ERROR PLEASE').text).toBe('错误：ERROR PLEASE');
    });

    it('路径必须有两级分隔、根/相对前缀或末段扩展名', () => {
        expect(masked('src/app.ts')).toBe('');
        expect(masked('./local')).toBe('');
        expect(masked('km/h')).toBe('km/h');
    });
});

describe('非 Latin 正文中的 Latin 词角色', () => {
    it.each([
        ['PDF', 'format', 0], ['pdf', 'format', 0], ['ePub', 'format', 0], ['Markdown', 'format', 0], ['JSON', 'format', 0],
        ['A', 'letter', 1], ['x', 'letter', 1],
        ['AI', 'name', 2], ['OPENAI', 'name', 2], ['APIs', 'name', 2], ['OpenAI', 'name', 2], ['iPhone', 'name', 2],
        ['CoT', 'name', 2], ['GitHub', 'name', 2], ['api', 'name', 2], ['app', 'name', 2],
        ['Sol', 'prose', 0], ['Error', 'prose', 0], ['café', 'prose', 0], ['hello', 'prose', 0], ['Please', 'prose', 0],
        ['ABCDEFGHIJK', 'prose', 0], ['Api', 'prose', 0], ['AppleBananaCherryDurianElderberry', 'prose', 0],
    ] as const)('%s → %s（权重 %i）', (word, role, weight) => {
        expect(classifyEmbeddedLatinWord(word)).toEqual({role, weight});
    });

    it('缩写长度上限为 10，可带复数 s；内部大写名称上限 24 且不能是纯大写', () => {
        expect(isAcronymWord('ABCDEFGHIJ')).toBe(true);
        expect(isAcronymWord('ABCDEFGHIJs')).toBe(true);
        expect(isAcronymWord('ABCDEFGHIJK')).toBe(false);
        expect(isAcronymWord('A')).toBe(false);
        expect(isMixedCaseName('JavaScript')).toBe(true);
        expect(isMixedCaseName('PDFs')).toBe(false);
        expect(isMixedCaseName('A'.repeat(1) + 'b'.repeat(22) + 'C')).toBe(true);
        expect(isMixedCaseName('A' + 'b'.repeat(23) + 'C')).toBe(false);
    });
});

describe('明确中文读音角色的有限 IPA 注音', () => {
    it.each([
        ['发音 /ˈtɛstə/，请先保存。', '发音 ，请先保存。'],
        ['发音为 /teː/，请先保存。', '发音为 ，请先保存。'],
        ['读音是 /t͡ʃeɪn/，请先保存。', '读音是 ，请先保存。'],
        ['發音為 /ˌɐɹə/，請先儲存。', '發音為 ，請先儲存。'],
        ['讀音 /ˈɐɹə/，請先儲存。', '讀音 ，請先儲存。'],
        ['讀音是\t/ˈtɛstə/，請先儲存。', '讀音是 ，請先儲存。'],
    ])('仅从识别副本去除注音并保留中文角色和原文：%s', (source, expected) => {
        const before = source;
        const copy = createLanguageDetectionCopy(source);
        expect(masked(source)).toBe(expected);
        expect(copy.identifiers).toBe(1);
        expect(copy.versionedNames).toBe(0);
        expect(source).toBe(before);
    });

    it.each([
        'ˈkæt', 'høːs', 'ðə', 'ˈħa', 'ŋˈa', 'œˈa', 'βˈa', 'θiː', 'χˈa',
    ])('常用 IPA 跨 Unicode 区段字母保留既有独特信号要求：%s', phonetic => {
        const source = `发音 /${phonetic}/，请先保存。`;
        expect(masked(source)).toBe('发音 ，请先保存。');
        expect(createLanguageDetectionCopy(source).identifiers).toBe(1);
    });

    it('扩展字母不替代原有信号，不越过长度、空白、角色和引文边界', () => {
        expect(masked(`读音 /${'æ'.repeat(63)}ˈ/，请保存。`)).toBe('读音 ，请保存。');
        expect(masked(`读音 /ˈ${'æ'.repeat(63)}/，请保存。`)).toBe('读音 ，请保存。');
        expect(masked(`读音${' '.repeat(8)}/ˈkæt/，请保存。`)).toBe('读音 ，请保存。');
        for (const source of [
            `读音 /${'æ'.repeat(64)}ˈ/，请保存。`,
            `读音 /ˈ${'æ'.repeat(64)}/，请保存。`,
            `读音${' '.repeat(9)}/ˈkæt/，请保存。`,
            '读音\n/ˈkæt/，请保存。', '発音 /ˈkæt/ を確認してください。',
        ]) {
            expect(createLanguageDetectionCopy(source).text).toContain('æ');
        }
        for (const source of ['读音 /læge/，请保存。', '发音 /smør/，请保存。', '发音 /βa/，请保存。']) {
            expect(createLanguageDetectionCopy(source).text).toMatch(/[æøβ]/u);
        }
        expect(shouldSkipTranslationForTarget('请先保存，发音 /ˈkæt/。', 'zh-Hans')).toBe(true);
        expect(shouldSkipTranslationForTarget('請先儲存，讀音 /ˈkæt/。', 'zh-Hant')).toBe(true);
        for (const source of [
            '请先保存，发音 /ˈkæt/，Please restart the process.',
            '請先儲存，讀音 /ˈkæt/，英文原文是 Permission denied。',
            '请先保存，发音 /ˈkæt/，「The request was denied.」',
        ]) {
            expect(shouldSkipTranslationForTarget(source, 'zh-Hans')).toBe(false);
            expect(shouldSkipTranslationForTarget(source, 'zh-Hant')).toBe(false);
        }
    });

    it('注音与角色空白均有上限，连续注音不会借前一个角色跨越标点', () => {
        const phonetic = 'ɐ'.repeat(64);
        expect(masked(`读音${' '.repeat(8)}/${phonetic}/，请保存。`)).toBe('读音 ，请保存。');
        for (const source of [
            `读音 /${'ɐ'.repeat(65)}/，请保存。`,
            `读音${' '.repeat(9)}/ɐ/，请保存。`,
            '读音 /ɐ/；/ə/，请保存。',
        ]) {
            expect(createLanguageDetectionCopy(source).text).toContain('/');
        }
        expect(createLanguageDetectionCopy('读音 /ɐ/，发音 /ə/。').identifiers).toBe(2);
    });

    it.each([
        '/ˈɐɹə/', '英文原文 /ˈɐɹə/', 'pronunciation /ˈɐɹə/', '発音 /ˈɐɹə/',
        '读音\n/ˈɐɹə/', '发音：/ˈɐɹə/', '发音 /ˈɐ ɹə/',
        '发音 /ˈɐ，ɹə/', '发音 /ˈɐ/ɹə/',
    ])('无明确相邻角色、跨行和句子内容不整体成为注音：%s', text => {
        const copy = createLanguageDetectionCopy(text);
        expect(copy.text).toContain('ɹə');
    });

    it('保留普通外语、引文和角色后的其他正文，不降低混合文本保护', () => {
        for (const text of [
            '请先保存，发音 /please restart/。',
            '请先保存，发音 /ˈtɛstə/，Please restart the process.',
            '請先儲存，讀音 /ˈtɛstə/，英文原文是 Permission denied。',
            '请先保存，发音 /ˈtɛstə/，「The request was denied.」',
        ]) {
            expect(shouldSkipTranslationForTarget(text, 'zh-Hans')).toBe(false);
            expect(shouldSkipTranslationForTarget(text, 'zh-Hant')).toBe(false);
        }
        expect(createLanguageDetectionCopy('发音以及 /ˈɐɹə/').text).toContain('ˈɐɹə');
        expect(createLanguageDetectionCopy('请先保存，发音 /ˈɐɹə/。').text).toContain('发音');
        expect(shouldSkipTranslationForTarget('请先保存，发音 /ˈɐɹə/。', 'zh-Hans')).toBe(true);
        expect(shouldSkipTranslationForTarget('請先儲存，讀音 /ˈɐɹə/。', 'zh-Hant')).toBe(true);
    });
});
