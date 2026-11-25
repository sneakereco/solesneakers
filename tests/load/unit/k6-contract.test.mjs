import test from "node:test";
import { readWorkerResult } from "../operator/report.mjs";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRunPlan } from "../shared/profiles.mjs";
import { parseTarget } from "../shared/contracts.mjs";
import { targetFixture } from "./fixtures.mjs";
import { scenarioOptions, allocateWorkers } from "../operator/workers.mjs";
const binary =
  process.env.K6_BINARY ?? resolve(".load-test/tools/k6-v2.4.0-windows-amd64/k6.exe");
const available = await access(binary).then(
  () => true,
  () => false,
);
const exec = promisify(execFile);
test(
  "real k6 inspect and local HTTP contract smoke, then deliberate HTTP failures",
  { skip: !available },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "sole-k6-contract-"));
    let forced = 0,
      preparations = 0;
    const id = "22222222-2222-4222-8222-222222222222";
    const server = createServer(async (req, res) => {
      for await (const chunk of req) {
        void chunk;
      }
      const path = new URL(req.url, "http://fixture").pathname;
      res.setHeader("content-type", "application/json");
      let data;
      if (path.endsWith("/quote"))
        data = {
          completeness: "exact",
          quoteFingerprint: "a".repeat(64),
          totals: { totalCents: 1000 },
        };
      else if (path.endsWith("/prepare")) {
        preparations++;
        res.statusCode = forced || 201;
        data = {
          orderId: id,
          totals: { totalCents: 1000 },
          guestAccessToken: "private-fixture",
        };
      } else if (path.endsWith("/payment-permit")) data = { permit: "private-fixture" };
      else if (path.endsWith("/pay"))
        data = { orderId: id, status: "COMPLETED", paymentId: "fake" };
      else if (path.startsWith("/api/orders/")) data = { id, status: "paid" };
      else if (path.endsWith("/validate"))
        data = { items: [{ productId: id, variantId: id, quantity: 1 }], removed: [] };
      else if (path.startsWith("/api/store/")) data = { products: [], total: 0 };
      else {
        res.setHeader("content-type", "text/html");
        data = "<!doctype html><html>Fixture</html>";
      }
      res.end(typeof data === "string" ? data : JSON.stringify(data));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(async () => {
      server.close();
      await rm(directory, { recursive: true, force: true });
    });
    const plan = createRunPlan(parseTarget(targetFixture()), "smoke");
    plan.sessionSeconds = [0.01, 0.01];
    plan.pauses = { browse: [0, 0], cart: [0, 0], checkout: [0, 0] };
    plan.deadline = new Date(Date.now() + 60000).toISOString();
    const shard = allocateWorkers(plan, 1)[0],
      config = {
        plan,
        shard,
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        credential: "local-fixture-only",
        phaseStart: Date.now(),
        fixtures: {
          products: [{ id, variantId: id, name: "Local fixture", hot: false }],
          addresses: [
            {
              name: "Load Buyer",
              phone: "2025550100",
              line1: "1 Test Avenue",
              line2: "",
              city: "Columbia",
              state: "SC",
              postalCode: "29201",
              country: "US",
            },
          ],
          sessions: Array.from({ length: 8 }, (_, slot) => ({
            slot,
            accountId: null,
            cookies: [],
          })),
        },
        options: scenarioOptions(plan, shard),
      };
    config.options.scenarios.shoppers = {
      executor: "shared-iterations",
      vus: 8,
      iterations: 8,
      maxDuration: "30s",
      exec: "shopperSession",
    };
    const file = join(directory, "private.json");
    await writeFile(file, JSON.stringify(config), { mode: 0o600 });
    const env = { ...process.env, LOAD_RUN_CONFIG: file, K6_NO_USAGE_REPORT: "true" };
    for (const script of ["shopping.js", "arrival.js"])
      await exec(
        binary,
        ["inspect", "--env", `LOAD_RUN_CONFIG=${file}`, resolve("tests/load/k6", script)],
        { env, windowsHide: true },
      );
    const nativeOutput = join(directory, "native-metrics.gz");
    await exec(
      binary,
      [
        "run",
        "--quiet",
        "--out",
        `json=${nativeOutput}`,
        "--env",
        `LOAD_RUN_CONFIG=${file}`,
        resolve("tests/load/k6/shopping.js"),
      ],
      { env, windowsHide: true, timeout: 45000 },
    );
    const native = await readWorkerResult(
      { output: nativeOutput, workerId: "http-0", exitCode: 0, finishedAt: Date.now() },
      plan,
    );
    assert.equal(native.errors.length, 0);
    assert.equal(native.offered, 8);
    assert.equal(native.completed, 8);
    assert.ok(
      native.operations.some((x) => x.operation === "prepare" && x.histogram.count > 0),
    );
    for (const code of [403, 429]) {
      forced = code;
      await assert.rejects(
        exec(
          binary,
          [
            "run",
            "--quiet",
            "--env",
            `LOAD_RUN_CONFIG=${file}`,
            resolve("tests/load/k6/shopping.js"),
          ],
          { env, windowsHide: true, timeout: 45000 },
        ),
        (error) => error.code === 99,
      );
    }
    const normal = JSON.parse(JSON.stringify(config));
    config.plan.httpSlots = 1;
    config.plan.totalSlots = 2;
    config.plan.sessionSeconds = [0.2, 0.2];
    config.shard.end = 1;
    config.fixtures.sessions = config.fixtures.sessions.slice(0, 1);
    config.phaseStart = Date.now();
    config.options.scenarios.shoppers = {
      executor: "constant-vus",
      vus: 1,
      duration: "1s",
      gracefulStop: "1s",
      exec: "shopperSession",
    };
    preparations = 0;
    forced = 403;
    await writeFile(file, JSON.stringify(config), { mode: 0o600 });
    await assert.rejects(
      exec(
        binary,
        [
          "run",
          "--quiet",
          "--env",
          `LOAD_RUN_CONFIG=${file}`,
          resolve("tests/load/k6/shopping.js"),
        ],
        { env, windowsHide: true, timeout: 15000 },
      ),
      (error) => error.code === 99,
    );
    assert.ok(
      preparations <= 6,
      `Failed sessions multiplied intended load: ${preparations} attempts`,
    );
    Object.assign(config, normal);
    forced = 0;
    config.plan.profile = "rush";
    config.plan.contenders = 3;
    config.plan.contentionKind = "purchase";
    config.plan.measurementSeconds = 1;
    config.fixtures.products.push({ ...config.fixtures.products[0], hot: true });
    config.options.scenarios.shoppers.exec = "rushSession";
    config.phaseStart = Date.now() + 1500;
    await writeFile(file, JSON.stringify(config), { mode: 0o600 });
    await exec(
      binary,
      ["inspect", "--env", `LOAD_RUN_CONFIG=${file}`, resolve("tests/load/k6/rush.js")],
      { env, windowsHide: true },
    );
    await exec(
      binary,
      [
        "run",
        "--quiet",
        "--env",
        `LOAD_RUN_CONFIG=${file}`,
        resolve("tests/load/k6/rush.js"),
      ],
      { env, windowsHide: true, timeout: 45000 },
    );
  },
);
