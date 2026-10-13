/**
 * @file tests/languageIdentification.test.ts
 * 统一识别流水线与公开判断 API：空文本、仅标识符、主文字并列、中日韩分支、名称主导、夹带外语、
 * 单一语言文字与反证、多语言统计与逐句混合检测；detectlang 的规范返回契约；目标语言与排除语言等价；
 * 目标、排除列表或文本变化后重新比较且缓存只以文本为键；用户反馈原文与既有中日韩反例。
 */
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {afterEach, describe, expect, it, vi} from 'vitest';
import modelPost from './fixtures/chinese-language-model-post.json';
import {
    detectChineseScript,
    detectlang,
    isTextInLanguage,
    shouldSkipChineseSelection,
    shouldSkipTranslationForTarget,
} from '@/src/core/language/detect';
import {
    clearLanguageIdentificationCache,
    identifyTextLanguage,
    normalizeLanguageEvidenceText,
} from '@/src/core/language/identify';

afterEach(() => {
    clearLanguageIdentificationCache();
    vi.restoreAllMocks();
});

describe('识别状态', () => {
    it.each(['', '   ', '12345', '🎉🔥👀', '—（）…', '2026-09-16 12:00', '$19.99 → €18,50'])('无字母文本 %j 为 empty，所有目标无需请求', text => {
        expect(identifyTextLanguage(text)).toEqual({status: 'empty', languages: []});
        expect(shouldSkipTranslationForTarget(text, 'en')).toBe(true);
        expect(shouldSkipTranslationForTarget(text, 'zh-Hans')).toBe(true);
    });

    it.each([
        'https://github.com/solidSpoon/DashPlayer/commit/84522b3ff33401f87da8d5d7c4510ea5453e40ef',
        'GPT-6 Sol', 'src/core/language/detect.ts', '84522b3', 'v2.3.1',
    ])('只有标识符的文本 %s 为 unknown，保留翻译机会', text => {
        expect(identifyTextLanguage(text)).toMatchObject({status: 'unknown', languages: []});
        expect(shouldSkipTranslationForTarget(text, 'en')).toBe(false);
    });

    it.each(['PDF、ePub、DOCX、Markdown', 'AI API', 'OpenAI', 'A B C'])('只有名称、格式或单字母的文本 %s 没有正文证据', text => {
        expect(identifyTextLanguage(text).status).toBe('unknown');
        expect(shouldSkipTranslationForTarget(text, 'en')).toBe(false);
        expect(shouldSkipTranslationForTarget(text, 'zh-Hans')).toBe(false);
    });

    it('两种文字正文字母数相同时无法确定主文字', () => {
        expect(identifyTextLanguage('中文 ab').status).toBe('unknown');
        expect(identifyTextLanguage('これは Ελληνικά の説明です。').status).not.toBe('identified');
    });

    it.each([
        ['这些算法使用 AI，可以降低成本，但是 Please translate this sentence.', 'Latin 主文字夹带中文'],
        ['预计将推出 GPT-6 Sol Please translate this sentence.', '模型名后的英文句子'],
        ['这些算法可以降低成本，同时需要翻译 café。', '中文夹带普通外语词'],
        ['这些算法可以降低成本，同时还有 русский。', '中文夹带俄文'],
        ['この機能は便利です。 Добро пожаловать на наш сайт.', 'Cyrillic 主文字夹带日文'],
        ['한국어 설명 Русский текст.', 'Cyrillic 主文字夹带谚文'],
        ['Welcome to our website. Nous sommes très heureux de vous accueillir sur notre nouvelle plateforme aujourd\'hui.', '英文句子加法文句子'],
        ['Dieser Absatz beschreibt die Einstellungen der Anwendung sehr genau.\nThis sentence is written in English for the reader.', '换行分隔的德文与英文'],
        ['Καλώς ήρθατε στον ιστότοπό μας, please sign in first.', '希腊文夹带英文'],
        ['हमारी वेबसाइट पर आपका स्वागत है, but the login page is broken.', '印地文夹带英文'],
    ])('%s → mixed（%s）', text => {
        expect(identifyTextLanguage(text).status).toBe('mixed');
    });

    it('希腊字母单字作符号使用时不算外语正文', () => {
        expect(identifyTextLanguage('这个参数 α 控制学习率的衰减速度').status).not.toBe('mixed');
        const withoutSymbol = 'The value of the parameter is the rate at which the model learns from all of the data.';
        expect(identifyTextLanguage(withoutSymbol)).toMatchObject({status: 'identified', languages: ['en']});
        expect(identifyTextLanguage(withoutSymbol.replace('parameter', 'parameter α'))).toMatchObject({status: 'identified', languages: ['en']});
    });

    it('结论对象不可变，调用方无法篡改共享缓存', () => {
        const result = identifyTextLanguage('Добро пожаловать на наш сайт.');
        expect(Object.isFrozen(result)).toBe(true);
        expect(Object.isFrozen(result.languages)).toBe(true);
    });
});

describe('中日韩', () => {
    it.each([
        ['GPT-6 Sol の新しいモデルを発表しました。', 'ja'],
        ['これは OpenAI API を使います。', 'ja'],
        ['この機能は誰でも簡単に使うことが出来ます。', 'ja'],
        ['設定を翻訳', 'ja'],
        ['GPT-6 Sol 모델의 새로운 기능을 소개합니다.', 'ko'],
        ['이 문서는 GitHub API를 설명합니다.', 'ko'],
        ['경제(經濟) 성장률이 올해 크게 높아졌습니다.', 'ko'],
        ['대한민국헌법(大韓民國憲法) 제1조를 설명합니다.', 'ko'],
    ])('%s → %s', (text, language) => {
        expect(identifyTextLanguage(text)).toMatchObject({status: 'identified', languages: [language]});
        expect(shouldSkipTranslationForTarget(text, language)).toBe(true);
        expect(shouldSkipTranslationForTarget(text, 'zh-Hans')).toBe(false);
        expect(shouldSkipTranslationForTarget(text, 'en')).toBe(false);
    });

    it.each([
        ['预计将推出 GPT-6 Sol あ', '假名夹在简体中文中'],
        ['這是繁體中文の説明', '假名夹在繁体中文中'],
        ['设置 简体中文', '谚文与简体字'],
        ['설정 简体中文', '简体字不会出现在韩文汉字中'],
        ['漢字漢字漢字 한', '汉字多于谚文'],
        ['あ안', '假名与谚文同时出现'],
        ['이 단락은 설명입니다. 這段文字說明擴充功能如何保留原文', '韩文后接繁体中文句子'],
    ])('%s 不作为日文或韩文（%s）', text => {
        expect(shouldSkipTranslationForTarget(text, 'ja')).toBe(false);
        expect(shouldSkipTranslationForTarget(text, 'ko')).toBe(false);
    });

    it('纯共享汉字、罕见字、粤语与简繁混排保持未知，最佳猜测为书写体系未知的中文', () => {
        for (const text of ['日本国立大学', '時間', '株式会社', '这是繁體中文測試。', '呢個係繁體嘅廣東話。', '这里有𱀀']) {
            expect(identifyTextLanguage(text)).toMatchObject({status: 'unknown', bestGuess: 'zh'});
            expect(detectlang(text)).toBe('cmn');
            for (const target of ['zh-Hans', 'zh-Hant', 'ja', 'yue']) expect(shouldSkipTranslationForTarget(text, target)).toBe(false);
        }
    });

    it('简繁同形中文同时属于简体和繁体目标，也可被任一中文排除项跳过', () => {
        expect(identifyTextLanguage('✨ 新增功能')).toMatchObject({status: 'identified', languages: ['zh-Hans', 'zh-Hant']});
        expect(detectlang('✨ 新增功能')).toBe('cmn');
        expect(detectChineseScript('✨ 新增功能')).toBeUndefined();
        expect(shouldSkipTranslationForTarget('✨ 新增功能', 'en', ['zh-Hant'])).toBe(true);
        expect(isTextInLanguage('你好，世界！', 'zh-TW')).toBe(true);
    });

    it('名称按词计权，超过母语字符一半时不能证明整段是目标语言', () => {
        expect(identifyTextLanguage('中文 AI').status).toBe('unknown');
        expect(identifyTextLanguage('中文 GPT-6 Sol').status).toBe('unknown');
        expect(identifyTextLanguage('预计推出 GPT-6 GPT-7 GPT-8 GPT-9 模型').status).toBe('unknown');
        expect(identifyTextLanguage('ハイ OpenAI API GitHub').status).toBe('unknown');
        expect(identifyTextLanguage('请使用 AI 翻译')).toMatchObject({status: 'identified', languages: ['zh-Hans']});
    });
});

describe('用户反馈原文', () => {
    it.each([
        'FluentRead 支持在原网页中对照阅读原文与译文，并提供划词翻译、AI 阅读辅助、图片翻译、文档翻译和视频双语字幕。翻译卡片接入了 DeepSeek Harness 会话内核的浏览器适配，支持结合上下文解释选中文字并连续追问。',
        '请在 Chrome 或 Firefox 浏览器中打开扩展设置，然后重新加载网页。',
        '翻译服务支持 DeepSeek Harness 会话内核的浏览器适配。',
        '我们介绍 New York 城市公共交通系统的使用方法。',
    ])('中文正文中嵌入未带版本的名称仍属于中文：%s', text => {
        expect(shouldSkipTranslationForTarget(text, 'zh-Hans')).toBe(true);
        expect(shouldSkipTranslationForTarget(text, 'en')).toBe(false);
        expect(shouldSkipTranslationForTarget(text, 'zh-Hant')).toBe(false);
    });

    it.each([
        '这里是一段中文说明。Please translate this sentence.',
        '这里是一段中文说明。Welcome to our website.',
        '请点击 Click Here 按钮后阅读完整说明。',
        '这里是一段中文说明，请翻译“Hello”。',
        '这里是一段中文说明，请翻译“AI Harness 后面的中文也保留。',
        '这里是一段中文说明，请翻译 AI Harness”后面的中文也保留。',
        '这里是一段中文说明，请翻译 café 这个词。',
        '这里是一段中文说明。Harness',
        '这个界面会显示 ERROR PLEASE RETRY 提示信息。',
        '请阅读 Long Product Name With Many Words 的使用说明。',
    ])('名称规则不吞掉外语句子、引文或歧义词：%s', text => {
        expect(shouldSkipTranslationForTarget(text, 'zh-Hans')).toBe(false);
    });

    const releaseNote = '云端模型清单允许清空，且不再连带拒掉无关偏好的保存';
    it.each([...modelPost, modelPost.join('\n'), releaseNote, `${releaseNote} (84522b3)`, `${releaseNote}\n(84522b3)`])(
        '中文发布说明与模型公告跳过简体目标，外语目标和繁体目标仍翻译 %#', text => {
            expect(identifyTextLanguage(text)).toMatchObject({status: 'identified', languages: ['zh-Hans']});
            expect(detectlang(text)).toBe('zh-Hans');
            for (const target of ['zh', 'zh-CN', 'zh-Hans', 'zh_SG']) expect(shouldSkipTranslationForTarget(text, target)).toBe(true);
            for (const target of ['zh-Hant', 'en', 'ja', 'ko']) expect(shouldSkipTranslationForTarget(text, target)).toBe(false);
            expect(shouldSkipTranslationForTarget(text, 'en', ['zh-Hans'])).toBe(true);
        });

    it('宿主页面 lang="en" 不参与判断：函数只读取传入文本', () => {
        vi.stubGlobal('document', {documentElement: {lang: 'en'}, title: 'GitHub'});
        expect(shouldSkipTranslationForTarget(`${releaseNote} (84522b3)`, 'en')).toBe(false);
        expect(shouldSkipTranslationForTarget(`${releaseNote} (84522b3)`, 'zh-Hans')).toBe(true);
        vi.unstubAllGlobals();
    });

    it.each([
        ['Welcome to the settings page.', 'en'],
        ['Bonjour et bienvenue sur notre site.', 'fr'],
        ['Добро пожаловать на наш сайт.', 'ru'],
    ])('反馈中的短句 %s 可信识别为 %s', (text, language) => {
        expect(detectlang(text)).toBe(language);
        expect(shouldSkipTranslationForTarget(text, language)).toBe(true);
        expect(shouldSkipTranslationForTarget(text, `${language}-ZZ`)).toBe(true);
        expect(shouldSkipTranslationForTarget(text, language === 'en' ? 'fr' : 'en')).toBe(false);
    });
});

describe('中文技术语境中的短术语边界', () => {
    it.each([
        '当前 SDK 的并发队列由 arbiter token gate 负责入场，每个实际请求完成后释放槽位。',
        '后台 messageRouter 只从 origin 接收可信元数据，并让 session 状态保持独立。',
        '当前 SDK 的处理链是 intake→routing→normalized output/fallback，每个处理节点都会保留原始内容。',
        '当前 SDK 的共享调度使用 global/local 池，结束时由 requestHandler settle 释放占位。',
        '这个 SDK 的连接检查保留 scheduled FIFO，完成后统一清理缓存。',
        '三个 pending 入口保留隐私、有效 Key 集合、轮换/恢复配置摘要，transport 按实际选择 Key，成功缓存规则不变。',
    ])('同句代码或缩写锚点与中文技术动作支撑短术语：%s', text => {
        expect(identifyTextLanguage(text)).toMatchObject({status: 'identified', languages: ['zh-Hans']});
        expect(shouldSkipTranslationForTarget(text, 'zh-Hans')).toBe(true);
        expect(shouldSkipTranslationForTarget(text, 'en', ['zh-Hans'])).toBe(true);
        expect(shouldSkipTranslationForTarget(text, 'en')).toBe(false);
        expect(shouldSkipTranslationForTarget(text, 'zh-Hant')).toBe(false);
    });

    it.each([
        'The SDK arbiter should retry the request after the current connection has finished.',
        '这个 SDK 的缓存配置已修复。The arbiter should retry the request.',
        '这个 SDK 的缓存配置已修复。unknown 状态保持独立。',
        '这个 SDK 的缓存配置已修复，but the retry is still broken.',
        '这个 SDK 的缓存配置已修复，请翻译 unknown。',
        '这个 SDK 的缓存配置已修复，请解释 arbiter。',
        '这个 SDK 的缓存配置已修复，显示“unknown”。',
        '这个 SDK 的缓存配置已修复，显示“server busy”。',
        '这个 SDK 的缓存配置已修复，同时需要翻译 café。',
        '这个 SDK 的缓存配置已修复，并保留 naïve 状态。',
        '这段中文说明讨论 coffee 的含义，并保持原来的句子。',
        '这段中文说明把 apple orange banana 放在正文里供大家阅读。',
        '这个 SDK 的展示内容包含 apple orange banana，其中还有一些中文说明文字。',
        '这里的缓存内容需要检查 Public Topic，其中包括英文标题。',
        '我们选择 apple/orange 作为水果名称，并保留原始说明。',
        '我们选择 apple、orange 作为水果名称，并保留原始说明。',
        '当前 SDK 的连接配置已修复，network connection failed后检查状态。',
        '当前 SDK 的连接配置已修复，server crashed后检查状态。',
        '这里提供中文说明文本 SDK arbiter token gate intake→routing→normalized output/fallback global/local。',
        '中文 SDK arbiter',
        '这个 SDK 的缓存配置已修复，请点击 Open Settings 按钮继续阅读说明。',
        '这个 SDK 的缓存配置已修复，请执行 Restart Connection 之后继续阅读说明。',
        'これは SDK の arbiter を使う説明です。',
        '이 SDK의 arbiter 설정을 설명합니다.',
    ])('技术锚点不能吞掉外语正文、歧义词或跨句证据：%s', text => {
        expect(shouldSkipTranslationForTarget(text, 'zh-Hans')).toBe(false);
    });

    it('64k 无操作符 Latin 长词在独立进程中有界完成，不阻塞中文技术预检', () => {
        const sourcePath = resolve(process.env.LANGUAGECORE_AUDIT_SOURCE_ROOT ?? process.cwd(), 'src/core/language/identify.ts');
        // 只转译并加载真实模块，进程硬超时捕获长词回溯；不复制识别规则或生成临时业务文件。
        const loader = `
            import fs from 'node:fs';
            import path from 'node:path';
            import {createRequire} from 'node:module';
            import {pathToFileURL} from 'node:url';
            const require = createRequire(process.cwd() + '/package.json');
            const ts = require('typescript');
            const urls = new Map();
            function load(file) {
                if (urls.has(file)) return urls.get(file);
                let output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
                    compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext}, fileName: file,
                }).outputText;
                output = output.replace(/(from\\s+['"])([^'"]+)(['"])/g, (_, before, specifier, after) => {
                    const url = specifier.startsWith('.')
                        ? load(path.resolve(path.dirname(file), specifier + '.ts'))
                        : pathToFileURL(require.resolve(specifier)).href;
                    return before + url + after;
                });
                const url = 'data:text/javascript;base64,' + Buffer.from(output).toString('base64');
                urls.set(file, url);
                return url;
            }
            const {identifyTextLanguage} = await import(load(process.argv[1]));
            console.log(JSON.stringify(identifyTextLanguage('这里的中文说明保持原始内容 ' + 'a'.repeat(64_000) + '.')));
        `;
        const child = spawnSync(process.execPath, ['--input-type=module', '-e', loader, sourcePath], {
            encoding: 'utf8', timeout: 4000, maxBuffer: 1024 * 1024,
        });
        expect(child.error, child.stderr).toBeUndefined();
        expect(child.status, child.stderr).toBe(0);
        expect(JSON.parse(child.stdout)).toMatchObject({status: 'mixed', languages: []});
    }, 10_000);
});

describe('多语言统计与混合', () => {
    it.each([
        ['Dieser deutsche Absatz beschreibt die verschiedenen Einstellungen der Anwendung und die automatische Übersetzung.', 'de'],
        ['Este é um parágrafo em português que descreve as configurações do aplicativo e a tradução automática.', 'pt'],
        ["Questo paragrafo italiano descrive le impostazioni dell'applicazione e la traduzione automatica.", 'it'],
        ['Цей абзац пояснює, як розширення зберігає оригінальний текст і показує переклад одразу під ним.', 'uk'],
        ['توضح هذه الفقرة كيف تحافظ الإضافة على النص الأصلي وتعرض الترجمة أسفله مباشرة.', 'ar'],
        ['यह अनुच्छेद बताता है कि एक्सटेंशन मूल पाठ को कैसे सुरक्षित रखता है और अनुवाद को ठीक उसके नीचे दिखाता है।', 'hi'],
        ['הפסקה הזו מסבירה איך התוסף שומר על הטקסט המקורי ומציג את התרגום ממש מתחתיו.', 'he'],
        ['Αυτή η παράγραφος εξηγεί πώς η επέκταση διατηρεί το αρχικό κείμενο.', 'el'],
        ['ยินดีต้อนรับสู่เว็บไซต์ของเรา', 'th'],
        ['Представлена модель GPT-6 Sol с улучшенными возможностями, подробности в файле README.md.', 'ru'],
    ])('%s → %s，目标语言、地区标签与排除语言三种写法结论一致', (text, language) => {
        expect(detectlang(text)).toBe(language);
        expect(shouldSkipTranslationForTarget(text, language)).toBe(true);
        expect(shouldSkipTranslationForTarget(text, `${language}_XK`)).toBe(true);
        expect(shouldSkipTranslationForTarget(text, 'zh-Hans', [language])).toBe(true);
        expect(shouldSkipTranslationForTarget(text, 'zh-Hans')).toBe(false);
    });

    it('同一文字但只有一个句子时不做逐句检测；换行也是句子边界', () => {
        const german = 'Dieser Absatz beschreibt die verschiedenen Einstellungen der Anwendung sehr genau.';
        expect(identifyTextLanguage(german).languages).toEqual(['de']);
        expect(identifyTextLanguage(`${german}\n${german}`).languages).toEqual(['de']);
        expect(identifyTextLanguage(`${german} Ok.`).languages).toEqual(['de']);
    });

    it('Myanmar、Ethiopic 等多语言文字和少于两个字母的单一语言文字保持未知', () => {
        expect(identifyTextLanguage('မင်္ဂလာပါ ကြိုဆိုပါတယ်').status).toBe('unknown');
        expect(identifyTextLanguage('ሰላም እንኳን ደህና መጡ').status).toBe('unknown');
        expect(identifyTextLanguage('א').status).toBe('unknown');
        expect(identifyTextLanguage('װאָס מאַכסטו? ײַ').status).toBe('unknown');
        expect(identifyTextLanguage('Ἐν ἀρχῇ ἦν ὁ λόγος.').status).toBe('unknown');
        expect(identifyTextLanguage('𓀀𓁐𓂀 𓃀𓄀').status).toBe('unknown');
    });

    it('非 Latin 统计文字中名称过多时不能证明语言', () => {
        expect(identifyTextLanguage('Новый OpenAI GPT-6 API SDK').status).toBe('unknown');
    });
});

describe('统计库没有给出候选时', () => {
    it('统计文字识别保持未知且不给出最佳猜测，detectlang 退回 und', async () => {
        vi.resetModules();
        vi.doMock('franc-min', () => ({franc: () => 'und', francAll: () => [['und', 1]]}));
        const isolated = await import('@/src/core/language/detect');
        const isolatedIdentify = await import('@/src/core/language/identify');
        expect(isolatedIdentify.identifyTextLanguage('Welcome to the settings page.')).toEqual({status: 'unknown', languages: []});
        expect(isolated.detectlang('Welcome to the settings page.')).toBe('und');
        expect(isolated.shouldSkipTranslationForTarget('Welcome to the settings page.', 'en')).toBe(false);
        vi.doUnmock('franc-min');
        vi.resetModules();
    });
});

describe('detectlang 返回契约', () => {
    it('可信结论优先；不可信时返回规范化最佳猜测；没有文字证据时返回 und', () => {
        expect(detectlang('Hallo Welt.')).not.toMatch(/^[a-z]{3}$/u);
        expect(detectlang('Ласкаво просимо на наш сайт.')).toBe('sr');
        expect(detectlang('12345')).toBe('und');
        expect(detectlang('GPT-6 Sol')).toBe('und');
        expect(detectlang('ברוכים הבאים לאתר שלנו.')).toBe('he');
    });

    it('混合文本没有统计最佳猜测时退回 franc 原始结果并规范化', () => {
        expect(detectlang('The phrase 你好世界 means hello world in Chinese.')).toBe('en');
        expect(detectlang('这是一个很长的中文句子，里面夹带 hello 这个英文单词。')).toBe('cmn');
    });
});

describe('配置或文本变化后的重新判断', () => {
    it('同一文本切换目标语言、排除列表时逐次比较，不复用上一次跳过结论', () => {
        const german = 'Dieser deutsche Absatz beschreibt die verschiedenen Einstellungen der Anwendung und die automatische Übersetzung.';
        const sequence = [
            [german, 'de', [], true], [german, 'en', [], false], [german, 'en', ['de'], true], [german, 'en', [], false],
            [german, 'de-AT', [], true], [german, 'zh-Hans', ['fr', 'ja'], false],
        ] as const;
        for (const [text, target, excluded, expected] of sequence) {
            expect(shouldSkipTranslationForTarget(text, target, excluded)).toBe(expected);
        }
    });

    it('缓存只以规范后的文本为键：空白差异复用，文本变化重新识别，超长文本不缓存', () => {
        const first = identifyTextLanguage('Welcome to the settings page.');
        expect(identifyTextLanguage('  Welcome   to the settings\tpage. ')).toBe(first);
        expect(identifyTextLanguage('Bienvenue sur la page des paramètres de notre site.')).not.toBe(first);
        const long = 'This paragraph explains how the translation extension keeps the original text. '.repeat(60);
        expect(long.length).toBeGreaterThan(4096);
        expect(identifyTextLanguage(long)).not.toBe(identifyTextLanguage(long));
        expect(identifyTextLanguage(long).languages).toEqual(['en']);
    });

    it('缓存有界并按最近使用淘汰，清空后重新计算', () => {
        const kept = identifyTextLanguage('Добро пожаловать на наш сайт.');
        for (let index = 0; index < 600; index += 1) identifyTextLanguage(`条目 ${index} 的中文说明`);
        expect(identifyTextLanguage('Добро пожаловать на наш сайт.')).not.toBe(kept);
        const recent = identifyTextLanguage('条目 599 的中文说明');
        expect(identifyTextLanguage('条目 599 的中文说明')).toBe(recent);
        clearLanguageIdentificationCache();
        expect(identifyTextLanguage('条目 599 的中文说明')).not.toBe(recent);
    });

    it('识别文本规范化合并行内空白但保留换行作为句子边界', () => {
        expect(normalizeLanguageEvidenceText('  a \t b　c \n\n  d  ')).toBe('a b c\nd');
    });
});

describe('选区交互规则保持独立', () => {
    it('纯汉字选区只对中文目标跳过，不作为通用识别结论', () => {
        expect(shouldSkipChineseSelection('日本国立大学', 'zh-CN')).toBe(true);
        expect(shouldSkipTranslationForTarget('日本国立大学', 'zh-CN')).toBe(false);
        expect(shouldSkipChineseSelection('日本国立大学', 'ja')).toBe(false);
    });
});
