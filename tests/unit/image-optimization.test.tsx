import { getImageProps } from "next/image";
import { renderToStaticMarkup } from "react-dom/server";
import { ProductDetail } from "@/components/store/ProductDetail";
import type { StorefrontProduct } from "@/types/domain/product";

jest.mock("@/components/cart/CartProvider", () => ({
  useCart: () => ({ items: [], isReady: true, validationStatus: "ready" }),
}));
jest.mock("@/Modules/Analytics/Source/Features/VisitorMeasurement/view-grant", () => ({
  useViewGrant: () => null,
}));

const original =
  "https://jxwulwjbtjtcqmyrzqiv.supabase.co/storage/v1/object/public/products/catalog/existing-photo.png";

describe("image delivery", () => {
  test.each([original, "/images/hero.jpg"])(
    "generates responsive optimizer URLs for an existing source: %s",
    (src) => {
      const { props } = getImageProps({
        src,
        alt: "Product photograph",
        fill: true,
        sizes: "(min-width: 1024px) 25vw, 50vw",
        quality: 75,
      });

      const optimized = new URL(props.src, "https://store.example");
      expect(optimized.pathname).toBe("/_next/image");
      expect(optimized.searchParams.get("url")).toBe(src);
      expect(props.srcSet).toContain("384w");
      expect(props.srcSet).toContain("640w");
      expect(props.sizes).toBe("(min-width: 1024px) 25vw, 50vw");
    },
  );

  test("retains explicit optimization bypasses for small fixed assets", () => {
    const { props } = getImageProps({
      src: "/images/logo.png",
      alt: "Solesneakers",
      width: 124,
      height: 124,
      unoptimized: true,
    });

    expect(props.src).toBe("/images/logo.png");
    expect(props.srcSet).toBeUndefined();
  });

  test("loads gallery thumbnails lazily and reserves image priority for the main photo", () => {
    const product = {
      id: "product-1",
      name: "Gallery sneaker",
      category: "sneakers",
      condition: "new",
      brand: { id: "brand-1", label: "Brand" },
      images: [
        { id: "front", url: original, is_primary: true, sort_order: 0 },
        {
          id: "back",
          url: original.replace("existing-photo", "back-photo"),
          is_primary: false,
          sort_order: 1,
        },
      ],
      variants: [],
    } as unknown as StorefrontProduct;
    const html = renderToStaticMarkup(<ProductDetail product={product} />);
    const thumbnails = (html.match(/<img\b[^>]*>/g) ?? []).filter((tag) =>
      tag.includes("Gallery sneaker, view"),
    );

    expect(thumbnails).toHaveLength(2);
    for (const thumbnail of thumbnails) {
      expect(thumbnail).toContain('loading="lazy"');
      expect(thumbnail).toContain("/_next/image?");
    }
    expect(html.match(/<link\b[^>]*rel="preload"[^>]*as="image"/g)).toHaveLength(1);
  });
});
