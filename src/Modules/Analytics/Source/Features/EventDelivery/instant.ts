import "server-only";
import { factFields } from "../CommerceFacts/contract";
// Date.parse retains milliseconds. Preserve the remaining supported microseconds in comparisons.
export function analyticsInstantMicros(value: string): bigint {
  factFields.effectiveAt.parse(value);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new RangeError("Invalid analytics timestamp");
  const fraction = /\.(\d+)/.exec(value)?.[1] ?? "";
  return BigInt(ms) * 1000n + BigInt(fraction.padEnd(6, "0").slice(3, 6));
}
export function formatAnalyticsMicros(value: bigint): string {
  const remainder = ((value % 1000n) + 1000n) % 1000n;
  const iso = new Date(Number((value - remainder) / 1000n)).toISOString();
  return remainder === 0n
    ? iso
    : iso.slice(0, -1) + String(remainder).padStart(3, "0") + "Z";
}
