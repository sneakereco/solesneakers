import { ContactForm } from "@/components/contact/ContactForm";
import { SUPPORT_EMAIL } from "@/config/constants/contact";

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-[var(--storefront-surface)] px-5 pb-20 pt-12 text-black sm:px-8 sm:pb-28 lg:px-12">
      <h1 className="text-center text-3xl font-normal uppercase tracking-[0.02em] sm:text-[2rem]">
        Contact Us
      </h1>

      <section
        className="storefront-contact-card mx-auto mt-14 w-full bg-white px-6 py-8 shadow-[0_2px_18px_rgba(0,0,0,0.1)] sm:px-8 sm:py-10"
        style={{ maxWidth: "1180px" }}
      >
        <ContactForm source="contact_form" variant="storefront" />
        <p className="mt-7 text-center text-sm text-zinc-800 sm:text-base">
          All messages will be sent to{" "}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="text-blue-600 underline underline-offset-2"
          >
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </section>
    </div>
  );
}
