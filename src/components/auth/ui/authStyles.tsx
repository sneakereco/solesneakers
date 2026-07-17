// src/components/auth/ui/AuthStyles.ts
export const authStyles = {
  input:
    "h-14 w-full border border-zinc-300 bg-white px-5 text-[1.02rem] font-normal text-zinc-800 placeholder:text-zinc-500 transition-colors focus:border-zinc-400 focus:outline-none disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-500 sm:h-[min(3.2vw,3.85rem)] sm:min-h-12",

  inputDisabled:
    "h-14 w-full border border-zinc-300 bg-zinc-100 px-5 text-[1.02rem] text-zinc-500 cursor-not-allowed sm:h-[min(3.2vw,3.85rem)] sm:min-h-12",

  primaryButton:
    "h-14 w-full bg-[#1f1f1d] text-[0.98rem] font-normal uppercase tracking-[0.01em] text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-[#1f1f1d] sm:h-[min(3.2vw,3.85rem)] sm:min-h-12",

  neutralLink: "text-[0.98rem] text-zinc-600 transition-colors hover:text-zinc-900",

  accentLink:
    "text-[0.98rem] text-zinc-700 underline-offset-4 transition-colors hover:text-black hover:underline",

  inlineAccentLink: "text-zinc-700 transition-colors hover:text-black",

  errorBox: "border border-red-200 bg-[#fff8f8] px-5 py-4 text-[0.95rem] text-red-700",

  infoBox:
    "border border-emerald-200 bg-[#f7fbf8] px-5 py-4 text-[0.95rem] text-emerald-700",

  panel: "border border-zinc-300 bg-white px-5 py-4 text-[0.95rem] text-zinc-600",

  divider: "flex items-center gap-3 text-xs uppercase tracking-[0.24em] text-zinc-400",

  dividerLine: "h-px flex-1 bg-zinc-300",
};
