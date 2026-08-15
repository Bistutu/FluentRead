# 翻译引擎配置

流畅阅读支持多种翻译引擎，包括机器翻译和大语言模型。本文将介绍各个翻译引擎的配置方法。

## 支持的翻译引擎

### 机器翻译
- **Microsoft 翻译**：免费且无需配置，开箱即用，支持多种语言互译
- **Google 翻译**：免费且无需配置，支持多种语言，国内暂不支持使用
- **DeepL (免费版)**：每月 50 万字符免费额度，[开发者平台](https://www.deepl.com/pro-api)
- **DeepLX（免费非官方）**：无需官方 API Key 的 DeepL 兼容服务。默认使用已验证的公共站点，也支持在设置中填入本地、自建或多个备用地址；公共站点可能记录文本，敏感内容建议使用自建服务。[项目文档](https://deeplx.owo.network/)
- **小牛翻译**：[API 文档](https://niutrans.com/dev-page?type=text)
- **有道翻译**：新用户可获体验资金，具体额度以[官方计费规则](https://ai.youdao.com/DOCSIRMA/html/trans/price/wbfy/index.html)为准
- **腾讯云文本翻译**：每月 500 万字符免费额度，[产品页面](https://cloud.tencent.com/product/tmt)
- **Chrome 内置 AI 翻译**：使用浏览器内置 Translator API，无需 API Key，仅支持 Google Chrome 138 Stable 及以上版本，[开发文档](https://developer.chrome.com/docs/ai/translator-api?hl=zh-cn)

#### DeepLX 备用地址

在 DeepLX 的“服务地址”中可以填写多个地址，每行或逗号分隔。设置页提供“快速添加推荐站点”，插件会按填写顺序请求，当前地址失败或返回无效响应时自动尝试下一个地址：

```text
https://deeplx.1stg.me/translate
https://freeapi.fanyimao.cn/translate?token={{apiKey}}
https://api.deeplx.org/{{apiKey}}/translate
http://localhost:1188/translate
```

`deeplx.1stg.me` 是当前验证可用且无需 Token 的公共实例。`freeapi.fanyimao.cn` 也已验证可返回译文，但需要用户自己的站点 Token；`api.deeplx.org` 需要个人 Token。地址中的 `{{apiKey}}` 会替换为设置页的“访问令牌”，不会把 Token 写入插件代码。

这些公共实例都属于非官方服务，可能限流、停用或记录请求内容。公开列表中的其他候选站点当前出现了 401、404、530、DNS/TLS 错误或已暂停，因此没有加入默认备用链。敏感文本建议使用本地或自建 DeepLX 服务。

### AI 大模型
- **OpenAI（推荐⭐️）**：国际领先的大模型服务，支持 GPT-4o 和 GPT-o1-mini 等，[API 文档](https://platform.openai.com/docs/api-reference)
- **DeepSeek（推荐⭐️）**：国内领先的大模型服务，[开发者中心](https://platform.deepseek.com/)
- **SiliconCloud（推荐⭐️）**：国内多模型聚合服务，**提供免费模型**，包括 `Qwen2.5-7B-Instruct`、`Meta-Llama-3.1-8B-Instruct`、`gemma-2-9b-it` 等，[API 文档](https://cloud.siliconflow.cn/models)
- **Kimi**：[API 文档](https://platform.moonshot.cn/)
- **腾讯混元**：[API 中心](https://cloud.tencent.com/document/product/1729)
- **腾讯混元翻译**：腾讯混元翻译专用大模型，[API 中心](https://cloud.tencent.com/document/product/1729)
- **字节豆包**：[开发者平台](https://www.volcengine.com/product/doubao)
- **阿里通义**：[API 文档](https://help.aliyun.com/zh/dashscope/developer-reference/api-details)
- **智谱清言**：免费提供 `GLM-4-Flash` 模型，[开放平台](https://open.bigmodel.cn/console/overview)
- **OpenRouter**：国外多模型聚合服务，提供免费模型，[API 参考](https://openrouter.ai/docs)
- **Groq**：国外多模型聚合服务，提供免费模型，[开发者文档](https://groq.com/)
- **Grok**：X.AI 的 AI 模型，[API 文档](https://docs.x.ai/)
- **百度文心**：[开放平台](https://cloud.baidu.com/doc/WENXINWORKSHOP/index.html)
- **百川智能**：[开发者文档](https://platform.baichuan-ai.com/docs/api)
- **零一万物**：[API 中心](https://platform.lingyiwanwu.com/)
- **MiniMax**：[开放平台](https://api.minimax.chat/)
- **无问芯穹**：[开发者平台](https://cloud.infini-ai.com/promotion)
- **阶跃星辰**：[开发者平台](https://platform.stepfun.com/)
- **Claude**：Anthropic 公司的 AI 模型，[API 参考](https://docs.anthropic.com/claude/reference)
- **Gemini**：谷歌最新的 AI 模型，[API 文档](https://ai.google.dev/)
- **Ollama**：开源的本地部署模型，[GitHub页面](https://github.com/ollama/ollama)
- **Azure OpenAI**：微软 Azure 托管的 OpenAI 服务，[API 参考](https://learn.microsoft.com/zh-cn/azure/ai-services/openai/reference)
- **Coze 国际**：字节跳动 AI 机器人平台，[官网](https://www.coze.com/)
- **Coze 国内（扣子）**：字节跳动 AI 机器人平台，[官网](https://www.coze.cn/)
- **New API**：开源大模型网关，需自行部署，[GitHub](https://github.com/QuantumNous/new-api)

## 配置示例：以 DeepSeek 为例

<img src="/model.png" alt="模型选择" style="width: 60%; max-width: 40%;border: 1px solid #eee;border-radius: 4px;box-shadow: 0 1px 2px rgba(0,0,0,0.05);" />

### 1. 获取 API Key
1. 访问 [DeepSeek 开发者中心](https://platform.deepseek.com/)
2. 注册/登录账号
3. 进入 API Keys 页面创建密钥
4. 复制生成的 API Key

<img src="/deepseek-apikey.png" alt="DeepSeek API Key" style="width: 80%; max-width: 100%;border: 1px solid #eee;border-radius: 4px;box-shadow: 0 1px 2px rgba(0,0,0,0.05);" />

### 2. 配置插件
1. 点击浏览器工具栏中的流畅阅读图标
2. 点击设置图标，进入设置页面
3. 选择 "翻译引擎" 选项卡
4. 在引擎列表中选择 "DeepSeek"
5. 选择 `deepseek-v4-flash` 模型，并填入配置信息

旧版配置会自动迁移：`deepseek-chat` 会迁移为关闭思考模式的 `deepseek-v4-flash`，
`deepseek-reasoner` 会迁移为开启思考模式的 `deepseek-v4-flash`。

默认的 API 格式使用 DeepSeek 官方 Chat Completion。只有当自定义代理或网关明确支持
Responses API 时，才需要在设置中手动切换；代理 URL 中已有的查询参数会被保留。

<img src="/click-fluent_read.png" alt="点击流畅阅读图标" style="width: 80%; max-width: 100%;border: 1px solid #eee;border-radius: 4px;box-shadow: 0 1px 2px rgba(0,0,0,0.05);" />


### 4. 使用效果
原文：
```text
The quantum computer performs operations on qubits, which can exist in multiple states simultaneously due to quantum superposition.
```

翻译结果：
```text
量子计算机对量子比特进行操作，由于量子叠加原理，这些量子比特可以同时存在于多个状态。
```

### 5. 高级选项

<img src="/advance.png" alt="高级选项" style="width: 40%; max-width: 100%;border: 1px solid #eee;border-radius: 4px;box-shadow: 0 1px 2px rgba(0,0,0,0.05);" />

#### 代理配置
如果你所在的网络环境无法直接访问某些 AI 服务，可以配置代理服务器。一般情况下无需配置此项。


#### 提示词配置
大语言模型的翻译效果很大程度上取决于提示词（Prompt）的设置。流畅阅读提供了默认的提示词配置：

##### 系统提示词（System Prompt）
```text
You are a professional, authentic machine translation engine.
You only return the translated text, without any explanations.
```

这个提示词告诉模型：
- 扮演专业的机器翻译引擎
- 只返回翻译结果
- 不添加任何解释或额外信息

##### 用户提示词（User Prompt）
```
Translate the following text into {to}, 
output translation text directly without any extra information:

{{origin}}
```

其中：
```text
{{to}} 表示目标语言
{{origin}} 表示原文内容
```

两者不可或缺。

#### 自定义提示词
你可以根据需要自定义提示词，以获得不同的翻译效果：

1. **更正式的翻译**
```text
You are a professional translator specializing in formal documentation.
Translate with accuracy and maintain professional terminology.
```

2. **更口语化的翻译**
```text
You are a translator focusing on natural, conversational language.
Translate into casual, everyday speech.
```

3. **技术文档翻译**
```text
You are a technical documentation translator.
Maintain precise technical terms and professional standards.
```

::: tip 提示
1. 修改提示词时请保持简洁明确
2. 避免添加过多限制条件
3. 确保提示词与目标语言相匹配
:::

## 下一步

- 访问 [GitHub Issues](https://github.com/Bistutu/FluentRead/issues) 反馈问题 
