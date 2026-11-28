# Vercel image optimization

The storefront uses the default Next.js image loader in production and preview builds. On Vercel this enables its managed image optimizer. Development bypasses optimization so private local Supabase URLs keep working.

## Existing images and rollout

No backfill, database migration, storage rewrite, or re-upload is needed. Existing Supabase public URLs remain the source URLs. Browsers receive responsive `/_next/image` URLs; Vercel creates and caches the requested renditions on demand. Do not warm the entire catalogue automatically.

Supabase can still transfer full originals to the optimizer on source fetches for cache misses or revalidation. Browser image delivery moves to Vercel for optimized images, and Vercel's transformation, cache and delivery pricing applies. Small logos, payment assets and existing staff snapshot bypasses retain their explicit behavior.

`next.config.ts` uses WebP output, retains existing width and quality allowlists, and gives optimized images a four-hour minimum cache lifetime. The upstream cache lifetime can extend that. Public images changed at the same URL can remain stale until expiration; uploading new content at a new content-hashed path avoids that ambiguity.

Gallery thumbnails use lazy loading; the main photo retains priority. Both outfit slideshow layers use the same responsive optimized source selection, and the stretched backdrop still loads only when the section enters view.

## Local verification

```powershell
node node_modules/jest/bin/jest.js --config jest.config.ts --runInBand --runTestsByPath tests/unit/image-optimization.test.tsx tests/unit/specialty-product-page.test.tsx
node tests/browser/home-clothing.mjs
node tests/browser/image-optimization.mjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

The image browser check builds an isolated production Next.js app using the repository's actual production image settings and real Next.js Image component. It uses synthetic environment values and does not require backend credentials. It verifies local-image conversion, responsive selection, repeated image-cache hits, and the real slideshow's optimized foreground/background reuse. The slideshow is bundled from its real source with React and Next.js external; it does not mock the Image component. Artifacts go to `.superpowers/verification/image-optimization/`.

Optionally exercise a pre-existing public Supabase image by setting `IMAGE_OPTIMIZATION_REMOTE_URL` to its existing public URL before running the browser check. This reads that public source through the local Next.js optimizer, and does not invoke Supabase image transformations or upload anything.

## After deployment

Verified locally on November 27, 2026: the two targeted Jest suites passed 9 tests; the homepage clothing/slideshow browser check passed; the real production optimizer fixture passed for local and existing public Supabase sources; scoped ESLint and repository type checking passed. Independent review reported no material findings. Mobile and desktop slideshow screenshots were inspected.

The real optimizer returned a 384px WebP of 33,784 bytes for the 309,005-byte homepage JPEG and 10,846 bytes for an existing 1,926,937-byte Supabase PNG. Both repeated requests returned `x-nextjs-cache: HIT`. These are measured local Next.js responses at one viewport/pixel density, not a whole-catalogue forecast or hosted Vercel measurements.

Local Next.js verification does not establish hosted Vercel cache behavior, billing, or realized egress reduction. After deploying through the repository's normal release process:

1. Verify mobile and desktop `currentSrc` uses `/_next/image`, the selected widths fit their rendered sizes and pixel densities, and responses use WebP.
2. Confirm repeat requests hit Vercel's cache and there are no raw slideshow backdrop requests.
3. Check product cards, specialty products, detail photos, thumbnails, search, cart and checkout. Existing originals should require no edits.
4. Compare Supabase cached/uncached bytes and Vercel image usage and data transfer across equivalent traffic windows. Normalize by traffic and account for initial cache fills.

The deployment is the point at which this behavior starts affecting production traffic. Merely merging the source or passing local tests does not establish production savings.
