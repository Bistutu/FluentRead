---
title: Maintainers — apply for ChatGPT access
---

# Maintainers — apply for ChatGPT access

**FluentRead has not submitted an application or received public integration approval. Its hosted backend is not deployed.** This page explains the maintainer application. Users should see [ChatGPT plan availability](/en/config/chatgpt-plan). Verified on October 14, 2026.

## 1. Open the official interest form

Open OpenAI's [Request a client ID](https://developers.openai.com/siwc/request-client-id) page and follow its **Sign in with ChatGPT interest form** link. This joins a waitlist; it does not immediately create a client ID. You can also open the [English form](https://openai.com/form/sign-in-with-chatgpt-interest/) or [Chinese form](https://openai.com/zh-Hans-CN/form/sign-in-with-chatgpt-interest/) directly.

<img src="/guides/chatgpt-application/01-request-client-id.jpg" alt="Official OpenAI Request a client ID page with the interest form link" width="1280" height="720" loading="lazy" />

Source: [OpenAI Developers](https://developers.openai.com/siwc/request-client-id), October 14, 2026. Actual page, unmodified.

OpenAI currently describes this application route as a limited trial for selected commercial partners. The form directs open-source developers to developer documentation. If you have an OpenAI representative, the [website guide](https://developers.openai.com/siwc/website) also says to contact them. Individual maintainers should describe their project and hosting needs truthfully; OpenAI does not promise acceptance or publish a review timeline.

FluentRead seeks a public extension experience using ChatGPT plans. The [open-source plan documentation](https://developers.openai.com/siwc/token-sharing-open-source) directs paid or remotely hosted apps to the interest form. Being open source does not establish public hosting permission.

<img src="/guides/chatgpt-application/02-interest-form-top.jpg" alt="Official Chinese interest form introduction explaining commercial partner and open-source routes" width="1280" height="720" loading="lazy" />

Source: [OpenAI Chinese interest form](https://openai.com/zh-Hans-CN/form/sign-in-with-chatgpt-interest/), October 14, 2026. Actual page; fields empty, no submission.

## 2. Complete the 8 actual fields

These fields were verified in the official form. An asterisk means required; **Job title** has none. Adapt the suggestions to your actual circumstances. The screenshots show the Chinese interface.

| Field | Suggested information for a FluentRead maintainer |
| --- | --- |
| Work email * | A real contact address where you can receive a response. Do not invent a corporate address. |
| Last name * | Your real family name. |
| First name * | Your real given name. |
| Company name * | Your actual company, if any. Otherwise explain truthfully, for example `Independent open-source developer / FluentRead project`. Do not invent a company; this wording does not guarantee eligibility. |
| Website URL * | The real project website, `https://read.thinkstu.com/`. Add the open-source repository in the product description. |
| Job title | `Open-source maintainer`, if accurate. This field is optional. |
| Capabilities * | Choose the second option, requesting both sign-in and ChatGPT plan AI requests. |
| Products * | Describe FluentRead's real features, open-source status, extension use case, and planned hosting. The draft below can help. |

<img src="/guides/chatgpt-application/03-interest-form-fields.jpg" alt="Official Chinese form fields for email, names, company, website, job title, and capabilities" width="1280" height="720" loading="lazy" />

Source: [OpenAI Chinese interest form](https://openai.com/zh-Hans-CN/form/sign-in-with-chatgpt-interest/), October 14, 2026. Actual page; fields empty, no submission.

FluentRead needs the second capability for translation, reading, and writing AI requests. Identity sign-in alone is insufficient. The [official quickstart](https://developers.openai.com/siwc/quickstart) distinguishes identity from plan permission; users must also be eligible and authorize plan use.

## 3. Copyable product description

This draft describes the requested experience, without claiming approval or an existing hosted service. Check it against the actual project before submitting.

```text
FluentRead is an open-source browser extension for bilingual webpage translation, reading assistance, and writing. We would like eligible users to sign in with ChatGPT and authorize ChatGPT plan usage for these AI features.

Our intended public experience is sign-in and automatic return to the extension, without asking users to install a local runtime or perform developer setup. We are requesting approval for a hosted backend to manage the approved authentication and inference flow. This backend is planned and is not currently deployed.

Please confirm the supported client type, registered callback requirements, ChatGPT plan usage permissions, and whether this hosted browser-extension integration is eligible.

Project: https://github.com/FluentRead/FluentRead
Website: https://read.thinkstu.com/
```

<img src="/guides/chatgpt-application/04-interest-form-plan-and-product.jpg" alt="Official Chinese form identity and plan options, product description field, and submit button" width="1280" height="720" loading="lazy" />

Source: [OpenAI Chinese interest form](https://openai.com/zh-Hans-CN/form/sign-in-with-chatgpt-interest/), October 14, 2026. Actual page; fields empty, Submit not clicked.

The initial form has no callback URL, client ID, or completed OAuth server field. You can describe the real project and planned integration first; the development guide's integration prerequisites are not fields in this initial application. **These screenshots do not constitute an application.** Submission still requires OpenAI to confirm eligibility and permissions.

## 4. Confirm the integration after a response

Before designing and deploying the public flow, confirm with OpenAI:

- **Application and client type:** whether the browser extension and planned hosted backend are eligible, the public or confidential client type, and the assigned client ID.
- **Exact callbacks:** allowed URLs for development and production, and the supported return to the extension. FluentRead has no approved, registered public callback yet.
- **Plan usage:** approval must include ChatGPT plan AI requests. Confirm scopes, account eligibility, models, and limits; identity approval does not supply plan approval.
- **Hosted operation:** permitted server-side token exchange, protection, refresh, and inference. The public hosted backend remains a proposal pending approval and deployment.

The [website guide](https://developers.openai.com/siwc/website) requires a registered client, exact callback, and secure application-session backend for integration, but covers identity only. The [open-source plan registration guide](https://developers.openai.com/siwc/token-sharing-open-source/sign-in) uses an HTTP listener on `127.0.0.1`; it does not explicitly document an extension `chrome.identity` or HTTPS callback for plan usage. OpenAI must confirm a supported public extension flow before this can be offered.

The current [privacy policy](/en/guide/privacy) says FluentRead has no self-operated translation server. The planned backend would change data transmission. Before implementing and launching it after approval, disclose the actual credential storage, content forwarding, revocation and deletion, and data retention. The existing policy does not establish coverage for that future service.

Approval, deployment, and real-account authorization validation must precede a public release with sign-in, automatic return, and working AI requests.
