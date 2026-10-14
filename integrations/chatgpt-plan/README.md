# ChatGPT 套餐本机助手：开发者实验

此目录仅供维护者和开发者研究官方 OAuth 协议，不是普通用户的安装流程。FluentRead 尚未申请或获得公共应用接入批准，当前公开版本不提供此服务。公共流程的 client ID、精确回调、套餐使用及托管访问权限需要维护者先向 OpenAI 申请；身份登录权限不能代替套餐推理权限。

公共申请入口、实际表单字段和官方页面截图见 [维护者申请指南](../../docs/guide/chatgpt-application.md)。下述本机实验不提供公共托管批准。

本机实验入口只在开发模式并显式启用以下开关时出现：

```sh
WXT_CHATGPT_PLAN_LOCAL_DEVELOPMENT=true pnpm dev
```

此开关必须同时满足 WXT `DEV` 模式才有效，不能在 production 构建中开放服务。下述助手、授权和配对步骤只用于这个隔离开发实验；模拟测试通过也不代表公共产品已经可用。

FluentRead 的浏览器扩展通过此助手使用官方 Sign in with ChatGPT OAuth。浏览器扩展无法监听官方要求的 `127.0.0.1` TCP 回调；助手在本机完成登录、保存和续期 OpenAI 令牌，并向官方公共 Responses API 发起请求。

需要 Node.js 20 或更新版本，无需安装新依赖或配置 API Key。从已交付且包含此助手的 FluentRead 源码仓库根目录运行；本地开发版可直接使用当前工作树：

```sh
node integrations/chatgpt-plan/cli.mjs
```

保持终端运行，在 FluentRead 设置中粘贴终端显示的一次性配对码，然后选择“Continue with ChatGPT”。系统浏览器完成授权后返回扩展查看连接与账号模型。配对码有 192 位随机熵、5 分钟有效期、10 次尝试上限，成功后立即失效；终端输入 `pair` 生成新码。扩展只保存访问本机助手的随机凭证，不接触 OpenAI access/refresh/ID token。

固定只监听 `http://127.0.0.1:18743`，与扩展的本机地址保持一致；端口被占用时先关闭已有助手或占用该端口的程序。不要改为 `localhost`，也不要通过反向代理对外暴露此进程。`--data-dir 路径` 可选择独立凭证目录；默认 `~/.config/fluentread-chatgpt-plan/`。凭证目录在 Unix 上为 `0700`，文件为 `0600`，写入采用原子替换。一个目录只允许一个助手进程，避免旋转 refresh token 的并发竞争。Windows 的文件权限仍需由操作系统用户目录 ACL 保护。不要将此目录加入仓库、同步盘或共享目录。

助手每次启动生成新配对码，已有扩展配对凭证可跨重启继续使用；不同扩展 Origin 各有独立凭证。对同一 Origin 重新配对会撤销旧配对凭证。普通重连复用现有账号注册；切换新账号采用独立动态注册，验证完成前继续保留旧连接，验证成功后仅保留旧 registration 元数据并清除旧令牌。当前 UI 只使用一个账号，不保留无法选择的历史账号令牌。退出 ChatGPT 保留扩展配对与 host/client 注册元数据，但取消当前账号请求、清理本地 OpenAI 令牌并尝试远端撤销；如果返回 `revocationConfirmed: false`，用户还需在 ChatGPT 设置中断开应用以确认撤销。

接口仅接受合法的 `chrome-extension://…`、`moz-extension://…` Origin；配对后的 Bearer 凭证还必须与该 Origin 匹配。`Host` 必须精确等于监听地址，拒绝转发头和其他域名，防止 DNS rebinding。普通网页、缺少 Origin 的 API 请求和简单表单请求均被拒绝。OAuth 回调使用一次性 state 独立验证，返回页面不含脚本或凭证。`GET /health` 是唯一允许无 Origin 的诊断接口，不含用户数据。

| 接口 | 请求 / 返回 |
| --- | --- |
| `POST /health` | `{}` → `{name,version}`，无需配对 |
| `POST /pair` | `{code}` → `{bridgeToken}`，仅一次返回随机本机凭证 |
| `POST /status` | `{}` → `{connected,sharing,account?,authPending,error?}` |
| `POST /auth/start` | `{newAccount?:boolean}` → `{authorizationUrl}`，URL 不包含 OpenAI 令牌 |
| `POST /auth/cancel` | `{}` → 安全状态，保留已有连接 |
| `POST /models` | `{}` → `{models:[{slug,display_name}]}`，仅保留官方 `visibility:list` 模型 |
| `POST /responses` | `{model,input[],instructions?,tools?,parallel_tool_calls?}` → SSE |
| `POST /logout` | `{}` → `{connected:false,revocationConfirmed}` |
| `POST /unpair` | `{}` → `{paired:false}`，仅撤销当前扩展的本机凭证 |

配对以外的接口要求 `Authorization: Bearer <bridgeToken>`。POST 请求必须带 `Content-Type: application/json`。`health/status/models` 也支持 GET；扩展推荐 POST 以触发明确的 CORS Origin。模型请求固定 `store:false`、`stream:true`，拒绝未知参数。仅支持 namespace 中的本地 function/custom tools，拒绝托管工具；本机助手只负责传输，工具执行由扩展负责。SSE 必须收到 `response.completed` 才视为成功，失败、提前结束和取消均不伪装成成功。

退出先取消请求并清理本机令牌，再在最多 8 秒的总预算内尝试远端撤销（包括身份服务发现）。超时仍返回本地已退出和 `revocationConfirmed:false`。续期遵守服务器返回的 `earliest_refresh_at`；提前续期尚不可用时仅使用仍未到期的 access token，到期后停止请求。

已实现 OpenAI OIDC discovery/JWKS 验证、PKCE、state、nonce、issuer/audience/过期/账号一致性校验、续期单飞，以及取消和退出后晚到结果的隔离。所有生产 OpenAI 请求固定在 `auth.openai.com` 与 `api.openai.com`，拒绝 HTTP 重定向；没有 `backend-api` 或可配置令牌服务。OAuth 测试用注入 transport 和时钟运行离线 HTTP 服务，不依赖真实账号。

开发说明：当前官方 Token reference 列出了 `earliest_refresh_at` 字段，但未具体说明类型、单位或额外必选规则。本助手对其中的数值采用 Unix 秒解释，这是实现假定；未返回该字段时，沿用 `expires_in` 的到期信息在临近到期时续期。上游 HTTP 错误状态保留，错误码只转发固定白名单，未知错误码和所有上游 message 均转换为本机安全提示。

```sh
node --test tests/chatgptPlanBridge.test.mjs
```

官方资格仍适用：当前公开流程面向开源工具及本地个人项目，用户需有符合资格的 ChatGPT Plus/Pro 并授权套餐使用；付费或远程托管服务需先申请访问。本仓库的离线测试不证明真实账号授权、套餐资格或线上模型质量。

官方依据：[Cookbook](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt)、[注册和登录](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)、[账号与会话](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)、[模型与推理](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)、[预览限制](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)。
