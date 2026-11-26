# Shop headings and mobile clothing alignment

Date: 2026-11-26
Status: Approved by the user and implemented locally on 2026-11-26.
Size: Small change.

## Intent

Give the shopping collection headings the bolder appearance the reseller wants,
and center the homepage Shop Clothing products on phones.

## Approaches

The visual comparison showed the existing Arial Bold alongside Anton, Archivo
Black, and Barlow Condensed ExtraBold. Anton is tall and dense; Archivo Black is
wider and chunkier; Barlow is compact with softer shapes. The user chose the
far-right option, **Barlow Condensed ExtraBold, weight 800**, on 2026-11-26.

For clothing alignment, the proposed approach is one full-width card per mobile
viewport with centered snapping. Keeping the narrower card and adding edge space
could retain a glimpse of adjacent products, but adds spacing and snapping work.
The full-width approach is the agent's recommendation and matches the preview.

## Design

- Apply Barlow Condensed ExtraBold to the main collection heading on `/store`,
  including Shop All, category names, Filtered Collection, and search headings.
  Match the chosen sample: uppercase, centered, 30px on phones and 32px above
  the small breakpoint, with 0.015em letter spacing. Long headings wrap.
- Below 640px, make homepage clothing cards fill the carousel's available width
  and snap to the center. Center the image, product name, and price together.
  Preserve the existing contained image presentation and navigation controls.
- Keep the existing tablet and desktop card sizes. Preserve inventory selection,
  prices, links, loading/error states, and reduced-motion behavior.

## Constraints and non-goals

Use the existing Next.js and Tailwind setup. This change covers collection
headings and the homepage clothing carousel. Body copy, product titles, admin
typography, homepage section headings, and the featured-sneaker carousel keep
their current presentation. Product photography is reused.

## Implementation calls left to the builder

The agent proposes bundling the single 800-weight font with its license and
loading it through `next/font/local`, scoped to the collection heading. This
matches the selected preview without a runtime font request to another host.
Exact file organization and utility classes can be settled during planning.

## Verification

The throwaway preview rendered the actual clothing component with controlled
product data. At widths 320, 375, 390, and 430px, the current first card was
35–47px left of the viewport center; the proposed card had zero measured offset.
Advancing to the second card also centered it. This is local fixture evidence.

After implementation, verify first, middle, and last clothing cards on phones,
the tablet/desktop layout, and populated/empty/error states. Check real font
loading and long category/search headings at mobile and desktop widths, then
run the applicable existing browser checks, lint, and typecheck.
