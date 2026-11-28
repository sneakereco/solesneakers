# Vercel Image Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver responsive optimized storefront images from existing sources without backfill.

**Architecture:** Use the existing Next.js Image components and default loader. Vercel handles hosted transformations and caching; Supabase remains the original-file store.

**Tech Stack:** Next.js 16.3, React 19, TypeScript, Jest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-27-vercel-image-optimization-design.md`

## Global Constraints

- No database migration, storage rewrite, upload processing change, destructive cleanup, blanket cache warm-up, or deployment.
- Retain existing image widths, qualities, remote patterns, and intentional per-image bypasses.
- Preserve product detail and slideshow composition and purchase behavior.
- Execute in the attached isolated worktree; do not include the shared checkout's unrelated changes.

## Review Focus

- Old Supabase URLs must generate optimizer URLs without editing stored data.
- Local photography must receive responsive URLs; intentional small-asset bypasses must still work.
- Gallery thumbnail requests must not compete with the main photo's preload.
- The slideshow must not fetch an original CSS background alongside the optimized photo.
- Unsupported source hosts must remain excluded by the existing configured remote patterns.

### Task 1: Enable the default image optimizer

**Files:** `next.config.ts`, `tests/unit/image-optimization.test.tsx`.

**Interfaces:** Existing Next.js Image components and stored URLs remain unchanged.

- [x] Add real Next.js image-prop tests for existing remote and local image sources and explicit bypasses. Run them before editing configuration; expect the optimized source/srcset assertions to fail.
- [x] Enable optimization, select WebP, and use a four-hour minimum cache TTL. Preserve sizes, qualities and remote patterns.
- [x] Run the new tests; expect them to pass. Verify real optimizer HTTP responses in an isolated local Next.js fixture using this configuration.

### Task 2: Remove remaining unnecessary storefront transfers

**Files:** `src/components/store/ProductDetail.tsx`, `src/components/home/OutfitSlideshow.tsx`, `tests/unit/image-optimization.test.tsx`, `tests/browser/home-clothing.mjs`.

**Interfaces:** Same image URLs, layout, interactions and public component props.

- [x] Add a regression for lazy gallery thumbnails with a prioritized main photo and for the slideshow's deferred optimized backdrop. Confirm failures against current behavior.
- [x] Make thumbnails lazy; render the slideshow backdrop with an Image sharing the foreground's responsive source selection.
- [x] Run targeted Jest and homepage browser checks. Verify actual source selection/request reuse in an isolated fixture with the real Next.js Image component.
- [x] Run lint, type checking and an independent review; resolve material findings. Record local versus hosted verification limits in the operations investigation.

Execution decision: proceed inline under the user's explicit implementation request. The small change does not need a new execution-method approval round. Keep all changes reviewable in the attached worktree; no deployment or unrelated commits.
