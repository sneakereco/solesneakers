import { pageMetadata } from "@/lib/metadata";

import { PolicyPage } from "@/components/legal/PolicyPage";
import { BRAND_DOMAIN, BRAND_NAME, LEGAL_BUSINESS_NAME } from "@/config/constants/brand";
import { SUPPORT_EMAIL } from "@/config/constants/mail";
import { PICKUP_LOCATION_SUMMARY } from "@/config/pickup";

export const metadata = pageMetadata(
  "Privacy Policy",
  "Learn how Solesneakers collects, uses, and protects information when you browse, create an account, or place an order.",
);

export default function PrivacyPage() {
  return (
    <PolicyPage title="Privacy Policy">
      <div className="prose prose-invert max-w-none">
        <div className="space-y-6 text-zinc-400">
          <p className="text-sm">Last updated: September 18, 2026</p>

          <p>
            This Privacy Policy describes how {LEGAL_BUSINESS_NAME}, doing business as{" "}
            {BRAND_NAME} (&quot;we,&quot; &quot;us,&quot; or &quot;our&quot;), collects,
            uses, and discloses personal information when you visit {BRAND_DOMAIN}, create
            an account, make a purchase, or otherwise interact with us (collectively, the
            &quot;Services&quot;).
          </p>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">
              1) Information We Collect
            </h2>
            <h3 className="mb-2 mt-4 text-lg font-semibold text-white">
              A) Information You Provide
            </h3>
            <p>We may collect information you provide directly, including:</p>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>name, email address, phone number, and shipping or billing address</li>
              <li>order details, transaction history, and pickup contact information</li>
              <li>account credentials and profile information</li>
              <li>
                customer-support messages and any photos or files you send us by email
              </li>
            </ul>
            <p className="mt-2">
              Payment information is collected and processed by Square. We do not store
              full payment card numbers.
            </p>

            <h3 className="mb-2 mt-4 text-lg font-semibold text-white">
              B) Information Collected Automatically
            </h3>
            <p>When you use the Services, we may collect:</p>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>
                IP address, browser type, device information, and session identifiers
              </li>
              <li>pages viewed and website performance information</li>
              <li>security, fraud-prevention, rate-limit, and access logs</li>
            </ul>

            <h3 className="mb-2 mt-4 text-lg font-semibold text-white">
              C) Information From Other Services
            </h3>
            <p>
              We may receive account information from Google if you choose Google sign-in,
              payment and order status from Square, and address, shipment, and tracking
              information from Shippo and participating carriers.
            </p>
          </section>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">
              2) How We Use Information
            </h2>
            <p>We use personal information to:</p>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>process, fulfill, and support orders and local pickups</li>
              <li>maintain accounts and essential session features</li>
              <li>send order, payment, shipping, security, and support communications</li>
              <li>detect and prevent fraud, abuse, and unauthorized access</li>
              <li>measure and improve website performance and reliability</li>
              <li>comply with legal obligations and enforce our policies</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">
              3) Cookies, Analytics, and Security Technologies
            </h2>
            <p>
              We use cookies and similar technologies that are necessary for account
              sessions, checkout security, fraud prevention, and site operation. We do not
              use marketing or advertising cookies.
            </p>
            <p className="mt-2">
              We use Cloudflare Web Analytics to understand page views and website
              performance. Cloudflare states that this service does not collect or use
              visitors&apos; personal data. Cloudflare security services may also process
              technical signals to distinguish people from automated abuse.
            </p>
          </section>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">
              4) How We Disclose Information
            </h2>
            <p>We may disclose personal information to:</p>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>Square to process payments and orders</li>
              <li>
                Shippo and shipping carriers to validate addresses and deliver orders
              </li>
              <li>Supabase, Google, and other account-service providers</li>
              <li>Vercel, Cloudflare, email, security, and IT service providers</li>
              <li>
                legal or regulatory authorities when required by law or necessary to
                protect rights, safety, and the integrity of the Services
              </li>
            </ul>
            <p className="mt-2">
              We do not sell personal information or share it for cross-context behavioral
              advertising.
            </p>
          </section>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">5) Data Retention</h2>
            <p>
              We keep account information while an account remains active and as needed to
              provide support. We retain order and transaction records as needed for
              fulfillment, taxes, accounting, disputes, fraud prevention, and other legal
              obligations. Security and support records are kept only as long as
              reasonably necessary for those purposes.
            </p>
          </section>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">6) Security</h2>
            <p>
              We take reasonable measures designed to protect your information. However,
              no method of transmission or storage is 100% secure, and we cannot guarantee
              absolute security.
            </p>
          </section>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">
              7) Children&apos;s Privacy
            </h2>
            <p>
              The Services are not intended for children under 13, and we do not knowingly
              collect personal information from children under 13.
            </p>
          </section>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">
              8) Your Choices and Rights
            </h2>
            <p>
              Depending on your location, you may have rights to access, correct, delete,
              or obtain a copy of your personal information. To make a privacy request,
              email {SUPPORT_EMAIL}. We may verify your identity before responding. If we
              deny a request, you may reply to appeal the decision where applicable law
              provides that right.
            </p>
          </section>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">
              9) Tracking Preference Signals
            </h2>
            <p>
              Because we do not sell personal information or use cross-context behavioral
              advertising, browser Do Not Track or Global Privacy Control signals do not
              change how the Site operates. We will honor legally required preference
              signals if our practices change.
            </p>
          </section>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">
              10) Changes to This Privacy Policy
            </h2>
            <p>
              We may update this Privacy Policy from time to time. We will post the
              revised policy on the Site and update the &quot;Last updated&quot; date. We
              will provide additional notice when required by law.
            </p>
          </section>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">11) Contact</h2>
            <p>{LEGAL_BUSINESS_NAME}</p>
            <p>Email: {SUPPORT_EMAIL}</p>
            <p>Location: {PICKUP_LOCATION_SUMMARY}</p>
          </section>
        </div>
      </div>
    </PolicyPage>
  );
}
