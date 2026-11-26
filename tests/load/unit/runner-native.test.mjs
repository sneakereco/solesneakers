import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { launchWorkers, scenarioOptions } from "../operator/workers.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createCoordinator } from "../runner/bootstrap.mjs";
import { readWorkerResult } from "../operator/report.mjs";
import { createRunPlan } from "../shared/profiles.mjs";
import { parseTarget } from "../shared/contracts.mjs";
import { targetFixture } from "./fixtures.mjs";
const binary =
    process.env.K6_BINARY ?? resolve(".load-test/tools/k6-v2.4.0-windows-amd64/k6.exe"),
  available = await access(binary).then(
    () => true,
    () => false,
  );
test(
  "two actual k6 iterations retain rotated customer auth and reset guest state",
  { skip: !available },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "sole auth iterations ")),
      seen = [];
    const server = createServer((req, res) => {
      seen.push(req.headers.cookie ?? "");
      res.setHeader("Set-Cookie", [
        "sb-fixture-auth-token=rotated; Path=/",
        "cart=old; Path=/",
      ]);
      res.end("{}");
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const url = `http://127.0.0.1:${server.address().port}`,
        path = join(directory, "cookies.js"),
        modulePath = resolve("tests/load/k6/lib/http.js").replaceAll("\\", "/"),
        options = {
          noCookiesReset: scenarioOptions(
            { measurementSeconds: 1, gracefulStopSeconds: 1, profile: "smoke" },
            { start: 0, end: 1 },
          ).noCookiesReset,
          vus: 1,
          iterations: 2,
        };
      await writeFile(
        path,
        `import http from 'k6/http';import * as cookies from ${JSON.stringify(modulePath)};export const options=${JSON.stringify(options)};let initialized=false;export default function(){const config={baseUrl:${JSON.stringify(url)}},identity={cookies:[{name:'sb-fixture-auth-token',value:'initial'}]};if(!initialized){cookies.initializeCookies(config,identity);initialized=true;}cookies.resetSessionCookies?.(config,identity);http.get(config.baseUrl+'/session');}`,
      );
      await promisify(execFile)(binary, ["run", "--quiet", path], {
        windowsHide: true,
        timeout: 15000,
      });
      assert.equal(seen.length, 2);
      assert.match(seen[0], /sb-fixture-auth-token=initial/);
      assert.match(seen[1], /sb-fixture-auth-token=rotated/);
      assert.ok(!seen[1].includes("cart=old"));
    } finally {
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
      await rm(directory, { recursive: true, force: true });
    }
  },
);
test(
  "two actual generators share one barrier and disjoint eight-slot budget with paths containing spaces",
  { skip: !available },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "sole load workers ")),
      id = "22222222-2222-4222-8222-222222222222";
    const server = createServer(async (req, res) => {
      for await (const chunk of req) void chunk;
      const path = new URL(req.url, "http://fixture").pathname;
      let value;
      res.setHeader("Content-Type", "application/json");
      if (path.endsWith("/quote"))
        value = {
          completeness: "exact",
          quoteFingerprint: "a".repeat(64),
          totals: { totalCents: 1000 },
        };
      else if (path.endsWith("/prepare")) {
        res.statusCode = 201;
        value = {
          orderId: id,
          totals: { totalCents: 1000 },
          guestAccessToken: "private",
        };
      } else if (path.endsWith("/payment-permit")) value = { permit: "private" };
      else if (path.endsWith("/pay"))
        value = { orderId: id, status: "COMPLETED", paymentId: "fake" };
      else if (path.startsWith("/api/orders/")) value = { id, status: "paid" };
      else if (path.endsWith("/validate"))
        value = { items: [{ productId: id, variantId: id, quantity: 1 }], removed: [] };
      else if (path.startsWith("/api/store/")) value = { products: [], total: 0 };
      else {
        res.setHeader("Content-Type", "text/html");
        value = "<!doctype html><html>Fixture</html>";
      }
      res.end(typeof value === "string" ? value : JSON.stringify(value));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const plan = {
      ...createRunPlan(parseTarget(targetFixture()), "smoke"),
      totalSlots: 8,
      httpSlots: 8,
      browserSlots: 0,
      measurementSeconds: 1,
      gracefulStopSeconds: 2,
      sessionSeconds: [0.2, 0.2],
      pauses: { browse: [0.05, 0.05], cart: [0.01, 0.01], checkout: [0.01, 0.01] },
    };
    const coordinator = await createCoordinator(plan, {
      workerCount: 2,
      releaseDelayMs: 50,
    });
    let handles = [];
    try {
      const fixtures = {
        products: [{ id, variantId: id, name: "Fixture", hot: false }],
        addresses: [
          {
            name: "Load",
            phone: "2025550100",
            line1: "1 Test Avenue",
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
      };
      handles = await launchWorkers(plan, fixtures, {
        artifactDir: directory,
        k6Binary: binary,
        target: { baseUrl: `http://127.0.0.1:${server.address().port}` },
        credential: "fixture",
        workerCount: 2,
        phaseStart: Date.now() + 30000,
        coordinator,
      });
      plan.measurementStart = await coordinator.waitForRelease();
      plan.measurementEnd = plan.measurementStart + 1000;
      await Promise.all(handles.map((x) => x.ready));
      const completions = await Promise.all(handles.map((x) => x.done));
      assert.deepEqual(
        completions.map((x) => x.exitCode),
        [0, 0],
      );
      const results = await Promise.all(
        completions.map((x) => readWorkerResult(x, plan)),
      );
      assert.equal(handles[0].shard.end, handles[1].shard.start);
      assert.equal(handles[1].shard.end, 8);
      assert.ok(results.every((x) => x.completed > 0 && x.errors.length === 0));
      assert.ok(
        results.every((x) => Math.max(...x.activeSamples.map((v) => v.slots)) === 4),
      );
    } finally {
      await Promise.allSettled(handles.map((x) => x.stop()));
      await coordinator.close();
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
      await rm(directory, { recursive: true, force: true });
    }
  },
);
