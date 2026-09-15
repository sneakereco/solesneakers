import { PolicyPage } from "@/components/legal/PolicyPage";

export default function RefundsPage() {
  return (
    <PolicyPage title="Returns and Refunds Policy">
      <div className="prose prose-invert max-w-none">
        <div className="space-y-6 text-zinc-400">
          <p className="text-sm">Last updated: December 30, 2025</p>
          <p>
            This Return &amp; Refund Policy applies to purchases made through{" "}
            realdealkickzsc.com.
          </p>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">
              1) All Sales Final
            </h2>
            <p>All sales are final, except as expressly stated below.</p>
          </section>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">
              2) Authenticity Refund (Eligible)
            </h2>
            <p>
              If you believe an item you received is not authentic, you may request a
              refund under this section.
            </p>

            <h3 className="mb-2 mt-4 text-lg font-semibold text-white">Claim Window</h3>
            <p>
              You must contact us within 72 hours of delivery to start an authenticity
              claim.
            </p>

            <h3 className="mb-2 mt-4 text-lg font-semibold text-white">
              How to Submit a Claim
            </h3>
            <p>Email realdealholyspill@gmail.com and include:</p>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>your order number</li>
              <li>
                clear photos of the item and packaging (including any size tags, labels,
                and SKU details, if present)
              </li>
              <li>a brief explanation of your concern</li>
            </ul>

            <h3 className="mb-2 mt-4 text-lg font-semibold text-white">
              Return Required Before Refund
            </h3>
            <p>
              To protect against fraud, we may require you to return the item for
              inspection before any refund is issued.
            </p>

            <h3 className="mb-2 mt-4 text-lg font-semibold text-white">
              Condition Requirements
            </h3>
            <p>Returned items must be:</p>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>in the same condition as received</li>
              <li>unworn and unaltered</li>
              <li>returned with original packaging/accessories when applicable</li>
            </ul>

            <h3 className="mb-2 mt-4 text-lg font-semibold text-white">Outcome</h3>
            <p>
              If we confirm the item is not authentic, we will issue a full refund to the
              original payment method after return processing.
            </p>
            <p>
              If we determine the item is authentic, or if it is returned worn/altered,
              the refund may be denied and you may be responsible for return shipping.
            </p>
          </section>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">
              3) Shipping, Transit Damage, Carrier Delays, and Lost Packages
            </h2>
            <p>
              To the extent permitted by law, once an order is shipped we are not
              responsible for carrier delays, loss, theft after delivery, or damage in
              transit. If your package is lost or damaged during shipping, you agree to
              pursue a claim with the carrier. We can provide reasonable shipment
              documentation upon request.
            </p>
          </section>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">
              4) Wrong Item Sent (Our Error)
            </h2>
            <p>
              If we sent the wrong item, contact us within 72 hours of delivery with your
              order number and photos. We will work to correct the issue (replacement if
              available; otherwise refund after the item is returned).
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
            <p>Email: realdealholyspill@gmail.com</p>
            <p>Location: Simpsonville, South Carolina, USA</p>
          </section>
        </div>
      </div>
    </PolicyPage>
  );
}
