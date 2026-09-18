// src/components/contact/ContactForm.tsx
"use client";

import { useEffect, useRef, useState } from "react";

import { Toast } from "@/components/ui/Toast";

export function ContactForm() {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    message: "",
  });
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [toast, setToast] = useState<{
    message: string;
    tone: "success" | "error" | "info";
  } | null>(null);
  const storageKey = "rdk_contact_draft";
  const draftRef = useRef(formData);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const stored = sessionStorage.getItem(storageKey);
    if (!stored) {
      return;
    }
    sessionStorage.removeItem(storageKey);
    try {
      const parsed = JSON.parse(stored) as Partial<typeof formData>;
      // Restore the consumed browser-only draft after hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFormData((prev) => ({
        name: parsed.name ?? prev.name,
        email: parsed.email ?? prev.email,
        message: parsed.message ?? prev.message,
      }));
    } catch {
      // Ignore malformed drafts.
    }
  }, [storageKey]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handleBeforeUnload = () => {
      const draft = draftRef.current;
      const hasDraft = draft.name || draft.email || draft.message;

      if (!hasDraft) {
        sessionStorage.removeItem(storageKey);
        return;
      }

      sessionStorage.setItem(storageKey, JSON.stringify(draft));
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [storageKey]);

  useEffect(() => {
    draftRef.current = formData;
  }, [formData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("sending");
    setToast(null);

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...formData, subject: "Website contact form" }),
      });

      const data = await response.json().catch(() => null);

      if (response.ok) {
        setStatus("success");
        setFormData({
          name: "",
          email: "",
          message: "",
        });
        setToast({
          message: "Thank you for your message! We'll get back to you soon.",
          tone: "success",
        });
        if (typeof window !== "undefined") {
          sessionStorage.removeItem(storageKey);
        }
      } else {
        setStatus("error");
        setToast({
          message: data?.error ?? "Something went wrong. Please try again.",
          tone: "error",
        });
      }
    } catch {
      setStatus("error");
      setToast({
        message: "Something went wrong. Please try again or email us directly.",
        tone: "error",
      });
    }
  };

  const labelClassName = "mb-3 block text-sm font-semibold text-black";
  const inputClassName =
    "storefront-contact-field w-full border border-zinc-300 bg-white px-4 py-4 text-base text-zinc-700 placeholder:text-zinc-500 focus:border-black focus:outline-none focus:ring-1 focus:ring-black";

  return (
    <form
      id="contact-form"
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
      className="space-y-7"
    >
      <div>
        <label htmlFor="name" className={labelClassName}>
          Name
        </label>
        <input
          type="text"
          id="name"
          required
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
          required
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
          required
          rows={5}
          value={formData.message}
          placeholder="Your Message"
          onChange={(e) => setFormData({ ...formData, message: e.target.value })}
          className={`${inputClassName} resize-y`}
        />
      </div>

      <button
        type="submit"
        disabled={status === "sending"}
        className="storefront-contact-field w-full cursor-pointer bg-black py-4 text-sm font-semibold uppercase text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
      >
        {status === "sending" ? "Sending..." : "Send Message"}
      </button>
      <Toast
        open={Boolean(toast)}
        message={toast?.message ?? ""}
        tone={toast?.tone ?? "info"}
        onClose={() => setToast(null)}
      />
    </form>
  );
}
