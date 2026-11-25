// src/components/ui/Select.tsx
"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown } from "lucide-react";

export type RdkSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type Props = {
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  value: string;
  onChange: (value: string) => void;
  options: RdkSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  className?: string;
  buttonClassName?: string;
  menuClassName?: string;
};

export function RdkSelect({
  id,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  value,
  onChange,
  options,
  placeholder = "Select…",
  disabled = false,
  searchable = false,
  searchPlaceholder = "Search…",
  className = "",
  buttonClassName = "",
  menuClassName = "",
}: Props) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState<number>(() => {
    const idx = options.findIndex((o) => o.value === value);
    return idx >= 0 ? idx : 0;
  });

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const filteredOptions = useMemo(() => {
    if (!searchable) {
      return options;
    }
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return options;
    }
    return options.filter((opt) => {
      const label = opt.label.toLowerCase();
      const valueText = opt.value.toLowerCase();
      return label.includes(query) || valueText.includes(query);
    });
  }, [options, searchable, searchQuery]);

  const selected = useMemo(
    () => options.find((o) => o.value === value) ?? null,
    [options, value],
  );

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!open || disabled) return;

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (filteredOptions.length === 0) return;
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((prev) =>
        Math.max(0, Math.min(prev + step, filteredOptions.length - 1)),
      );
      return;
    }

    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.stopPropagation();
      const option = filteredOptions[activeIndex];
      if (option && !option.disabled) {
        onChange(option.value);
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
  };

  useEffect(() => {
    if (!open) {
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (wrapRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const [previousOptions, setPreviousOptions] = useState(filteredOptions);
  const [previousValue, setPreviousValue] = useState(value);
  if (previousOptions !== filteredOptions || previousValue !== value) {
    setPreviousOptions(filteredOptions);
    setPreviousValue(value);
    setActiveIndex(
      Math.max(
        0,
        filteredOptions.findIndex((o) => o.value === value),
      ),
    );
  }

  useEffect(() => {
    if (!open) {
      return;
    }
    if (searchable) {
      searchRef.current?.focus();
    }
  }, [open, searchable]);

  return (
    <div
      ref={wrapRef}
      data-ui-select
      className={`relative ${className}`}
      onKeyDown={handleKeyDown}
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
        }
      }}
    >
      <button
        ref={buttonRef}
        id={id}
        data-ui-select-trigger
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-expanded={open && !disabled}
        aria-controls={open && !disabled ? menuId : undefined}
        onClick={() => {
          setSearchQuery("");
          setActiveIndex(
            Math.max(
              0,
              options.findIndex((o) => o.value === value),
            ),
          );
          setOpen((v) => !v);
        }}
        className={[
          "flex w-full items-center justify-between gap-2",
          "border border-zinc-300 bg-white",
          "px-3 py-2 text-sm text-zinc-900",
          "rounded-md",
          "focus:border-black focus:outline-none focus:ring-2 focus:ring-black/10",
          "disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400",
          buttonClassName,
        ].join(" ")}
      >
        <span
          data-ui-select-value
          className={`min-w-0 truncate ${selected ? "text-zinc-900" : "text-zinc-500"}`}
        >
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && !disabled && (
        <div
          id={menuId}
          data-ui-select-menu
          role="listbox"
          className={[
            "absolute z-50 mt-2 w-full",
            "max-h-72 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-1 shadow-xl",
            menuClassName,
          ].join(" ")}
        >
          {searchable && (
            <div className="sticky top-0 z-10 border-b border-zinc-200 bg-white p-2">
              <input
                ref={searchRef}
                data-ui-select-search
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={searchPlaceholder}
                className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-black focus:outline-none focus:ring-2 focus:ring-black/10"
              />
            </div>
          )}
          {filteredOptions.length === 0 && (
            <div className="px-3 py-2 text-sm text-zinc-500">No matches</div>
          )}
          {filteredOptions.map((opt, idx) => {
            const isSelected = opt.value === value;
            const isActive = idx === activeIndex;

            return (
              <button
                key={opt.value}
                data-ui-select-option
                type="button"
                role="option"
                aria-selected={isSelected}
                data-active={isActive ? "true" : "false"}
                disabled={opt.disabled}
                onFocus={() => setActiveIndex(idx)}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => {
                  if (opt.disabled) {
                    return;
                  }
                  onChange(opt.value);
                  setOpen(false);
                  buttonRef.current?.focus();
                }}
                className={[
                  "w-full rounded-md px-3 py-2 text-left text-sm",
                  "transition-colors",
                  opt.disabled
                    ? "cursor-not-allowed text-zinc-400"
                    : "cursor-pointer text-zinc-800",
                  isSelected || isActive
                    ? "bg-zinc-900 text-white"
                    : "bg-white hover:bg-zinc-100 hover:text-zinc-950",
                ].join(" ")}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
