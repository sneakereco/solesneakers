"use client";

import { Search, X } from "lucide-react";

type AdminSearchFieldProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label?: string;
  className?: string;
  compact?: boolean;
  autoComplete?: string;
};

export function AdminSearchField({
  value,
  onChange,
  placeholder,
  label = "Search",
  className = "",
  compact = false,
  autoComplete = "off",
}: AdminSearchFieldProps) {
  return (
    <label
      data-admin-search
      className={`relative flex w-full items-center rounded-lg border border-zinc-300 bg-white text-zinc-950 shadow-[0_1px_0_rgba(9,9,11,0.03)] transition focus-within:border-black focus-within:ring-2 focus-within:ring-black/10 ${
        compact ? "min-h-9" : "min-h-11"
      } ${className}`}
    >
      <span className="sr-only">{label}</span>
      <Search
        aria-hidden="true"
        className={`pointer-events-none absolute left-3 text-zinc-500 ${
          compact ? "h-3.5 w-3.5" : "h-4 w-4"
        }`}
      />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className={`w-full appearance-none border-0 bg-transparent pl-9 text-zinc-950 outline-none placeholder:text-zinc-400 focus:border-0 focus:ring-0 ${
          compact ? "h-8 pr-8 text-xs sm:text-sm" : "h-10 pr-10 text-sm"
        }`}
      />
      {value.length > 0 && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label={`Clear ${label.toLowerCase()}`}
          className="absolute right-2 flex h-7 w-7 items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 hover:text-black"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </label>
  );
}
