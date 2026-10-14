---
title: 使用 ChatGPT 套餐
---

# 使用 ChatGPT 套餐

FluentRead 可以通过官方 **Sign in with ChatGPT** 授权，使用符合资格的 ChatGPT Plus 或 Pro 账户的套餐额度进行翻译、阅读讲解和写作。模型从当前账户获取，无需填写 OpenAI API Key。可用模型、套餐权限和用量限额由 OpenAI 决定。

此接法适用于开源工具和本地运行的个人项目。付费或远程托管应用需要先向 OpenAI 申请访问权限。参见 [OpenAI 接入说明](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt)。

## 连接步骤

官方授权流程要求本机 HTTP 回调。浏览器扩展不能监听 TCP 端口，因此需要一起运行 FluentRead 的本机助手。

1. 安装 **Node.js 20 或更新版本**，使用已交付且包含 `integrations/chatgpt-plan/cli.mjs` 的 FluentRead 源码。本地开发版直接使用当前工作树，在源码仓库根目录打开终端；包含此助手的版本发布后，也可从 [FluentRead 仓库](https://github.com/Bistutu/FluentRead) 下载对应源码。
2. 运行：

   ```sh
   node integrations/chatgpt-plan/cli.mjs
   ```

   仓库开发者也可以运行 `pnpm chatgpt:bridge`。助手只监听 `127.0.0.1:18743`；使用期间保持终端打开。
3. 打开 FluentRead 的完整设置 → 翻译服务 → **ChatGPT 套餐**，输入助手显示的一次性配对码。配对码 5 分钟有效；过期时在助手终端输入 `pair` 获取新码。
4. 点击 **Continue with ChatGPT**，在官方网页登录并同意套餐使用权限。完成后返回设置页；登录窗口不会要求你提供 API Key。
5. 在“套餐可用模型”中选择一个当前账户可用的模型，再点击该服务的“设为默认”。也可只为划词、输入框、图片、视频、文档、阅读助手或写作选择此服务。
6. 点击“检查连接”完成一次最小真实翻译请求。此请求会使用你的套餐额度。

配对和账户授权会在助手重启后保留。每次助手启动显示新配对码，但已配对的同一扩展无需重复配对。不同浏览器或扩展安装需要各自配对。

## 账户与用量

- **管理套餐用量**打开 ChatGPT 的用量设置；达到限额后可查看权限、等待额度恢复或调整套餐预算。
- **切换 ChatGPT 账户**开启新的动态注册。新账户授权完成前原连接仍有效；失败或取消不会覆盖原连接。完成后刷新模型列表并确认保存的模型仍可用。
- **退出 ChatGPT 账户**清除本机 OAuth 凭据并取消该账户未完成的请求，保留助手配对和已保存的翻译、模型选择。若远端撤销未得到确认，界面会引导你在 ChatGPT 设置中移除共享。
- 关闭助手后，请求会提示无法连接本机助手。重新启动后可重试；这不会清除已完成的译文。

## 数据与边界

OpenAI 的 access/refresh/ID token 只保存于本机助手的私有目录（默认 `~/.config/fluentread-chatgpt-plan`，目录 `0700`、凭证文件 `0600`）。扩展只保存与其安装来源绑定的本机配对凭证，单独存放，均不进入配置导出、配置历史或云备份。配对码只显示在助手终端；不要分享给他人。

助手仅接受已配对扩展来源，检查 Host、Origin 和请求格式，使用 PKCE、state、nonce 及签名验证。模型请求只发往官方 `https://api.openai.com/v1/responses`，按套餐协议使用 `stream: true`、`store: false`。翻译和使用模型的必要上下文会随请求发送给 OpenAI；此授权不会读取你的 ChatGPT 历史对话。

套餐协议与普通 API Key 接口不同，不能使用自定义代理、请求体、请求头和不支持的采样参数。只有收到完整 `response.completed` 才提交最终结果，部分输出后发生失败或断流不会被当作成功。

此功能目前用于 Chrome、Edge 和 Firefox 扩展；用户脚本版不提供本机助手配对入口。浏览器构建通过不能证明每个真实账户都有权限；授权和模型调用以账户实际返回为准。参见 [官方预览限制](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)。
