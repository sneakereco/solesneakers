import {
  acquisitionForSession,
  clearAcquisition,
} from "@/Modules/Analytics/Source/Features/VisitorMeasurement/attribution";
const first = "123e4567-e89b-42d3-a456-426614174000",
  second = "123e4567-e89b-42d3-a456-426614174001";
it("keeps first discovery when a new native session has no usable referrer or tags", () => {
  const map = new Map<string, string>();
  const storage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => map.set(k, v),
    removeItem: (k: string) => map.delete(k),
  };
  const browser = {
    location: new URL(
      "https://soles-stg.vercel.app/store?utm_source=Google&utm_medium=cpc&utm_content=footer&utm_campaign=private%40example.com&utm_term=private&utm_source_extra=private",
    ),
    localStorage: storage,
    sessionStorage: storage,
  };
  const doc = {
    referrer: "https://search.example.org/results?email=private@example.org",
  };
  Object.defineProperty(globalThis, "window", { value: browser, configurable: true });
  Object.defineProperty(globalThis, "document", { value: doc, configurable: true });
  try {
    expect(acquisitionForSession(first)).toEqual({
      landing_pathname: "/store",
      referrer_host: "search.example.org",
      discovery: { source: "google", channel: "cpc", placement: "footer" },
      purchaseSession: { source: "google", channel: "cpc", placement: "footer" },
    });
    browser.location = new URL(
      "https://soles-stg.vercel.app/checkout?utm_source=dup&utm_source=again&utm_campaign=123-456-7890",
    );
    doc.referrer = "";
    expect(acquisitionForSession(second)).toMatchObject({
      discovery: { source: "google" },
      purchaseSession: { source: "direct-unknown" },
    });
    expect([...map.values()].join(" ")).not.toMatch(
      /private|123-456|utm_source|dup|again/,
    );
    clearAcquisition();
    expect(map.size).toBe(0);
  } finally {
    Reflect.deleteProperty(globalThis, "window");
    Reflect.deleteProperty(globalThis, "document");
  }
});
