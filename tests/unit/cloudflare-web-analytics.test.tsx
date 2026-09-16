import { renderToStaticMarkup } from "react-dom/server";
import { CloudflareWebAnalytics } from "@/components/analytics/CloudflareWebAnalytics";

describe("CloudflareWebAnalytics", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    Object.defineProperty(process.env, "NODE_ENV", {
      configurable: true,
      value: originalNodeEnv,
    });
  });

  it("does not load the production beacon during local development", () => {
    Object.defineProperty(process.env, "NODE_ENV", {
      configurable: true,
      value: "development",
    });

    expect(
      renderToStaticMarkup(<CloudflareWebAnalytics token="test-token" />),
    ).toBe("");
  });
});
