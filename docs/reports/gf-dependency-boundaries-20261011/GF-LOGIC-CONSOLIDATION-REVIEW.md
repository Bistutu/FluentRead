# Config and broker consolidation review

This bounded review did not find a sufficiently large, proven behavior-equivalent consolidation for the approximately 248 KB remaining planning deficit. It found several small maintenance candidates. No patch is proposed here, no gross span is treated as fully removable, and no net saving, global limit or Pareto optimum is established.

The live configuration state module is `src/services/config/store.ts`; `state.ts` is absent. The current source inputs are 104,916 B for `model.ts`, 94,802 B for `store.ts`, and 94,124 B for `broker.ts`. Their hashes are recorded in the JSON report. Against code commit `80c9da44f8cd7c01f7a50ac767c79396cf78cce5`, these target files differ only in the Config import of manga normalizers; the reviewed function bodies are unchanged.

Compiled ranges in this report bind only the 2,349,380 B reference artifact with SHA256 `78bc5697da881bd392fdead89eb700b905cdd49c572cfdb512b8b44bc4ab66a1`. They are not coordinates or size results for newer statistics, manga, CSS or facade outputs. This review did not measure an updated original-wrapper artifact.

## Small candidates

An AST/token scan of the three target files compared consecutive 3–20 statement windows of at least 130 source UTF-8 bytes, excluding trivia while retaining names, literals and operators. Only three store groups met that exact bounded criterion. No large exact model/broker block matched. This is not an exhaustive semantic clone search.

| Candidate | Exact source locations | Gross evidence and safe boundary |
| --- | --- | --- |
| Failure recovery | `store.ts:1663–1674`, `1692–1703` | Two identical 617 B node spans, excluding leading indentation. Keep the distinct error and existing branch/await order. |
| Advance/reset/reconcile | `store.ts:1511–1515`, `1666–1670`, `1695–1699`, `1820–1824` | Four identical token sequences with formatting differences; overlaps the recovery blocks. They cannot be added to those blocks as independent savings. |
| Commit bookkeeping | `store.ts:1738–1744`, `1803–1809` | Identical assignments in 442 B and 370 B node spans. Authority checks preceding each site must remain. |
| Pending Map release | `broker.ts:1326–1331`, `1435–1444`, `1613–1622` | Reference-artifact spans are 295 B, 365 B and 335 B: 995 B total before replacement helper/call costs. |

The JSON report separately records whole source-line ranges, including indentation/newlines; those values differ from AST node spans. Source ranges and reference-artifact ranges use explicit coordinate scopes.

For store recovery, a synchronous helper can share state clearing and bookkeeping. An unconditional `await` or an async convenience wrapper would introduce a new microtask boundary on paths that previously had none, allowing request/revision/credential-watch races. Preserve credential restoration before reconciliation, ownership predicates, failure reasons and every existing first-await boundary.

For broker release, a helper must register the exact original Promise in the correct Map, delete it only if the Map still holds that same Promise, handle both settlement paths and return the original Promise. Do not merge the three maps, change request keys, introduce `finally`/`await`, or leave a rejected cleanup Promise.

Existing tests cover the affected boundaries: `configStoreAuditBoundaries.test.ts` at 346, 397, 892, 901, 911 and 925; `configIndexedDbIntegration.test.ts`; `backgroundConfigPersistenceHandler.test.ts`; broker tests at 1002, 1170 and 1251; shared-deadline recovery at 77 and 92; and recovery sharing/statistics at 50 and 59. Any implementation would still require actual builds and final-artifact acceptance; these small gross inventories do not solve the size deficit.

## Larger-looking scopes that are not established duplicates

**Config initialization:** 198 emitted `__publicField` statements total 8,698 B when summing the individual statements without inter-statement whitespace. The source has 197 bare declarations plus `display = 1`, followed by 198 explicit constructor assignments. A simple `declare` change removes runtime own-property creation and can expose inherited setters or non-writable properties. Moving defaults into field initializers changes evaluation order: declaration order differs from constructor assignment order, and ten right-hand sides invoke factories or normalizers. Property insertion order, descriptors, fresh collection identity, prototype protections and evaluation order all require proof. The 8,698 B inventory is not a removable-byte claim.

**Cloning:** model's clone occupies 1,163 B in the reference artifact and credentials' clone 1,286 B. They share an iterative WeakMap pattern but differ in enumeration and filtering. Model cloning uses `HasProperty` at each array index, preserving inherited or non-enumerable indexed entries and holes. Credential cloning uses enumerable own keys, excludes custom array properties and optionally strips sensitive object keys. An undifferentiated helper changes compatibility or secret filtering. Relevant existing tests include Config audit boundaries at 149, 181 and 199, credential/encryption tests and history projection tests.

**Equality:** credential equality occupies 1,423 B and patch equality 1,101 B in the reference artifact. Patch equality uses `Object.is`, preserves raw own keys and distinguishes negative zero. Credential equality applies JSON-like conversion: non-finite numbers become null, functions/symbols become undefined, undefined object values are omitted, and absent/undefined array values compare as null. Similar traversal does not justify replacing either predicate. Config diff has related JSON comparison, but that module is absent from the GF graph, so sharing its code supplies no demonstrated current GF saving. Patch expectations, cycles, own keys and credential comparisons need their existing regression coverage.

**Complete single/batch pipelines:** their reference function scopes are 3,843 B and 6,912 B. Single requests include image identity and slot/detection boundaries. Batches include mode/fingerprint identity, partial and deduplicated item-cache reads, complete neighboring-context recomputation for AI multi-segment, leaked/plain missing groups, native batch validation and atomic cache publication. These are containing functions, not two redundant copies.

**Per-slot leak recovery:** loops at `broker.ts:1010–1036` and `1139–1165` occupy 832 B and 918 B in the reference artifact. Prompt slots are validated parsed values governed by `usedContextFreeRequest`; ordinary/native batches use null fallbacks and `startWithoutPageContext`. Later protocol, unchanged-result and wrong-language checks differ. The finalization loops at 1130–1135 and 1167–1172 also pass different context arguments. A shared helper would need explicit contracts and could add an async settlement boundary. No equivalence or net saving is established. Existing context-leak tests at 1676 and 1889, cancellation/deadline tests and statistics tests remain essential.

## Evidence

`GF-LOGIC-CONSOLIDATION-REVIEW.json` contains source hashes, exact locations, dependencies, tests and non-adoption reasons. `GF-LOGIC-SPANS.json` contains exact source/reference-artifact ranges and all 198 field-definition receipts. The static parser is reproducible with the repository's installed TypeScript module:

```sh
node GF-LOGIC-SPANS.mjs "$REPO_ROOT" original-retained-fluent-read.user.js "$REPO_ROOT/node_modules/typescript/lib/typescript.js" > GF-LOGIC-SPANS.json
```

The initial inventory's unrestricted name map rejected an unrelated repeated nested function named `execute`. Restricting it to the explicit target function whitelist resolved that analyzer ambiguity; it was not a product failure.

This phase performed only local reads, static parsing and evidence writes. It did not edit repository code, apply patches, run tests/builds, use a browser/API/network, or change resources, permissions, environment or credentials. The already evaluated statistics and manga candidates were not repeated. No further phase was started.
