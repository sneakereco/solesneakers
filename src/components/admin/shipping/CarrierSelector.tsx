import type { CarrierKey } from "@/lib/shipping/carriers";

const AVAILABLE_CARRIERS = [
  { key: "UPS", label: "UPS", description: "United Parcel Service" },
  { key: "USPS", label: "USPS", description: "United States Postal Service" },
  { key: "FEDEX", label: "FedEx", description: "Federal Express" },
] satisfies Array<{ key: CarrierKey; label: string; description: string }>;

export function CarrierSelector({
  enabled,
  onToggle,
}: {
  enabled: CarrierKey[];
  onToggle(carrier: CarrierKey): void;
}) {
  return (
    <div className="space-y-2">
      {AVAILABLE_CARRIERS.map((carrier) => {
        const selected = enabled.includes(carrier.key);
        return (
          <button
            key={carrier.key}
            type="button"
            aria-pressed={selected}
            data-admin-inverse={selected ? "" : undefined}
            onClick={() => onToggle(carrier.key)}
            className={
              selected
                ? "w-full rounded border border-black bg-black p-3 text-left ring-1 ring-black"
                : "w-full rounded border border-zinc-200 bg-white p-3 text-left hover:border-black hover:bg-zinc-50"
            }
          >
            <span
              className={`block text-[12px] font-medium sm:text-sm ${selected ? "text-white" : "text-zinc-950"}`}
            >
              {carrier.label}
            </span>
            <span
              className={`block text-[11px] sm:text-xs ${selected ? "text-zinc-300" : "text-zinc-500"}`}
            >
              {carrier.description}
            </span>
          </button>
        );
      })}
    </div>
  );
}
