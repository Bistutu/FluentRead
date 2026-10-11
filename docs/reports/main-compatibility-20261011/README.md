# Frozen main integration and userscript acceptance

This change merges official main `25f5dca794848782f717493ce0e08545a0e57b35` into the shared Retry-After branch, preserving both the newer translation/UI features and the existing privacy, cancellation and transport-lease behavior. The merge initially produced a standalone userscript of **3,604,328 bytes**, exceeding its existing limit by 4,328 bytes. Lossless compression of the static service-icon table reduces that artifact by **17,240 bytes**; both original userscript build verifiers now pass.

The tested source is `ad21620f80d02729836dc77b3704ce0cf0f73dc7`, tree `acf60c2a721632b5956e544822b45a97877c0d0e`. Its merge parents are `e74968150f308af2c176b013226f6a4a02c3520f` and the frozen main above. Main and PR #912 were resolved and fetched once by exact SHA; later main changes are outside this report. Subsequent report-only commits do not change these production artifacts.

| Original CLI artifact | Bytes | Existing limit | Margin | SHA256 |
| --- | ---: | ---: | ---: | --- |
| Standard userscript | 2,018,735 | 2,025,000 | 6,265 | `77799000f4e0060ebdfd57ee7e922e08cd4baeb549fcb271fd0959cbfc7de4f8` |
| Standalone userscript | 3,587,088 | 3,600,000 | 12,912 | `4d3f021326ab7a0b713b5b3f5d595e3d5b507eacd75ea727c90f320f3f7b8095` |

The standard limit of 2,025,000 bytes is inherited from frozen main, which had advanced the earlier 2,010,000-byte limit. This integration does not raise it further. Standalone's 3,600,000-byte and Greasy Fork's 2,000,000-byte limits remain unchanged. No package/lock upgrade or executable-code compression was introduced.

## Merge and PR #912 overlap

The actual four conflict paths were `messageRuntime.ts`, area `textTranslation.ts`, input `handler.ts`, and `inputTranslationBackground.test.ts`. The three production conflicts affected Chinese file headers; their auto-merged executable bodies retain both branches. The test resolution joins 13 base, nine #906 and six main regressions, producing 28 cases. The popup test fixture now supplies the real main manifest contract; its privacy assertions remain.

Main's target-language/literal preflight, authorized default-popup routing, on-demand PDF fonts and hover improvements remain. Input translation still snapshots the trusted sender's ordinary/private/unknown state before its first await, attaches the same privacy/glossary context and request control, and retains cancellation registration and cleanup. Area translation preserves explicit glossary precedence, frozen target language, vision context and remaining request budget. All 81 recorded broker/provider/HTTP/background dependencies are byte-identical to the prior #906 head; this is source-retention evidence, not a fresh execution of every transport path. [Merge and source binding](./merge-source-binding.json)

Frozen PR #912 is `ee2c29bd5be95c2670ff2fa9ecc13985bbe85651`. Its five production-file changes were already represented in #906: the unavailable settings-loader guards, inflate-only pako entry, dead UI-export removal and standard-only `strictRequires`. No duplicate implementation was transplanted. Only its two still-missing gzip regression examples were reused, covering a typed-array view's offset/length and invalid header/checksum rejection. The resulting compression test file has five passing cases. The current video-local-transcription state relay remains; an older whole adapter was not copied. PR #912 was not closed or edited. [Overlap and final-file receipts](./pr912-overlap.json)

Main adds five language JSON resources absent from the prior immutable language pin. All 740 local language files were compared with official frozen-main Git objects and match exactly. The language pin therefore advances to `25f5dca7…`; the icon pin remains `184a3d74…`. No new remote resource was generated or published, and no host permission changed. This proves Git-object availability and byte identity; live CDN delivery was not exercised. [Full language binding](./language-resource-binding.json)

## Static SVG compatibility

The new transformation applies only to the standalone `ServiceIcon.vue` consumer of `serviceBrandPaths.json`, without query suffixes. It serializes the complete original object, including insertion order and every attribute, then uses the existing synchronous bundled inflate path. Standard, native extension, Greasy Fork and other consumers retain their original paths. The complete Lobe MIT notice is still emitted for the virtual module.

Seven added configuration regressions cover exact consumer/mode boundaries, complete data round-trip through the real bundled inflater and actual license emission. The source table contains 38 services and 63 paths; its canonical JSON is 38,074 bytes, SHA `603d249a2b8c27b5473b395b49b05836464652d314b2deae1836978c4f362928`. The standard artifact is byte-identical before and after this standalone-only transformation. The initial standalone failure is retained alongside the final original-verifier pass.

## Validation and source reuse

The retained targeted result is **769 different cases across 12 files**: the first run passed 762, including 44 configuration cases; the final configuration file passed 51. The other 718 cases and their relevant production inputs remain unchanged. This total replaces the earlier 44 with 51; it does not add reruns or the historical 151/606-case batches. An initial added SVG test referenced the wrong bundled-inflate export name; the fixture alias was corrected and that failure log retained.

Type checking, test audit, Chrome/Firefox builds, generated-manifest verification and both original userscript CLI/verifiers pass. The audit's 654 files and 10,865 syntactic cases are static inventory, not an executed full suite. Chrome/Firefox were built before the final SVG-only configuration change; only `userscript/vite.config.ts` and its test differ from that build snapshot, and WXT does not consume either. Native sources, original SVG/component, WXT configuration and dependency inputs are unchanged, so those successful builds are reused with an explicit ledger. Main's popup manifest additions mean the manifests differ from the earlier historical report. No extension was installed by these tests. [Logs, hashes, case sources and build reuse](./validation.json)

## Real Neo userscript results

Nine localhost sessions passed in Neo `browserclaw/v0.51.0`, CDP `Chrome/155.0.8309.26`. Each used its own temporary HOME/XDG/profile and a visible private Xvfb X11 display, 1440×1000, with a 1280×900 window at 60,40. There was no daily-profile connection, desktop scan, `bringToFront`, minimization or sandbox disabling. Loopback CDP was gated to the owned process identity. CSP, exact localhost GET paths and memory-GM request denial kept external model/API calls at zero. All owned processes, listeners and private X sockets were cleaned; the exclusive lease is absent and further launches are disabled.

Both exact, unmodified IIFEs initialized, registered menus, opened/navigated/closed/reopened settings and preserved the host hash. Browser script SHA matched the archived artifact before and after execution. Each mode passed six actual CommonJS MD5/SHA256 vectors, five gzip error contracts, and native typed inputs at offsets 0, 3 and 17: 24 inputs from eight standard fixtures, 30 from ten standalone fixtures. Functional documents force native `DecompressionStream` off; standalone has no global pako and uses its actual bundled backend. Cold timing documents retain the native stream.

Standalone's actual seven tldts exports match the complete 116,078-byte locked reference, SHA `b9bc8ae20f317a2317cdd1cd82737cda61fb71556298f36da16261bb8964a3b2`, including typed constructors, array lengths, string and roots. Its actual parser matches 22 locked-package vectors using pure strings, without DNS requests. The real compiled ServiceIcon component and real Vue `createApp` were captured from the same original lexical scope. All 38 apps rendered 63 paths with matching SVG namespace, viewBox, ordered `d`, `clip-rule`, `fill-opacity` and remaining original attributes, then unmounted. These detached real DOM checks do not establish pixel or layout equivalence. The unavailable image/video/writing/stats pages and context-menu hint have no misleading forms; the supported speech section retains eight controls without downloads or inference. Area/model-usage aliases were not directly driven.

| Current-artifact observation | Independent processes | Median | Range |
| --- | ---: | ---: | ---: |
| Standard IIFE append → settings and CSS ready, no API hooks | 3 | 195.0 ms | 190.3–199.5 ms |
| Standalone same readiness, no API hooks | 3 | 213.1 ms | 210.2–219.8 ms |
| First natural SVG atob → JSON completion, separate hooked samples | 3 | 0.9 ms | 0.9–1.0 ms |

Cold intervals exclude browser-process startup and do not establish OS/V8/disk-cache coldness. The two settings UIs differ, so the columns do not rank identical functionality. SVG bytes materialization plus actual inflate has a 0.9 ms median; parsing and atob can fall below the clock's observed precision. Hook/timer overhead is unquantified. These three instrumented sessions do not replace the six unwrapped cold samples. The first SVG sample did not pin the complete helper-file SHA before import; an unused parameter-construction export was added around that run. The actual observation function bodies are byte-identical across retained versions. The report records this version boundary explicitly.

Current-artifact tldts warm replay uses three uninstrumented sessions, three warmups and 15 retained samples per process: 45 samples, total median 2.2 ms, range 2.0–2.8 ms. It uses the actual captured inflater but replays constructors. Actual exports/parser checks are separate. Earlier natural-tldts timing belongs to the older artifact and is not rebound here. There is no uncompressed browser control, RSS or throughput measurement, universal functional-equivalence proof, or global-optimality/Pareto claim. [Raw timing samples and source-bound browser receipts](./browser-validation.json)

## Greasy Fork and remaining scope

The original Greasy Fork wrapper fails before building: its existing selector pins `af81332fb598f78b1199d103e0943e4e521a7f96`, whose resource lock lacks the current fontkit entry. A separately labelled direct-Vite diagnostic bypasses that failed wrapper solely to measure the remaining gap. It produces 2,486,441 bytes, **486,441 over the unchanged 2,000,000-byte limit**, and generated data differs from the tracked fixed resource. Those are three unresolved release blockers. The diagnostic predates the final SVG configuration, which is disabled for GF; it is not a final GF release receipt. No resource pin was changed, resource published, budget relaxed, or GF success claimed. [Diagnostic and exact hashes](./gf-diagnostic.json)

Extension incognito acceptance, real provider/model/search APIs, downloads/inference, native GNOME Wayland/Cua, actual RTX5090 WebGPU, the whole repository suite and coverage remain unrun. User approval for a temporary-profile extension-incognito run is separate from these userscript results. The local browser harness and private raw profiles/logs are not published; the public receipts retain their basenames and hashes, so this is not a one-command browser benchmark.

## Reproduction

Use the tested source above, Node 26.7.0, pnpm 9.12.1 and the frozen lock, with the referenced immutable resource Git objects available. Run commands serially through the repository's resource wrapper; 60% is a cooperative target, not a kernel CPU quota.

```bash
pnpm install --frozen-lockfile
export FLUENTREAD_TEST_CPU_TARGET=60
export FLUENTREAD_TEST_MAX_WORKERS=1
export FLUENTREAD_TEST_CONCURRENCY=1
pnpm test tests/inputTranslationBackground.test.ts tests/areaTextTranslation.test.ts tests/backgroundMessageRuntimePrivacy.test.ts tests/backgroundFeatureHandlers.test.ts tests/floatingPopupAuthorization.test.ts tests/floatingPopupOverlay.test.ts tests/popupEmbedded.test.ts tests/targetTranslationResult.test.ts tests/sameTargetLanguageClient.test.ts tests/translationCore.test.ts tests/userscriptViteConfig.test.ts tests/userscriptCompression.test.ts
pnpm compile
pnpm test:audit
pnpm build
pnpm build:firefox
pnpm verify:extension-manifests
pnpm build:userscript
node scripts/verify-userscript-build.mjs
pnpm build:userscript:standalone
node scripts/verify-userscript-standalone-build.mjs
pnpm docs:build
```

The suggested PR body is maintained locally; external PR metadata was not changed.
