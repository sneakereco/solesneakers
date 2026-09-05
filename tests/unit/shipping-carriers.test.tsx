import { renderToStaticMarkup } from "react-dom/server";

import { CarrierSelector } from "@/components/admin/shipping/CarrierSelector";
import {
  normalizeCarrier,
  parseCarrierSelection,
  parseStoredCarrierSelection,
  toggleCarrierSelection,
} from "@/lib/shipping/carriers";

describe("shipping carrier configuration", () => {
  it("normalizes FedEx and preserves stable provider order", () => {
    expect(normalizeCarrier("FedEx")).toBe("FEDEX");
    expect(parseCarrierSelection(["fedex", "UPS", "USPS", "UPS"])).toEqual([
      "UPS",
      "USPS",
      "FEDEX",
    ]);
  });

  it("rejects unknown submitted providers", () => {
    expect(() => parseCarrierSelection(["DHL"])).toThrow(
      "shipping_carrier_invalid",
    );
  });

  it("drops unknown legacy providers when reading saved configuration", () => {
    expect(parseStoredCarrierSelection(["FedEx", "DHL"])).toEqual(["FEDEX"]);
  });

  it("toggles canonical carriers in stable order", () => {
    expect(toggleCarrierSelection(["UPS"], "UPS")).toEqual([]);
    expect(toggleCarrierSelection(["FEDEX"], "UPS")).toEqual(["UPS", "FEDEX"]);
  });

  it("renders each carrier as a button with visible selected state", () => {
    const html = renderToStaticMarkup(
      <CarrierSelector enabled={["FEDEX"]} onToggle={() => undefined} />,
    );

    expect(html.match(/<button/g)).toHaveLength(3);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("FedEx");
  });
});
