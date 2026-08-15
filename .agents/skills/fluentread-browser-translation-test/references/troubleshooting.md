# Troubleshooting

Read this file only after the standard runner fails or when the user requests diagnosis.

## Shortcut does nothing

- Confirm the configured mouse hotkey is exactly `Control`.
- Send `keyboard.down("Control")` followed by `keyboard.up("Control")`.
- Do not use `CTRL`, `Control_L`, `Ctrl+A`, Meta, or a DOM-created keyboard event.
- Move and click the target before sending the key. Click ordinary text, not an anchor.
- Confirm no extra ordinary key is held. FluentRead performs exact set matching.

Source anchors:

- `entrypoints/content.ts`: `getConfiguredMouseHotkeyParts`, `checkMouseHotkey`, and the `keyup` handler.
- `entrypoints/utils/option.ts`: default `hotkey: "Control"`.

## Extension was not injected

- Confirm `.output/chrome-mv3-dev/manifest.json` exists.
- Keep `pnpm dev` running so the dev artifact and HMR server remain available.
- Use a fresh temporary profile. Do not reuse a daily Chrome or Edge profile.
- Confirm `#fluent-read-floating-ball-container` exists before triggering translation.
- Check the service worker and content-page console for load errors.

## Translation element appears but has no Chinese

- Inspect the active provider in `chrome.storage.local` through an extension page.
- Distinguish provider/API failure from shortcut failure.
- For `siliconCloud`, use an explicitly supplied dedicated test profile and confirm the user's token and custom model are already configured; never print or replace the token.
- For `microsoft`, inspect `entrypoints/service/microsoft.ts` and the background message path.
- A deterministic Microsoft test on `https://example.com` may use:

```text
该域用于文档示例，无需许可。避免在操作中使用。
```

Do not require this exact wording for an LLM provider unless the user asks for it.

## Wrong paragraph or page translated

- Use the first plain-text paragraph on `https://example.com`.
- Ensure the second paragraph remains at zero translated children.
- Do not use `Alt+T` or `Option+T`; those are full-page shortcuts.
- Check that the URL remains unchanged after every gesture.

## State counts differ from 1,0,1

- Wait for each state before sending the next gesture.
- A provider request can take up to the configured timeout.
- Count `.fluent-read-bilingual-content` inside the target paragraph, not globally.
- If the third state is greater than one, report duplicate insertion as a regression.
- If the second state stays at one, inspect `handleBilingualTranslation` removal timing in `entrypoints/main/trans.ts`.

## Build and type-check interpretation

- Run `pnpm build` for a production build check when relevant.
- Run `git diff --check` after the browser test.
- Treat existing `pnpm compile` failures as baseline unless the current changes introduce new errors in modified files. Known categories can include missing `chrome` global types and duplicate Vite type versions.

## Cleanup

- Close only the persistent context created by the runner.
- Delete only an automatically generated profile under the OS temporary directory with the `fluentread-edge-profile-` prefix. Preserve any explicitly supplied dedicated profile.
- Stop only the exact `pnpm dev` process started for the test.
- Never run broad `pkill` commands against Chrome, Edge, or Node.
