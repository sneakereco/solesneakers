import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkAndSyncDeployment,
  checkDeployment,
  pairingFingerprint,
} from "../../scripts/check-analytics-deployment.mjs";

const project = {
  projectId: "prj_ROOpjgDuPj2405JzeR1yG4iRtFMf",
  orgId: "team_yj8Rl9ibCXwtdttRrYPhnLcD",
};
const publicEnv = {
  NEXT_PUBLIC_POSTHOG_ENABLED: "true",
  NEXT_PUBLIC_MEASUREMENT_ENVIRONMENT: "production",
  NEXT_PUBLIC_POSTHOG_PROJECT_KEY: "fixture-public-key",
  NEXT_PUBLIC_POSTHOG_HOST: "https://capture.example.com",
};
const privateEnv = {
  POSTHOG_API_HOST: "https://api.example.com",
  POSTHOG_PROJECT_ID: "123",
  POSTHOG_QUERY_API_KEY: "fixture-query-key",
  ANALYTICS_IDENTITY_SECRET: 'fixture-"identity"-key',
};
const protectedEnv = Object.fromEntries(
  Object.keys(privateEnv).map((key) => [key, "[SENSITIVE]"]),
);
const env = {
  ...publicEnv,
  ...privateEnv,
  ANALYTICS_VERIFIED_PAIRING: pairingFingerprint({
    environment: publicEnv.NEXT_PUBLIC_MEASUREMENT_ENVIRONMENT,
    apiHost: privateEnv.POSTHOG_API_HOST,
    projectId: privateEnv.POSTHOG_PROJECT_ID,
    host: publicEnv.NEXT_PUBLIC_POSTHOG_HOST,
    projectKey: publicEnv.NEXT_PUBLIC_POSTHOG_PROJECT_KEY,
  }),
  VERCEL_TOKEN: "fixture-vercel-token",
  VERCEL_PROJECT_ID: project.projectId,
  VERCEL_ORG_ID: project.orgId,
};
const records = Object.keys(privateEnv).map((key, index) => ({
  id: "env-" + index,
  key,
  target: ["production"],
  type: "sensitive",
  visibility: "secret",
  configurationId: "icfg_lbw5Z4UVhVWQkQsAyvJzSgYY",
}));

function provider(rows = records, write = (row) => Response.json(row)) {
  const calls = [];
  const fetch = async (input, init) => {
    const url = new URL(input);
    calls.push({ url, init });
    if (init.method === "GET") return Response.json({ envs: rows });
    return write(rows.find((row) => url.pathname.endsWith("/" + row.id)));
  };
  return { fetch, calls };
}

for (const [name, deployed] of [
  ["omitted", publicEnv],
  ["redacted", { ...publicEnv, ...protectedEnv }],
]) {
  test(`writes exact Doppler values to existing production Secret IDs for ${name} private values`, async () => {
    const { fetch, calls } = provider();
    await checkAndSyncDeployment("production", env, deployed, { project, fetch });
    assert.equal(calls.length, 5);
    assert.equal(calls[0].url.pathname, "/v10/projects/" + project.projectId + "/env");
    assert.equal(calls[0].url.searchParams.get("decrypt"), "false");
    for (const [index, row] of records.entries()) {
      const { url, init } = calls[index + 1];
      assert.equal(url.origin, "https://api.vercel.com");
      assert.equal(url.pathname, "/v9/projects/" + project.projectId + "/env/" + row.id);
      assert.equal(url.searchParams.get("teamId"), project.orgId);
      assert.equal(init.method, "PATCH");
      assert.equal(init.redirect, "error");
      assert.deepEqual(JSON.parse(init.body), { value: privateEnv[row.key] });
      assert.equal(url.href.includes(privateEnv[row.key]), false);
    }
  });
}

test("accepts Vercel redactions for private settings in the pairing check", () => {
  checkDeployment("production", env, { ...publicEnv, ...protectedEnv });
});

test("keeps readable and disabled configurations on the existing verification path", async () => {
  const { fetch, calls } = provider();
  await checkAndSyncDeployment(
    "production",
    env,
    { ...publicEnv, ...privateEnv },
    { fetch },
  );
  await checkAndSyncDeployment(
    "production",
    { ...env, NEXT_PUBLIC_POSTHOG_ENABLED: "false" },
    { NEXT_PUBLIC_POSTHOG_ENABLED: "false" },
    { fetch },
  );
  assert.equal(calls.length, 0);
});

for (const [name, candidateEnv, deployed, linked] of [
  [
    "wrong public pairing",
    { ...env, ANALYTICS_VERIFIED_PAIRING: "wrong" },
    publicEnv,
    project,
  ],
  [
    "public mismatch",
    env,
    { ...publicEnv, NEXT_PUBLIC_POSTHOG_HOST: "https://wrong.example.com" },
    project,
  ],
  [
    "public redaction",
    env,
    { ...publicEnv, ...protectedEnv, NEXT_PUBLIC_POSTHOG_PROJECT_KEY: "[SENSITIVE]" },
    project,
  ],
  [
    "readable private mismatch alongside redactions",
    env,
    { ...publicEnv, ...protectedEnv, POSTHOG_QUERY_API_KEY: "wrong" },
    project,
  ],
  [
    "redacted Doppler value",
    { ...env, POSTHOG_QUERY_API_KEY: "[SENSITIVE]" },
    publicEnv,
    project,
  ],
  ["wrong linked project", env, publicEnv, { ...project, projectId: "prj_wrong" }],
  ["wrong linked team", env, publicEnv, { ...project, orgId: "team_wrong" }],
  [
    "wrong allowlisted project",
    { ...env, VERCEL_PROJECT_ID: "prj_wrong" },
    publicEnv,
    { ...project, projectId: "prj_wrong" },
  ],
]) {
  test(name + " stops before any API request", async () => {
    const { fetch, calls } = provider();
    await assert.rejects(() =>
      checkAndSyncDeployment("production", candidateEnv, deployed, {
        project: linked,
        fetch,
      }),
    );
    assert.equal(calls.length, 0);
  });
}

const [first, ...rest] = records;
for (const [name, rows] of [
  ["wrong Secret visibility", [{ ...first, visibility: "config" }, ...rest]],
  ["wrong target", [{ ...first, target: ["preview"] }, ...rest]],
  ["multi-target row", [{ ...first, target: ["production", "preview"] }, ...rest]],
  ["branch target", [{ ...first, gitBranch: "feature" }, ...rest]],
  ["custom target", [{ ...first, customEnvironmentIds: ["env_custom"] }, ...rest]],
  ["wrong integration", [{ ...first, configurationId: "icfg_other" }, ...rest]],
  ["shared Secret", [{ ...first, sharedEnvVarId: "shared_1" }, ...rest]],
  ["shared Secret alias", [{ ...first, sharedEnvVariableId: "shared_1" }, ...rest]],
  ["duplicate runtime row", [...records, { ...first, id: "env-duplicate" }]],
  ["operator Secret", [...records, { ...first, key: "POSTHOG_OPERATOR_API_KEY" }]],
]) {
  test(name + " stops before the first write", async () => {
    const { fetch, calls } = provider(rows);
    await assert.rejects(() =>
      checkAndSyncDeployment("production", env, publicEnv, { project, fetch }),
    );
    assert.deepEqual(
      calls.map(({ init }) => init.method),
      ["GET"],
    );
  });
}

for (const [name, reply] of [
  [
    "failed write",
    () => new Response(privateEnv.ANALYTICS_IDENTITY_SECRET, { status: 403 }),
  ],
  ["unexpected receipt", (row) => Response.json({ ...row, visibility: "config" })],
  ["changed owner", (row) => Response.json({ ...row, configurationId: null })],
]) {
  test(name + " fails closed without including the write response", async () => {
    const { fetch, calls } = provider(records, reply);
    await assert.rejects(
      () => checkAndSyncDeployment("production", env, publicEnv, { project, fetch }),
      (error) => !String(error).includes(privateEnv.ANALYTICS_IDENTITY_SECRET),
    );
    assert.deepEqual(
      calls.map(({ init }) => init.method),
      ["GET", "PATCH"],
    );
  });
}
