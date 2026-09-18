import { PolicyPage } from "@/components/legal/PolicyPage";
import { BRAND_DOMAIN, LEGAL_BUSINESS_NAME } from "@/config/constants/brand";
import { SUPPORT_EMAIL } from "@/config/constants/mail";
import {
  PICKUP_HOURS,
  PICKUP_INSTRUCTIONS,
  PICKUP_LOCATION_SUMMARY,
} from "@/config/pickup";

export default function ShippingPage() {
  return (
    <PolicyPage title="Shipping Policy">
      <div className="prose prose-invert max-w-none">
        <div className="space-y-6 text-zinc-400">
          <p className="text-sm">Last updated: September 18, 2026</p>
          <p>
            This Shipping Policy applies to orders placed with {LEGAL_BUSINESS_NAME}{" "}
            through {BRAND_DOMAIN}.
          </p>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">
              1) Processing Time
            </h2>
            <p>
              Our goal is to ship orders placed before 3:00 PM Eastern Time the same day
              and orders placed at or after 3:00 PM Eastern Time the following day.
              Shipment dates are estimates, not guarantees.
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>The cutoff refers to shipment, not delivery time.</li>
              <li>The estimate shown in the cart updates using Eastern Time.</li>
              <li>
                Verification, holidays, weather, carrier disruptions, high order volume,
                address issues, or product-specific notices may require additional time.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">
              2) Unexpected Shipment Delays
            </h2>
            <p>
              Unexpected processing delays on our end may add several days to the
              estimated shipment date. We will provide delay notices and any option to
              consent to a delay or cancel for a full refund when required by applicable
              law. If we cannot fulfill your order, we will cancel it and issue a refund.
            </p>
          </section>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">
              3) Shipping Rates and Methods
            </h2>
            <p>
              You pay the flat shipping charge displayed at checkout. Sole Sneakers
              selects the carrier and shipping service. Carrier transit time is separate
              from order processing time.
            </p>
          </section>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">4) Tracking</h2>
            <p>
              When available, we will provide tracking information after shipment.
              Tracking updates may take time to appear after carrier acceptance.
            </p>
          </section>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">
              5) Delivery and Carrier Issues
            </h2>
            <p>
              Delivery dates are estimates and are not guaranteed. To the extent permitted
              by law, risk of loss or damage transfers when a shipment is properly handed
              to the carrier. Contact us promptly about a delayed, lost, stolen, or
              damaged shipment so we can investigate and help coordinate an available
              carrier claim.
            </p>
            <p className="mt-2">
              Carrier problems do not create a discretionary refund under our Returns and
              Refunds Policy, but nothing in this policy limits rights or remedies that
              cannot be waived under applicable law.
            </p>
          </section>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">
              6) Address Accuracy
            </h2>
            <p>
              You are responsible for providing a complete and accurate shipping address
              at checkout. If an order is returned or delayed because of an incorrect or
              incomplete address, additional shipping charges may apply to reship.
            </p>
          </section>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">7) Local Pickup</h2>
            <p>
              Local pickup is available by appointment in {PICKUP_LOCATION_SUMMARY} during{" "}
              {PICKUP_HOURS}. We will send the agreed-upon business location after the
              pickup time is confirmed.
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              {PICKUP_INSTRUCTIONS.map((instruction) => (
                <li key={instruction}>{instruction}</li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">8) Questions</h2>
            <p>{LEGAL_BUSINESS_NAME}</p>
            <p>Email: {SUPPORT_EMAIL}</p>
            <p>Location: {PICKUP_LOCATION_SUMMARY}</p>
          </section>
        </div>
      </div>
    </PolicyPage>
  );
}
