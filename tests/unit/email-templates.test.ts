import fs from "node:fs";
import path from "node:path";

import { buildPasswordUpdatedEmail } from "@/lib/email/account/password-updated";
import {
  buildOrderConfirmationEmail,
  buildOrderDeliveredEmail,
  buildOrderInTransitEmail,
  buildOrderLabelCreatedEmail,
  buildOrderRefundedEmail,
  buildPickupInstructionsEmail,
} from "@/lib/email/orders";
import {
  buildSubscriptionConfirmationEmail,
  buildSubscriptionConfirmedEmail,
} from "@/lib/email/subscription";

const expectBrandedShell = (html: string) => {
  expect(html).toContain("https://example.com/images/email-logo.png");
  expect(html).toContain("Curated heat");
  expect(html).toContain('class="email-shell"');
  expect(html).toContain("https://example.com/store");
  expect(html).toContain("https://example.com/shipping");
  expect(html).toContain("SOLESNEAKERS. All rights reserved.");
  expect(html).toContain("New inventory daily");
  expect(html).toContain("'Arial Black'");
  expect(html).toContain("border-radius:0");
  expect(html).not.toContain("border-radius:999px");
};

describe("customer email templates", () => {
  it("renders every customer notification inside the storefront-branded shell", () => {
    const emails = [
      buildSubscriptionConfirmedEmail(),
      buildSubscriptionConfirmationEmail("https://example.com/email/confirm?token=abc"),
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
          brand: "Jordan",
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
    expect(email.html).toContain("The heat is yours");
    expect(email.html).toContain("Jordan &lt;Retro&gt;");
    expect(email.html).not.toContain("Jordan <Retro>");
    expect(email.html).toContain("https://example.com/jordan.png");
    expect(email.html).toContain("object-fit:contain");
    expect(email.html).toContain('class="email-button"');
  });
});

describe("Supabase auth email templates", () => {
  const templates = ["confirmation.html", "magic_link.html", "recovery.html"];

  it.each(templates)("renders %s in the editorial storefront shell", (filename) => {
    const html = fs.readFileSync(
      path.join(process.cwd(), "supabase", "templates", filename),
      "utf8",
    );

    expect(html).toContain('class="email-shell"');
    expect(html).toContain('class="email-logo"');
    expect(html).toContain("{{ .SiteURL }}/images/email-logo.png");
    expect(html).toContain("{{ .Token }}");
    expect(html).toContain("Curated heat");
    expect(html).toContain("Arial Black");
    expect(html).not.toContain("#f7f6f2");
  });
});
