"use client";

import { createContext, useContext, type ComponentProps } from "react";
import { FeedbackLink } from "@/components/ui/FeedbackLink";

export const StoreOverlayNavigation = createContext<
  ((href: string, label: string) => void) | null
>(null);

export function StoreOverlayLink({
  href,
  onNavigate,
  ...props
}: Omit<ComponentProps<typeof FeedbackLink>, "onNavigate" | "href"> & {
  href: string;
  onNavigate: () => void;
}) {
  const navigate = useContext(StoreOverlayNavigation);
  return (
    <FeedbackLink
      {...props}
      href={href}
      onNavigate={(event) => {
        onNavigate();
        if (navigate) {
          event.preventDefault();
          navigate(href, "Loading page…");
        }
      }}
    />
  );
}
