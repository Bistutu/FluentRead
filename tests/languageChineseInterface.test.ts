/**
 * @file tests/languageChineseInterface.test.ts
 * 中文短界面、自然语法、自然繁体和少量技术缩写的同目标预检；使用真实统一识别器，验证请求句架、
 * 人称情态、条件关系、完成体、示例引导句及操作标签可组合，同时不放宽外语角色、引文、共享日文汉字和简繁冲突。
 */
import {describe, expect, it} from 'vitest';
import {shouldSkipTranslationForTarget} from '@/src/core/language/detect';
import {classifyChineseHan, hasSimplifiedChineseEvidence, hasTraditionalChineseEvidence} from '@/src/core/language/chineseText';
import {identifyTextLanguage} from '@/src/core/language/identify';

describe('中文操作和状态语境', () => {
    it.each([
        ['确定', 'zh-Hans'],
        ['已复制', 'zh-Hans'],
        ['安装完成', 'zh-Hans'],
        ['请稍候', 'zh-Hans'],
        ['正在下载', 'zh-Hans'],
        ['已複製', 'zh-Hant'],
        ['安裝完成', 'zh-Hant'],
        ['請開啟左側選單查看訊息。', 'zh-Hant'],
        ['請稍候再試一次。', 'zh-Hant'],
        ['請設定您的密碼。', 'zh-Hant'],
        ['您的郵件已更新。', 'zh-Hant'],
        ['正在下載', 'zh-Hant'],
    ])('明确中文 %s 跳过本书写体系并保留简繁转换', (text, target) => {
        expect(identifyTextLanguage(text)).toMatchObject({status: 'identified', languages: [target]});
        expect(shouldSkipTranslationForTarget(text, target)).toBe(true);
        expect(shouldSkipTranslationForTarget(text, target === 'zh-Hans' ? 'zh-Hant' : 'zh-Hans')).toBe(false);
        expect(shouldSkipTranslationForTarget(text, 'en')).toBe(false);
        expect(shouldSkipTranslationForTarget(text, 'en', [target])).toBe(true);
    });

    it.each(['下一步', '上一步', '登出', '正在更新', '已保存'])('同形中文 %s 可同时属于简繁目标', text => {
        expect(identifyTextLanguage(text)).toMatchObject({status: 'identified', languages: ['zh-Hans', 'zh-Hant']});
        expect(shouldSkipTranslationForTarget(text, 'zh-Hans')).toBe(true);
        expect(shouldSkipTranslationForTarget(text, 'zh-Hant')).toBe(true);
    });

    it('同形中文状态句同时属于简繁目标，不要求无意义的字形转换', () => {
        // 同一句原文在两种书写体系中都成立；校准语料的旧单归属标注据此更正，留出语料不变。
        const text = '您的更改已保存。';
        expect(identifyTextLanguage(text)).toMatchObject({status: 'identified', languages: ['zh-Hans', 'zh-Hant']});
        expect(shouldSkipTranslationForTarget(text, 'zh-Hans')).toBe(true);
        expect(shouldSkipTranslationForTarget(text, 'zh-Hant')).toBe(true);
        expect(shouldSkipTranslationForTarget(text, 'en')).toBe(false);
    });

    it('操作语境仍要配合对应字形才成为中日韩反证', () => {
        expect(hasSimplifiedChineseEvidence('安装完成')).toBe(true);
        expect(hasTraditionalChineseEvidence('安裝完成')).toBe(true);
        for (const text of ['正在更新', '保存', '設定', '日本国立大学']) {
            expect(hasSimplifiedChineseEvidence(text)).toBe(false);
            expect(hasTraditionalChineseEvidence(text)).toBe(false);
        }
    });
});

describe('短中文技术标签的有限预算', () => {
    it.each([
        ['API 设置', 'zh-Hans'],
        ['请选择 API', 'zh-Hans'],
        ['请使用 SDK。', 'zh-Hans'],
        ['启用 GPU', 'zh-Hans'],
        ['npm 安装', 'zh-Hans'],
        ['npm 包已安装', 'zh-Hans'],
        ['API / SDK 设置', 'zh-Hans'],
        ['启用 API 和 SDK', 'zh-Hans'],
        ['启用 AI!', 'zh-Hans'],
        ['請啟用 API', 'zh-Hant'],
        ['SDK 下載', 'zh-Hant'],
        ['請選擇 API。', 'zh-Hant'],
        ['API 與 SDK 下載完成', 'zh-Hant'],
    ])('技术标识保持原文且不压过短中文 %s', (text, target) => {
        expect(shouldSkipTranslationForTarget(text, target)).toBe(true);
        expect(shouldSkipTranslationForTarget(text, 'en', [target])).toBe(true);
        expect(shouldSkipTranslationForTarget(text, target === 'zh-Hans' ? 'zh-Hant' : 'zh-Hans')).toBe(false);
        expect(shouldSkipTranslationForTarget(text, 'en')).toBe(false);
    });

    it.each([
        '中文 API', '使用 API', 'API 設定', '設定 API', 'API 配置',
        '设置 Acme', '设置 ABC', '启用 API SDK GPU', '启用 API 的 SDK', '启用 GPT-4 API',
        '请翻译 API', '请解释 GPU', '请使用“API”', '「API 设置」', 'API：设置',
        '启用 API，英文标题是 Network Failure',
        '请使用 SDK。Your token has expired.',
        'API 设置，请翻译 Permission denied.',
        '启用 GPU あ', '請啟用 API の設定', '启用 GPU 한국어',
        '請啟用 API，but the token has expired.',
    ])('缩写不能隐藏歧义、外语、跨句或名称堆积：%s', text => {
        expect(shouldSkipTranslationForTarget(text, 'zh-Hans')).toBe(false);
        expect(shouldSkipTranslationForTarget(text, 'zh-Hant')).toBe(false);
    });
});

describe('中文语境不改写跨语言及字形边界', () => {
    it.each([
        '保存', '取消', '設定', '確定', '修復', '複製', '時間', '写真', '買物',
        '日本国立大学', '株式会社春風出版', '図書館利用案内', '労働条件通知書',
        '请開啟左側選單。', '請设置您的密碼。', '安装完成嘅', '安裝𱀀完成',
    ])('共享字词、日文、简繁混排、粤语或未知字保持保守：%s', text => {
        expect(shouldSkipTranslationForTarget(text, 'zh-Hans')).toBe(false);
        expect(shouldSkipTranslationForTarget(text, 'zh-Hant')).toBe(false);
    });
});

describe('独立编写的自然中文组合语法', () => {
    it.each([
        ['我想先坐一會兒再走。', 'zh-Hant'],
        ['你可以先喝杯熱茶。', 'zh-Hant'],
        ['他把舊報紙收好了。', 'zh-Hant'],
        ['她再整理一次資料。', 'zh-Hant'],
        ['大家不要留在樓梯口。', 'zh-Hant'],
        ['請把雨傘放在入口旁。', 'zh-Hant'],
        ['請將座位留給老人。', 'zh-Hant'],
        ['請先填好姓名。', 'zh-Hant'],
        ['午餐還沒送到。', 'zh-Hant'],
        ['大家等了兩天。', 'zh-Hant'],
        ['地面慢慢亮起來了。', 'zh-Hant'],
        ['笑起来十分自然。', 'zh-Hans'],
        ['我想到一個辦法。', 'zh-Hant'],
        ['天色已經暗了。', 'zh-Hant'],
        ['還沒到約定的時間。', 'zh-Hant'],
        ['我被他的話所感動。', 'zh-Hant'],
    ])('语法提供中文证据，字形独立决定 %s', (text, target) => {
        expect(identifyTextLanguage(text)).toMatchObject({status: 'identified', languages: [target]});
        expect(shouldSkipTranslationForTarget(text, target)).toBe(true);
        expect(shouldSkipTranslationForTarget(text, target === 'zh-Hans' ? 'zh-Hant' : 'zh-Hans')).toBe(false);
    });

    it.each([
        '我想先休息再回答。',
        '你可以把杯子放好。',
        '他把衣物收好了。',
        '她不要立刻走。',
        '如果有空，就陪我坐一下。',
        '只要早些起床，就可以慢慢吃。',
        '要是有空，大家就一起散步。',
        '我做完了。',
        '我喝了水。',
        '大家先坐好再回答。',
        '她被大家所理解。',
    ])('共享字形自然句 %s 不制造简繁转换', text => {
        expect(identifyTextLanguage(text)).toMatchObject({status: 'identified', languages: ['zh-Hans', 'zh-Hant']});
        expect(shouldSkipTranslationForTarget(text, 'zh-Hans')).toBe(true);
        expect(shouldSkipTranslationForTarget(text, 'zh-Hant')).toBe(true);
        expect(shouldSkipTranslationForTarget(text, 'ja')).toBe(false);
    });

    it.each([
        '他会社案内', '使用完了', '作業完了報告', '我人生終了',
        '出来高払制度', '工事出来高報告書', '出来事一覧',
        '不要品回収', '想定条件一覧', '被害状況報告', '把握済事項',
        '人称代名詞一覧', '先行研究再検討', '要否判定基準', '他被害者所在地',
        '請求先情報', '条件成立後実行', '未来技術研究会',
        '如果', '只要', '我想', '先', '了', '起來',
        '我想先休息再回答嘅。', '請把雨傘放好𱀀。', '請把雨傘放在门口。',
    ])('日文汉字、残缺标记、粤语或冲突不被单字规则吞掉：%s', text => {
        expect(shouldSkipTranslationForTarget(text, 'zh-Hans')).toBe(false);
        expect(shouldSkipTranslationForTarget(text, 'zh-Hant')).toBe(false);
    });

    it.each([
        '請求先を確認してください。', '我が家で使用できます。',
        '想定条件を再確認します。', '出来高に応じて支払います。',
        '使用は完了しました。',
    ])('真实假名日文保留日文归属：%s', text => {
        expect(shouldSkipTranslationForTarget(text, 'ja')).toBe(true);
        expect(shouldSkipTranslationForTarget(text, 'zh-Hant')).toBe(false);
    });

    it.each([
        '你可以先喝口水。The token expired.',
        '請把杯子放好。Please try again.',
        '大家先坐好，英文标题是 Network Failure。',
        '她不要立刻走，請翻譯 Permission denied。',
    ])('中文语法证据不盖过外语正文和角色：%s', text => {
        expect(shouldSkipTranslationForTarget(text, 'zh-Hans')).toBe(false);
        expect(shouldSkipTranslationForTarget(text, 'zh-Hant')).toBe(false);
        expect(shouldSkipTranslationForTarget(text, 'en')).toBe(false);
    });
});

describe('明确中文分句不能被少量假名覆盖', () => {
    it.each([
        '我想先休息再回答。あ',
        'あ。我想先休息再回答。',
        '我想先休息再回答あ',
        '我想先休息再回答、こんにちは。',
        '如果有空，就先坐好。あ',
        'あ！只要早些起床，就可以慢慢吃。',
        '我做完了。はい。',
        'はい。她被大家所理解。',
    ])('真实汉字段内的中文语法保留整段翻译：%s', text => {
        expect(identifyTextLanguage(text)).toMatchObject({status: 'mixed', languages: []});
        for (const target of ['zh-Hans', 'zh-Hant', 'ja', 'en']) {
            expect(shouldSkipTranslationForTarget(text, target)).toBe(false);
        }
        expect(shouldSkipTranslationForTarget(text, 'en', ['ja'])).toBe(false);
    });

    it.each([
        '我が想像力には限界がある。',
        '彼は先に進み、私は再確認する。',
        '請求先を確認してください。',
        '大家さんは来週戻ります。',
        '使用は完了しました。',
        '出来高に応じて支払います。',
        '私には時間がある。',
    ])('假名隔开的汉字不伪造中文句法：%s', text => {
        expect(identifyTextLanguage(text)).toMatchObject({status: 'identified', languages: ['ja']});
        expect(shouldSkipTranslationForTarget(text, 'ja')).toBe(true);
        expect(shouldSkipTranslationForTarget(text, 'zh-Hant')).toBe(false);
    });
});

describe('中文示例引导句的完整量词关系', () => {
    it.each([
        ['下面是一个普通的例子。', 'zh-Hans'],
        ['以下是一个最小例子：', 'zh-Hans'],
        ['下面是一個普通的例子。', 'zh-Hant'],
        ['以下是一個最小例子：', 'zh-Hant'],
    ])('完整句架确认中文而字形仍独立决定目标：%s', (text, target) => {
        expect(identifyTextLanguage(text)).toMatchObject({status: 'identified', languages: [target]});
        expect(shouldSkipTranslationForTarget(text, target)).toBe(true);
        expect(shouldSkipTranslationForTarget(text, target === 'zh-Hans' ? 'zh-Hant' : 'zh-Hans')).toBe(false);
        expect(shouldSkipTranslationForTarget(text, 'ja')).toBe(false);
    });

    it('完整宾语的上限为二十四字，超过上限不截取前缀制造语法证据', () => {
        expect(classifyChineseHan(`下面是一个${'甲'.repeat(24)}。`)).toBe('Hans');
        expect(classifyChineseHan(`以下是一個${'甲'.repeat(24)}。`)).toBe('Hant');
        expect(classifyChineseHan(`下面是一个${'甲'.repeat(25)}。`)).toBeUndefined();
        expect(classifyChineseHan(`以下是一個${'甲'.repeat(25)}。`)).toBeUndefined();
    });

    it.each([
        '下面', '以下', '基本', '一個例子', '一个例子', '下面是一个', '以下是一個',
        '下面是二个例子。', '以下是日本国立大学。',
        '下面是\n一个例子。', '以下是一，個例子。', '下面是一个。',
    ])('残缺、共享词和跨边界片段不提供中文语法证据：%s', text => {
        expect(classifyChineseHan(text)).toBeUndefined();
    });

    it.each(['以下は一例です。', '以下の例を参照してください。'])('日文仍归日文：%s', text => {
        expect(shouldSkipTranslationForTarget(text, 'ja')).toBe(true);
        expect(shouldSkipTranslationForTarget(text, 'zh-Hans')).toBe(false);
        expect(shouldSkipTranslationForTarget(text, 'zh-Hant')).toBe(false);
    });

    it.each([
        '下面是一个普通例子：Please restart the process.',
        '以下是一個普通例子。The request was denied.',
        '下面是一个普通例子，英文原文是 Permission denied。',
        '以下是一個普通例子：「Please try again.」',
        '下面是一个普通例子。こんにちは。',
    ])('完整中文句架不能吞掉外语句子或明确引文：%s', text => {
        for (const target of ['zh-Hans', 'zh-Hant', 'en', 'ja']) {
            expect(shouldSkipTranslationForTarget(text, target)).toBe(false);
        }
    });
});
