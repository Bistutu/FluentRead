# Translation core

This directory owns FluentRead's DOM-to-translation-candidate policy. Callers
outside the directory import `public.ts`; WXT treats a directory-level
`index.ts` as an entrypoint, so this package intentionally has no `index.ts`.

## Pipeline

1. `dom.ts` applies non-overridable safety guards and composed-tree helpers.
2. `registry.ts` selects typed site adapters for the current URL.
3. `engine.ts` resolves adapter decisions and generic layout boundaries.
4. `text.ts` extracts readable source text and rejects identifiers/target text.
5. `serialization.ts` prepares safe rich-text input for providers.
6. `main/trans.ts` is the runtime port for scheduling, provider requests and
   rendering. Hover and full-page translation both enter through the same
   `TranslationCandidateCore` and the same `translateTarget` function.

## Decision model

Adapters can return `pass`, `skip-self`, `prune-subtree` or `force-target`.
Safety guards (extension-owned DOM, scripts/styles, form inputs, editable or
hidden trees, `translate=no`, SVG/math and similar non-prose content) run before
adapter targets and cannot be reopened. Adapters are sorted by priority, while
registration order is stable for ties. Invalid selectors only invalidate that
match and never abort the page scan.

Every accepted candidate includes a reason and optional adapter id. This keeps
hover/full equality and adapter precedence directly testable without starting a
browser. Open Shadow DOM is traversed through the same policy.

## Verification contract

`tests/translationCore.test.ts` covers generic and adapter decisions. The real
site contract lives in `tests/browser-translation-cases.json` and is executed by
`scripts/run-site-translation-test.cjs` or
`scripts/run-site-translation-matrix.cjs`. A required case must pass both hover
and full-page translation, restore its original DOM, translate again without
duplicate/nested wrappers, preserve forbidden DOM and keep interactions stable.

Reference projects were studied for traversal and test ideas only. The code in
this directory is an independent FluentRead implementation; site selectors are
kept minimal and backed by FluentRead regression cases instead of copying an
external rule database.
