import Image from "next/image";
import { useId, useState } from "react";

// Square's US online acceptance list, not every brand defined by the SDK.
// https://developer.squareup.com/docs/payment-card-support-by-country
const brands = [
  { code: "VISA", name: "Visa", file: "visa" },
  { code: "MASTERCARD", name: "Mastercard", file: "mastercard" },
  { code: "AMERICAN_EXPRESS", name: "American Express", file: "amex" },
  { code: "DISCOVER", name: "Discover", file: "discover" },
  { code: "DISCOVER_DINERS", name: "Diners Club", file: "diners" },
  { code: "JCB", name: "JCB", file: "jcb" },
  { code: "CHINA_UNIONPAY", name: "UnionPay", file: "unionpay" },
];

export function PaymentCardBrands({ brand }: { brand?: string | null }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const brandKey = brand?.replace(/[^a-z]/gi, "").toLowerCase();
  const detected = brands.find(
    (item) => item.code.replace(/_/g, "").toLowerCase() === brandKey,
  );
  const badge = (item: (typeof brands)[number]) => (
    <Image
      key={item.code}
      src={`/images/payments/${item.file}.svg`}
      alt={item.name}
      width={48}
      height={30}
      unoptimized
      className="h-6 w-auto sm:h-[30px]"
    />
  );
  return (
    <div
      className="relative ml-auto flex shrink-0 items-center gap-1"
      aria-label={detected ? `Detected card: ${detected.name}` : "Accepted cards"}
    >
      {(detected ? [detected] : brands.slice(0, 3)).map(badge)}
      {!detected && (
        <div onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
          <button
            type="button"
            aria-label="Show 4 more accepted card brands"
            aria-expanded={open}
            aria-describedby={open ? id : undefined}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onClick={() => setOpen(true)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                setOpen(false);
              }
            }}
            className="flex h-6 items-center rounded border border-zinc-200 bg-white px-1 text-[11px] text-[#1773b0] sm:h-[30px]"
          >
            +4
          </button>
          <div
            id={id}
            role="tooltip"
            aria-label="Accepted cards"
            hidden={!open}
            className="absolute right-0 top-full z-30 w-64 pt-2"
          >
            <div className="rounded-lg border border-zinc-200 bg-white p-3 shadow-lg">
              <p className="mb-2 text-xs font-medium text-zinc-600">Accepted cards</p>
              <div className="flex flex-wrap gap-2">{brands.map(badge)}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
