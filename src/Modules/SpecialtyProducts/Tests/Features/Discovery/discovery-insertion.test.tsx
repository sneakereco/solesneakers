import { renderToStaticMarkup } from "react-dom/server";
import { DiscoveryInsertion } from "@/Modules/SpecialtyProducts/Source/Features/Discovery/DiscoveryInsertion";
import { SpecialtyProductCard } from "@/Modules/SpecialtyProducts/Source/Features/Discovery/SpecialtyProductCard";
test("ordinary nodes render unchanged before independent browser discovery", () => {
  const html = renderToStaticMarkup(
    <DiscoveryInsertion
      allowed
      items={[
        { id: "a", node: <span>A</span> },
        { id: "b", node: <span>B</span> },
      ]}
    />,
  );
  expect(html.indexOf(">A<")).toBeLessThan(html.indexOf(">B<"));
  expect(html).not.toContain("specialty-product-card");
});
test("specialty cards offer claim navigation without cart controls", () => {
  const html = renderToStaticMarkup(
    <SpecialtyProductCard
      product={{
        id: "prize",
        name: "Cash prize",
        description: null,
        imageUrl: null,
        claimable: true,
      }}
    />,
  );
  expect(html).toContain("Cash prize");
  expect(html).toContain("Claim");
  expect(html).not.toMatch(/Add to cart|shipping|pickup/i);
});
