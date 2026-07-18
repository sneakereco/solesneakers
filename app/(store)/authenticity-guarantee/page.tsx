import { PolicyPage } from "@/components/legal/PolicyPage";
import { SUPPORT_EMAIL } from "@/config/constants/contact";

export default function AuthenticityGuaranteePage() {
  return (
    <PolicyPage title="Authenticity Guarantee">
      <p>
        Every product sold by Sole Sneakers is represented as authentic. We stand behind
        the products listed on our site and review each item before it is made available
        for sale.
      </p>

      <section>
        <h2>Our Guarantee</h2>
        <p>
          We do not knowingly sell counterfeit merchandise. Product details, condition,
          packaging, identifiers, and construction are reviewed using the information and
          resources available to us.
        </p>
      </section>

      <section>
        <h2>Our Review Process</h2>
        <p>
          Our review may include an inspection of materials, stitching, labels, production
          codes, packaging, accessories, and other product-specific characteristics. The
          exact process varies by brand, product type, age, and condition.
        </p>
      </section>

      <section>
        <h2>If You Have a Concern</h2>
        <p>
          If you believe an item you received is not authentic, contact us promptly with
          your order number, a description of your concern, and clear photos of the item,
          labels, packaging, and identifying details. Claims are handled according to our{" "}
          <a href="/refunds">Returns and Refunds Policy</a>.
        </p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>
          Questions about authenticity can be sent to{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
        </p>
      </section>
    </PolicyPage>
  );
}
