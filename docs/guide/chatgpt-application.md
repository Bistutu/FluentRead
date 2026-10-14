---
title: 维护者申请 ChatGPT 接入
---

# 维护者申请 ChatGPT 接入

**FluentRead 尚未提交申请或获得公共接入批准，托管后端也尚未部署。** 本页说明维护者如何提交接入意向，普通用户请查看 [ChatGPT 套餐接入状态](/config/chatgpt-plan)。核对日期：2026-10-14。

## 1. 从官方入口打开意向表

打开 OpenAI 的 [Request a client ID](https://developers.openai.com/siwc/request-client-id)，点击页面中的 **Sign in with ChatGPT interest form**。这会进入候补申请表，不会立即生成 client ID。也可以直接打开 [中文接入意向表](https://openai.com/zh-Hans-CN/form/sign-in-with-chatgpt-interest/) 或 [英文表单](https://openai.com/form/sign-in-with-chatgpt-interest/)。

<img src="/guides/chatgpt-application/01-request-client-id.jpg" alt="OpenAI Request a client ID 官方页面与接入意向表链接" width="1280" height="720" loading="lazy" />

截图来源：[OpenAI Developers](https://developers.openai.com/siwc/request-client-id)，2026-10-14，真实页面，未经改写。

官方目前将该申请入口描述为面向选定商业合作伙伴的有限试用；表单也将开源开发者引向开发文档。如果已有 OpenAI 对接代表，可按 [网站接入指南](https://developers.openai.com/siwc/website) 联系对方。个人维护者可以如实说明自己的项目和托管需求，但官方没有承诺个人项目必定获准，也没有公布审核时限。

FluentRead 要申请的是让公众在扩展内使用 ChatGPT 套餐的产品流程。[开源套餐文档](https://developers.openai.com/siwc/token-sharing-open-source) 要求付费或远程托管应用通过意向表申请；开源身份不能直接推导出公共托管权限。

<img src="/guides/chatgpt-application/02-interest-form-top.jpg" alt="OpenAI 中文接入意向表顶部，说明商业合作伙伴与开源开发者入口" width="1280" height="720" loading="lazy" />

截图来源：[OpenAI 中文意向表](https://openai.com/zh-Hans-CN/form/sign-in-with-chatgpt-interest/)，2026-10-14，真实页面，所有字段未填，未提交。

## 2. 填写实际的 8 项资料

以下字段来自上述官方表单；带星号的字段必填，**职位**没有星号。建议文字需要按维护者的真实情况调整。

| 字段 | FluentRead 维护者填写建议 |
| --- | --- |
| 工作邮箱 * | 填可接收审核回复的真实联系邮箱，不虚构企业邮箱。 |
| 姓氏 * | 填维护者本人的真实姓氏。 |
| 名字 * | 填维护者本人的真实名字。 |
| 公司名称 * | 有实际公司则填写公司名称；没有公司可如实说明 `Independent open-source developer / FluentRead project`，不要假造公司。此写法不是 OpenAI 的资格承诺。 |
| 网站 URL * | 填真实官网 `https://read.thinkstu.com/`；产品介绍中可补充开源仓库地址。 |
| 职位 | 可如实填 `Open-source maintainer`；这是可选字段。 |
| 希望实现的功能 * | 选择第二项 **登录并使用 ChatGPT 套餐发起 AI 请求**。 |
| 将接入的产品介绍 * | 说明 FluentRead 的真实功能、开源属性、扩展使用场景和计划中的托管流程；可参考下一节英文草稿。 |

<img src="/guides/chatgpt-application/03-interest-form-fields.jpg" alt="OpenAI 中文意向表的邮箱、姓名、公司、网站、职位和功能选项" width="1280" height="720" loading="lazy" />

截图来源：[OpenAI 中文意向表](https://openai.com/zh-Hans-CN/form/sign-in-with-chatgpt-interest/)，2026-10-14，真实页面，所有字段未填，未提交。

**仅登录**只申请身份登录。FluentRead 的翻译、阅读和写作需要套餐 AI 请求，因此应选择第二项。[官方 quickstart](https://developers.openai.com/siwc/quickstart) 明确身份权限与套餐请求权限是两项能力；用户还需要符合账户资格并授权套餐权限。

## 3. 产品介绍英文草稿

下面的文本可以复制到产品介绍框。它说明申请目标，不声称已具备批准或托管服务；提交前请核对实际情况。

```text
FluentRead is an open-source browser extension for bilingual webpage translation, reading assistance, and writing. We would like eligible users to sign in with ChatGPT and authorize ChatGPT plan usage for these AI features.

Our intended public experience is sign-in and automatic return to the extension, without asking users to install a local runtime or perform developer setup. We are requesting approval for a hosted backend to manage the approved authentication and inference flow. This backend is planned and is not currently deployed.

Please confirm the supported client type, registered callback requirements, ChatGPT plan usage permissions, and whether this hosted browser-extension integration is eligible.

Project: https://github.com/FluentRead/FluentRead
Website: https://read.thinkstu.com/
```

<img src="/guides/chatgpt-application/04-interest-form-plan-and-product.jpg" alt="OpenAI 中文意向表中的身份登录和套餐请求选项、产品介绍框及提交按钮" width="1280" height="720" loading="lazy" />

截图来源：[OpenAI 中文意向表](https://openai.com/zh-Hans-CN/form/sign-in-with-chatgpt-interest/)，2026-10-14，真实页面，所有字段未填，未点击提交。

初次表单没有 callback URL、client ID 或完整 OAuth 服务器的填写项。按当前表单，可以先提交真实项目与计划；不能把开发指南的接入准备项误当成初次申请的必填项。上述截图仅记录入口，**没有代替维护者提交申请**。提交后仍需等待 OpenAI 确认资格与权限。

## 4. 获得回复后确认接入条件

在设计和部署公共流程前，向 OpenAI 明确确认：

- **应用与 client 类型**：FluentRead 浏览器扩展及计划中的托管后端是否获准，使用 public 还是 confidential client，以及正式分配的 client ID。
- **精确回调**：开发与生产环境各自允许的 callback URL，以及官方支持的返回扩展方式。FluentRead 当前没有已批准、已注册的公共回调地址。
- **套餐请求**：批准范围必须包含 ChatGPT plan usage，确认允许的 scopes、账户资格、模型和用量限制；身份登录批准不能代替这项批准。
- **托管运行**：确认服务器交换与保护令牌、续期和发起推理的许可与要求。公共托管后端是待批准、待部署方案。

[网站指南](https://developers.openai.com/siwc/website) 要求接入时准备已注册 client、精确回调和安全的应用会话后端，但该指南只说明身份登录。[开源套餐注册指南](https://developers.openai.com/siwc/token-sharing-open-source/sign-in) 的现有动态流程使用 `127.0.0.1` HTTP 监听回调；它没有明确提供浏览器扩展的 `chrome.identity` 或 HTTPS 套餐回调流程。公共扩展的一键接入仍需 OpenAI 确认支持方式，不能用网站登录示例宣称套餐推理已经可用。

现有 [隐私政策](/guide/privacy) 说明 FluentRead 没有自建翻译服务器。计划中的托管后端会改变数据传递方式；获批后实际开发和上线前，应按实际方案更新凭证存储、内容转发、撤销与删除、数据保留的披露，不能宣称现有政策已覆盖该服务。

维护者完成批准、部署和真实账户授权验证后，才能向普通用户开放扩展内发起授权、自动返回并使用服务的完整体验。
