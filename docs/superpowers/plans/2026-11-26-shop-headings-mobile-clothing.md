# Shop Headings and Mobile Clothing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the selected Barlow collection headings and center clothing cards on phones.

**Architecture:** Keep the existing store page and shared product carousel. Load one local font only on the collection heading; choose mobile card width and snapping according to the clothing category.

**Tech Stack:** Next.js 16.3, React 19, Tailwind 3, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-26-shop-headings-mobile-clothing-design.md`

## Global Constraints

- Barlow Condensed ExtraBold, weight 800; uppercase, centered, 30px on phones and 32px above the small breakpoint, with 0.015em letter spacing. Long headings wrap.
- Below 640px, clothing cards fill the available carousel width and snap to the center.
- Preserve contained images, navigation, inventory/prices, loading/error states, reduced motion, and tablet/desktop card sizes.
- Keep body copy, product titles, admin typography, homepage section headings, and featured-sneaker cards unchanged.

## Review Focus

- First and last clothing cards should center as accurately as middle cards.
- A single clothing item should center without unnecessary scrolling controls.
- Switching between phone and tablet widths should retain useful snapping.
- A long search with an unbroken word should wrap within a phone viewport.
- The actual 800-weight font should load from the application and apply only to the collection heading.

### Task 1: Center mobile clothing cards

**Files:** Modify `src/components/home/FeaturedItems.tsx` and `tests/browser/home-clothing.mjs`.

**Interfaces:** Existing `FeaturedItems({ category?: "clothing" })`; no new exports.

- [x] Run the existing home-clothing browser suite for a baseline.
- [x] Extend that suite to measure first, middle, and last clothing card centers at 320, 375, 390, and 430px; require less than 1px offset from the carousel viewport center. Cover one-item centering, unchanged featured-sneaker width, and tablet/desktop multi-card layout.
- [x] Run `node tests/browser/home-clothing.mjs`; observe a centering assertion fail against the existing 78% card.
- [x] Use full-width, center-snapped clothing cards below 640px; retain existing widths and start snapping above that breakpoint. Update clothing image `sizes` to reflect the full mobile width.
- [x] Run `node tests/browser/home-clothing.mjs` and `node tests/browser/home-featured-items.mjs`; require success, including existing inventory/state/motion cases. Capture the mobile clothing section.

### Task 2: Apply the selected heading font and validate

**Files:** Modify `src/app/(store)/store/page.tsx`; add `src/components/store/fonts/BarlowCondensed-ExtraBold.ttf` and its `OFL.txt` license.

**Interfaces:** Existing server `StorePage`; `next/font/local` provides a scoped class name. No new public interface.

- [x] Bundle the exact previewed font and its upstream license. Define the local font in the store page with weight `800`, style `normal`, and display `swap`.
- [x] Apply its class only to the collection `h1`, with the approved size/spacing and safe wrapping for unbroken search terms.
- [x] Use a real Next.js page in a local browser to verify Shop All, category, filter, and long search headings at phone/desktop sizes; inspect the loaded font and unchanged body typography. Capture screenshots. This styling change needs visual/runtime verification, not source-text tests.
- [x] Run targeted ESLint, TypeScript, and Prettier checks; run the existing relevant browser suites and a production build when the configured environment is available.
- [x] Request one fresh review of this task's changes against the approved spec; address material findings, then commit only the scoped implementation and documentation. Do not push or deploy.

## Completion evidence

The home-clothing regression failed at 320px before the fix and passed afterward;
the featured-items browser suite also passed. Real Next.js checks passed for
Shop All, Clothing, Filtered Collection, a normal search, and a 96-character
unbroken search at 320, 390, and 1440px. The font loaded locally at weight 800;
body typography stayed Arial. ESLint, typechecking, formatting, and the production
build passed. Independent review found no critical or important issues.

One optional coverage improvement remains: explicitly checking start snapping
after a phone-to-tablet resize. The implementation sets the correct breakpoint
behavior; the existing resize assertions verify the card widths.
