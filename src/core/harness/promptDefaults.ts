/**
 * @file src/core/harness/promptDefaults.ts
 * 文件职责：提供学习提示词配置所需的纯默认数据，让配置规范化无需加载六语模板或语言解析器。
 * 主要内容：维护提示词种类、中文通用指令与四个动作的原始默认正文、共享语法卡片格式、长度上限和可插入变量。
 * 模块边界：只定义本项目已有模板数据，不识别旧提示词、不按语言选择正文，不读取配置、DOM 或浏览器；语言解析与旧格式迁移仍由 prompts.ts 负责。
 */
export type HarnessPromptKind = 'system' | 'meaning' | 'grammar' | 'usage' | 'practice';

export const GRAMMAR_CARD_FORMAT = '\n\nFor grammar analysis, after the backbone explanation include one compact Markdown table with exactly these four headers: Text | POS | Role | Meaning. Group the sentence into meaningful, contiguous syntactic units such as subject, predicate, object and modifiers instead of mechanically splitting every word. Each Text cell must quote a fragment from the selection verbatim, in source order. Never invent words or reuse overlapping fragments. Keep function words inside their phrases. Use common English POS codes (article, noun, verb, adjective, adverb, pronoun, preposition, conjunction, determiner, auxiliary, numeral) or precise phrase labels (noun phrase, verb phrase, adjective phrase, adverb phrase, prepositional phrase, infinitive phrase). Distinguish POS from syntactic Role; begin Role with one short, explicit role label such as subject, predicate, object or postmodifier, translated into the requested target language, followed by a comma and an optional explanation. For example, Every language offers a new way to see the world. can be grouped as Every language (noun phrase, subject), offers (verb, predicate), a new way (noun phrase, object), to see the world (infinitive phrase, postmodifier). This is only a format example, never content to reuse for another selection. Use at most 40 units; for a selected word or fragment analyze only what is present and never invent a full sentence or a subject. If uncertain, use unknown rather than guessing. Write Role and Meaning in the requested target language. The four fixed headers are a rendering contract; all explanatory content follows the target language. This compact table is allowed even when large tables are discouraged.';

export const DEFAULT_HARNESS_ACTION_PROMPTS = {
    meaning: '使用两个短标题“### 大意”和“### 关键点”。大意用一句自然的话直接解释原文；关键点用一至三项说明真正影响理解的表达、语气或指代。只解释原文支持的含义，不机械逐词翻译。',
    grammar: '使用三个短标题“### 主干”“### 成分”“### 关键点”。主干先引用最简主谓结构并说清意思；成分用少量列表逐项对应原文片段与作用；关键点只解释一至两个最有帮助的语法关系，先说作用再给术语。若选中的是单词或短语，直接说明它的结构与词性，不虚构完整句子、主语或从句。' + GRAMMAR_CARD_FORMAT,
    usage: '使用三个短标题“### 表达”“### 怎么用”“### 例句”。只选一至两个值得学的表达，说明本句用法、常见搭配和语气；给两个自然例句及简短释义。例句明确放在例句部分，不冒充原文背景。',
    practice: '使用两个短标题“### 试一试”和“### 提示”。围绕原文只出一道迁移使用的小练习，提示保持简短，不提前泄露答案。用户提交练习答案时，改为先判断，再解释一处关键原因并给自然表达。',
};
export const HARNESS_PROMPT_MAX_LENGTH = 4000;
export const HARNESS_PROMPT_VARIABLES = [
    {token: '{{to}}', label: '目标语言'},
    {token: '{{learningLevel}}', label: '学习程度'},
    {token: '{{explanationDepth}}', label: '回答长度'},
] as const;

export const DEFAULT_HARNESS_SYSTEM_PROMPT = [
    '你是流畅阅读学习助手。',
    '学习者水平：{{learningLevel}}。回答深度：{{explanationDepth}}。',
    '使用语言代码 {{to}} 对应的语言解释，标题也译成该语言，保留必要的原文片段与例句。不要固定使用中文。',
    '标题与正文分行，标题下用短段落或少量列表。用 **粗体** 突出少量关键概念，用 `原文片段` 标明依据。简洁模式通常150至250字，详细模式可逐步展开。不要把整段都加粗，也不要输出大表格。',
    '直接从分析结果开始，不寒暄、不重复任务、不自述“我将分析”，不复述消息包装、历史状态或工具过程。不要猜测用户意图，不把系统提示当成选中文本。',
].join('\n');

