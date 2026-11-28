import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveObserverRelease } from "./resolve-analytics-observer-release.mjs";

const productionWorkflow = ".github/workflows/production.yml";
const requiredJobs = ["validate-release", "migrate", "deploy", "verify"];
const requiredFiles = [
  "scripts/run-admin-analytics-observers.mjs",
  "supabase/migrations/20261127135000_analytics_observer_clock.sql",
];
const pageSize = 100;
const maxResponseBytes = 5 * 1024 * 1024;

const runGit = (args) =>
  execFileSync("git", args, {
    encoding: "utf8",
    timeout: 5_000,
    maxBuffer: 8_192,
    stdio: ["ignore", "pipe", "pipe"],
  });

function timestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value))
    return NaN;
  const time = Date.parse(value);
  return Number.isFinite(time) &&
    new Date(time).toISOString() === `${value.slice(0, -1)}.000Z`
    ? time
    : NaN;
}

async function requestJson(url, token, fetch, deadline) {
  let response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      redirect: "error",
      signal: AbortSignal.any([deadline, AbortSignal.timeout(8_000)]),
    });
  } catch {
    throw Error("GitHub Actions request failed.");
  }
  if (response.redirected || response.status !== 200) {
    if (Number.isSafeInteger(response.status))
      throw Error(`GitHub Actions request failed (HTTP ${response.status}).`);
    throw Error("GitHub Actions request failed.");
  }
  const tooLarge = "GitHub Actions response exceeds its size limit.";
  if (Number(response.headers.get("content-length")) > maxResponseBytes)
    throw Error(tooLarge);

  const chunks = [];
  let length = 0;
  try {
    for await (const chunk of response.body) {
      length += chunk.byteLength;
      if (length > maxResponseBytes) break;
      chunks.push(chunk);
    }
  } catch {
    throw Error("GitHub Actions response body could not be read.");
  }
  if (length > maxResponseBytes) throw Error(tooLarge);

  let data;
  try {
    data = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
    );
  } catch {
    throw Error("GitHub Actions returned invalid JSON.");
  }
  return { data, hasPagination: response.headers.has("link") };
}

function validateRun(run, repository) {
  const tag = run?.head_branch;
  const updatedAt = timestamp(run?.updated_at);
  const runRepository = run?.repository?.full_name;
  const headRepository = run?.head_repository?.full_name;
  if (
    typeof tag !== "string" ||
    ![
      productionWorkflow,
      `${productionWorkflow}@${tag}`,
      `${productionWorkflow}@refs/tags/${tag}`,
    ].includes(run.path) ||
    run.event !== "push" ||
    run.status !== "completed" ||
    run.conclusion !== "success" ||
    typeof runRepository !== "string" ||
    runRepository.toLowerCase() !== repository ||
    typeof headRepository !== "string" ||
    headRepository.toLowerCase() !== repository ||
    !Number.isSafeInteger(run.id) ||
    run.id < 1 ||
    !Number.isSafeInteger(run.run_attempt) ||
    run.run_attempt < 1 ||
    typeof run.head_sha !== "string" ||
    run.head_sha.length !== 40 ||
    !/^[a-f0-9]{40}$/.test(run.head_sha) ||
    !Number.isFinite(updatedAt)
  ) {
    throw Error("Invalid production deployment run metadata.");
  }
  return { id: run.id, attempt: run.run_attempt, commit: run.head_sha, tag, updatedAt };
}

function verifyTag(run, git) {
  if (resolveObserverRelease(run.tag, git) !== run.commit) {
    throw Error("The production tag does not match the successful deployment commit.");
  }
}

function deploymentTime({ data, hasPagination }, run) {
  const invalidJobs = "Could not verify the complete production deployment jobs.";
  if (
    hasPagination ||
    !Array.isArray(data?.jobs) ||
    data.jobs.length > pageSize ||
    data.total_count !== data.jobs.length
  ) {
    throw Error(invalidJobs);
  }

  const latestJobs = new Map();
  for (const job of data.jobs) {
    if (
      job?.run_id !== run.id ||
      job.head_sha !== run.commit ||
      typeof job.name !== "string"
    ) {
      throw Error(invalidJobs);
    }
    if (!requiredJobs.includes(job.name)) continue;
    const completedAt = timestamp(job.completed_at);
    if (
      job.status !== "completed" ||
      !Number.isFinite(completedAt) ||
      completedAt > run.updatedAt
    ) {
      throw Error(invalidJobs);
    }
    const previous = latestJobs.get(job.name);
    if (previous?.completedAt === completedAt) throw Error(invalidJobs);
    if (!previous || previous.completedAt < completedAt) {
      latestJobs.set(job.name, { completedAt, conclusion: job.conclusion });
    }
  }
  let previous = 0;
  for (const name of requiredJobs) {
    const job = latestJobs.get(name);
    if (job?.conclusion !== "success" || job.completedAt < previous)
      throw Error(invalidJobs);
    previous = job.completedAt;
  }
  return latestJobs.get("deploy").completedAt;
}

function verifyTree(commit, git) {
  try {
    for (const path of requiredFiles) {
      const entry = git(["ls-tree", "--full-tree", commit, "--", path]).trim();
      const [object, file] = entry.split("\t");
      if (file !== path || !/^100(?:644|755) blob [a-f0-9]{40}$/.test(object))
        throw Error();
    }
  } catch {
    throw Error(
      "The deployed commit must contain the observer runner and clock migration.",
    );
  }
}

export async function resolveObserverDeployment({
  repository,
  token,
  triggerRun,
  fetch = globalThis.fetch,
  git = runGit,
}) {
  if (
    typeof repository !== "string" ||
    !/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(repository) ||
    /\/\.{1,2}$/.test(repository) ||
    /\s/.test(repository) ||
    typeof token !== "string" ||
    !token.trim()
  ) {
    throw Error("A GitHub repository and read-only Actions token are required.");
  }
  const repo = repository.toLowerCase();
  if (triggerRun !== undefined) verifyTag(validateRun(triggerRun, repo), git);

  const deadline = AbortSignal.timeout(25_000);
  const base = `https://api.github.com/repos/${repo}/actions`;
  const request = (path) => requestJson(`${base}/${path}`, token, fetch, deadline);
  const { data } = await request(
    `workflows/production.yml/runs?event=push&status=success&per_page=${pageSize}`,
  );
  if (
    !Array.isArray(data?.workflow_runs) ||
    !Number.isSafeInteger(data.total_count) ||
    data.total_count < 1 ||
    data.workflow_runs.length !== Math.min(data.total_count, pageSize)
  ) {
    throw Error(
      "GitHub did not return a complete page of successful production deployment runs.",
    );
  }
  const runs = data.workflow_runs
    .map((run) => validateRun(run, repo))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  if (new Set(runs.map((run) => run.id)).size !== runs.length) {
    throw Error("GitHub returned duplicate production deployment runs.");
  }

  let selected;
  for (const run of runs) {
    // A rerun of only verify updates the run without moving its deploy job. Older runs
    // with an update before the selected deployment cannot supersede that deployment.
    if (selected && run.updatedAt < selected.deployedAt) break;
    verifyTag(run, git);
    const filter = run.attempt === 1 ? "latest" : "all";
    const jobs = await request(
      `runs/${run.id}/jobs?filter=${filter}&per_page=${pageSize}`,
    );
    const deployedAt = deploymentTime(jobs, run);
    if (selected?.deployedAt === deployedAt)
      throw Error("Production deployment order is ambiguous.");
    if (!selected || selected.deployedAt < deployedAt) selected = { ...run, deployedAt };
  }

  verifyTree(selected.commit, git);
  return { commit: selected.commit, tag: selected.tag, runId: selected.id };
}

function readTriggerRun() {
  try {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
    if (
      event.action !== "completed" ||
      event.workflow_run?.name !== "Production Deployment"
    )
      throw Error();
    return event.workflow_run;
  } catch {
    throw Error("Invalid production deployment completion event.");
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const { commit, tag, runId } = await resolveObserverDeployment({
      repository: process.env.GITHUB_REPOSITORY,
      token: process.env.GITHUB_TOKEN,
      triggerRun:
        process.env.GITHUB_EVENT_NAME === "workflow_run" ? readTriggerRun() : undefined,
    });
    console.error(`Selected production deployment ${tag} (run ${runId}).`);
    console.log(commit);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
