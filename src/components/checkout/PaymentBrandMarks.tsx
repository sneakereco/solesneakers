export function PaymentBrandMarks() {
  return (
    <span className="flex items-center gap-1.5" aria-label="Accepted credit cards">
      <span
        aria-label="Visa"
        className="grid h-7 min-w-12 place-items-center rounded bg-[#1434CB] px-1.5 text-sm font-black italic tracking-tight text-white"
      >
        VISA
      </span>
      <span aria-label="Mastercard" className="relative h-7 w-12 rounded bg-zinc-900">
        <span
          aria-hidden="true"
          className="absolute left-2 top-1.5 h-4 w-4 rounded-full bg-[#EB001B]"
        />
        <span
          aria-hidden="true"
          className="absolute right-2 top-1.5 h-4 w-4 rounded-full bg-[#F79E1B] opacity-95"
        />
      </span>
      <span
        aria-label="American Express"
        className="grid h-7 min-w-12 place-items-center rounded bg-[#006FCF] px-1 text-[9px] font-black leading-[0.8] text-white"
      >
        <span aria-hidden="true">AM</span>
        <span aria-hidden="true">EX</span>
      </span>
      <span
        aria-label="Five additional accepted card brands"
        className="grid h-7 min-w-7 place-items-center rounded border border-zinc-200 bg-white px-1 text-xs text-sky-700"
      >
        +5
      </span>
    </span>
  );
}
