/**
 * @file src/core/harness/prompts.ts
 * 文件职责：定义划词翻译学习模式可编辑的模型输入模板、占位符目录和纯替换规则。
 * 主要内容：按界面语言解析通用指令与四个学习动作，仅识别完整旧中文系统默认正文及旧内置语法格式而保留自定义正文，执行目标语言、学习程度和回答长度的单次占位符替换；中文默认正文与语法卡片格式由 promptDefaults.ts 提供。
 * 模块边界：内置模板按界面语言选择，自定义正文保持原样，模板不参与界面文案自动翻译；本模块不读写配置、不发起请求，也不接收网页正文。
 */
import {normalizeUiLanguage, UI_LANGUAGE_OPTIONS} from '../i18n/language';
import {HARNESS_TRANSLATED_PROMPTS} from './promptLocales';
import {DEFAULT_HARNESS_ACTION_PROMPTS, DEFAULT_HARNESS_SYSTEM_PROMPT, GRAMMAR_CARD_FORMAT, type HarnessPromptKind} from './promptDefaults';

const LEGACY_CHINESE_GRAMMAR_PROMPT = '使用三个短标题“### 主干”“### 成分”“### 关键点”。主干先引用最简主谓结构并说清意思；成分用少量列表逐项对应原文片段与作用；关键点只解释一至两个最有帮助的语法关系，先说作用再给术语。若选中的是单词或短语，直接说明它的结构与词性，不虚构完整句子、主语或从句。';
const LEGACY_CHINESE_SYSTEM_PROMPT = DEFAULT_HARNESS_SYSTEM_PROMPT.replace('你是流畅阅读学习助手。', '你是 FluentRead 阅读学习助手。');
const LEGACY_GRAMMAR_CARD_FORMAT = '\n\nFor grammar analysis, after the backbone explanation include one compact Markdown table with exactly these four headers: Text | POS | Role | Meaning. Each Text cell must quote a contiguous fragment from the selection verbatim, in source order. Never add invented words or reuse overlapping fragments. Use common English POS codes (article, noun, verb, adjective, adverb, pronoun, preposition, conjunction, determiner, auxiliary, numeral, phrase); distinguish part of speech from syntactic role such as subject or object. Write Role and Meaning in the requested target language. Include articles and other function words for a short sentence; for long selections use at most 40 meaningful fragments. If uncertain, use unknown rather than inventing a classification. The four fixed headers are a rendering contract; all explanatory content follows the target language. This compact table is allowed even when large tables are discouraged.';

/** 内置模板使用界面语言；回答语言仍由模板中的 {{to}} 决定。 */
export function getDefaultHarnessPrompt(kind: HarnessPromptKind, language: unknown): string {
    const locale = normalizeUiLanguage(language);
    if (locale === 'zh-CN') return kind === 'system' ? DEFAULT_HARNESS_SYSTEM_PROMPT : DEFAULT_HARNESS_ACTION_PROMPTS[kind];
    return HARNESS_TRANSLATED_PROMPTS[locale][kind] + (kind === 'grammar' ? GRAMMAR_CARD_FORMAT : '');
}

/** 识别旧配置和恢复默认写入的内置正文，不因切换语言改写用户自定义内容。 */
export function resolveHarnessPrompt(value: string, kind: HarnessPromptKind, language: unknown): string {
    const legacyBody = kind === 'grammar' && value.endsWith(LEGACY_GRAMMAR_CARD_FORMAT) ? value.slice(0, -LEGACY_GRAMMAR_CARD_FORMAT.length) : value;
    if (!value.trim() || (kind === 'system' && value === LEGACY_CHINESE_SYSTEM_PROMPT) || (kind === 'grammar' && (legacyBody === LEGACY_CHINESE_GRAMMAR_PROMPT || Object.values(HARNESS_TRANSLATED_PROMPTS).some(prompts => legacyBody === prompts.grammar))) || UI_LANGUAGE_OPTIONS.some(({value: locale}) => value === getDefaultHarnessPrompt(kind, locale))) {
        return getDefaultHarnessPrompt(kind, language);
    }
    return value;
}

/** 仅替换已登记的设置变量，单次替换避免把替换值当成另一个模板执行。 */
export function renderHarnessPrompt(template: string, variables: {to: string; learningLevel: string; explanationDepth: string}): string {
    return template.replace(/\{\{(to|learningLevel|explanationDepth)\}\}/gu, (_match, key: keyof typeof variables) => variables[key]);
}

