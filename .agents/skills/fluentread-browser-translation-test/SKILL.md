---
name: fluentread-browser-translation-test
description: Run and diagnose FluentRead real-browser translation tests from a WXT development build. Use when Codex must start `pnpm dev`, load `.output/chrome-mv3-dev` in an isolated browser, operate paragraph translation with a real Control key event, verify translate-remove-translate state toggling, validate Microsoft or another configured translation service, capture DOM/screenshot evidence, or determine whether a shortcut failure is an automation problem rather than a plugin regression.
---

# FluentRead Browser Translation Test

Test the built FluentRead extension in an isolated graphical Microsoft Edge profile. Prove behavior with both visible browser state and DOM assertions; do not infer success from build output alone.

## Locate the active project

1. Treat the current FluentRead checkout or worktree as the project under test.
2. Confirm it contains `package.json`, `wxt.config.ts`, and `entrypoints/content.ts`.
3. Run `git status --short` before testing. Preserve all existing changes.
4. Do not edit or build `read-frog` or `kiss-translator`; they are reference projects only.

## Choose the test path

- Use the bundled runner in `scripts/run-toggle-test.cjs` for the standard paragraph test.
- Use manual GUI operation only when diagnosing visuals, browser prompts, extension loading, or a runner failure.
- A fresh isolated profile uses FluentRead's default Microsoft service. Use `--expected-service microsoft` for that path.
- To test `siliconCloud` or another credentialed provider, use a dedicated test profile through `--profile-dir`. Configure its credential in the GUI with user handoff, then use `--expected-service siliconCloud` to prove the intended provider is active.
- Never overwrite API keys or models merely to make the test pass. Ask the user only if the requested provider requires credentials that are absent.

## Start the development build

From the active FluentRead checkout:

```bash
pnpm dev
```

Keep this process running. Wait until WXT reports a successful build and verify:

```text
.output/chrome-mv3-dev/manifest.json
```

`pnpm dev` may open its own WXT Chromium window. Leave the user's everyday Chrome profile untouched. The bundled runner opens a separate temporary Edge profile and loads the same live development artifact.

If `pnpm dev` needs GUI or network access, request the normal scoped approval for that command. Do not broaden approval to unrelated shell commands.

## Load browser automation dependencies

Call the Codex workspace-dependencies tool and record:

- Node.js executable
- Node.js packages directory

Pass the packages directory as `--playwright-root`. Do not hardcode a dated Codex runtime path in new documentation.

## Run the standard test

Invoke the runner with absolute paths:

```bash
<bundled-node> \
  <this-skill>/scripts/run-toggle-test.cjs \
  --extension-dir <fluentread-checkout>/.output/chrome-mv3-dev \
  --playwright-root <bundled-node-packages> \
  --url https://example.com \
  --selector p \
  --expected-hotkey Control \
  --artifacts-dir /private/tmp/fluentread-toggle-evidence
```

Add an exact service assertion when required:

```bash
--expected-service microsoft
```

or:

```bash
--expected-service siliconCloud
```

For a credentialed provider, also pass a dedicated profile that is not a daily browser profile:

```bash
--profile-dir /private/tmp/fluentread-edge-profile-silicon-test
```

The runner never deletes an explicitly supplied profile. Do not point `--profile-dir` at a normal Chrome or Edge profile. If credentials must be entered or changed, hand control to the user for that step.

The runner performs this exact gesture three times:

```text
move mouse to ordinary paragraph text
-> click the paragraph
-> keyboard.down("Control")
-> keyboard.up("Control")
-> wait for the expected DOM state
```

Do not substitute `CTRL`, `Control_L`, `Ctrl+A`, or a synthetic JavaScript `KeyboardEvent`. FluentRead requires an exact shortcut match, and the browser input must be trusted.

## Required assertions

Accept the run only if all assertions pass:

1. The extension injects `#fluent-read-floating-ball-container` into the page.
2. The active configuration is enabled, bilingual, and uses the expected `Control` hotkey.
3. First gesture: the target paragraph contains exactly one `.fluent-read-bilingual-content` element with Chinese text.
4. Second gesture: the target paragraph contains zero translated elements.
5. Third gesture: the target paragraph again contains exactly one translated element.
6. A neighboring paragraph never gains a translated element.
7. The page URL does not change, so no link or full-page action was triggered.
8. The final paragraph contains one translation, not a duplicate.

Use `--expected-text '<known translation fragment>'` when the provider output is deterministic enough for an exact content check. Otherwise the runner requires at least one CJK character and reports the actual text.

Save first-translation and final-state screenshots when `--artifacts-dir` is supplied. Inspect at least the final screenshot when visual correctness matters.

## Manual GUI fallback

If the runner cannot establish the state:

1. Open an isolated Edge profile with only `.output/chrome-mv3-dev` loaded.
2. Navigate to `https://example.com`.
3. Dismiss Edge's native translation prompt with `Escape` if it covers the page.
4. Confirm the FluentRead floating ball is visible.
5. Move to the first paragraph, click ordinary text, tap and release `Control` once.
6. Repeat twice to verify translate, restore, and translate again.
7. Inspect `.fluent-read-bilingual-content` after every gesture.

Read `references/troubleshooting.md` before changing product code in response to a test failure.

## Interpret results

- A successful `[1, 0, 1]` sequence proves paragraph state toggling, not every translation feature.
- A build success without browser evidence is insufficient.
- A `Control` failure after using another key name is an automation error, not evidence that the plugin is broken.
- A provider error with correct shortcut and DOM injection is a service/configuration failure, not a shortcut failure.
- `Alt+T` or `Option+T` exercises full-page translation and is outside this paragraph test.
- `pnpm compile` may expose unrelated pre-existing type errors. Attribute a regression only when modified files add new errors.

## Clean up and report

1. Let the runner close Edge and delete only an automatically generated temporary profile in `finally`. Preserve an explicitly supplied dedicated profile.
2. Stop the exact `pnpm dev` process started for this run.
3. Run `git status --short` and `git diff --check`.
4. Confirm the test created no tracked project changes.
5. Report browser, artifact path, active service, configuration summary, `[1, 0, 1]` counts, translated text sample, screenshot paths, and any limitation.

Never kill a broad browser process set or delete a non-temporary profile.
