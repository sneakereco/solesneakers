import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveObserverDeployment } from "../../scripts/resolve-analytics-observer-deployment.mjs";

const repo = "shop/store";
const repository = { full_name: repo };
const token = "github-token-canary";
const olderSha = "a".repeat(40);
const newerSha = "b".repeat(40);
const workflowPath = ".github/workflows/production.yml";
const runList =
  "https://api.github.com/repos/shop/store/actions/workflows/production.yml/runs?event=push&status=success&per_page=100";
const jobsUrl = (run) =>
  `https://api.github.com/repos/shop/store/actions/runs/${run.id}/jobs?filter=${run.run_attempt === 1 ? "latest" : "all"}&per_page=100`;

const newer = {
  id: 200,
  event: "push",
  status: "completed",
  conclusion: "success",
  path: workflowPath,
  head_branch: "v1.2.3-beta.11",
  head_sha: newerSha,
  repository,
  head_repository: repository,
  run_attempt: 1,
  updated_at: "2026-11-27T00:11:00Z",
};
const older = {
  ...newer,
  id: 100,
  path: `${workflowPath}@refs/tags/v1.2.3-beta.10`,
  head_branch: "v1.2.3-beta.10",
  head_sha: olderSha,
  updated_at: "2026-11-27T00:10:00Z",
};

const validJobs = (run) =>
  ["validate-release", "migrate", "deploy", "verify"].map((name, i) => ({
    run_id: run.id,
    head_sha: run.head_sha,
    name,
    status: "completed",
    conclusion: "success",
    completed_at: new Date(Date.parse(run.updated_at) - (3 - i) * 1000)
      .toISOString()
      .replace(".000Z", "Z"),
  }));

function harness({
  runs = [newer],
  expectedRun = runs[0],
  jobs = validJobs(expectedRun),
  runResponse = Response.json({ total_count: runs.length, workflow_runs: runs }),
  jobsResponse = Response.json({ total_count: jobs.length, jobs }),
  missingFile,
  ancestryError,
  resolvedCommit,
  triggerRun,
  previousJobSets = [],
} = {}) {
  const requests = [];
  const gitCalls = [];
  return {
    requests,
    gitCalls,
    resolve: () =>
      resolveObserverDeployment({
        repository: repo,
        token,
        triggerRun,
        fetch: async (url, options) => {
          requests.push({ url: String(url), options });
          if (String(url) === runList) return runResponse;
          if (String(url) === jobsUrl(expectedRun)) return jobsResponse;
          for (const run of previousJobSets) {
            if (String(url) !== jobsUrl(run)) continue;
            const jobs = validJobs(run);
            return Response.json({ total_count: jobs.length, jobs });
          }
          throw Error("unexpected fixture URL");
        },
        git: (args) => {
          gitCalls.push(args);
          if (args[0] === "rev-parse") {
            assert.match(args[2], /^refs\/tags\/v1\.2\.3-beta\.1[01]\^\{commit\}$/);
            return resolvedCommit ?? (args[2].includes("beta.10") ? olderSha : newerSha);
          }
          if (args[0] === "merge-base" && ancestryError) throw Error(token);
          if (args[0] === "ls-tree") {
            if (args[4] === missingFile) return "";
            return `100644 blob ${"c".repeat(40)}\t${args[4]}\n`;
          }
          return "";
        },
      }),
  };
}

test("selects the latest successful deployment by completion rather than list order", async () => {
  const h = harness({ runs: [older, newer], expectedRun: newer });
  assert.deepEqual(await h.resolve(), {
    commit: newerSha,
    tag: newer.head_branch,
    runId: 200,
  });
  assert.deepEqual(
    h.requests.map((request) => request.url),
    [runList, jobsUrl(newer)],
  );
  for (const { options } of h.requests) {
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
  }
});

test("a successful full rerun of an older tag supersedes a newer tag", async () => {
  const rerun = { ...older, run_attempt: 2, updated_at: "2026-11-27T00:12:00Z" };
  const h = harness({
    runs: [newer, rerun],
    expectedRun: rerun,
    jobs: [...validJobs(older), ...validJobs(rerun)],
    triggerRun: newer,
  });
  assert.deepEqual(await h.resolve(), {
    commit: olderSha,
    tag: older.head_branch,
    runId: 100,
  });
});

test("rerunning verification alone does not make an older deployment current", async () => {
  const rerun = { ...older, run_attempt: 2, updated_at: "2026-11-27T00:12:00Z" };
  const h = harness({
    runs: [newer, rerun],
    expectedRun: rerun,
    jobs: [...validJobs(older), validJobs(rerun).at(-1)],
    previousJobSets: [newer],
  });
  assert.deepEqual(await h.resolve(), {
    commit: newerSha,
    tag: newer.head_branch,
    runId: 200,
  });
  assert.deepEqual(
    h.requests.map((request) => request.url),
    [runList, jobsUrl(rerun), jobsUrl(newer)],
  );
});

test("missing, failed, or paginated verification fails without falling back to an older run", async () => {
  for (const options of [
    { jobs: validJobs(newer).slice(0, 3) },
    {
      jobs: validJobs(newer).map((job) =>
        job.name === "verify" ? { ...job, conclusion: "failure" } : job,
      ),
    },
    { jobsResponse: Response.json({ total_count: 5, jobs: validJobs(newer) }) },
    {
      jobsResponse: Response.json(
        { total_count: 4, jobs: validJobs(newer) },
        { headers: { Link: `<${jobsUrl(newer)}&page=2>; rel="next"` } },
      ),
    },
    { jobs: validJobs(newer).map((job) => ({ ...job, run_id: older.id })) },
  ]) {
    const h = harness({ runs: [newer, older], ...options });
    await assert.rejects(h.resolve(), /deployment jobs/);
    assert.equal(h.requests.length, 2);
  }
});

test("rejects untrusted or malformed run metadata", async () => {
  for (const fields of [
    { repository: { full_name: "other/store" } },
    { head_repository: { full_name: "other/store" } },
    { head_sha: "HEAD" },
    { id: "200" },
    { path: `${workflowPath}.disabled` },
    { path: `${workflowPath}@refs/heads/main` },
    { event: "workflow_dispatch" },
    { status: "in_progress" },
    { conclusion: "failure" },
    { updated_at: "2026-02-30T00:11:00Z" },
    { run_attempt: 0 },
  ]) {
    const h = harness({ runs: [{ ...newer, ...fields }, older] });
    await assert.rejects(h.resolve(), /production deployment run/);
    assert.equal(h.requests.length, 1);
    assert.deepEqual(h.gitCalls, []);
  }
});

test("rejects a moved tag, non-main commit, or a tag outside the release syntax", async () => {
  await assert.rejects(harness({ resolvedCommit: olderSha }).resolve(), /does not match/);
  await assert.rejects(harness({ ancestryError: true }).resolve(), /main history/);
  for (const tag of ["main", "refs/tags/v1.2.3", "v1.2.3-beta.11^", "v1.2.3\n"]) {
    const h = harness({ runs: [{ ...newer, head_branch: tag }] });
    await assert.rejects(h.resolve(), /semantic-version tag/);
    assert.deepEqual(h.gitCalls, []);
  }
});

test("a production completion trigger must itself be a normal push of a trusted matching tag", async () => {
  for (const triggerRun of [
    { ...newer, head_branch: "version-job" },
    { ...newer, head_sha: olderSha },
    { ...newer, path: ".github/workflows/staging.yml" },
  ]) {
    const h = harness({ triggerRun });
    await assert.rejects(
      h.resolve(),
      /production deployment run|semantic-version tag|does not match/,
    );
    assert.deepEqual(h.requests, []);
  }
});

test("requires the observer runner and clock migration in the deployed commit tree", async () => {
  for (const missingFile of [
    "scripts/run-admin-analytics-observers.mjs",
    "supabase/migrations/20261127135000_analytics_observer_clock.sql",
  ]) {
    const h = harness({ missingFile });
    await assert.rejects(h.resolve(), /observer runner and clock migration/);
    assert.ok(h.gitCalls.some((args) => args[0] === "ls-tree" && args[2] === newerSha));
  }
});

test("GitHub failures, redirects and malformed JSON redact secrets and response bodies", async () => {
  for (const status of [302, 401, 403, 500]) {
    const h = harness({ runResponse: new Response(token, { status }) });
    await assert.rejects(
      h.resolve(),
      (error) =>
        error.message.includes(`HTTP ${status}`) && !error.message.includes(token),
    );
  }
  const h = harness({ runResponse: new Response(`{"data":"${token}`) });
  await assert.rejects(
    h.resolve(),
    (error) => /invalid JSON/.test(error.message) && !error.message.includes(token),
  );
  await assert.rejects(
    resolveObserverDeployment({
      repository: repo,
      token,
      fetch: async () => {
        throw Error(token);
      },
    }),
    (error) => /request failed/.test(error.message) && !error.message.includes(token),
  );
});

test("rejects empty, truncated and oversized run inventories", async () => {
  for (const runResponse of [
    Response.json({ total_count: 0, workflow_runs: [] }),
    Response.json({ total_count: 101, workflow_runs: [newer] }),
    new Response("unused", { headers: { "Content-Length": "100000000" } }),
    new Response(new Uint8Array(8 * 1024 * 1024)),
  ]) {
    await assert.rejects(
      harness({ runResponse }).resolve(),
      /production deployment runs|response exceeds/,
    );
  }
});

test("older pages of successful runs do not disable the bounded history lookup", async () => {
  const runs = [
    newer,
    ...Array.from({ length: 99 }, (_, i) => ({ ...older, id: 300 + i })),
  ];
  const runResponse = Response.json(
    { total_count: 101, workflow_runs: runs },
    {
      headers: { Link: `<${runList}&page=2>; rel="next"` },
    },
  );
  const h = harness({ runs, runResponse });
  assert.deepEqual(await h.resolve(), {
    commit: newerSha,
    tag: newer.head_branch,
    runId: 200,
  });
  assert.equal(h.requests.length, 2);
});
