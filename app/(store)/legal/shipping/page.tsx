import { PolicyPage } from "@/components/legal/PolicyPage";
import { SUPPORT_EMAIL } from "@/config/constants/mail";
import { PICKUP_LOCATION_SUMMARY } from "@/config/pickup";

export default function ShippingPage() {
  return (
    <PolicyPage title="Shipping Policy">
      <div className="prose prose-invert max-w-none">
        <div className="text-zinc-400 space-y-6">
          <p className="text-sm">Last updated: July 18, 2026</p>
          <p>
            This Shipping Policy applies to orders placed through the Sole Sneakers
            website (the &quot;Site&quot;).
          </p>

          <section>
            <h2 className="text-2xl font-bold text-white mt-8 mb-4">
              1) Processing Time (When We Ship)
            </h2>
            <p>
              Orders placed before 3:00 PM Eastern Time are scheduled to ship the same
              day. Orders placed at or after 3:00 PM Eastern Time are scheduled to ship
              the following day.
            </p>
            <p>Important clarifications:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>
                The 3:00 PM cutoff refers to order processing and shipment, not delivery
                time.
              </li>
              <li>
                The shipping estimate shown in the cart updates automatically using
                Eastern Time.
              </li>
              <li>
                Some orders may require additional time for verification (for example,
                fraud prevention or address confirmation).
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-white mt-8 mb-4">
              2) Exceptions (When Shipping May Take Longer)
            </h2>
            <p>Shipping may take longer in cases including, but not limited to:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>holidays or carrier closures</li>
              <li>weather events or natural disasters</li>
              <li>carrier disruptions, delays, or service outages</li>
              <li>high order volume</li>
              <li>address issues (incomplete or incorrect address)</li>
              <li>payment review or fraud-prevention checks</li>
              <li>
                product-specific notes such as &quot;pre-order,&quot; &quot;delayed,&quot;
                or &quot;ships later&quot; (when stated on the listing or at checkout)
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-white mt-8 mb-4">
              3) Shipping Rates and Methods
            </h2>
            <p>
              Shipping options and rates are displayed at checkout. The shipping method
              you choose affects transit time, not our processing time.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-white mt-8 mb-4">4) Tracking</h2>
            <p>
              When available, we will provide tracking information once your order ships.
              Tracking updates may take time to appear after carrier acceptance.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-white mt-8 mb-4">
              5) Delivery Times and Carrier Responsibility
            </h2>
            <p>
              Delivery dates are estimates and are not guaranteed. After a package is
              handed to the carrier, delivery speed and handling are the carrier&apos;s
              responsibility (except where applicable law provides otherwise).
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-white mt-8 mb-4">
              6) Address Accuracy
            </h2>
            <p>
              You are responsible for providing a complete and accurate shipping address
              at checkout. If an order is returned or delayed due to an incorrect or
              incomplete address, additional shipping charges may apply to reship.
            </p>
          </section>

          <section>
            <h2 className="text-2xl font-bold text-white mt-8 mb-4">7) Questions</h2>
            <p>If you have any shipping questions, contact us at:</p>
            <p className="mt-2">
              Email: {SUPPORT_EMAIL}
              <br />
              Location: {PICKUP_LOCATION_SUMMARY}
            </p>
          </section>
        </div>
      </div>
    </PolicyPage>
  );
}
