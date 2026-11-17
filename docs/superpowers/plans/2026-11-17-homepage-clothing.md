# Homepage Clothing Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add the approved outfit slideshow and live clothing carousel below Featured Items.

**Architecture:** Add a client-side OutfitSlideshow for local images and timed transitions. Extend FeaturedItems with an optional clothing category that consumes the public catalog endpoint and reuses its existing rendering and navigation. Compose both below the current featured row.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS and Playwright.

**Spec:** docs/superpowers/specs/2026-11-17-homepage-clothing-design.md

## Constraints

- Page order is hero, Featured Items, outfit slideshow, Shop Clothing and Shop by Category.
- Six-second autoplay with crossfade, faint arrows at opposite edges and touch navigation.
- Slideshow has no counter, playback controls or overlaid clothing button.
- Use real catalog inventory with product links and a clothing destination below the row.
- Respect reduced motion and stop autoplay following focus or manual navigation.

## Tasks

- [x] Export the selected images and implement the approved slideshow.
- [x] Verify navigation, autoplay suppression, reduced motion and framing at 390, 767, 768 and 1440 px.
- [x] Extend FeaturedItems with the clothing category and newest twelve available clothing products, their primary catalog images and in-stock prices.
- [x] Add clothing loading, empty and retry states and the Shop All Clothing destination.
- [x] Verify product links, carousel scrolling, request cleanup, default featured behavior and section order.
- [x] Run production build, TypeScript, scoped lint, homepage browser checks and all 475 unit tests.

## Review focus

Empty clothing inventory keeps the clothing destination usable. Failed requests allow retry. Abort late completion after unmount. Suppress autoplay when offscreen, manually navigated or reduced motion is enabled. Clothing cards use primary catalog images and in-stock prices.

## Verification history

The implementation passed production build, TypeScript, homepage browser checks and all 475 unit tests. Independent review identified eager background downloads and cropping near the desktop breakpoint. Both were fixed with regression checks. Full-project lint hits the existing .playwright/list-fixtures.ts parse error and unrelated warnings. The temporary layout change that removed the clothing row was reverted at the user's request.
