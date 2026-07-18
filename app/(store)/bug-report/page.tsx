import { ContactForm } from "@/components/contact/ContactForm";

export default function BugReportPage() {
  return (
    <div className="min-h-screen bg-[var(--storefront-surface)] px-5 pb-20 pt-12 text-black sm:px-8 sm:pb-28 lg:px-12">
      <h1 className="text-center text-3xl font-normal uppercase tracking-[0.02em] sm:text-[2rem]">
        Report a Problem
      </h1>

      <section
        className="storefront-contact-card mx-auto mt-14 w-full bg-white px-6 py-8 shadow-[0_2px_18px_rgba(0,0,0,0.1)] sm:px-8 sm:py-10"
        style={{ maxWidth: "1180px" }}
      >
        <p className="mb-8 text-sm leading-6 text-zinc-600 sm:text-base">
          Found something that is not working correctly? Tell us what happened, where it
          happened, and what you expected to see. Screenshots are helpful.
        </p>
        <ContactForm
          source="bug_report"
          variant="storefront"
          initialSubject="Bug report"
          messagePlaceholder="Share the steps, where it happened, and what you expected to see."
        />
      </section>
    </div>
  );
}
