import { OPERATION_BUDGETS } from "../shared/thresholds.mjs";
export function fixture() {
  const plan = {
    runId: "unit-run",
    profile: "smoke",
    targetDigest: "a".repeat(64),
    workloadDigest: "b".repeat(64),
    totalSlots: 10,
    httpSlots: 8,
    browserSlots: 2,
    warmupSeconds: 0,
    measurementSeconds: 10,
    startedAt: new Date(1000).toISOString(),
    measurementStart: 1000,
    measurementEnd: 11000,
    provenance: {
      commit: "c".repeat(40),
      deploymentId: "dpl_fixture",
      projectId: "prj_fixture",
      providerMode: "simulated",
      region: "us-east",
      tiers: { verified: true },
    },
    requiredTelemetry: ["generator", "database", "redis", "queues", "application"],
  };
  const operations = Object.keys(OPERATION_BUDGETS)
    .filter((x) => x !== "claim")
    .map((operation) => ({ operation, outcome: "success", durationMs: 100 }));
  const worker = {
    version: 1,
    runId: plan.runId,
    workerId: "http-0",
    profile: plan.profile,
    activeSamples: [
      { at: 1000, slots: 8 },
      { at: 11000, slots: 8 },
      { at: 11001, slots: 0 },
    ],
    offered: 8,
    completed: 8,
    dropped: 0,
    interrupted: 0,
    operations,
    resources: [{ type: "checkout-outcomes", eligible: 1, completedOnTime: 1 }],
    errors: [],
  };
  const browser = {
    ...worker,
    workerId: "browser-0",
    activeSamples: [
      { at: 1000, slots: 2 },
      { at: 11000, slots: 2 },
      { at: 11001, slots: 0 },
    ],
    offered: 2,
    completed: 2,
    operations: [{ type: "case", name: "checkout", status: "pass" }],
    resources: [
      { type: "browser-coverage", status: "pass", planned: 2, started: 2 },
      { type: "vitals-gate", status: "pass", measurements: [{ samples: 20 }] },
    ],
  };
  const invariants = {
    variants: [{ initial: 10, stock: 9, active: 0, consumed: 1 }],
    orders: [
      {
        id: "order",
        status: "paid",
        totalCents: 1000,
        itemCents: 1000,
        shippingCents: 0,
        taxCents: 0,
        itemCount: 1,
        hasSnapshot: true,
      },
    ],
    captures: [
      { id: "payment", orderId: "order", status: "COMPLETED", totalCents: 1000 },
    ],
    acceptedOrderIds: ["order"],
    receiptEvidence: true,
  };
  const telemetry = {
    availability: Object.fromEntries(
      plan.requiredTelemetry.map((source) => [source, { status: "available" }]),
    ),
    samples: [
      {
        source: "generator",
        at: 1000,
        value: { cpuPercent: 10, memoryPercent: 20, networkSaturated: false },
      },
      {
        source: "database",
        at: 1000,
        value: { cpuPercent: 20, connections: 5, maxConnections: 100, waitingLocks: 0 },
      },
      {
        source: "redis",
        at: 1000,
        value: {
          available: true,
          limitExceeded: false,
          simulationOverhead: { measured: true },
        },
      },
      {
        source: "queues",
        at: 1000,
        value: { oldestDeliverableSeconds: 10, baselineRecovered: true },
      },
      { source: "application", at: 1000, value: { requests: 100, unexpectedErrors: 0 } },
    ],
  };
  return { plan, workers: [worker, browser], invariants, telemetry };
}
