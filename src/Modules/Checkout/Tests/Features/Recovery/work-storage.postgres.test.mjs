import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { withCheckoutDatabase } from "../../../../../../tests/database/fixtures/checkout-hardening.mjs";

const mode = process.env.CHECKOUT_WORK_STORAGE_MODE ?? "fresh";
const iso = (milliseconds = 0) => new Date(Date.now() + milliseconds).toISOString();

async function enqueue(client, orderId, uniqueKey, dueAt = iso(-1000)) {
  await client.query("select public.enqueue_checkout_recovery($1,$2,$3,$4,$5)", [
    "reconcile_payment",
    uniqueKey,
    dueAt,
    "payment_inquiry",
    orderId,
  ]);
}

async function claim(client, limit = 50, now = iso()) {
  return (
    await client.query("select public.claim_checkout_recovery($1,120,$2) as result", [
      limit,
      now,
    ])
  ).rows[0].result;
}

async function finish(client, job, result = "done", nextAttemptAt = null, reason = null) {
  return (
    await client.query(
      "select public.finish_checkout_recovery($1,$2,$3,$4,$5) as finished",
      [job.id, job.leaseToken, result, nextAttemptAt, reason],
    )
  ).rows[0].finished;
}

async function acquire(client, dependency = "square", limit = 4) {
  return (
    await client.query(
      "select public.acquire_checkout_dependency_lease($1,$2,120) as token",
      [dependency, limit],
    )
  ).rows[0].token;
}

async function release(client, token) {
  await client.query("select public.release_checkout_dependency_lease($1)", [token]);
}

const payload = {
  merchantId: "merchant-fixture",
  locationId: "location-fixture",
  createdAt: "2026-11-25T12:00:00.000Z",
  paymentId: "payment-fixture",
  squareOrderId: "square-order-fixture",
};
const hash = "a".repeat(64);
async function receive(client, eventId, body = payload, payloadHash = hash) {
  return (
    await client.query(
      "select public.receive_checkout_square_event($1,'payment.updated',$2,$3) as receipt",
      [eventId, payloadHash, JSON.stringify(body)],
    )
  ).rows[0].receipt;
}

async function race(connect, barrier, participants, action) {
  const clients = await Promise.all(
    Array.from({ length: participants }, () => connect("service_role")),
  );
  const pids = await Promise.all(
    clients.map(
      async (client) =>
        (await client.query("select pg_backend_pid() as pid")).rows[0].pid,
    ),
  );
  assert.equal(new Set(pids).size, participants);
  const start = barrier(participants);
  const calls = clients.map(async (client) => {
    await start.wait();
    return action(client);
  });
  start.release();
  const results = await Promise.allSettled(calls);
  const rejected = results.find(({ status }) => status === "rejected");
  if (rejected) throw rejected.reason;
  return results.map(({ value }) => value);
}

test("checkout recovery storage on the owned PostgreSQL replay", async (t) => {
  await withCheckoutDatabase(
    mode,
    async ({ admin, connect, seedOrder, barrier, populated }) => {
      const service = await connect("service_role");
      const { orderId } = populated ?? (await seedOrder());

      await t.test(
        "disjoint_claims_and_global_dependency_limit_survive_redis_outage",
        async () => {
          for (let index = 0; index < 4; index++) {
            await enqueue(service, orderId, "concurrent:" + index);
          }
          const claimed = barrier(2);
          claimed.release();
          // Neither claimant releases its row locks until both calls have returned.
          const [firstClaim, secondClaim] = await race(
            connect,
            barrier,
            2,
            async (client) => {
              await client.query("begin");
              try {
                await client.query("set local statement_timeout = '4s'");
                return await claim(client, 2);
              } finally {
                await claimed.wait();
                await client.query("commit");
              }
            },
          );
          assert.equal(firstClaim.length, 2);
          assert.equal(secondClaim.length, 2);
          assert.equal(
            firstClaim.some((a) => secondClaim.some((b) => a.id === b.id)),
            false,
          );
          for (const job of [...firstClaim, ...secondClaim]) {
            assert.equal(job.kind, "reconcile_payment");
            assert.equal(job.orderId, orderId);
            assert.equal(job.eventId, null);
            assert.equal(job.attempts, 1);
            assert.equal(await finish(service, job), true);
          }

          // The test uses independent service connections and only PostgreSQL to coordinate.
          const acquiredLeases = await race(connect, barrier, 5, (client) =>
            acquire(client),
          );
          const tokens = acquiredLeases.filter(Boolean);
          assert.equal(tokens.length, 4);
          assert.equal(new Set(tokens).size, 4);
          const {
            rows: [active],
          } = await admin.query(
            "select count(*)::int as count from public.checkout_dependency_leases where dependency = 'square' and lease_expires_at > clock_timestamp()",
          );
          assert.equal(active.count, 4);
          assert.equal(await acquire(service), null);
          for (const dependency of ["shippo", "smtp"]) {
            const otherToken = await acquire(service, dependency);
            assert.ok(otherToken);
            await release(service, otherToken);
          }
          await assert.rejects(acquire(service, "square", 5), { code: "22023" });

          const stale = tokens[0];
          await admin.query(
            "update public.checkout_dependency_leases set lease_expires_at = clock_timestamp() - interval '1 second' where lease_token = $1",
            [stale],
          );
          const [reacquirer, releaser] = await Promise.all([
            connect("service_role"),
            connect("service_role"),
          ]);
          await reacquirer.query("begin");
          const replacement = await acquire(reacquirer);
          const releaseGate = barrier(2);
          const staleRelease = releaseGate.wait().then(() => release(releaser, stale));
          const commitReplacement = releaseGate
            .wait()
            .then(() => reacquirer.query("commit"));
          releaseGate.release();
          await Promise.all([staleRelease, commitReplacement]);
          assert.ok(replacement);
          assert.notEqual(replacement, stale);
          assert.equal(await acquire(service), null);
          await release(service, replacement);
          const afterRelease = await acquire(service);
          assert.ok(afterRelease);
          await Promise.all(
            [...tokens.slice(1), afterRelease].map((token) => release(service, token)),
          );
        },
      );

      await t.test(
        "expired and reclaimed job tokens cannot finish during another claim",
        async () => {
          const originalTime = iso(-150_000);
          await enqueue(service, orderId, "interrupted", originalTime);
          const [stale] = await claim(service, 1, originalTime);
          assert.deepEqual(
            await claim(await connect("service_role"), 1, iso(300_000)),
            [],
          );
          await admin.query(
            "update public.checkout_recovery_jobs set lease_expires_at = clock_timestamp() - interval '1 second' where id = $1",
            [stale.id],
          );
          assert.equal(await finish(service, stale), false);

          const [newWorker, oldWorker] = await Promise.all([
            connect("service_role"),
            connect("service_role"),
          ]);
          await newWorker.query("begin");
          const [replacement] = await claim(newWorker, 1);
          const commitGate = barrier(2);
          const staleCompletion = commitGate.wait().then(() => finish(oldWorker, stale));
          const commit = commitGate.wait().then(() => newWorker.query("commit"));
          commitGate.release();
          const [oldFinish] = await Promise.all([staleCompletion, commit]);
          assert.equal(oldFinish, false);
          assert.equal(replacement.id, stale.id);
          assert.notEqual(replacement.leaseToken, stale.leaseToken);
          assert.equal(replacement.attempts, 2);
          assert.equal(await finish(service, stale), false);
          assert.equal(await finish(service, replacement), true);
        },
      );

      await t.test(
        "retrying poison work yields to due work and retains its own review reason",
        async () => {
          const earliest = iso(-20_000);
          await race(connect, barrier, 2, (client) =>
            enqueue(client, orderId, "poison", earliest),
          );
          await enqueue(service, orderId, "healthy", iso(-10_000));
          const [poison] = await claim(service, 1);
          assert.equal(poison.attempts, 1);
          await assert.rejects(
            finish(service, poison, "retry", iso(-1000), "provider_timeout"),
            {
              code: "22023",
            },
          );

          const later = iso(30_000);
          assert.equal(
            await finish(service, poison, "retry", later, "provider_timeout"),
            true,
          );
          const [healthy] = await claim(service, 1);
          assert.notEqual(healthy.id, poison.id);
          assert.equal(await finish(service, healthy), true);
          assert.deepEqual(await claim(service), []);
          assert.deepEqual(await claim(service, 1, later), []);
          const {
            rows: [rescheduled],
          } = await admin.query(
            "select next_attempt_at, reason from public.checkout_recovery_jobs where id = $1",
            [poison.id],
          );
          assert.deepEqual(rescheduled, {
            next_attempt_at: new Date(later),
            reason: "provider_timeout",
          });
          await admin.query(
            "update public.checkout_recovery_jobs set next_attempt_at = clock_timestamp() - interval '1 second' where id = $1",
            [poison.id],
          );
          const [retried] = await claim(service, 1);
          assert.equal(retried.id, poison.id);
          assert.equal(retried.attempts, 2);
          assert.equal(
            await finish(service, retried, "review", null, "provider_unresolved"),
            true,
          );
          await enqueue(service, orderId, "poison");
          const { rows } = await admin.query(
            "select unique_key, status, reason, lease_token, lease_expires_at from public.checkout_recovery_jobs where unique_key in ('poison','healthy') order by unique_key",
          );
          assert.deepEqual(rows, [
            {
              unique_key: "healthy",
              status: "done",
              reason: null,
              lease_token: null,
              lease_expires_at: null,
            },
            {
              unique_key: "poison",
              status: "review",
              reason: "provider_unresolved",
              lease_token: null,
              lease_expires_at: null,
            },
          ]);
        },
      );

      await t.test(
        "concurrent duplicate receipts create exactly one recoverable event",
        async () => {
          const eventId = randomUUID();
          const receipts = await race(connect, barrier, 2, (client) =>
            receive(client, eventId),
          );
          assert.deepEqual(receipts.sort(), ["duplicate", "stored"]);
          const { rows } = await admin.query(
            "select square_event_id, payload_sha256, event_data, processed_at from public.square_webhook_events where square_event_id = $1",
            [eventId],
          );
          assert.deepEqual(rows, [
            {
              square_event_id: eventId,
              payload_sha256: hash,
              event_data: payload,
              processed_at: null,
            },
          ]);
          const jobs = await claim(service);
          assert.equal(jobs.length, 1);
          const [job] = jobs;
          assert.equal(job.kind, "square_event");
          assert.equal(job.orderId, null);
          assert.equal(job.eventId, eventId);
          assert.equal(await finish(service, job), true);
          assert.equal(await receive(service, eventId), "duplicate");
          await service.query(
            "select public.enqueue_checkout_recovery('square_event','alternate-event-key',clock_timestamp(),p_event_id => $1)",
            [eventId],
          );
          assert.deepEqual(await claim(service), []);
        },
      );

      await t.test(
        "enqueue and receipt share the caller transaction, including rollback",
        async () => {
          const eventId = randomUUID();
          await service.query("begin");
          try {
            await enqueue(service, orderId, "rolled-back-order");
            assert.equal(await receive(service, eventId), "stored");
            assert.equal((await claim(service)).length, 2);
            assert.equal(
              (
                await admin.query(
                  "select 1 from public.square_webhook_events where square_event_id = $1",
                  [eventId],
                )
              ).rowCount,
              0,
            );
          } finally {
            await service.query("rollback");
          }
          assert.equal(
            (
              await admin.query(
                "select 1 from public.checkout_recovery_jobs where unique_key = 'rolled-back-order' or event_id = $1",
                [eventId],
              )
            ).rowCount,
            0,
          );
          assert.equal(await receive(service, eventId), "stored");
          const [job] = await claim(service);
          assert.equal(await finish(service, job), true);
        },
      );

      await t.test(
        "legacy processed events remain recognizable without gaining work",
        async () => {
          const eventId = randomUUID();
          const legacyPayload = { paymentStatus: "COMPLETED", amountCents: 1000 };
          const processedAt = "2026-11-25T12:01:00.000Z";
          await admin.query(
            "insert into public.square_webhook_events(square_event_id,event_type,payload_sha256,event_data,processed_at) values ($1,'payment.updated',$2,$3,$4)",
            [eventId, hash, legacyPayload, processedAt],
          );
          assert.equal(
            await receive(service, eventId, payload, "b".repeat(64)),
            "duplicate",
          );
          await service.query(
            "select public.enqueue_checkout_recovery('square_event','processed-legacy-key',clock_timestamp(),p_event_id => $1)",
            [eventId],
          );
          const {
            rows: [row],
          } = await admin.query(
            "select payload_sha256, event_data, processed_at from public.square_webhook_events where square_event_id = $1",
            [eventId],
          );
          assert.deepEqual(row, {
            payload_sha256: hash,
            event_data: legacyPayload,
            processed_at: new Date(processedAt),
          });
          assert.equal(
            (
              await admin.query(
                "select 1 from public.checkout_recovery_jobs where event_id = $1",
                [eventId],
              )
            ).rowCount,
            0,
          );
        },
      );

      if (mode === "populated") {
        await t.test(
          "suffix replay preserves both historical Square rows without queuing them",
          async () => {
            const { processed, unprocessed } = populated.legacySquareEvents;
            assert.equal(await receive(service, processed), "duplicate");
            assert.equal(await receive(service, unprocessed), "duplicate");
            const { rows } = await admin.query(
              "select square_event_id, processed_at, recovery_receipt from public.square_webhook_events where square_event_id = any($1)",
              [[processed, unprocessed]],
            );
            const historical = new Map(rows.map((row) => [row.square_event_id, row]));
            assert.deepEqual(historical.get(processed), {
              square_event_id: processed,
              processed_at: new Date("2026-09-21T12:01:00.000Z"),
              recovery_receipt: false,
            });
            assert.deepEqual(historical.get(unprocessed), {
              square_event_id: unprocessed,
              processed_at: null,
              recovery_receipt: false,
            });
            assert.equal(
              (
                await admin.query(
                  "select 1 from public.checkout_recovery_jobs where event_id = any($1)",
                  [[processed, unprocessed]],
                )
              ).rowCount,
              0,
            );
          },
        );
      }

      await t.test(
        "storage rejects unsafe receipt fields, oversized references and free-text reasons",
        async () => {
          const eventId = randomUUID();
          for (const body of [
            { ...payload, sourceId: "fixture-only" },
            { ...payload, cardDetails: { fixture: "value" } },
            { ...payload, paymentId: "a".repeat(4096) },
            { ...payload, paymentId: 123 },
            { ...payload, createdAt: "not-a-date" },
          ]) {
            await assert.rejects(receive(service, eventId, body), { code: "22023" });
          }
          await assert.rejects(receive(service, eventId, payload, "invalid"), {
            code: "22023",
          });
          await assert.rejects(
            service.query(
              "select public.enqueue_checkout_recovery('reconcile_payment','bad-reason',clock_timestamp(),'unstructured error from provider',$1)",
              [orderId],
            ),
            { code: "22023" },
          );
          assert.equal(
            (
              await admin.query(
                "select 1 from public.square_webhook_events where square_event_id = $1",
                [eventId],
              )
            ).rowCount,
            0,
          );
        },
      );

      await t.test(
        "ordinary API roles cannot access the new service-only tables and procedures",
        async () => {
          const queries = [
            ["select 1 from public.checkout_recovery_jobs limit 1", []],
            ["select 1 from public.checkout_dependency_leases limit 1", []],
            ["select 1 from public.square_webhook_events limit 1", []],
            [
              "select public.enqueue_checkout_recovery('reconcile_payment','customer-test',clock_timestamp(),null,$1)",
              [orderId],
            ],
            ["select public.claim_checkout_recovery(1,120,clock_timestamp())", []],
            [
              "select public.finish_checkout_recovery($1,$2,'done')",
              [randomUUID(), randomUUID()],
            ],
            ["select public.acquire_checkout_dependency_lease('smtp',4,120)", []],
            ["select public.release_checkout_dependency_lease($1)", [randomUUID()]],
            [
              "select public.receive_checkout_square_event($1,'payment.updated',$2,$3)",
              [randomUUID(), hash, payload],
            ],
          ];
          for (const role of ["anon", "authenticated"]) {
            const client = await connect(role);
            for (const [sql, parameters] of queries) {
              await assert.rejects(client.query(sql, parameters), { code: "42501" });
            }
          }
        },
      );
    },
  );
});
