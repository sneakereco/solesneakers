import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync, statSync } from "node:fs";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { resolveObserverRelease } from "../../scripts/resolve-analytics-observer-release.mjs";
import { runObservers } from "../../scripts/run-admin-analytics-observers.mjs";

const env = {
  ANALYTICS_OBSERVER_PROBES_APPROVED: "true",
  ANALYTICS_OBSERVER_ATTESTATION: JSON.stringify({
    environment: "staging",
    projectId: "501",
    region: "https://us.posthog.com",
    activationInstant: "2026-12-01T12:00:00Z",
    geoIpDisabled: true,
    sourceAndDefinitionsVerified: true,
  }),
  NEXT_PUBLIC_MEASUREMENT_ENVIRONMENT: "staging",
  NEXT_PUBLIC_POSTHOG_ENABLED: "false",
  POSTHOG_API_HOST: "https://us.posthog.com",
  POSTHOG_PROJECT_ID: "501",
  POSTHOG_OWNER_STAGING_PROJECT_ID: "501",
  POSTHOG_OWNER_PRODUCTION_PROJECT_ID: "502",
  UPSTASH_REDIS_REST_TOKEN: "shared-test-token",
  DOPPLER_TOKEN: "DOPPLER_SERVICE_CANARY",
  POSTHOG_PROVISIONING_KEY: "PROVISION_KEY_CANARY",
  SUPABASE_DB_URL: "DB_OWNER_CANARY",
};

function harness(scenario) {
  let at = 0;
  const events = [];
  const invocations = [];
  let running = false;
  let attestationPath;
  const finish = (child, code) => {
    running = false;
    child.emit("close", code);
  };
  const clock = {
    now: () => at,
    sleep: async (ms) => {
      at += ms;
    },
    setTimer: (callback, ms) => {
      const event = { callback, at: at + ms };
      events.push(event);
      return event;
    },
    clearTimer: (event) => {
      if (event) event.cancelled = true;
    },
  };
  const spawn = (exe, args, options) => {
    assert.equal(exe, process.execPath);
    assert.equal(running, false, "observer children overlapped");
    running = true;
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.pid = 151;
    const source = args[args.indexOf("--source") + 1];
    invocations.push({ source, at, options });
    const action = scenario?.(source, at) ?? {};
    if (source === "native") {
      attestationPath = args[args.indexOf("--attestation") + 1];
      assert.deepEqual(
        JSON.parse(readFileSync(attestationPath, "utf8")),
        JSON.parse(env.ANALYTICS_OBSERVER_ATTESTATION),
      );
      if (process.platform !== "win32")
        assert.equal(statSync(attestationPath).mode & 0o777, 0o600);
    }
    child.kill = (signal) => {
      assert.equal(signal, "SIGKILL");
      if (!action.unconfirmed) finish(child, null);
    };
    queueMicrotask(() => {
      if (action.hang) {
        while (running) {
          const next = events.find((event) => !event.cancelled);
          assert.ok(next);
          next.cancelled = true;
          at = next.at;
          next.callback();
          if (action.unconfirmed && !events.some((event) => !event.cancelled)) break;
        }
      } else if (action.overflow) {
        child.stdout.write("CUSTOMER_DATA_CANARY".repeat(1000));
      } else {
        at += action.duration ?? 0;
        finish(child, action.code ?? 0);
      }
    });
    return child;
  };
  return {
    run: (settings = env) =>
      runObservers({
        environment: "staging",
        run: true,
        env: settings,
        clock,
        spawn,
      }),
    invocations,
    attestationPath: () => attestationPath,
  };
}

test("actual dry-run CLI has a credential-free preview and performs no child work", () => {
  const cli = spawnSync(
    process.execPath,
    ["scripts/run-admin-analytics-observers.mjs", "--environment", "staging"],
    { env: {}, encoding: "utf8", timeout: 5000 },
  );
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(JSON.parse(cli.stdout).status, "dry-run");
});

test("an explicit run skips probes when owner opt-in or attestation is absent or mismatched", async () => {
  const h = harness();
  for (const settings of [
    {},
    { ...env, ANALYTICS_OBSERVER_PROBES_APPROVED: "false" },
    { ...env, ANALYTICS_OBSERVER_ATTESTATION: undefined },
    { ...env, POSTHOG_PROJECT_ID: "502" },
    { ...env, POSTHOG_API_HOST: "https://other.example" },
    {
      ...env,
      ANALYTICS_OBSERVER_ATTESTATION: JSON.stringify({
        ...JSON.parse(env.ANALYTICS_OBSERVER_ATTESTATION),
        geoIpDisabled: false,
      }),
    },
    {
      ...env,
      ANALYTICS_OBSERVER_ATTESTATION: JSON.stringify({
        ...JSON.parse(env.ANALYTICS_OBSERVER_ATTESTATION),
        activationInstant: "2026-02-30T00:00:00Z",
      }),
    },
  ]) {
    assert.equal((await h.run(settings)).status, "skipped");
  }
  assert.deepEqual(h.invocations, []);
  assert.equal(h.attestationPath(), undefined);
});

test("uses the 240-second window and sequential cadence while a native failure leaves warehouse running", async () => {
  const h = harness((source) =>
    source === "native" ? { duration: 500, code: 1 } : { duration: 100 },
  );
  const result = await h.run();
  assert.equal(result.status, "failed");
  assert.equal(result.native.failed, 2);
  assert.deepEqual(
    h.invocations.filter((item) => item.source === "native").map((item) => item.at),
    [0, 180000],
  );
  const warehouse = h.invocations.filter((item) => item.source === "warehouse");
  assert.ok(warehouse.length >= 20 && warehouse.length <= 24);
  assert.equal(warehouse[0].at, 500);
  assert.ok(warehouse.at(-1).at < 240000);
  assert.ok(warehouse.slice(1).every((item, i) => item.at - warehouse[i].at >= 10000));
  assert.equal(warehouse[0].options.env.NEXT_PUBLIC_POSTHOG_ENABLED, undefined);
  assert.equal(h.invocations[0].options.env.NEXT_PUBLIC_POSTHOG_ENABLED, "true");
  for (const invocation of h.invocations) {
    assert.equal(invocation.options.env.UPSTASH_REDIS_REST_TOKEN, "shared-test-token");
    for (const variable of [
      "DOPPLER_TOKEN",
      "POSTHOG_PROVISIONING_KEY",
      "SUPABASE_DB_URL",
      "ANALYTICS_OBSERVER_ATTESTATION",
    ])
      assert.equal(invocation.options.env[variable], undefined);
  }
  assert.equal(existsSync(h.attestationPath()), false);
});

test("output overflow and child timeouts kill workers, redact output and permit a later warehouse attempt", async () => {
  let earlyNative = true;
  const h = harness((source, at) => {
    if (source === "native" && earlyNative) {
      earlyNative = false;
      return { overflow: true };
    }
    return source === "warehouse" && at === 0 ? { hang: true } : {};
  });
  const result = await h.run();
  assert.equal(result.status, "failed");
  assert.equal(result.native.failed, 1);
  assert.equal(result.warehouse.failed, 1);
  assert.equal(result.failures["output-limit"], 1);
  assert.equal(result.failures.timeout, 1);
  assert.doesNotMatch(JSON.stringify(result), /CUSTOMER_DATA_CANARY|shared-test-token/);
  assert.equal(h.invocations[2].source, "warehouse");
  assert.equal(h.invocations[2].at, 35000);
});

test("if a timed-out child never confirms exit, stops the window to prevent overlap", async () => {
  const h = harness(() => ({ hang: true, unconfirmed: true }));
  const result = await h.run();
  assert.equal(result.failures["exit-unconfirmed"], 1);
  assert.equal(result.status, "failed");
  assert.equal(h.invocations.length, 1);
  assert.equal(existsSync(h.attestationPath()), false);
});

test("production release resolution uses an exact version tag descended from main", () => {
  const commit = "a".repeat(40);
  const calls = [];
  const git = (args) => {
    calls.push(args);
    return args[0] === "rev-parse" ? commit + "\n" : "";
  };
  const invalidTags = [
    "main",
    "refs/tags/v1.2.3",
    "v01.2.3",
    "v1.2.3\n",
    "v1.2.3^",
    "--help",
    "",
  ];
  for (const version of invalidTags)
    assert.throws(() => resolveObserverRelease(version, git), /tag/);
  assert.deepEqual(calls, []);
  assert.equal(resolveObserverRelease("v1.2.3-beta.4", git), commit);
  assert.deepEqual(calls, [
    ["rev-parse", "--verify", "refs/tags/v1.2.3-beta.4^{commit}"],
    ["merge-base", "--is-ancestor", commit, "refs/remotes/origin/main"],
  ]);
  for (const failure of ["rev-parse", "merge-base"]) {
    assert.throws(
      () =>
        resolveObserverRelease("v1.2.3", (args) => {
          if (args[0] === failure) throw Error("git output canary");
          return git(args);
        }),
      (error) => !/git output canary/.test(error.message),
    );
  }
});
