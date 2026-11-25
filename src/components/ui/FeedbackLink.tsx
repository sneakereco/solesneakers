"use client";

import type { ComponentPropsWithRef } from "react";
import Link, { useLinkStatus } from "next/link";

import { LoadingAnnouncement } from "./LoadingAnnouncement";

function NavigationStatus() {
  const { pending } = useLinkStatus();
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
  return (
    <Link {...props} data-feedback-link>
      {children}
      <NavigationStatus />
    </Link>
  );
}
