export function createRushSchedule(plan, clockSamples, now = Date.now()) {
  if (!clockSamples.length || !plan.contenders)
    throw Error("Rush clock/contender evidence missing");
  const offsets = clockSamples.map((sample) => {
    if (sample.receivedAt < sample.sentAt || sample.receivedAt - sample.sentAt > 200)
      throw Error("Rush clock uncertainty exceeds 100ms");
    return sample.serverAt - (sample.sentAt + sample.receivedAt) / 2;
  });
  if (Math.max(...offsets) - Math.min(...offsets) > 100)
    throw Error("Rush clock skew exceeds 100ms");
  const offset = offsets.reduce((a, b) => a + b, 0) / offsets.length;
  return {
    kind: plan.contentionKind,
    releaseAt: now + 30000,
    offsetMs: offset,
    dispatchWindowMs: 1000,
    ranges: [
      { kind: "contender", start: 0, end: plan.contenders },
      { kind: "background", start: plan.contenders, end: plan.httpSlots },
      { kind: "browser", start: plan.httpSlots, end: plan.totalSlots },
    ],
  };
}
export function validateDispatchWindow(values, schedule) {
  const reasons = [];
  if (!values?.length || values.some((x) => !Number.isFinite(x)))
    return { status: "unmet", reasons: ["No measured dispatch timestamps"] };
  if (Math.min(...values) < schedule.releaseAt - 100)
    reasons.push("Dispatch preceded sale opening");
  if (Math.max(...values) - Math.min(...values) > schedule.dispatchWindowMs)
    reasons.push("Measured dispatch spread exceeded one second");
  return {
    status: reasons.length ? "fail" : "pass",
    reasons,
    spreadMs: Math.max(...values) - Math.min(...values),
  };
}
export function bindCampaignContract(attestation) {
  if (!attestation.capabilities?.includes("specialty-claims")) return null;
  const contract = attestation.capabilityContracts?.specialtyClaims;
  if (!contract || contract.version !== 1 || contract.kind !== "specialty-claims")
    throw Error("Missing versioned specialty contract");
  for (const key of ["validatePath", "claimPath", "recoverPath"])
    if (
      typeof contract[key] !== "string" ||
      !/^\/api\/[a-z0-9/_-]+$/i.test(contract[key]) ||
      /checkout|internal|admin|webhook/i.test(contract[key])
    )
      throw Error("Unsafe specialty contract path");
  if (
    !contract.requestSchema ||
    !contract.responseSchema ||
    !contract.fixtureContract ||
    !contract.assertionContract
  )
    throw Error("Incomplete specialty contract schemas");
  return Object.freeze(contract);
}
