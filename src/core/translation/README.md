<!--
  @file src/core/translation/README.md

  文件职责：记录翻译候选核心的职责、处理管线、适配器决策模型与验证契约，帮助维护者理解 DOM 到候选文本的统一政策。
  主要内容：说明 dom、registry、engine、text、serialization 的协作顺序、独立文本槽协议与基础 DOM 守卫，解释安全守卫、man7 手册的受信正文边界、内容型按钮的显式站点例外、Shadow DOM、站点适配优先级，以及单元与真实站点回归的覆盖要求。
  模块边界：该文档只描述 core/translation 的维护契约，不充当运行时代码；候选使用 public.ts，纯协议与基础 DOM 判断分别直接使用 slotProtocol.ts、dom.ts，feature 调度和 provider 边界继续受架构测试约束。
-->

# Translation core

This directory owns FluentRead's DOM-to-translation-candidate policy. Candidate
callers outside the directory import `public.ts`. Consumers that only encode or
parse text slots import `slotProtocol.ts` directly, without initializing DOM
candidate dependencies or the site-adaptation registry. Consumers that only need
basic DOM guards import `dom.ts`, whose functions read supplied DOM without
loading candidate engines or compiling site rules. WXT treats a directory-level
`index.ts` as an entrypoint, so this package intentionally has no `index.ts`.

## Text slot protocol

`slotProtocol.ts` owns the shared `serializeTranslationSlots` and
`parseTranslationSlots` functions. It processes strings and immutable protocol
data, with no imports, DOM access, configuration reads or provider calls. The
broker and request snapshot use this source for batching, echo repair and
glossary source recovery. `serialization.ts` and `public.ts` re-export the same
functions for existing candidate consumers; they do not wrap or replace them.

The protocol keeps deterministic marker identities, collision avoidance, literal
marker handling and strict rejection of missing, duplicated or crossed slots.
Changing a consumer's import does not create a second implementation or change
cache identities.

The same ownership rule applies to `getElementTagName` and
`isTopLevelApplicationShell`: selection algorithms use their existing `dom.ts`
definitions directly. The candidate public entry still re-exports those exact
functions. Reading or speech clients that need selection helpers should not
initialize the site-rule pack merely by loading those clients.

## Pipeline

1. `dom.ts` applies non-overridable safety guards and composed-tree helpers.
2. `registry.ts` compiles the shared site-adaptation JSON catalog into typed
   adapters for the current URL; custom rules use the same compiler.
3. `engine.ts` resolves adapter decisions and generic layout boundaries.
4. `text.ts` extracts readable source text and rejects identifiers/target text.
5. `serialization.ts` prepares safe rich-text input for providers.
6. `src/features/full-page-translation/content/runtime.ts` is the runtime port
   for scheduling, provider requests and rendering. Hover and full-page
   translation both enter through the same
   `TranslationCandidateCore` and the same `translateTarget` function.

## Decision model

Adapters can return `pass`, `skip-self`, `prune-subtree` or `force-target`.
Safety guards (extension-owned DOM, scripts/styles, form inputs, editable or
hidden trees, `translate=no`, SVG/math and similar non-prose content) run before
adapter targets and cannot be reopened. Adapters are sorted by priority, while
registration order is stable for ties. Invalid selectors only invalidate that
match and never abort the page scan.

An adapter may set `genericCandidatePolicy` to `targets-only` when a site has a
large application shell and a stable content allowlist. This disables generic
block and inline-run fallbacks for that matched site while preserving explicit
`force-target` decisions for both hover and full-page translation.

Use `keepOriginal` for protected content that must survive rich-text handling,
and `omitFromTranslation` for metadata that must also be absent from the bilingual
copy. The original page node remains untouched in both cases. Icon-font glyphs
are excluded from provider input and bilingual copies based on their live primary
font family; ordinary prose with an icon font only in its fallback list is kept.
Scribble/Racket code tables marked `table.RktBlk` are protected as code, while
ordinary tables and prose remain eligible. Code blocks remain protected, except
for the browser's direct body `pre` in a `text/plain` document, where that element
is the readable document itself.
The man7 Linux manual capability additionally prepares verified manual `pre`
sections as reversible prose paragraphs. Only internally registered nodes can
cross that PRE boundary; matching a public marker alone grants no permission.
Terminal sessions and program source remain protected, while prose, list items
and parameter explanations share the ordinary hover/full translation pipeline.
Bilingual copies align their first and continuation lines to the original prose,
including hanging indents in lists and parameter descriptions. Translations share
the original prose column's right boundary, including short paragraphs and headings,
and shrink to the available container width. Manual layout line breaks collapse
so translated text wraps naturally within that column; the explicit long-paragraph
line-break option still applies. Window and appearance changes remeasure the
registered prose geometry without requesting another translation. Original PRE
layout is retained. Manual loading and retry feedback uses an owned block so it
cannot occupy the next paragraph's first line. Orphan cleanup handles that block
as one artifact and preserves feedback still held by active state.
Restoration removes the preparation wrappers and retains original inline nodes,
links, text and whitespace. This does not enable arbitrary HTML PRE or RFC text.
Ubuntu HTML manpages preserve command signatures and command labels using the
manual's section structure. Literal command and argument markup stays original
inside translated explanations; these rules apply only to Ubuntu's manpage URLs.
The JSON compiler maps `omit` to metadata omission and `literalLabels` to a
conservative command-label predicate. Both remain editable through ordinary
same-ID custom replacement; no parallel site-specific TypeScript registry is kept.

Bilingual copies can wrap even when the source inherits `white-space: nowrap`;
preformatted whitespace and explicit line breaks remain meaningful. In intrinsic
width contexts such as auto-layout tables, inline blocks and floats, only the
translation's inline size is contained, so the original text still determines
the column width. Direct text in a flex/grid content candidate is materialized
as one reversible source-and-translation item; controls and containers with
existing element children retain their ordinary ownership boundaries.
When a translation precedes an inside-list item, its inline block reserves the
native marker's measured space. The marker stays on the first translated line,
card styles remain a single box, and the original text continues below it.

Every accepted candidate includes a reason and optional adapter id. This keeps
hover/full equality and adapter precedence directly testable without starting a
browser. Open Shadow DOM is traversed through the same policy.

By default, buttons and elements with `role=button` or `role=menuitem` own their internal
labels, including labels styled as flex or grid boxes. They use the control text
slot path in both display modes, keeping a single visible label within the
original button height and preserving icons, click handlers and restoration.
Internal layout wrappers must not become bilingual paragraphs. Ordinary buttons
remain one control; clickable cards containing separate nested controls split
only their own labels into control targets or text runs, leaving nested buttons
with independent ownership.
A mutation scan starting at an internal label resolves back to the control;
protected subtrees still retain their original exclusion boundaries.

An explicit site-adaptation `content` target can classify a content-bearing
button or its internal headline label as `content`. This reuses the ordinary
bilingual/single rendering and restoration paths without changing generic
control ownership or bypassing hidden, editable or no-translate guards.
Kagi News selects the headline label inside its expand/collapse buttons, with a
non-atomic button fallback for headlines rendered directly as text. Keeping the
label as the content owner stacks the bilingual text within the site's flex
button rather than adding a second flex item. Other action buttons remain controls.

## Verification contract

`tests/translationCore.test.ts` covers generic and adapter decisions;
`tests/translationControlOwnership.test.ts` covers nested control labels and
the reusable `tests/fixtures/translation-pages/button-controls.html` fixture.
The real
site contract lives in `tests/browser-translation-cases.json` and is executed by
`scripts/run-site-translation-test.cjs` or
`scripts/run-site-translation-matrix.cjs`. A required case must pass both hover
and full-page translation, restore its original DOM, translate again without
duplicate/nested wrappers, preserve forbidden DOM and keep interactions stable.

Reference projects were studied for traversal and test ideas only. The code in
this directory is an independent FluentRead implementation; site selectors are
kept minimal and backed by FluentRead regression cases instead of copying an
external rule database.
