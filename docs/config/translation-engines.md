# 翻译服务

FluentRead 不把翻译能力锁定在单一供应商上。你可以在设置页启用多个服务，并根据质量、速度、成本和隐私要求选择当前使用的引擎。

<img class="doc-screenshot" src="/screenshots/settings-services.png" alt="FluentRead translation service settings" />

## 如何选择

| 你的优先级 | 建议先尝试 |
| --- | --- |
| 想快速体验 | 免费翻译服务 |
| 想要稳定的通用翻译 | Microsoft、Google 或 DeepL |
| 想让译文更关注上下文 | OpenAI 兼容 API 或其他 AI 服务 |
| 不希望文本离开本机 | Ollama 本地模型 |

公共免费服务可能受到流量、区域、频率和维护状态影响；它适合入门和临时使用，不适合作为关键工作流的唯一依赖。

## 通用配置流程

1. 打开设置页的“翻译服务”。
2. 启用目标服务，填写服务要求的地址、密钥或模型名称。
3. 保存后可以点击“检查连接”发送一条很短的真实请求；这可能产生少量用量。
4. 确认结果、耗时和额度都符合预期，再处理长页面。

## 云端服务

Microsoft、Google、DeepL 以及其他云端服务通常需要 API 密钥或账号配额。请从服务商的官方控制台获取凭据，并确认：

- API 地址与区域、版本或项目设置匹配；
- 密钥只拥有必要权限，并设置合理的额度限制；
- 服务商是否会保存请求内容；
- 你的文本是否包含不应上传的个人或机密信息。

云服务的价格、免费额度和接口要求可能变化，使用前应以服务商当前文档为准。

## AI 服务与 OpenAI 兼容接口

AI 翻译更适合需要上下文、术语一致性或风格控制的内容。配置时通常需要填写：

- API Base URL；
- API Key；
- Model 名称；
- 目标语言和可选的高级参数。

不同供应商对兼容接口的实现并不完全相同。如果请求失败，先用服务商官方示例验证地址、模型和密钥，再回到 FluentRead 检查配置。

首次配置 AI 服务时，FluentRead 会按服务选择近期的推荐档位：除 OpenAI 兼容服务默认使用 GPT-5.6 Luna 外，其他服务优先采用成本友好的小型档位（例如 mini、flash、haiku 或 lite）；你仍可以在“模型列表”中手动切换模型。

## MiniMax

MiniMax 同时提供按量付费 API 和 Token Plan 两类权益。两类 Key 不能互换；Token Plan Key 通常以 `sk-cp-` 开头，并且要求对应订阅仍然有效。在 MiniMax 服务配置中分别选择“按量付费（API）”或“Token Plan（套餐/积分）”，再选择 Key 所属的“中国版”或“全球版”（默认中国版）。FluentRead 会根据区域使用对应的 OpenAI 兼容 Chat Completions 地址，并在页面显示当前地址。

如果看到 `401` 或错误码 `2049`，优先检查计费方式、区域和 Key 是否来自同一套 MiniMax 账户权益；不要把截图或完整 Key 发到 Issue、聊天记录或仓库。

## 小米 MiMo

小米 MiMo 提供独立的按量付费 API 和 Token Plan。按量付费 Key 通常以 `sk-` 开头，Token Plan Key 以 `tp-` 开头，两类 Key 不能互换。FluentRead 会在 MiMo 服务配置中分别保存计费方式和集群，避免误用 MiniMax 的配置。

- 按量付费：使用 `https://api.xiaomimimo.com/v1/chat/completions`。
- Token Plan：中国集群使用 `token-plan-cn.xiaomimimo.com`，新加坡集群使用 `token-plan-sgp.xiaomimimo.com`，欧洲集群使用 `token-plan-ams.xiaomimimo.com`；应以 Token Plan 页面实际提供的 Base URL 为准。
- 当前支持文本翻译的预设模型包括 `mimo-v2.5` 和 `mimo-v2.5-pro`，也可以填写自定义模型标识。

如果遇到 `401`，先确认 Key 前缀、Token Plan 是否仍在有效期内，以及所选集群是否与购买页面提供的地址一致。

## Ollama 本地模型

Ollama 适合希望在本机处理文本的用户。你需要在本机运行 Ollama、准备一个可用模型，并让浏览器扩展可以访问本地接口。

如果浏览器控制台出现跨域错误，请参考[常见问题中的 Ollama 部分](/guide/faq#ollama-无法连接)。本地模型的速度和质量取决于模型大小、显卡或 CPU 性能以及上下文长度。

## 失败排查

### 请求超时

先用短文本测试，检查网络和服务地址，再降低并发或切换到响应更快的服务。

### 返回空结果或格式错误

确认模型支持当前请求格式，并检查服务商是否返回了错误信息或触发了内容过滤。AI 服务还需要确认模型名称正确。

### 只有部分段落成功

长页面可能触发额度、频率或上下文限制。恢复原文后分批翻译，或选择更适合长文本的服务。

### API 密钥泄露

立即在服务商控制台撤销并重新生成密钥，同时检查仓库、Issue、截图和浏览器同步记录中是否存在旧密钥。不要把密钥提交到 Git。
