# little-helper

A single Chrome Manifest V3 extension. Bun bundles TypeScript/React UI, Markdown capture and retained JavaScript site enhancements. Load `dist/`, never the source root.

## Commands

- `bun install --frozen-lockfile`
- `bun run typecheck` checks TypeScript and GitHub's strict JavaScript project.
- `bun run test` runs focused Vitest regressions with jsdom.
- `bun run build` generates the extension and PNG icons.
- `bun run check:build` validates packaged references and Mermaid chunks.
- `bun run dev` rebuilds on source changes; reload the unpacked extension manually.

## Boundaries

`src/background/index.ts` registers the browser, GitHub and clipper workers. Popup actions send namespaced messages to the relevant content scripts. Clipper capture results are scoped by tab, URL and request. Session storage holds captures, tab activity and redirect traces. Local storage holds preferences and histories; reader display preferences use sync storage.

`src/github/entry.js` gates initialization and inlines CSS. `src/github/diagrams.js` is split into local ESM chunks exposed through the manifest. Do not move diagram output without updating the reader import, manifest and package check.

`src/browser/` retains useful original JavaScript to avoid a broad rewrite. New logic uses strict TypeScript. Keep types inferred where possible, no `any`, and comments for non-obvious invariants only.

## UI

Approved direction B: compact site-first toolbox with a fixed 420 × 600px popup, single-line actions and right-aligned details, true black background, white text, system sans, thin dividers, no decorative cards/pills or continuous animations. Markdown capture uses a matching side panel. Native controls must remain labelled and keyboard operable. For new non-trivial design changes, show multiple static mocks and wait for Wesley's pick.

## Behavior

Tab cleanup must start disabled and protect active/pinned/audible/excluded/last tabs. Do not store incognito tab URLs in persistent history. Preserve cookie stores/partitions and save replacements before removing changed identities. Music sends audio only after explicit Listen, cleans up tracks/context, and never exports credentials with preferences. Never log secrets or page captures.

The original reference checkouts have been removed; all build inputs live in this repository. Preserve upstream notices in `licenses/` and `public/`. Keep README feature, install, permission and privacy descriptions aligned with behavior.

## PRs

Use a feature branch, rebase onto latest main, open a real PR, and name model/harness in the description. Do not merge without instruction. Native Chrome-only APIs need honest manual-validation notes when verification only used a UI fixture.
