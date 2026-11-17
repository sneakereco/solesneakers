# Homepage clothing section

## Intent and approval

Help homepage visitors discover clothing through outfit inspiration and available products. The user approved the interactive preview for implementation on November 17, 2026, with Featured Items directly below the hero. The later layout change was reverted at the user's request.

## Layout and behavior

- Render hero, existing Featured Items, outfit slideshow, Shop Clothing product row and Shop by Category in that order.
- Use the six AI-expanded outfit photos with social counters and repost graphics removed. Export compressed WebP assets into public/images/homepage_outfits.
- Keep the slideshow full width and slim, around 320 px tall at a 1440 px viewport and 200 px on mobile. Preserve outfit proportions and match the prototype's concrete background extension.
- Crossfade every six seconds with faint previous and next arrows at opposite edges. Support touch swiping. Omit image counts, playback buttons and an overlaid shopping button as requested.
- Pause automatic movement on hover, keyboard focus, manual navigation, hidden tabs and when outside the viewport. Respect reduced motion. Manual navigation leaves autoplay stopped until a fresh page visit.
- Below the slideshow, use a centered Shop Clothing heading with the same typography and carousel treatment as Featured Items. Show actual active, available clothing products, their catalog images, names and prices, with product links. Show Shop All Clothing below, linking to /store?category=clothing.
- Loading, empty inventory and fetch failures must leave the clothing destination available. Empty inventory gets concise status text. Failures offer a retry.

## Approaches

The two-photo strip and single-photo split preserved outfits but the user rejected their composition. Cropping the originals to a full-width banner lost outfit content. The user selected AI expansion of the concrete background and approved the slimmer slideshow with a separate product row.

## Constraints and implementation choices

Reuse the existing featured carousel rendering and catalog endpoint. The clothing row defaults to the twelve newest clothing products, an implementation choice. Use current Next.js and React conventions and existing styling. The local catalog currently contains no clothing, so verify populated states with controlled catalog responses as well as the real local empty state. The generated images have some redrawn fine product details, already disclosed during review.

This change covers the homepage and its assets. Checkout, admin curation and deployment are outside this change.
