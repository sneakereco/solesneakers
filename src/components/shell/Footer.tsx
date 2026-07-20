import Link from "next/link";

import { SUPPORT_EMAIL } from "@/config/constants/mail";
import { INSTAGRAM_HANDLE, INSTAGRAM_URL } from "@/config/constants/contact";
import { PICKUP_LOCATION_SUMMARY } from "@/config/pickup";

const TERMS_LINKS = [
  { label: "Privacy Policy", href: "/privacy" },
  { label: "Returns and Refunds Policy", href: "/refunds" },
  { label: "Shipping Policy", href: "/shipping" },
  { label: "Terms of Service", href: "/terms" },
];

const CUSTOMER_RESOURCE_LINKS = [
  { label: "Authenticity Guarantee", href: "/authenticity-guarantee" },
  { label: "Contact Us", href: "/contact" },
  { label: "Hours & Pickups", href: "/hours" },
  { label: "Shipping Information", href: "/shipping" },
  { label: "Report a Problem", href: "/bug-report" },
];

const footerLinkClassName =
  "text-[1rem] text-zinc-600 transition-colors hover:text-black sm:text-[1.05rem]";

export function Footer() {
  return (
    <footer
      data-storefront-footer
      className="border-t border-zinc-200 bg-white text-black"
    >
      <div className="mx-auto max-w-[120rem] px-6 py-14 sm:px-10 sm:py-16 lg:px-[3.75rem] lg:py-20">
        <div className="grid grid-cols-1 gap-12 md:grid-cols-3 md:gap-10 lg:gap-20">
          <section aria-labelledby="footer-contact-heading">
            <h2
              id="footer-contact-heading"
              className="text-[0.8rem] font-medium uppercase tracking-[0.02em]"
            >
              Contact
            </h2>
            <address className="mt-7 space-y-4 not-italic">
              <p>
                <a
                  href={`mailto:${SUPPORT_EMAIL}`}
                  className={`${footerLinkClassName} break-all`}
                >
                  {SUPPORT_EMAIL}
                </a>
              </p>
              <p>
                <a
                  href={INSTAGRAM_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={footerLinkClassName}
                >
                  {INSTAGRAM_HANDLE}
                </a>
              </p>
              <p className={footerLinkClassName}>{PICKUP_LOCATION_SUMMARY}</p>
            </address>
          </section>

          <section aria-labelledby="footer-terms-heading">
            <h2
              id="footer-terms-heading"
              className="text-[0.8rem] font-medium uppercase tracking-[0.02em]"
            >
              Terms &amp; Privacy
            </h2>
            <ul className="mt-7 space-y-4">
              {TERMS_LINKS.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className={footerLinkClassName}>
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="footer-resources-heading">
            <h2
              id="footer-resources-heading"
              className="text-[0.8rem] font-medium uppercase tracking-[0.02em]"
            >
              Customer Resources
            </h2>
            <ul className="mt-7 space-y-4">
              {CUSTOMER_RESOURCE_LINKS.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className={footerLinkClassName}>
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="mt-16 border-t border-zinc-200 pt-6">
          <p className="text-xs uppercase tracking-[0.02em] text-zinc-500">
            © 2026 SOLESNEAKERS. ALL RIGHTS RESERVED.
          </p>
        </div>
      </div>
    </footer>
  );
}
