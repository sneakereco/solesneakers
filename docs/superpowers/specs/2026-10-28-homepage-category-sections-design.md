# Homepage category sections

Status: Design awaiting approval. Layout B and image positions selected by the user.

## Intent and scope

Help homepage shoppers browse six collections immediately below Featured Items, using the supplied photographs and the existing monochrome storefront styling. Add one Shop by Category section; preserve the hero, featured products, and unrelated changes. Do not introduce a designer product category or change catalog classification.

## Approaches

- A: Uniform three-column desktop grid. Gives all six collections equal prominence and uses less vertical space.
- B: Editorial desktop grid. Two large condition cards above four smaller category cards; emphasizes sneakers and adds visual hierarchy. The user selected B after reviewing both layouts and adjusting image crops.

## Selected presentation

Use the B mockup in `.superpowers/brainstorm/1124-1793206819/content/category-layouts-v3.html` as the visual reference. Center the uppercase section heading and supporting line, "Find your next pair. And everything to go with it." Use the existing Arial typography, light storefront surface, generous spacing, square corners, labels beneath photos, thin dividers, and arrow affordances. Entire cards are links with visible keyboard focus. Hover movement respects reduced-motion preferences.

Desktop: a four-column grid; Brand New and Pre-Owned each span two columns with 16:9 image frames, followed by four square image cards. Tablet: two columns. Narrow mobile: one column with 4:3 frames, as previewed. Implementation breakpoint choice remains with the builder; preserve card order and avoid horizontal overflow.

All category images fill their frames with `object-fit: cover`. Capture of the user's live sliders on 2026-10-28 confirmed:

- Brand New: `object-position: 50% 64%`.
- Designer Bags & Accessories: `object-position: 50% 50%`.
- Remaining images: centered.

Preserve these focal points across responsive sizes. Cropping is intentional; do not stretch images or add empty padding. No crop sliders appear on the website.

## Cards and destinations

| Label | Image under public/images/homepage_categories | Store filters |
| --- | --- | --- |
| Brand New | brand_new_shoes.jpg | category=sneakers, condition=new |
| Pre-Owned | preowned_shoes_2.jpg | category=sneakers, condition=used |
| Designer Sneakers | designer_shoes_1.jpg | category=sneakers plus the designer brand IDs |
| Designer Bags & Accessories | designer_bags.jpg | category=accessories plus the designer brand IDs |
| Clothing | clothing_1.jpg | category=clothing |
| Electronics | electronics.jpg | category=electronics |

The Brand New and Pre-Owned destinations are sneaker-specific, as proposed in the mockup. Designer collections have no condition restriction.

Resolve the exact designer labels against the existing active brand taxonomy and use repeated `brandIds` parameters, matching the current store filter behavior. Designer brands are OR selections within the selected category. Never silently fall back to the unrestricted category when brand resolution fails; handle missing taxonomy without broadening the promised collection. The builder chooses an appropriate bounded failure treatment.

User-defined designer brands, exactly: Prada, Chanel, Gucci, Burberry, Dior, Lanvin, Versace, Maison Margiela, Alexander McQueen, Rick Owens, Dolce and Gabbana, Louis Vuitton, Balenciaga, Amiri.

## Validation and builder decisions

Reuse the current Next.js, React, Tailwind, Link, and Image setup, following the installed Next.js guides. The builder chooses component boundaries and loading/caching details without introducing new dependencies. Verify all six destinations, repeated designer brand selections, image rendering and focal points, keyboard usability, and desktop/tablet/mobile layouts. Preserve unrelated logo and email edits. No catalog migration, new admin workflow, product carousels, or automatic photo rotation is included.
