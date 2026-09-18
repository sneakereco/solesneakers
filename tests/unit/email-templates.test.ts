import fs from "node:fs";
import path from "node:path";

// Keep template fixtures independent of the host or CI build environment.
jest.mock("@/config/env", () => ({
  env: { NEXT_PUBLIC_SITE_URL: "https://example.com" },
}));

import { buildPasswordUpdatedEmail } from "@/lib/email/account/password-updated";
import {
  buildOrderConfirmationEmail,
  buildOrderDeliveredEmail,
  buildOrderInTransitEmail,
  buildOrderLabelCreatedEmail,
  buildOrderRefundedEmail,
  buildPickupInstructionsEmail,
} from "@/lib/email/orders";

const expectBrandedShell = (html: string) => {
  expect(html).toContain("https://example.com/images/email-logo.png");
  expect(html).toContain('class="email-shell"');
  expect(html).toContain("https://example.com/store");
  expect(html).toContain("https://example.com/shipping");
  expect(html).toContain("Solesneakers. All rights reserved.");
  expect(html).toContain("mailto:SolesneakersLLC@yahoo.com");
  expect(html).not.toContain("Jmanrule15@gmail.com");
  expect(html).toContain("border-radius:16px");
  expect(html).toContain("border-radius:10px");
  expect(html).not.toContain("Curated heat");
  expect(html).not.toContain("Authenticated always");
  expect(html).not.toContain("New inventory daily");
  expect(html).not.toContain("Arial Black");
};

describe("customer email templates", () => {
  it("renders every customer notification inside the storefront-branded shell", () => {
    const emails = [
      buildPasswordUpdatedEmail("https://example.com/account"),
      buildOrderLabelCreatedEmail({
        to: "buyer@example.com",
        orderId: "12345678-abcd",
        carrier: "UPS",
        trackingNumber: "1Z999",
        trackingUrl: "https://example.com/track",
      }),
      buildOrderInTransitEmail({
        to: "buyer@example.com",
        orderId: "12345678-abcd",
      }),
      buildOrderDeliveredEmail({
        to: "buyer@example.com",
        orderId: "12345678-abcd",
      }),
      buildOrderRefundedEmail({
        to: "buyer@example.com",
        orderId: "12345678-abcd",
        refundAmount: 12500,
      }),
      buildPickupInstructionsEmail({
        to: "buyer@example.com",
        orderId: "12345678-abcd",
        locationSummary: "the Triad",
      }),
    ];

    for (const email of emails) {
      expectBrandedShell(email.html);
      expect(email.html).toContain('class="email-hero"');
      expect(email.text.length).toBeGreaterThan(40);
    }
  });

  it("renders an escaped, product-led order receipt", () => {
    const email = buildOrderConfirmationEmail({
      to: "buyer@example.com",
      orderId: "12345678-abcd",
      createdAt: "2026-07-21T12:00:00.000Z",
      fulfillment: "ship",
      currency: "USD",
      subtotal: 180,
      tax: 12,
      shipping: 10,
      total: 202,
      items: [
        {
          title: "Jordan <Retro>",
          sizeLabel: "10.5",
          quantity: 1,
          unitPrice: 180,
          lineTotal: 180,
          imageUrl: "https://example.com/jordan.png",
          brand: "Repeated brand metadata",
          model: "Repeated model metadata",
          category: "Repeated category metadata",
          sku: "J-001",
        },
      ],
      shippingAddress: {
        name: "Alex Buyer",
        line1: "123 Main St",
        city: "Greensboro",
        state: "NC",
        postalCode: "27401",
        country: "US",
      },
      orderUrl: "https://example.com/orders/12345678",
    });

    expectBrandedShell(email.html);
    expect(email.html).toContain("Order confirmed");
    expect(email.html).toContain("Jordan &lt;Retro&gt;");
    expect(email.html).not.toContain("Jordan <Retro>");
    expect(email.html).toContain("https://example.com/jordan.png");
    expect(email.html).toContain("object-fit:contain");
    expect(email.html).not.toContain("Repeated brand metadata");
    expect(email.html).not.toContain("Repeated model metadata");
    expect(email.html).not.toContain("Repeated category metadata");
    expect(email.html).not.toContain("J-001");
    expect(email.html).toContain('class="email-button"');
    expect(email.html).not.toContain("Processing fee");
    expect(email.text).toContain("Total: $202.00");
    expect(email.text).not.toContain("img:");
    expect(email.text).not.toContain("J-001");
    expect(email.text).not.toContain("Processing fee");
  });

  it("keeps pickup coordination in its own explicit email", () => {
    const confirmation = buildOrderConfirmationEmail({
      to: "buyer@example.com",
      orderId: "12345678-abcd",
      createdAt: "2026-07-21T12:00:00.000Z",
      fulfillment: "pickup",
      currency: "USD",
      subtotal: 180,
      tax: 12,
      shipping: 0,
      total: 192,
      items: [],
    });
    const pickup = buildPickupInstructionsEmail({
      to: "buyer@example.com",
      orderId: "12345678-abcd",
      locationSummary: "the Triad",
    });

    expect(confirmation.html).toContain("Local pickup");
    expect(confirmation.html).not.toContain("Reply to this email");
    expect(pickup.html).toContain("Pickup is by appointment only");
    expect(pickup.html).toContain("Reply to this email");
    expect(pickup.html).toContain("Bring your order confirmation email");
  });
});

describe("Supabase auth email templates", () => {
  const templates = ["confirmation.html", "magic_link.html", "recovery.html"];

  it.each(templates)("renders %s in the soft storefront shell", (filename) => {
    const html = fs.readFileSync(
      path.join(process.cwd(), "supabase", "templates", filename),
      "utf8",
    );

    expect(html).toContain('class="email-shell"');
    expect(html).toContain('class="email-logo"');
    expect(html).toContain("{{ .SiteURL }}/images/email-logo.png");
    expect(html).toContain("{{ .Token }}");
    expect(html).toContain("mailto:SolesneakersLLC@yahoo.com");
    expect(html).not.toContain("Jmanrule15@gmail.com");
    expect(html).toContain("border-radius: 16px");
    expect(html).not.toContain("Curated heat");
    expect(html).not.toContain("Authenticated always");
    expect(html).not.toContain("New inventory daily");
    expect(html).not.toContain("Arial Black");
  });
});
