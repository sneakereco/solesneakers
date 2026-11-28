# Vercel image optimization

The user selected Vercel's optimizer after comparing Supabase transformations and generating stored variants, and explicitly requested implementation. This is a bounded delivery change to reduce bytes sent to shoppers using the existing Next.js Image components.

## Approaches and decision

- Selected: Next.js default image loader, implemented by Vercel in hosted deployments. Existing Supabase originals remain the source; optimized renditions are created and cached on demand.
- Supabase transformations would keep image delivery there but introduce its distinct-origin transformation fee.
- Generating stored variants would require upload processing and a catalogue backfill; that work is unnecessary for the selected approach.

## Scope

Enable optimization globally for production and previews. Use WebP as the single optimized output format, following the installed Next.js guide, to avoid multiple format caches and AVIF's slower encoding. Retain the currently supported image widths, qualities, remote source patterns, and intentional per-image bypasses for logos, payment icons, and staff snapshots. Use the framework's four-hour minimum cache lifetime instead of the existing 60 seconds.

Keep card and main-photo quality settings. Make gallery thumbnails lazy and reserve priority for the main photo. Route both layers of the outfit slideshow through the optimizer with matching sizes, preserving its existing stretched backdrop, foreground composition, and deferred loading.

No database migration, storage rewrite, upload processing change, destructive cleanup, blanket cache warm-up, or deployment is required. Existing public product URLs work without backfill. Source reads still consume Supabase egress when the optimizer fetches originals; Vercel's optimization, caching, and delivery billing applies.

## Validation

Prove real Next.js image URL/srcset generation using current configuration, old Supabase URLs and local photography. Verify gallery priority behavior and slideshow request reuse without raw image bypasses. Exercise the actual Next.js optimizer against local fixture images and record content type, dimensions, response bytes, and repeated-cache behavior. Run the affected browser checks, lint and type checking, and an independent final review. Hosted Vercel billing and post-deployment bandwidth require later observation.
