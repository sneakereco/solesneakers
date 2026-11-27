import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CloudflareWebAnalytics } from "../../src/components/analytics/CloudflareWebAnalytics";
process.stdout.write(
  renderToStaticMarkup(
    createElement(CloudflareWebAnalytics, { token: "fixture-configured-token" }),
  ),
);
