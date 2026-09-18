import { pageMetadata } from "@/lib/metadata";

import { PolicyPage } from "@/components/legal/PolicyPage";
import { BRAND_DOMAIN, BRAND_NAME, LEGAL_BUSINESS_NAME } from "@/config/constants/brand";
import { SUPPORT_EMAIL } from "@/config/constants/mail";
import { PICKUP_LOCATION_SUMMARY } from "@/config/pickup";

export const metadata = pageMetadata(
  "Terms of Service",
  "Read the terms for shopping with Solesneakers, including orders, payments, shipping, and local pickup.",
);

export default function TermsPage() {
  return (
    <PolicyPage title="Terms of Service">
      <div className="prose prose-invert max-w-none">
        <div className="space-y-6 text-zinc-400">
          <p className="text-sm">Last updated: September 16, 2026</p>

          <p>
            These Terms of Service (&quot;Terms&quot;) govern your access to and use of
            the website located at {BRAND_DOMAIN} (the &quot;Site&quot;) and any related
            services provided by {LEGAL_BUSINESS_NAME}, doing business as {BRAND_NAME}
            (&quot;{BRAND_NAME},&quot; &quot;we,&quot; &quot;us,&quot; or &quot;our&quot;)
            (collectively, the &quot;Services&quot;).
          </p>
          <p>
            By creating an account, selecting or using a payment method, or placing an
            order after these Terms are presented, you affirmatively agree to these Terms.
            If you do not agree, do not create an account, submit payment, or use the
            Services.
          </p>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">1) Privacy Policy</h2>
            <p>
              Your use of the Services is also subject to our Privacy Policy, available at{" "}
              <a href="/privacy" className="text-red-400 hover:underline">
                privacy
              </a>
              . By using the Services, you acknowledge that we may collect, use, and share
              information as described in the Privacy Policy.
            </p>
          </section>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">
              2) Independent Reseller; No Brand Affiliation
            </h2>
            <p>
              {BRAND_NAME}, operated by {LEGAL_BUSINESS_NAME}, is an independent sneaker
              and apparel reseller. We are not affiliated with, endorsed by, sponsored by,
              or supported by Nike, Jordan, Adidas, New Balance, or any other brand. All
              trademarks, logos, and brand names are the property of their respective
              owners and are used only to identify the products we sell.
            </p>
          </section>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">3) Accounts</h2>
            <p>
              If you create an account, you agree to provide accurate and complete
              information and to keep your login credentials secure. You are responsible
              for all activities that occur under your account.
            </p>
            <p className="mt-2">
              You must be at least 18 years old and legally able to enter into a contract,
              or use the Services with the involvement and permission of a parent or legal
              guardian.
            </p>
          </section>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">
              4) Products, Condition, and Listings
            </h2>
            <p>
              We sell products in the condition described on the product page (for
              example: new, used, pre-owned). Product photos and descriptions are provided
              for informational purposes. Minor variations (including manufacturer
              variations) may occur. We reserve the right to correct errors in product
              descriptions, pricing, or availability at any time.
            </p>
          </section>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">5) Authenticity</h2>
            <p>
              We stand behind the authenticity of the products we sell. If you believe an
              item you received is not authentic, you must follow the instructions in our
              Return &amp; Refund Policy at{" "}
              <a href="/refunds" className="text-red-400 hover:underline">
                refunds
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">
              6) Pricing, Availability, and Order Acceptance
            </h2>
            <p>
              All prices are subject to change without notice. Placing an order is an
              offer to purchase.
            </p>
            <p>
              We may accept, reject, or cancel orders for reasons including, but not
              limited to:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>product availability</li>
              <li>pricing or listing errors</li>
              <li>suspected fraud or unauthorized activity</li>
              <li>shipping limitations</li>
            </ul>
            <p className="mt-2">
              If we cancel an accepted order, we will issue a refund for any amount
              captured for that order.
            </p>
          </section>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">7) Payments</h2>
            <p>
              Payments are processed through third-party payment processors. We do not
              store full payment card numbers.
            </p>
          </section>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">
              8) Shipping, Pickup, Delivery, and Risk of Loss
            </h2>
            <p>
              Shipping costs, methods, and estimated delivery times are displayed at
              checkout. Delivery dates are estimates and are not guaranteed.
            </p>
            <p>
              To the extent permitted by law, responsibility for loss or damage transfers
              once the shipment is handed to the carrier. We are not responsible for
              carrier delays, lost packages, theft after delivery, or damage in transit,
              except where such responsibility cannot be disclaimed under applicable law.
            </p>
            <p className="mt-2">
              Pickup by appointment requires the order number and a government-issued ID.
              We will provide the agreed-upon business location after confirming the
              pickup time. Contact us in advance if a different person will collect the
              order. Responsibility for the item transfers when it is handed to the
              authorized pickup person.
            </p>
          </section>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">
              9) Returns and Refunds
            </h2>
            <p>
              All sales are final. The only discretionary refund offered is for an item
              verified as inauthentic under our Return &amp; Refund Policy available at{" "}
              <a href="/refunds" className="text-red-400 hover:underline">
                refunds
              </a>
              , which is incorporated by reference into these Terms. Nothing in these
              Terms limits rights or remedies that cannot be waived under applicable law.
            </p>
          </section>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">
              10) Chargebacks and Payment Disputes
            </h2>
            <p>
              If you have an issue with an order, please contact us first at{" "}
              {SUPPORT_EMAIL} so we can try to resolve it. Nothing in these Terms limits a
              payment-dispute right provided by applicable law.
            </p>
          </section>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">
              11) Prohibited Conduct
            </h2>
            <p>You agree not to:</p>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>attempt unauthorized access to the Site or its systems</li>
              <li>
                interfere with or disrupt the Services (including via attacks, scraping,
                or abusive traffic)
              </li>
              <li>use the Services for unlawful, deceptive, or fraudulent purposes</li>
              <li>violate any intellectual property or other rights</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">
              12) Intellectual Property
            </h2>
            <p>
              All Site content (including text, graphics, layout, and design) is owned by
              or licensed to {BRAND_NAME} and is protected by applicable intellectual
              property laws. You may not use our content without prior written permission.
            </p>
          </section>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">13) Disclaimers</h2>
            <p>
              The Services are provided on an &quot;AS IS&quot; and &quot;AS
              AVAILABLE&quot; basis to the maximum extent permitted by law. We do not
              guarantee that the Services will be uninterrupted, secure, or error-free.
            </p>
          </section>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">
              14) Limitation of Liability
            </h2>
            <p>
              To the maximum extent permitted by law, {LEGAL_BUSINESS_NAME} will not be
              liable for any indirect, incidental, special, consequential, or punitive
              damages. In all cases, {LEGAL_BUSINESS_NAME}&apos;s total liability for any
              claim will not exceed the amount you paid to us for the order giving rise to
              the claim.
            </p>
          </section>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">
              15) Indemnification
            </h2>
            <p>
              You agree to indemnify and hold harmless {LEGAL_BUSINESS_NAME} from and
              against claims, damages, liabilities, and expenses arising out of your
              misuse of the Services or violation of these Terms.
            </p>
          </section>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">
              16) Governing Law and Venue
            </h2>
            <p>
              These Terms are governed by the laws of the State of North Carolina, without
              regard to conflict of law principles. You agree that any dispute will be
              brought in the state or federal courts located in North Carolina, unless
              applicable law requires otherwise.
            </p>
          </section>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">
              17) Changes to These Terms
            </h2>
            <p>
              We may update these Terms from time to time. We will post the updated Terms
              on the Site and update the &quot;Last updated&quot; date.
            </p>
          </section>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">18) Contact</h2>
            <p>{LEGAL_BUSINESS_NAME}</p>
            <p>Email: {SUPPORT_EMAIL}</p>
            <p>Location: {PICKUP_LOCATION_SUMMARY}</p>
          </section>
        </div>
      </div>
    </PolicyPage>
  );
}
