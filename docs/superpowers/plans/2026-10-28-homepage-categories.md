# Homepage Categories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add approved editorial layout B below Featured Items with six correctly filtered collection destinations.

**Architecture:** A small client component reuses `/api/store/taxonomy`, just like the existing store menu, to resolve designer labels to active brand IDs. Pure collection configuration builds repeatable store links. Regular collections remain immediately usable; designer cards remain unavailable while taxonomy loads or fails, rather than linking to an unrestricted category.

**Tech Stack:** Existing Next.js 16, React 19, TypeScript, Tailwind, lucide-react, Jest, and browser harness.

**Spec:** `docs/superpowers/specs/2026-10-28-homepage-category-sections-design.md` (approved in chat).

## Global Constraints

- Editorial B: two 16:9 cards above four square cards on desktop; two columns on tablet; one column with 4:3 images on narrow mobile.
- Images fill their frames with object-fit cover. Brand New position: `50% 64%`; Designer Bags & Accessories: `50% 50%`.
- Preserve the exact 14 designer labels in the spec; use repeated `brandIds` parameters plus the appropriate category.
- Brand New and Pre-Owned select sneakers plus new/used condition respectively.
- Preserve unrelated logo/email edits, existing hero and featured behavior. No dependencies, migrations, or designer category.

## Review Focus

- Empty or failed taxonomy must never broaden designer collections to all brands.
- Non-designer premium streetwear must not enter the designer selection.
- Multiple designer selections must survive URL parsing as separate brandIds.
- Network completion after unmount must not overwrite component state.
- Images and layout must remain usable at mobile, tablet, and desktop sizes with visible keyboard focus.

### Task 1: Collection destinations

**Files:** Create `src/components/home/homepage-categories.ts`; create `tests/unit/homepage-categories.test.ts`.

**Interfaces:** Export `HomepageBrand` (`id`, `label` strings), `HomepageCategory` (label, image, href nullable string, objectPosition string, featured boolean), and `getHomepageCategories(brands: readonly HomepageBrand[]): HomepageCategory[]`.

- [x] Write tests for the six parsed destinations, exact designer allowlist, normalization/deduplication, and null designer links when no designer brand resolves. Independent fixtures include Nike, Chrome Hearts, Off-White, and Palm Angels to detect over-broad designer selection.
- [x] Run `npm run test:jest:unit -- --runInBand tests/unit/homepage-categories.test.ts`; expect missing module failure before implementation.
- [x] Implement configuration, label matching, and repeated-parameter URLs. Keep designer links null when no matching IDs resolve.
- [x] Repeat the focused test command; expect all tests passing.

### Task 2: Homepage UI and browser verification

**Files:** Create `src/components/home/HomepageCategories.tsx`; modify `src/app/(store)/page.tsx`; update `tests/browser/home-featured-items.mjs`; create `tests/browser/home-categories.mjs`; modify `package.json` to include the new browser check.

**Interfaces:** `HomepageCategories(): React.JSX.Element` consumes Task 1's configuration, fetches `/api/store/taxonomy`, and renders the approved section. Abort requests on unmount. Allow retry after network failure; keep four regular destinations usable throughout.

- [x] Extend the existing homepage browser check to expect the category heading, section order, six collection links, and intended filters after taxonomy resolves; expect it to fail before UI integration.
- [x] Implement layout B, exact photos/crops, lazy responsive Next Image sizes, accessible links, and loading/error states. Do not expose crop controls on the website.
- [x] Add browser checks for delayed/failed taxonomy and retry, missing designer brands, image loading, rendered responsive geometry, and keyboard focus. Use the existing esbuild boundary harness and real generated Tailwind CSS/local images; stub only Next Link/Image and API boundaries.
- [x] Run the focused browser scripts, unit suite, lint, typecheck, and build; report failures separately if unrelated.
- [x] Verify the real Next.js homepage visually on desktop and the rendered component at desktop/tablet/mobile sizes. Capture a review screenshot.
- [x] Request one fresh whole-change review, address material findings, and leave the implementation on its feature branch without merging or deploying.
