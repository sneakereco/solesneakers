"use client";

import { useState, useEffect, type ComponentPropsWithRef } from "react";
import Link, { useLinkStatus } from "next/link";

import { LoadingAnnouncement } from "./LoadingAnnouncement";

function NavigationStatus() {
  const { pending } = useLinkStatus();
  return <NavigationFeedback pending={pending} />;
}

function NavigationFeedback({ pending }: { pending: boolean }) {
  if (!pending) return null;

  return (
    <>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-current opacity-70"
      />
      <LoadingAnnouncement label="Loading page" />
    </>
  );
}

export function FeedbackLink({ children, ...props }: ComponentPropsWithRef<typeof Link>) {
  if (props.legacyBehavior) return <Link {...props}>{children}</Link>;

  return (
    <Link {...props} data-feedback-link>
      {children}
      <NavigationStatus />
    </Link>
  );
}

export function DocumentFeedbackLink({
  children,
  onClick,
  ...props
}: ComponentPropsWithRef<"a">) {
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!attempt) return;
    const settle = () => setAttempt(0);
    // A browser Stop can leave this document visible without firing pageshow.
    const timer = window.setTimeout(settle, 15_000);
    window.addEventListener("pageshow", settle);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pageshow", settle);
    };
  }, [attempt]);
  return (
    <a
      {...props}
      data-document-link
      onClick={(event) => {
        onClick?.(event);
        if (
          !event.defaultPrevented &&
          event.button === 0 &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.shiftKey &&
          !event.altKey &&
          props.href &&
          (props.download === undefined || props.download === false) &&
          (!props.target || props.target === "_self")
        )
          setAttempt((current) => current + 1);
      }}
    >
      {children}
      <NavigationFeedback pending={attempt !== 0} />
    </a>
  );
}
