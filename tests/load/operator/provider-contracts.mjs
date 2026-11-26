import { chromium } from "@playwright/test";
import { ensureBrowserRuntime } from "../browser/probe.mjs";
import { runSandboxContract } from "./sandbox-contract.mjs";
import { secureDirectory, privateJson } from "./journal.mjs";
import { writeRunReport } from "./report.mjs";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve, join } from "node:path";
export async function dispatchSandboxAction(action, dependencies) {
  if (action === "stop") {
    await dependencies.requestStop();
    return {
      summary: {
        status: "stopped",
        action: "Recover this same run ID after the active probe stops",
      },
      exitCode: 3,
    };
  }
  return dependencies.resume({ ignoreStop: true, cleanupOnly: action === "cleanup" });
}
export async function probeBoundedContracts(profile, target, env, options = {}) {
  if (profile === "sandbox") {
    const runId = env.LOAD_TEST_SANDBOX_RUN_ID ?? randomUUID();
    if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(runId))
      throw Error("Invalid Sandbox recovery run ID");
    const artifactDir = resolve(".load-test/runs", runId);
    await secureDirectory(artifactDir);
    const priorPlan = await readFile(join(artifactDir, "run-plan.json"), "utf8")
      .then(JSON.parse)
      .catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
    if (
      priorPlan &&
      (priorPlan.runId !== runId ||
        priorPlan.targetDigest !== target.digest ||
        priorPlan.profile !== "sandbox-contract")
    )
      throw Error("Sandbox recovery plan identity mismatch");
    const statePath = join(artifactDir, "contract-state.json");
    await privateJson(join(artifactDir, "run-plan.json"), {
      version: 1,
      runId,
      targetDigest: target.digest,
      profile: "sandbox-contract",
    });
    process.stderr.write(`Sandbox run ${runId}; private artifacts: ${artifactDir}\n`);
    const sdk = await runSandboxContract(env, {
      runId,
      targetDigest: target.digest,
      baseUrl: target.baseUrl,
      cleanupOnly: options.cleanupOnly,
      assertActive: async () => {
        if (options.ignoreStop) return;
        try {
          await readFile(join(artifactDir, "stop.request"));
        } catch (error) {
          if (error.code === "ENOENT") return;
          throw error;
        }
        throw Error("Operator stop requested");
      },
      load: async () => {
        try {
          return JSON.parse(await readFile(statePath, "utf8"));
        } catch (error) {
          if (error.code === "ENOENT") return null;
          throw error;
        }
      },
      save: (value) => privateJson(statePath, value),
    });
    const report = {
      ...sdk,
      provenance: target.expected,
      operations: [],
      gates: sdk.checks ?? [],
    };
    const files = await writeRunReport(report, artifactDir);
    return {
      ...report,
      profile,
      status: "unmet",
      sdkStatus: sdk.status,
      files,
      artifactDir,
      reasons: [
        ...(sdk.reasons ?? []),
        "Application webhook, real browser SDK, normal checkout and native-wallet compatibility remain unverified",
      ],
    };
  }
  const runtime = await ensureBrowserRuntime(),
    browser = await chromium.launch({
      executablePath: runtime.executablePath,
      headless: true,
    });
  const checks = [];
  try {
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 1440, height: 1000 },
    ]) {
      const context = await browser.newContext({ viewport });
      try {
        const page = await context.newPage();
        for (const path of ["/", "/store", "/store?q=Load"]) {
          const response = await page.goto(target.baseUrl + path, {
            waitUntil: "domcontentloaded",
            timeout: 15000,
          });
          checks.push({
            route: path.split("?")[0],
            viewport: viewport.width,
            status:
              response?.ok() &&
              new URL(page.url()).origin === target.baseUrl &&
              new URL(page.url()).pathname === path.split("?")[0]
                ? "pass"
                : "fail",
          });
        }
      } catch {
        checks.push({
          viewport: viewport.width,
          status: "fail",
          reason: "Normal browser navigation blocked",
        });
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  return {
    profile,
    status: checks.some((x) => x.status === "fail") ? "fail" : "unmet",
    checks,
    reasons: [
      "Normal navigation is bounded and has no synthetic admission headers; normal checkout/consent/native SDK coverage remains separate",
    ],
  };
}
