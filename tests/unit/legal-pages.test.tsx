import { renderToStaticMarkup } from "react-dom/server";

import PrivacyPage from "@/app/(store)/legal/privacy/page";
import RefundsPage from "@/app/(store)/legal/refunds/page";
import ShippingPage from "@/app/(store)/legal/shipping/page";
import TermsPage from "@/app/(store)/legal/terms/page";

describe("storefront legal policies", () => {
  it("matches the current business identity and customer data practices", () => {
    const privacy = renderToStaticMarkup(<PrivacyPage />);

    expect(privacy).toContain("Solesneakers LLC");
    expect(privacy).toContain("Cloudflare Web Analytics");
    expect(privacy).toContain("do not sell personal information");
    expect(privacy).toContain("September 18, 2026");
    expect(privacy).not.toContain("if your implementation");
  });

  it("keeps final sale as the rule with only the approved authenticity refund", () => {
    const refunds = renderToStaticMarkup(<RefundsPage />);

    expect(refunds).toContain("All sales are final");
    expect(refunds).toContain("verified as inauthentic");
    expect(refunds).toContain("do not offer discretionary refunds");
    expect(refunds).toContain("rights or remedies that cannot be waived");
    expect(refunds).not.toContain("replacement if available; otherwise refund");
  });

  it("states the delayed-shipment remedy and local pickup rules", () => {
    const shipping = renderToStaticMarkup(<ShippingPage />);

    expect(shipping).toContain("consent to a delay");
    expect(shipping).toContain("cancel for a full refund");
    expect(shipping).toContain("government-issued ID");
    expect(shipping).toContain("September 18, 2026");
  });

  it("identifies the contracting entity and North Carolina terms", () => {
    const terms = renderToStaticMarkup(<TermsPage />);

    expect(terms).toContain("Solesneakers LLC");
    expect(terms).toContain("State of North Carolina");
    expect(terms).toContain("parent or legal guardian");
    expect(terms).toContain("Pickup by appointment");
    expect(terms).toContain("September 16, 2026");
  });
});
