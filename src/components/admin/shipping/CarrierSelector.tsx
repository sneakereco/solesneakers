import type { CarrierKey } from "@/lib/shipping/carriers";

const AVAILABLE_CARRIERS = [
  { key: "UPS", label: "UPS", description: "United Parcel Service" },
  { key: "USPS", label: "USPS", description: "United States Postal Service" },
  { key: "FEDEX", label: "FedEx", description: "Federal Express" },
] satisfies Array<{ key: CarrierKey; label: string; description: string }>;

export function CarrierSelector({ enabled, onToggle }: {
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
            onClick={() => onToggle(carrier.key)}
            className={
              selected
                ? "w-full rounded border border-red-500 bg-red-950/40 p-3 text-left"
                : "w-full rounded border border-zinc-800/70 bg-zinc-950/40 p-3 text-left hover:border-zinc-700"
            }
          >
            <span className="block text-[12px] font-medium text-white sm:text-sm">
              {carrier.label}
            </span>
            <span className="block text-[11px] text-gray-500 sm:text-xs">
              {carrier.description}
            </span>
          </button>
        );
      })}
    </div>
  );
}
