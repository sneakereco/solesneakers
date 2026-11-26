import { manifestDigest } from "./contracts.mjs";

export const MIX = Object.freeze({ browse: 55, search: 25, cart: 15, checkout: 5 });
export const PROFILE_NAMES = [
  "smoke",
  "calibration",
  "peak",
  "arrival",
  "rush",
  "rush-worst",
  "claim-rush",
  "stress",
  "soak",
  "faults",
  "acceptance",
];
const limits = {
  smoke: [10, 2, 120],
  calibration: [500, 5, 300],
  peak: [10000, 20, 1800],
  arrival: [12000, 20, 600],
  rush: [10000, 20, 600],
  "rush-worst": [10000, 20, 600],
  "claim-rush": [10000, 20, 600],
  stress: [12000, 20, 300],
  soak: [10000, 20, 7200],
  faults: [500, 5, 600],
};
export function createRunPlan(target, profile, options = {}) {
  if (!limits[profile])
    throw new Error(
      "Select a runnable profile; acceptance is orchestrated as separate phases",
    );
  const allowed = [
    "runId",
    "startedAt",
    "totalSlots",
    "cacheState",
    "arrivalEvidence",
    "contenders",
    "hotStock",
    "fault",
  ];
  if (Object.keys(options).some((key) => !allowed.includes(key)))
    throw new Error("Unsupported profile override");
  const [ceiling, browsers, measurementSeconds] = limits[profile];
  const totalSlots = options.totalSlots ?? ceiling;
  if (
    !Number.isSafeInteger(totalSlots) ||
    totalSlots < 2 ||
    totalSlots > ceiling ||
    totalSlots > target.budget.maxSessions ||
    (["peak", "soak", "rush", "rush-worst", "claim-rush", "arrival"].includes(profile) &&
      totalSlots !== ceiling)
  )
    throw new Error("Profile session budget is invalid");
  const browserSlots = Math.min(browsers, totalSlots - 1);
  const httpSlots = totalSlots - browserSlots;
  const runId = options.runId ?? globalThis.crypto.randomUUID();
  const startedAt = options.startedAt ?? new Date().toISOString();
  if (!/^[a-f0-9-]{36}$/i.test(runId) || !Number.isFinite(Date.parse(startedAt)))
    throw new Error("Invalid run identity/time");
  const cacheState = options.cacheState ?? "warm";
  if (!["warm", "cold"].includes(cacheState)) throw new Error("Unknown cache state");
  const hotStock = options.hotStock ?? 1;
  if (![1, 10, 100].includes(hotStock)) throw new Error("Unsupported hot stock profile");
  let contenders =
    profile === "rush"
      ? 8000
      : profile === "rush-worst"
        ? 9980
        : profile === "claim-rush"
          ? (options.contenders ?? 1000)
          : 0;
  if (
    !Number.isSafeInteger(contenders) ||
    contenders < 0 ||
    contenders > httpSlots ||
    (profile === "claim-rush" && ![1000, 2000, 5000, 8000, 9980].includes(contenders)) ||
    (options.contenders !== undefined && profile !== "claim-rush")
  )
    throw new Error("Invalid contender allocation");
  const warmupSeconds = profile === "peak" ? 780 : profile === "arrival" ? 600 : 0;
  const plan = {
    version: 1,
    runId,
    profile,
    targetDigest: target.digest,
    startedAt,
    totalSlots,
    httpSlots,
    browserSlots,
    contenders,
    background: contenders ? httpSlots - contenders : httpSlots,
    contentionKind: profile === "claim-rush" ? "specialty" : "purchase",
    hotStock,
    cacheState,
    measurementSeconds,
    warmupSeconds,
    gracefulStopSeconds: 600,
    mix: { ...MIX },
    guestPercent: 70,
    accountPercent: 30,
    shippingPercent: 80,
    pickupPercent: 20,
    browserViewports: {
      mobile: Math.round(browserSlots * 0.7),
      desktop: browserSlots - Math.round(browserSlots * 0.7),
    },
    sessionSeconds: [300, 600],
    pauses: { browse: [5, 15], cart: [2, 5], checkout: [3, 8] },
    accountPoolSize: Math.ceil(
      ((ceiling <= 500 ? ceiling : target.budget.maxSessions) * 33) / 100,
    ),
    stages:
      profile === "peak"
        ? [100, 500, 1000, 2000, 5000].flatMap((slots) => [
            { durationSeconds: 30, totalSlots: slots },
            { durationSeconds: 120, totalSlots: slots },
          ])
        : [],
    slotRanges: [
      { workerId: "http-0", kind: "http", start: 0, end: httpSlots },
      { workerId: "browser-0", kind: "browser", start: httpSlots, end: totalSlots },
    ],
    fault: options.fault ?? null,
  };
  if (profile === "arrival") {
    const evidence = options.arrivalEvidence;
    if (
      evidence?.profile !== "peak" ||
      evidence.passed !== true ||
      evidence.totalSlots !== 10000 ||
      !Number.isSafeInteger(evidence.completedSessions) ||
      evidence.completedSessions < 1 ||
      !Number.isFinite(evidence.meanSessionSeconds) ||
      evidence.meanSessionSeconds < 300 ||
      evidence.meanSessionSeconds > 1200 ||
      !Number.isFinite(evidence.requestsPerSession) ||
      evidence.requestsPerSession <= 0
    )
      throw new Error("Arrival load needs completed successful target-peak sessions");
    const rate = Math.round((9980 * 60) / evidence.meanSessionSeconds);
    plan.arrival = {
      unit: "sessions",
      rate,
      timeUnit: "1m",
      preAllocatedVUs: Math.min(
        httpSlots,
        Math.ceil((rate / 60) * evidence.meanSessionSeconds * 1.1),
      ),
      maxVUs: httpSlots,
      evidenceDigest: manifestDigest(evidence),
    };
  }
  plan.durationSeconds = warmupSeconds + measurementSeconds + plan.gracefulStopSeconds;
  if (plan.durationSeconds > target.budget.maxDurationSeconds)
    throw new Error("Profile exceeds approved duration");
  plan.deadline = new Date(
    Date.parse(startedAt) + plan.durationSeconds * 1000,
  ).toISOString();
  plan.ordinaryStockUnits = Math.ceil(
    httpSlots * 0.05 * Math.ceil(plan.durationSeconds / 300) * 3 * 2,
  );
  plan.workloadDigest = manifestDigest(plan);
  return plan;
}
export function acceptanceProfiles() {
  return [
    { profile: "smoke" },
    { profile: "calibration" },
    ...["cold", "warm"].map((cacheState) => ({ profile: "peak", cacheState })),
    { profile: "arrival" },
    ...[1, 10, 100].map((hotStock) => ({ profile: "rush", hotStock })),
    { profile: "rush-worst" },
    ...[1000, 2000, 5000, 8000, 9980].map((contenders) => ({
      profile: "claim-rush",
      contenders,
    })),
    { profile: "stress" },
    { profile: "soak" },
    ...[
      "square-timeout",
      "shippo-unavailable",
      "smtp-outage",
      "redis-outage",
      "database-outage",
      "response-loss",
      "duplicate-event",
      "expiry-race",
    ].map((fault) => ({ profile: "faults", fault })),
  ];
}
