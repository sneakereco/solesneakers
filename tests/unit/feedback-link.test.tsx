import { renderToStaticMarkup } from "react-dom/server";

import { FeedbackLink } from "@/components/ui/FeedbackLink";

// Match the installed App Router's aliases without exercising RSC transport.
jest.mock(
  "react-server-dom-webpack/client",
  () => jest.requireActual("next/dist/compiled/react-server-dom-webpack/client.node"),
  { virtual: true },
);

jest.mock("next/link", () => jest.requireActual("next/dist/client/app-dir/link"));

describe("FeedbackLink", () => {
  it("preserves the single anchor required by the installed legacy Link", () => {
    const html = renderToStaticMarkup(
      <FeedbackLink href="/store" legacyBehavior passHref prefetch={false}>
        <a target="_blank" rel="noreferrer">
          Visit shop
        </a>
      </FeedbackLink>,
    );

    expect(html.match(/<a\s/g)).toHaveLength(1);
    expect(html).toContain('href="/store"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
    expect(html).toContain(">Visit shop</a>");
  });

  it("lets the installed legacy Link wrap a text child in an anchor", () => {
    expect(
      renderToStaticMarkup(
        <FeedbackLink href="/cart" legacyBehavior passHref>
          Cart
        </FeedbackLink>,
      ),
    ).toBe('<a href="/cart">Cart</a>');
  });
});
