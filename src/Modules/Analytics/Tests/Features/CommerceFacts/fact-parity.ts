import cases from "./fact-parity.json";
import { base, payloads } from "./fixtures";

export const factParityCases = cases.map((entry) => {
  const payload = payloads[entry.kind as keyof typeof payloads];
  const fact = { ...base, kind: entry.kind, payload };
  return {
    ...entry,
    candidate: entry.top
      ? { ...fact, [entry.key]: entry.value }
      : { ...fact, payload: { ...payload, [entry.key]: entry.value } },
  };
});
