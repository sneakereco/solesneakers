// src/components/contact/ContactForm.tsx
"use client";

import { useEffect, useRef, useState } from "react";

import { ActionButton } from "@/components/ui/ActionButton";
import { useAsyncAction } from "@/components/ui/useAsyncAction";
import { withRequestDeadline } from "@/lib/http/request-deadline";

export function ContactForm() {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    message: "",
  });
  const send = useAsyncAction();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const storageKey = "rdk_contact_draft";
  const draftRef = useRef(formData);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const stored = sessionStorage.getItem(storageKey);
      if (!stored) return;
      sessionStorage.removeItem(storageKey);
      const parsed = JSON.parse(stored) as Partial<typeof formData>;
      // Restore the consumed browser-only draft after hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFormData((prev) => ({
        name: parsed.name ?? prev.name,
        email: parsed.email ?? prev.email,
        message: parsed.message ?? prev.message,
      }));
    } catch {
      // The form also works when browser storage is blocked.
    }
  }, [storageKey]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handleBeforeUnload = () => {
      const draft = draftRef.current;
      const hasDraft = draft.name || draft.email || draft.message;

      try {
        if (hasDraft) sessionStorage.setItem(storageKey, JSON.stringify(draft));
        else sessionStorage.removeItem(storageKey);
      } catch {
        // Draft persistence is optional when browser storage is blocked.
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [storageKey]);

  useEffect(() => {
    draftRef.current = formData;
  }, [formData]);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    void send.run(async () => {
      setResult(null);
      const fallback =
        "We could not confirm that your message was sent. Please try again or email us directly.";

      try {
        const outcome = await withRequestDeadline(async (signal) => {
          const response = await fetch("/api/contact", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...formData, subject: "Website contact form" }),
            signal,
          });
          const data = await response.json().catch(() => null);
          if (!response.ok || data?.ok !== true) {
            return {
              ok: false,
              message:
                response.status >= 400 &&
                response.status < 500 &&
                typeof data?.error === "string"
                  ? data.error
                  : fallback,
            };
          }
          return {
            ok: true,
            message: "Thank you for your message! We'll get back to you soon.",
          };
        });

        setResult(outcome);
        if (outcome.ok) {
          const empty = { name: "", email: "", message: "" };
          draftRef.current = empty;
          setFormData(empty);
        }
      } catch {
        setResult({ ok: false, message: fallback });
      }
    });
  }

  const labelClassName = "mb-3 block text-sm font-semibold text-black";
  const inputClassName =
    "storefront-contact-field w-full border border-zinc-300 bg-white px-4 py-4 text-base text-zinc-700 placeholder:text-zinc-500 focus:border-black focus:outline-none focus:ring-1 focus:ring-black";

  return (
    <form id="contact-form" onSubmit={handleSubmit} className="space-y-7">
      <div>
        <label htmlFor="name" className={labelClassName}>
          Name
        </label>
        <input
          type="text"
          id="name"
          name="name"
          autoComplete="name"
          required
          readOnly={send.pending}
          aria-describedby={result && !result.ok ? "contact-result" : undefined}
          placeholder="Your Name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          className={inputClassName}
        />
      </div>

      <div>
        <label htmlFor="email" className={labelClassName}>
          Email
        </label>
        <input
          type="email"
          id="email"
          name="email"
          autoComplete="email"
          required
          readOnly={send.pending}
          aria-describedby={result && !result.ok ? "contact-result" : undefined}
          placeholder="Your Email"
          value={formData.email}
          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
          className={inputClassName}
        />
      </div>

      <div>
        <label htmlFor="message" className={labelClassName}>
          Message
        </label>
        <textarea
          id="message"
          name="message"
          required
          readOnly={send.pending}
          aria-describedby={result && !result.ok ? "contact-result" : undefined}
          rows={5}
          value={formData.message}
          placeholder="Your Message"
          onChange={(e) => setFormData({ ...formData, message: e.target.value })}
          className={`${inputClassName} resize-y`}
        />
      </div>

      <ActionButton
        type="submit"
        pending={send.pending}
        pendingLabel="Sending message…"
        className="storefront-contact-field w-full cursor-pointer bg-black py-4 text-sm font-semibold uppercase text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
      >
        Send Message
      </ActionButton>
      {result && (
        <p
          id="contact-result"
          role={result.ok ? "status" : "alert"}
          className={result.ok ? "text-sm text-emerald-700" : "text-sm text-red-700"}
        >
          {result.message}
        </p>
      )}
    </form>
  );
}
