import { SquareClient } from "square";
import { createSquareClient } from "@/lib/square/client";
jest.mock("@/lib/square/config", () => ({
  getSquareConfig: () => ({
    environment: "sandbox",
    accessToken: "inert",
    locationId: "location",
  }),
}));
import {
  runCheckoutRecovery,
  deadlineFetch,
  type RecoveryWorkerDependencies,
} from "../../../Source/Features/Recovery/recovery-worker";
import { expireCheckout } from "../../../Source/Features/Recovery/expiry-operation";
import {
  drainNotifications,
  SmtpRefusal,
} from "../../../Source/Features/Recovery/notification-drain";
import type { RecoveryJob } from "../../../Source/Features/Recovery/recovery-contract";

import { SquareEvidenceConflict } from "../../../Source/Features/Payments/payment-facts";
const config = { deadlineMs: 45000, batchSize: 50, concurrency: 4 };
const jobs = (n: number): RecoveryJob[] =>
  Array.from({ length: n }, (_, i) => ({
    kind: "reconcile_payment",
    id: String(i),
    orderId: String(i),
    eventId: null,
    leaseToken: "lease" + i,
    attempts: 1,
    unresolvedObservations: 0,
  }));
it("continues beyond fifty retrying jobs to settle a closed browser's accepted payment", async () => {
  const queue = jobs(51),
    done: string[] = [];
  let active = 0,
    peak = 0;
  const deps: RecoveryWorkerDependencies = {
    sweep: async () => {},
    oldestDueMs: () => Promise.resolve(123),
    claimRecovery: ({ limit }) => Promise.resolve(queue.splice(0, limit)),
    finishRecovery: (j) => {
      if (j.result === "done") done.push(j.id);
      return Promise.resolve(true);
    },
    acquireDependencyLease: () => Promise.resolve(String(Math.random())),
    releaseDependencyLease: async () => {},
    process: async (job, signal) => {
      signal.throwIfAborted();
      active++;
      peak = Math.max(active, peak);
      await Promise.resolve();
      active--;
      if (job.id !== "50") throw Error("outage");
      return "done";
    },
  };
  expect(await runCheckoutRecovery(config, deps)).toEqual({
    claimed: 51,
    done: 1,
    retry: 50,
    review: 0,
    oldestDueMs: 123,
  });
  expect(done).toEqual(["50"]);
  expect(peak).toBeLessThanOrEqual(4);
});
it("finishes an unmatched receipt as review and a database outage as retry", async () => {
  const queue = jobs(2).map((j) => ({
    ...j,
    kind: "square_event" as const,
    orderId: null,
    eventId: j.id,
  }));
  const finish = jest.fn().mockResolvedValue(true);
  await runCheckoutRecovery(config, {
    sweep: async () => {},
    oldestDueMs: () => Promise.resolve(0),
    claimRecovery: () => Promise.resolve(queue.splice(0)),
    acquireDependencyLease: () => Promise.resolve("slot"),
    releaseDependencyLease: async () => {},
    process: (j) =>
      Promise.reject(
        j.eventId === "0" ? new SquareEvidenceConflict() : Error("database unavailable"),
      ),
    finishRecovery: finish,
  });
  expect(finish).toHaveBeenCalledWith(
    expect.objectContaining({
      id: "0",
      result: "review",
      reason: "square_evidence_conflict",
    }),
  );
  expect(finish).toHaveBeenCalledWith(
    expect.objectContaining({ id: "1", result: "retry", reason: "recovery_unavailable" }),
  );
});
it("escalates only the twelfth actual unresolved observation", async () => {
  const queue = jobs(2).map((j, i) => ({
    ...j,
    attempts: 12 + i,
    unresolvedObservations: i ? 11 : 0,
  }));
  const finishes: string[] = [];
  const result = await runCheckoutRecovery(config, {
    sweep: async () => {},
    oldestDueMs: () => Promise.resolve(0),
    claimRecovery: () => Promise.resolve(queue.splice(0)),
    acquireDependencyLease: () => Promise.resolve("slot"),
    releaseDependencyLease: async () => {},
    process: () => Promise.resolve("retry"),
    finishRecovery: (j) => {
      finishes.push(j.result);
      return Promise.resolve(true);
    },
  });
  expect(finishes.sort()).toEqual(["retry", "review"]);
  expect(result.review).toBe(1);
});
it("aborts the installed Square SDK's response body and forbids subsequent requests after the operation deadline", async () => {
  const ctl = new AbortController();
  let calls = 0;
  const transport: typeof fetch = (_url, init) => {
    calls++;
    return Promise.resolve(
      new Response(
        new ReadableStream({
          start(c) {
            init!.signal!.addEventListener("abort", () => c.error(Error("aborted")));
            queueMicrotask(() => ctl.abort());
          },
        }),
        { headers: { "content-type": "application/json" } },
      ),
    );
  };
  const client = new SquareClient({
    token: "inert",
    timeoutInSeconds: 0.1,
    maxRetries: 0,
    fetch: deadlineFetch(ctl.signal, transport),
  });
  await expect(client.orders.get({ orderId: "inert" })).rejects.toThrow();
  await expect(client.payments.get({ paymentId: "inert" })).rejects.toThrow();
  expect(calls).toBe(1);
});
it("never queues SDK retries on a worker 503 with a long Retry-After", async () => {
  const transport = jest.fn(() =>
    Promise.resolve(
      new Response("{}", { status: 503, headers: { "retry-after": "120" } }),
    ),
  );
  const client = createSquareClient({
    maxRetries: 0,
    fetch: deadlineFetch(AbortSignal.timeout(250), transport),
  });
  await expect(client.orders.get({ orderId: "fixture" })).rejects.toThrow();
  expect(transport).toHaveBeenCalledTimes(1);
});
it("retains a possibly dispatched hold after no payment is found and cancellation by key succeeds", async () => {
  const finish = jest.fn(() => Promise.resolve("reconcile" as const)),
    cancel = jest.fn(async () => {});
  const result = await expireCheckout("order", {
    mark: () =>
      Promise.resolve({
        kind: "inquire" as const,
        squareOrderId: "square",
        unknownKeys: ["key"],
      }),
    inquire: async () => {},
    cancelByKey: cancel,
    cancelOrder: () => Promise.resolve(null),
    finish,
  });
  expect(cancel).toHaveBeenCalledWith("key");
  expect(result).toBe("reconcile");
  expect(finish).toHaveBeenCalledWith("order", null);
});
it("drains independent emails across claims and preserves ambiguous handoff", async () => {
  const queue = Array.from({ length: 7 }, (_, i) => ({
    id: String(i),
    orderId: "order",
    kind: i % 2 ? ("pickup_instructions" as const) : ("order_confirmation" as const),
    payload: {},
    leaseToken: "l" + i,
  }));
  const outcomes: string[] = [];
  const result = await drainNotifications(config, {
    claim: (n) => Promise.resolve(queue.splice(0, n)),
    remaining: () => Promise.resolve(1),
    acquireDependencyLease: () => Promise.resolve("slot"),
    releaseDependencyLease: async () => {},
    send: async (n, _signal, handoff) => {
      await handoff();
      if (n.id === "0") throw Error("disconnect after DATA");
      if (n.id === "1") {
        const error = Object.assign(Error("SMTP negative reply"), {
          code: "EMESSAGE",
          response: "451 refused",
          responseCode: 451,
          command: "DATA",
        });
        throw SmtpRefusal.fromProvider(error, "buyer@example.invalid") ?? error;
      }
    },
    beginHandoff: () => Promise.resolve(true),
    finish: (_n, outcome) => {
      outcomes.push(outcome);
      return Promise.resolve(outcome === "sent" ? "sent" : "failed");
    },
  });
  expect(result).toEqual({ sent: 5, failed: 2, remaining: 1 });
  expect(outcomes).toContain("review");
  expect(outcomes).toContain("rejected");
});
it("classifies only explicit single-recipient negative replies from installed Nodemailer", () => {
  // Exercise Nodemailer's real SMTP reply handlers with inert protocol lines.
  // No connection is opened and no authentication or message is transmitted.
  type Reply = (line: string, callback: (error: Error | null) => void) => void;
  const SMTPConnection = jest.requireActual<
    new (options: object) => { _actionDATA: Reply; _actionSMTPStream: Reply }
  >("nodemailer/lib/smtp-connection");
  const smtp = new SMTPConnection({});
  const classify = (handler: Reply, response: string) => {
    let result: SmtpRefusal | null = null;
    handler.call(smtp, response, (error) => {
      result = SmtpRefusal.fromProvider(error, "buyer@example.invalid");
    });
    return result;
  };
  expect(classify(smtp._actionDATA, "451 envelope rejected")).toMatchObject({
    reply: 451,
    phase: "data_command",
  });
  expect(classify(smtp._actionSMTPStream, "554 final refusal")).toMatchObject({
    reply: 554,
    phase: "data_final",
  });
  expect(classify(smtp._actionSMTPStream, "250 queued")).toBeNull();
  for (const error of [
    Error("451 timeout"),
    Object.assign(Error("lost"), { code: "ETIMEDOUT", command: "DATA" }),
    Object.assign(Error("partial"), {
      code: "EMESSAGE",
      command: "DATA",
      responseCode: 451,
      response: "451 server reply",
      accepted: ["other@example.invalid"],
    }),
  ])
    expect(SmtpRefusal.fromProvider(error, "buyer@example.invalid")).toBeNull();
});
it("counts persisted sent even after the post-delivery order event failed", async () => {
  const once = [
    {
      id: "fixture",
      leaseToken: "owned",
      kind: "order_confirmation" as const,
      payload: {},
      orderId: "fixture-order",
    },
  ];
  const finish = jest.fn().mockResolvedValue("sent");
  const summary = await drainNotifications(config, {
    claim: () => Promise.resolve(once.splice(0)),
    remaining: () => Promise.resolve(0),
    acquireDependencyLease: () => Promise.resolve("slot"),
    releaseDependencyLease: async () => {},
    beginHandoff: () => Promise.resolve(true),
    send: async (_n, _s, begin) => {
      await begin();
      throw Error("post_delivery_order_event_failed");
    },
    finish,
  });
  expect(finish).toHaveBeenCalledWith(expect.anything(), "review", undefined);
  expect(summary).toEqual({ sent: 1, failed: 0, remaining: 0 });
});
