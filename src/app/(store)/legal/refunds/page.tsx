import { PolicyPage } from "@/components/legal/PolicyPage";
import { BRAND_DOMAIN, LEGAL_BUSINESS_NAME } from "@/config/constants/brand";
import { SUPPORT_EMAIL } from "@/config/constants/mail";
import { PICKUP_LOCATION_SUMMARY } from "@/config/pickup";

export default function RefundsPage() {
  return (
    <PolicyPage title="Returns and Refunds Policy">
      <div className="prose prose-invert max-w-none">
        <div className="space-y-6 text-zinc-400">
          <p className="text-sm">Last updated: September 16, 2026</p>
          <p>
            This Return &amp; Refund Policy applies to purchases from{" "}
            {LEGAL_BUSINESS_NAME}
            through {BRAND_DOMAIN}.
          </p>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">
              1) All Sales Final
            </h2>
            <p>
              All sales are final. Except for an item verified as inauthentic under
              Section 2, we do not accept returns or exchanges and do not offer
              discretionary refunds for fit, size, condition preferences, buyer&apos;s
              remorse, carrier delivery timing after timely shipment, or other
              change-of-mind reasons.
            </p>
            <p className="mt-2">
              Nothing in this policy limits rights or remedies that cannot be waived under
              applicable law.
            </p>
          </section>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">
              2) Authenticity Refund
            </h2>
            <p>
              If you believe an item is not authentic, contact us promptly, preferably
              within 72 hours after delivery. This requested timing does not limit any
              right that cannot be waived under applicable law.
            </p>

            <h3 className="mb-2 mt-4 text-lg font-semibold text-white">
              How to Submit a Claim
            </h3>
            <p>Email {SUPPORT_EMAIL} and include:</p>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>your order number</li>
              <li>
                clear photos of the item and packaging, including size tags, labels, and
                SKU details when present
              </li>
              <li>a brief explanation of your concern</li>
            </ul>

            <h3 className="mb-2 mt-4 text-lg font-semibold text-white">
              Return and Inspection
            </h3>
            <p>
              We may require the item to be returned for inspection before deciding the
              claim. If we authorize a return, follow the provided instructions and send
              it within seven calendar days unless we agree otherwise in writing.
            </p>
            <p className="mt-2">
              The item must be in the same condition as received, unworn and unaltered,
              and include its original packaging and accessories when applicable.
            </p>

            <h3 className="mb-2 mt-4 text-lg font-semibold text-white">Outcome</h3>
            <p>
              If we verify that the item is inauthentic, we will issue a full refund to
              the original payment method within 10 business days after the return and
              review are complete. Your financial institution may take additional time to
              post the credit.
            </p>
            <p className="mt-2">
              If the item is authentic, is not returned as instructed, or is returned worn
              or altered, the authenticity refund will be denied and you may be
              responsible for return shipping.
            </p>
          </section>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">
              3) Shipping Problems
            </h2>
            <p>
              Carrier delay, loss, theft after delivery, or transit damage does not create
              eligibility for a discretionary refund under this policy. Contact us
              promptly with your order number and supporting photos or tracking
              information so we can investigate and help coordinate any available carrier
              claim.
            </p>
            <p className="mt-2">
              This section does not limit rights or remedies that applicable law does not
              permit us to waive.
            </p>
          </section>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">
              4) Wrong Item Sent
            </h2>
            <p>
              If we sent an item different from the item ordered, contact us promptly with
              your order number and photos. We may require its return and will work to
              send the item ordered when it is available. This policy does not offer a
              discretionary refund for a wrong-item claim; non-waivable legal rights and
              remedies still apply.
            </p>
          </section>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">
              5) Address Accuracy
            </h2>
            <p>
              You are responsible for providing a complete and accurate shipping address
              at checkout. If an order is returned due to an incorrect or incomplete
              address, additional shipping costs may apply to reship.
            </p>
          </section>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">6) Contact</h2>
            <p>{LEGAL_BUSINESS_NAME}</p>
            <p>Email: {SUPPORT_EMAIL}</p>
            <p>Location: {PICKUP_LOCATION_SUMMARY}</p>
          </section>
        </div>
      </div>
    </PolicyPage>
  );
}
