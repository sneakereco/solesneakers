import test from "node:test";
import assert from "node:assert/strict";
import { probeBrowserProtocol } from "../browser/journeys.mjs";
test("browser protocol probes retain CSRF origin and reject HTTP 200 with missing contract fields", async () => {
  const observations = [];
  let valid = true;
  const context = {
    request: {
      fetch: async (url, input) => {
        assert.equal(input.headers.Origin, "https://stage.test");
        return {
          ok: () => true,
          json: async () =>
            url.includes("/products")
              ? { products: [], ...(valid ? { total: 0 } : {}) }
              : { items: [], ...(valid ? { removed: [] } : {}) },
        };
      },
    },
  };
  const options = {
    baseUrl: "https://stage.test",
    emit: (value) => observations.push(value),
  };
  await probeBrowserProtocol(context, options, { id: "product", variantId: "variant" });
  assert.ok(observations.every((x) => x.outcome === "success"));
  valid = false;
  observations.length = 0;
  await probeBrowserProtocol(context, options, { id: "product", variantId: "variant" });
  assert.ok(observations.every((x) => x.outcome === "technical"));
});
