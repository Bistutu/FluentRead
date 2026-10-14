---
title: Use your ChatGPT plan
---

# Use your ChatGPT plan

FluentRead can use an eligible ChatGPT Plus or Pro plan through official Sign in with ChatGPT authorization for translation, reading assistance, and writing. Models are discovered from the connected account. You do not need an OpenAI API key. Availability and usage limits depend on the account.

This integration is for open-source tools and locally running personal projects. Paid or remotely hosted apps need access approval from OpenAI. See the [official cookbook](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt).

## Connect

The OAuth flow requires a loopback HTTP callback. A browser extension cannot listen on a TCP port, so run the included local helper:

1. Install Node.js 20 or newer and download the [FluentRead repository](https://github.com/Bistutu/FluentRead).
2. From the repository directory, run `node integrations/chatgpt-plan/cli.mjs`. Keep the terminal open while using this provider. The helper listens only on `127.0.0.1:18743`.
3. Open FluentRead settings → Translation services → ChatGPT plan. Enter the one-time pairing code printed by the helper. It expires after five minutes; enter `pair` in the helper terminal to obtain a new code.
4. Choose **Continue with ChatGPT**, sign in on the official page, and authorize plan usage. Return to settings when finished.
5. Choose a model from the account’s current list and explicitly set the provider as default, or select it for a specific feature.
6. Use **Check connection** to perform a small real translation request. This uses your plan allowance.

Pairing and account authorization survive helper restarts. Each browser extension installation pairs separately. Switching accounts starts a new registration and replaces the current connection only after validation succeeds. Refresh the model list and confirm that your saved model is available.

## Privacy and recovery

OpenAI tokens stay in the helper’s private local directory, `~/.config/fluentread-chatgpt-plan` by default. The directory uses `0700` and credential files use `0600` permissions. The extension keeps only a separate local pairing credential. Neither appears in configuration exports, history, or cloud backup.

Signing out clears local OAuth credentials and cancels unfinished requests, while retaining pairing and your completed translations. If remote revocation is unconfirmed, remove the app’s access in ChatGPT settings. Stopping the helper produces a recoverable connection error. **Manage plan usage** opens ChatGPT usage settings for quota and permission management.

Requests use the public Responses API with `stream: true` and `store: false`. The provider sends your requested text and necessary context to OpenAI and does not read your ChatGPT conversation history. It does not accept custom endpoints, headers, request bodies, or unsupported sampling settings. Final results require `response.completed`; a failed or truncated stream is not successful.

This provider is available in the Chrome, Edge, and Firefox extensions. The userscript does not provide the local pairing flow. Build and fixture tests do not prove eligibility for a real account. See [OpenAI’s preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).
