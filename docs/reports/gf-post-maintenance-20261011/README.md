# CW post-maintenance Greasy Fork resource and size report — 2026-10-11

The original GF command now passes its lock-input and committed/tracked/built resource checks, then fails the unchanged **2,000,000-byte** source budget: **2,349,380 bytes, 349,380 bytes over**. This is a retained build/resource change with a documented release blocker. It is not a GF release or browser deployment.

Code and resources are committed together at `80c9da44f8cd7c01f7a50ac767c79396cf78cce5` (tree `3f1823724652efb10a3e33a439e7ac15e424cf84`), based on previously pushed `353621606fe86a329fcd1ba678c4c78ab8107e06`. The existing frozen-main integration remains `25f5dca794848782f717493ce0e08545a0e57b35`; no new main merge was performed. The separate #912 checkout remains protected at `ee2c29bd5be95c2670ff2fa9ecc13985bbe85651`.

## Retained behavior

The existing character-data plugin uses one strict exported-const-string AST parser for all 49 original exports. GF reads those complete named strings synchronously from plain JSON in the existing immutable data resource. Standard and standalone retain their original gzip/delta transform; both real source-module transform outputs were byte-identical to the original plugin. Missing or non-string resource fields fail explicitly. The full Unicode notice remains in the main output and the data resource.

GF also reads six complete original CSS strings through seven exact `.css?inline` importer edges inside the existing catalog plugin. Other paths, queries, importers and output modes retain their previous resolution. Tests compare all six strings against actual Vite preprocessing. Inputs needing `@import`, `url()`, `@apply` or BOM preprocessing are rejected rather than silently changing CSS semantics.

The existing pinned vendor adds the already installed TinyColor constructor and Noble `sha256`/`bytesToHex` public exports. Their full applicable MIT texts are retained by the existing license collector; CryptoJS exports keep their implementation. No dependency, credential, grant, endpoint, product decision rule or permission was added. No primary product logic moved into a remote resource.

The old cached data was independently stale: English/Chinese key counts were 1,465 rather than 2,407, and the pinned catalog had 17 rather than 19 current categories. The catalog source itself was unchanged between its old pin and the current source. This mismatch is not attributed to Node or the added Fontkit lock entry. Regeneration restores the current language/catalog/CSS contents before measuring further candidates.

## Fixed resources and original guard

[Resource binding](./resource-binding.json) records actual three-way byte equality and full SHA256 values.

| Resource at code commit `80c9da44…` | Bytes | SHA256 |
| --- | ---: | --- |
| `fluentread-data.v1.js` | 980,711 | `6d43a00d1732422fe0946b292a1986254a1e3244eb04f156ce6a13c1649a0d37` |
| `fluentread-vendor.v1.js` | 602,246 | `8fa608295f4e3479c9c70a1181ee008944c85b19d1c3bd542f7062e91898fc38` |

Both `@require` URLs use the same immutable 40-character commit. The original selector still finds the last commit touching the two resource paths. Its guard still compares `vendorEntry.ts`, `vendor.vite.config.ts` and `pnpm-lock.yaml` against that commit. The wrapper, all three original output verifiers, package and lock are byte-identical to the prior pushed source; budgets are unchanged. A proposal to broaden the selector to input-only commits was withdrawn because it could select stale resource bytes.

The final normal wrapper's GF SHA256 is `78bc5697da881bd392fdead89eb700b905cdd49c572cfdb512b8b44bc4ab66a1`; it has 49,512 lines. Its resource/lock checks finish before invoking the original verifier. That verifier stops at the size assertion, so its later line-count, resource, UI and license assertions were **not run**. Separate read-only observations of those same predicates passed and are labeled separately in the resource receipt; they do not waive size or turn the original failure into a pass.

No resource URL was fetched. An authorized fork push alone does not prove that this commit is reachable under the official `FluentRead/FluentRead` CDN path. Official upstream availability remains a release prerequisite.

## Actual size experiments

[Candidate receipts](./candidate-matrix.json) bind each diagnostic artifact and input snapshot. The candidate builds retain the same old 40-character URL text solely to keep metadata lengths comparable; those diagnostic URLs do not certify current resource contents. The normal final wrapper changes the pin and SHA256, with the same measured size.

| Actual artifact | Main bytes | Over original budget |
| --- | ---: | ---: |
| Original CLI diagnostic after maintenance | 2,486,441 | 486,441 |
| Current-data regenerated baseline | 2,479,675 | 479,675 |
| A: complete named character data | 2,426,264 | 426,264 |
| A+C: plus existing TinyColor vendor export | 2,399,164 | 399,164 |
| A+D: plus existing Noble vendor exports | 2,417,327 | 417,327 |
| A+C+D | 2,390,227 | 390,227 |
| A+C+D+F: plus six plain inline CSS strings | 2,349,380 | 349,380 |
| Final original wrapper with committed resources | 2,349,380 | 349,380 |

The first 6,766-byte main reduction came from refreshing stale data, independently of A/C/D/F. The retained changes then save 130,295 main bytes against the fresh baseline. Fresh main+vendor+data total 3,935,984 bytes; retained total is 3,932,337 bytes, a 3,647-byte reduction. Against the older published resource set plus original main, the retained total grows by 197,242 bytes, including the inherited current language/UI refresh. No general download or performance improvement is claimed.

The readable all-minify-false formatter diagnostic grew to 2,574,428 bytes and was rejected. A separate AST/token-checked indentation counterfactual measured 2,322,881 bytes on the fresh baseline, still 322,881 bytes over; it ran in memory and was not retained or browser-tested. Candidate B was screened out before implementation: four identified literal initializers total only 12,219 raw bytes before replacement costs. This is a bound on that subset, not the possible savings of all product code.

The finite experiments and five earlier experiment designs do not establish a global limit, SOTA, Pareto dominance, or five executed rounds after reaching a limit. Large primary product modules remain in the readable main. Closing the remaining gap requires further maintainable source/bundle work with behavior evidence; increasing the budget, minifying the GF product code, or moving product logic into remote resources was not authorized. [Greasy Fork's official code rules](https://greasyfork.org/en/help/code-rules) inform that release boundary.

## Verification and evidence limits

All heavy stages ran serially on CW with CPU target 60%, one worker and concurrency one. The post-maintenance runtime is Node 26.11.1/npm 11.20.0 with the existing pnpm 9.12.1, Vite 5.4.19 and installed lock/dependencies preserved. No install or dependency upgrade ran. [Environment](./environment.json), [validation](./validation.json), [stage ledger](./stage-ledger.json) and [log binding](./log-binding.json) preserve actual hashes and stage inputs.

| Check | Actual outcome |
| --- | --- |
| Final clean code commit's two targeted runtime files | 87/87 passed: config 82, compression 5 |
| Final production source compile | Passed |
| Test classification audit | Passed: 654 files, 10,877 syntactic cases; not full-suite execution |
| Vendor public-export synthetic vectors | 168 assertions passed against the final vendor SHA256 |
| Final standard build + original verifier | Passed: 2,018,735 bytes, original budget 2,025,000 |
| Final standalone build + original verifier | Passed: 3,587,088 bytes, original budget 3,600,000 |
| Original GF release command | Failed: 349,380 bytes over original 2 MB budget |
| VitePress documentation build | Passed |
| Full static site check / Storybook build | Blocked: existing linked Storybook output absent; declared 8.6.18 package is not installed (`spawn storybook ENOENT`) |

Final standard SHA256 is `77799000f4e0060ebdfd57ee7e922e08cd4baeb549fcb271fd0959cbfc7de4f8`; final standalone SHA256 is `4d3f021326ab7a0b713b5b3f5d595e3d5b507eacd75ea727c90f320f3f7b8095`. Both are byte-identical to their historical artifacts. This identity does not establish a new browser/environment runtime test.

The vendor vectors use independent Node crypto oracles for fixed synthetic SHA/MD5/HMAC/AES cases and compare language/color/hash/error/namespace contracts. They include complete original/new license text checks. Real AI generation, model execution, database access and network operations were uncalled; fetch/random/timer traps recorded zero calls. The VM separates trusted globals and is not a security sandbox for untrusted code. [Vector receipt](./vendor-synthetic-vectors.json) states these limits.

An intermediate standalone candidate was 45 bytes smaller (`15534e86…`). Its static AST audit accounts for MD5 initialization structure −40 bytes and identifier spelling −5 bytes, with algorithm callbacks unchanged and no residual bytes. That result binds only the intermediate/control hashes and is not a Node-causation or runtime claim. The final retained standalone is the original `4d3f0213…` artifact, so the 45-byte intermediate result is not reported as a final saving.

[Failure contexts](./failure-contexts.json) retain the original stale-lock failure, invalid non-production graph diagnostic, missing helper dependency, one stale catalog-fixture failure, and omitted `TransformStream` in the first vector harness. Corrected later checks do not erase those outcomes. Sanitized selected logs are committed; original local log hashes and larger frozen artifact/source receipts remain in the CW evidence directory. No credentials or authentication file contents were copied.

## Unrun and remaining blockers

The VitePress build passed. Its full static artifact check failed on the existing `/storybook/` link, and the attempted existing Storybook build failed because the declared 8.6.18 package is absent from this checkout’s preserved installed dependencies. No install or upgrade was performed under the current dependency-preservation constraint. The new report is explicitly excluded from website rendering by the existing `reports/**` configuration. This phase does not claim the full docs site check passed. Logs and both failed stages are retained.

This phase launched no Neo/browser session and called no real search/model API. Current GF browser integration/resource delivery, post-maintenance Neo acceptance, FluentRead **extension incognito** acceptance, GNOME Wayland/RTX5090 WebGPU and the full repository runtime suite remain unrun. The earlier [frozen-main browser evidence](../main-compatibility-20261011/README.md) retains its own exact hash/session bindings and isolated X11/Xvfb scope; it does not cover those unrun checks.

The minimum next GF step is further source-level size work followed by the unchanged normal wrapper, plus official immutable resource availability before release. No browser installation, persistent process, new MCP access, profile migration, daily-profile scan, security setting, remote control port or GF publication was performed. PR metadata editing remains blocked by the earlier 403 and was not retried through another path.
