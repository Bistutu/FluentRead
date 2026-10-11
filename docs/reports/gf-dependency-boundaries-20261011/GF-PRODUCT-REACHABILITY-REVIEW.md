# GF product reachability review

The best bounded candidates are a GF-only translation statistics adapter and a separation of manga preference normalizers from reader matching. Both preserve supported product functions and keep primary logic in readable main code. Neither candidate has a net size result in this static review.

The baseline is code commit `80c9da44f8cd7c01f7a50ac767c79396cf78cce5`, tree `3f1823724652efb10a3e33a439e7ac15e424cf84`, retained by commit `f35d642dda4213b5d042be1982f45e3c4687d7e7`. Its original-wrapper GF artifact is **2,349,380 B**, SHA256 `78bc5697da881bd392fdead89eb700b905cdd49c572cfdb512b8b44bc4ab66a1`, exceeding the unchanged 2,000,000 B budget by **349,380 B**. The current 381-module graph has the same artifact SHA. The older `GF-MODULE-GRAPH.json` describes a different 2,486,441 B artifact and is historical evidence only.

## Statistics boundary

Both repositories have exactly one external importer in the current graph: `src/app/translation/runtime.ts`. The graph excludes `platformFull`, background usage/writing/harness composition, and local insights handlers. Connection testing accepts an optional recorder, but the GF platform does not supply one. Vision probing uses the same shared broker and retains its separate probe storage. ReadingPanel uses its existing client/message contracts and has no repository reference. The GF platform supplies no dashboard, statistics reset, or usage transfer handler.

The metadata matches HTTP(S) pages only. The existing protocol guard allows writes only on Chrome, Firefox or Safari extension protocols. Model usage already captures generation 0 and returns before recording on HTTP(S). Translation statistics captures its repository generation unconditionally: that generation starts at 0, `captureGeneration()` only reads it, and only `clear()` increments it. No external `clear()` or other query/transfer method is reachable in this GF graph. Consequently its generation remains 0, recording never enters the repository, its queue stays empty, and it schedules no statistics flush.

`GF-STATS-BOUNDARY.production.patch` introduces the dedicated `userscript/translationInsights.ts` adapter and two GF-only exact repository aliases. It retains both capture ports at 0 and the existing asynchronous/synchronous record contracts without inspecting their inputs. It leaves the shared runtime, its protocol guard, extension paths, standard output and standalone output unchanged. Standalone retains its original full-options repository and reset-generation behavior.

`GF-STATS-BOUNDARY.tests.patch` adds five cases to the existing ViteConfig suite: HTTP(S) metadata, three output modes with exact alias boundaries, and actual adapter behavior with inputs that throw if read. An AST check rejects runtime imports, calls or constructors in the adapter. No new test file or verification classification is introduced.

The existing retained statistics implementation occupies UTF-8 bytes **[1,101,757, 1,169,475)**: **67,718 B**, SHA256 `a6e441a6264ed838fd5717532f05098013d9d8436a346fdec917709faaa16608`. This is a gross existing span, not an artifact saving. Removing unused repository constructors also removes inert Dexie object/schema initialization; cold start and preserved cache/config behavior need acceptance. Dexie itself remains required by supported storage, so this review claims no vendor-library or license removal. New GF protocols, repository import spellings, dashboard/reset exposure, or repository methods require review of this boundary.

Required checks are the focused ViteConfig/platform/privacy/broker statistics suites, retained repository regressions, compile and supported output checks, then the original GF build wrapper/verifier without changing the budget. The final GF graph should exclude both real repositories and their aggregation implementations. Authorized synthetic browser/manager acceptance must bind the exact final artifact and resources, exercise settings/translation/input cancellation/cache/config, and verify absence of usage/statistics origin writes with the existing permissions and network surface.

## Manga preference boundary

`manga.ts` retains only its normalizer/rule functions in the current GF graph. Its reader matcher exports are removed. Its top-level imports still bring in catalog URL/map initialization and a profile spread; the catalog and profile matcher/UI exports are removed, yet their initialization remains.

`GF-MANGA-NORMALIZERS.production.patch` moves the unchanged `MangaSiteRule` interface and four functions to `src/core/config/mangaRules.ts`. Config imports this narrow module directly. `manga.ts` imports and reexports the same function objects and publicly reexports the type, retaining all original import contracts and reader matching behavior. It neither edits nor externalizes any catalog, domain, selector, field, order, or matcher logic. Its added existing-suite test checks function identity and representative complete rule behavior.

The affected retained initialization occupies UTF-8 bytes **[73,879, 85,207)**: **11,328 B**, SHA256 `9b4ec7938d5cd5f0f1b85eab19ea1230ce1131113d8abef9371b8b90f8de96f5`. Preserved normalizers are outside this span. Net savings require a build. Config stops triggering reader catalog initialization, so future import-time dependencies must have an explicit owner.

The new executable `src` module must be added beside `manga.ts` in the existing `vitest.coverage.config.ts` strict coverage include. `verificationOwnership.test.ts` requires this four-dimension coverage boundary; build-only treatment is insufficient. This registration is a prerequisite of applying the candidate, not part of these review-only patches. Validate the unchanged complete mangaSites catalog/rule fixtures, Config normalization/import/transfer and userscript initialization, strict coverage, compile, and original extension/standalone public imports. Rebuild GF with its original wrapper to measure retention changes.

## Other findings and limits

The current entry is a single `userscript/main.ts` IIFE with dynamic imports inlined. Its false full-options define selects the slim platform and settings modules; OptionsApp is absent. No duplicate physical TypeScript module was found. The eleven Vue script/wrapper/style groups are normal component decomposition, not duplicate implementations. These observations do not establish the absence of similar functions or every possible duplication.

SelectionTranslator, SettingsPanel, ReadingPanel, FloatingBall, ShareCardStudio and the translation content features are live supported components. Their size is not deletion evidence. Config compatibility requires keeping defaults, normalization and persisted/imported extension preferences even when their GF UI is unavailable. Model/service catalogs and language algorithms also serve active UI, routing, migration and target-language preflight. The shared image operation registry supplies cancellation safety and cannot be discarded merely because image UI is absent.

Strict AST parsing found four literal initializer spans totaling **12,219 B**: credential labels 322 B, model IDs 728 B, language options 3,378 B, and translation style presets 7,791 B. No additional data patch is proposed. Any future data extraction needs exact named-consumer whitelists, full field/type/nesting/order roundtrips, retained singleton reference identity and mutation/freeze behavior, resource pinning and licenses. This small initializer inventory excludes replacement and validation costs and supplies no net saving.

The two reachability candidates have a combined **79,046 B gross code-span inventory**. That value is not a measured saving or a proof that the 349,380 B deficit can be closed. These candidates and the data screen do not establish a global size limit or Pareto optimum. Separate source-tree and exact-artifact receipts are needed for any later evaluation.

## Evidence and reproduction

`GF-PRODUCT-REACHABILITY-REVIEW.json` records module references, proof boundaries, focused checks and exact patch hashes. `GF-PRODUCT-SPANS.json` records zero-based, half-open UTF-8 and UTF-16 ranges plus hashes. To reproduce the static parse with the repository's installed TypeScript parser:

```sh
node GF-PRODUCT-SPANS.mjs original-retained-fluent-read.user.js "${REPO_ROOT}/node_modules/typescript/lib/typescript.js" > GF-PRODUCT-SPANS.json
```

This review performed bounded local reads and static parsing without evaluating the product artifact. It wrote only evidence and candidate patches. It did not apply production patches, run tests/builds, launch or connect a browser, call a provider/API, or modify resources, permissions, environment or credentials. Subsequent candidate results require their own receipts and are not implied by this review.
