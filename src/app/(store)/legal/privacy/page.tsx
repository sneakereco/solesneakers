import { PolicyPage } from "@/components/legal/PolicyPage";
import { BRAND_DOMAIN, BRAND_NAME } from "@/config/constants/brand";
import { SUPPORT_EMAIL } from "@/config/constants/mail";

export default function PrivacyPage() {
  return (
    <PolicyPage title="Privacy Policy">
      <div className="prose prose-invert max-w-none">
        <div className="space-y-6 text-zinc-400">
          <p className="text-sm">Last updated: December 30, 2025</p>

          <p>
            This Privacy Policy describes how {BRAND_NAME} (&quot;we,&quot;
            &quot;us,&quot; or &quot;our&quot;) collects, uses, and discloses personal
            information when you visit, use our services, create an account, or make a
            purchase through {BRAND_DOMAIN} (the &quot;Site&quot;) or otherwise interact
            with us (collectively, the &quot;Services&quot;).
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
              <li>
                Contact information (name, email address, phone number, shipping/billing
                information)
              </li>
              <li>
                Order information (items purchased, order details, transaction history)
              </li>
              <li>Account information (if you create an account)</li>
              <li>
                Customer support information (messages and information you share with us)
              </li>
            </ul>

            <h3 className="mb-2 mt-4 text-lg font-semibold text-white">
              B) Information Collected Automatically (Essential)
            </h3>
            <p>
              When you use the Services, we may automatically collect certain technical
              information, including:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>IP address, browser type, device identifiers</li>
              <li>pages viewed and basic usage activity</li>
              <li>security and fraud-prevention logs</li>
            </ul>

            <h3 className="mb-2 mt-4 text-lg font-semibold text-white">
              C) Information From Service Providers
            </h3>
            <p>
              We may receive information from service providers that help operate the
              Services, such as payment processors and shipping providers.
            </p>
          </section>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">
              2) How We Use Information
            </h2>
            <p>We use personal information to:</p>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>process orders and deliver products</li>
              <li>provide customer support and communicate about purchases</li>
              <li>
                maintain accounts and essential session features (such as staying logged
                in)
              </li>
              <li>detect and prevent fraud, abuse, and unauthorized access</li>
              <li>improve the performance and reliability of the Services</li>
              <li>comply with legal obligations and enforce our policies</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">
              3) Cookies and Similar Technologies
            </h2>
            <p>
              We use strictly necessary cookies (and similar technologies) for essential
              site functions such as:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>keeping you logged in</li>
              <li>maintaining secure sessions</li>
              <li>preventing abuse and protecting the Services</li>
            </ul>
            <p className="mt-2">
              We do not use marketing/advertising cookies if your implementation is
              limited to essential login/session cookies. If we add analytics,
              advertising, or other non-essential cookies in the future, we will update
              this Privacy Policy and provide any required notices or choices.
            </p>
          </section>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">
              4) How We Share Information
            </h2>
            <p>We may share personal information with:</p>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>payment processors to complete transactions</li>
              <li>shipping and fulfillment providers to deliver orders</li>
              <li>
                hosting, security, and IT providers to maintain and protect the Services
              </li>
              <li>
                legal or regulatory authorities if required by law or to protect rights,
                safety, and the integrity of the Services
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">5) Data Retention</h2>
            <p>We retain personal information as long as necessary to:</p>
            <ul className="mt-2 list-disc space-y-1 pl-6">
              <li>fulfill orders and provide support</li>
              <li>maintain business records</li>
              <li>enforce our policies</li>
              <li>comply with legal obligations</li>
            </ul>
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
              collect personal information from children.
            </p>
          </section>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">8) Your Rights</h2>
            <p>
              Depending on your location, you may have rights to access, correct, delete,
              or obtain a copy of your personal information. To request action on your
              information, contact us at {SUPPORT_EMAIL}. We may verify your identity
              before responding.
            </p>
          </section>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">
              9) Changes to This Privacy Policy
            </h2>
            <p>
              We may update this Privacy Policy from time to time. We will post the
              revised policy on the Site and update the &quot;Last updated&quot; date.
            </p>
          </section>

          <section>
            <h2 className="mb-4 mt-8 text-2xl font-bold text-white">10) Contact</h2>
            <p>Email: {SUPPORT_EMAIL}</p>
            <p>Location: Simpsonville, South Carolina, USA</p>
          </section>
        </div>
      </div>
    </PolicyPage>
  );
}
