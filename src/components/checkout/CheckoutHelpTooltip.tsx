"use client";

import { CircleHelp } from "lucide-react";
import { useId } from "react";

export function CheckoutHelpTooltip({
  label,
  children,
}: {
  label: string;
  children: string;
}) {
  const tooltipId = useId();

  return (
    <span className="group absolute right-3 top-1/2 z-20 -translate-y-1/2">
      <button
        type="button"
        aria-label={label}
        aria-describedby={tooltipId}
        className="flex cursor-help rounded-full text-[#737373] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
      >
        <CircleHelp aria-hidden="true" className="h-5 w-5" />
      </button>
      <span
        id={tooltipId}
        role="tooltip"
        className="pointer-events-none invisible absolute bottom-[calc(100%+0.75rem)] right-[-0.5rem] w-52 rounded-xl bg-zinc-900 px-3 py-2 text-center text-xs leading-4 text-white opacity-0 shadow-lg transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 after:absolute after:right-3 after:top-full after:border-8 after:border-transparent after:border-t-zinc-900"
      >
        {children}
      </span>
    </span>
  );
}
