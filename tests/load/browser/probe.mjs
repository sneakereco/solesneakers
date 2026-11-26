import { access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { chromium } from "@playwright/test";
import { redactArtifact } from "../shared/redact.mjs";
import { collectVitals, evaluateVitals } from "./vitals.mjs";
import { captureJourneyRequests } from "./capture.mjs";
import { installBulkProviderRoutes } from "./provider-shims.mjs";
import { runRenderedJourney, applyConsentChoice } from "./journeys.mjs";
import { browserCookies } from "./cookies.mjs";
const require = createRequire(import.meta.url),
  tools = require("../config/toolchain.json"),
  exec = promisify(execFile);
export async function ensureBrowserRuntime(dependencies = {}) {
  if (require("@playwright/test/package.json").version !== tools.playwright.version)
    throw Error("Playwright version differs from locked toolchain");
  const exists =
    dependencies.exists ??
    ((path) =>
      access(path).then(
        () => true,
        () => false,
      ));
  const executablePath = (
    dependencies.executablePath ?? (() => chromium.executablePath())
  )();
  if (!(await exists(executablePath)))
    await (
      dependencies.install ??
      (() =>
        exec(
          process.execPath,
          [
            join(dirname(require.resolve("playwright/package.json")), "cli.js"),
            "install",
            "chromium",
          ],
          { windowsHide: true },
        ))
    )();
  if (!(await exists(executablePath)))
    throw Error("Chromium executable is missing after locked runtime installation");
  return {
    executablePath,
    version: tools.playwright.chromiumVersion,
    revision: tools.playwright.chromiumRevision,
  };
}
export function validateBrowserCoverage({ planned, started, errors, perimeter }) {
  const reasons = [];
  if (started !== planned) reasons.push("Not every planned browser started");
  if (errors.length) reasons.push("Rendered journey assertions failed");
  if (perimeter && perimeter.status !== "pass")
    reasons.push("Normal perimeter admission blocked");
  return { status: reasons.length ? "fail" : "pass", reasons, planned, started };
}
export function publicBrowserArtifact(value) {
  const allowed = [
    "version",
    "runId",
    "workerId",
    "profile",
    "planned",
    "started",
    "activeSamples",
    "offered",
    "completed",
    "dropped",
    "interrupted",
    "operations",
    "resources",
    "errors",
    "coverage",
    "perimeter",
  ];
  const artifact = Object.fromEntries(
    allowed.filter((key) => key in value).map((key) => [key, value[key]]),
  );
  if (value.observations)
    artifact.observations = value.observations.map(({ name, value }) => ({
      name,
      value,
    }));
  return redactArtifact(artifact);
}
export async function runBrowserCohort(plan, fixtures, options) {
  const runtime = await ensureBrowserRuntime(options.runtimeDependencies);
  const browser = await chromium.launch({
    headless: true,
    executablePath: runtime.executablePath,
  });
  if (browser.version() !== runtime.version) {
    await browser.close();
    throw Error("Chromium version differs from locked toolchain");
  }
  const abort = () => {
    void browser.close().catch(() => {});
  };
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  const result = {
    version: 1,
    runId: plan.runId,
    workerId: "browser-0",
    profile: plan.profile,
    activeSamples: [{ at: Date.now(), slots: 0 }],
    offered: 0,
    completed: 0,
    dropped: 0,
    interrupted: 0,
    operations: [],
    resources: [],
    errors: [],
  };
  let active = 0,
    started = 0;
  const observations = [];
  const sample = (delta) => {
    active += delta;
    result.activeSamples.push({ at: Date.now(), slots: active });
  };
  try {
    await Promise.all(
      Array.from({ length: plan.browserSlots }, async (_, index) => {
        const slot = plan.httpSlots + index,
          identity = fixtures.sessions.find((x) => x.slot === slot),
          viewport = index < plan.browserViewports.mobile ? "mobile" : "desktop";
        let context, capture, egress;
        let admitted = false;
        try {
          if (!identity) throw Error("Missing leased browser identity");
          context = await browser.newContext({
            viewport:
              viewport === "mobile"
                ? { width: 390, height: 844 }
                : { width: 1440, height: 1000 },
            isMobile: viewport === "mobile",
            hasTouch: viewport === "mobile",
            serviceWorkers: "block",
            extraHTTPHeaders: {},
          });
          if (options.mode !== "perimeter")
            await context.addCookies(
              browserCookies(identity.cookies, options.target.baseUrl),
            );
          egress =
            options.mode === "perimeter"
              ? null
              : await installBulkProviderRoutes(context, {
                  ...identity,
                  runId: plan.runId,
                  baseUrl: options.target.baseUrl,
                  providerMode: options.target.providerMode,
                  credential: options.credential,
                  supabaseUrl: options.target.resources?.supabase?.url,
                });
          const page = await context.newPage();
          page.setDefaultTimeout(15000);
          page.on("pageerror", (error) => {
            result.errors.push(`Rendered JavaScript error: ${error.name}`);
          });
          await collectVitals(page, (value) => observations.push(value), viewport);
          capture = captureJourneyRequests(page, options.target.baseUrl);
          if (options.ready) {
            const initial = await page.goto(options.target.baseUrl, {
              waitUntil: "domcontentloaded",
            });
            if (!initial?.ok() || new URL(page.url()).origin !== options.target.baseUrl)
              throw Error("Browser admission failed before ready barrier");
            admitted = true;
            started++;
            sample(1);
            await options.ready(slot);
          }
          const release = options.phaseStart ?? Date.now();
          if (Date.now() < release)
            await new Promise((resolve) => setTimeout(resolve, release - Date.now()));
          const end = release + (plan.warmupSeconds + plan.measurementSeconds) * 1000;
          do {
            result.offered++;
            const response = await page.goto(options.target.baseUrl, {
              waitUntil: "domcontentloaded",
            });
            if (!response?.ok() || new URL(page.url()).origin !== options.target.baseUrl)
              throw Error("Storefront/perimeter admission blocked");
            const storeLink = page.locator('a[href="/store"]:visible').first();
            if (await storeLink.count()) {
              await storeLink.click();
              await page.waitForURL((url) => url.pathname === "/store");
            }
            if (!admitted) {
              admitted = true;
              started++;
              sample(1);
            }
            const consent = await applyConsentChoice(
              page,
              index % 2 === 0 ? "accept" : "reject",
            );
            result.resources.push({ type: "consent", viewport, ...consent });
            const cycle = Date.now();
            await runRenderedJourney(page, context, {
              plan,
              fixtures,
              identity,
              viewport,
              baseUrl: options.target.baseUrl,
              credential: options.credential,
              mode: options.mode,
              emit: (value) => {
                result.operations.push(value);
                if (value.type === "case" && value.status !== "pass")
                  result.errors.push(`Rendered case failed: ${value.name}`);
              },
            });
            result.completed++;
            // A real five-minute browser session; browse while waiting instead of
            // terminating the browser cohort early relative to the protocol load.
            while (
              options.mode !== "perimeter" &&
              Date.now() < Math.min(end, cycle + 300000) &&
              !options.signal?.aborted
            ) {
              await page.waitForTimeout(Math.min(10000, Math.max(1, end - Date.now())));
              if (Date.now() < end)
                await page.goto(`${options.target.baseUrl}/store`, {
                  waitUntil: "domcontentloaded",
                });
            }
          } while (
            Date.now() < end &&
            !options.signal?.aborted &&
            options.mode !== "perimeter"
          );
          await page.goto("about:blank");
        } catch (error) {
          result.interrupted++;
          result.errors.push(String(redactArtifact(error.message)));
        } finally {
          if (admitted) sample(-1);
          if (capture) {
            const navigation = capture.stop();
            result.operations.push(...navigation.requests);
            result.resources.push(
              {
                type: "navigation-assets",
                paths: navigation.assets,
                replay: navigation.replay,
              },
              { type: "egress", ...egress },
            );
          }
          await context?.close().catch(() => {});
        }
      }),
    );
  } finally {
    options.signal?.removeEventListener("abort", abort);
    await browser.close().catch(() => {});
  }
  result.resources.push({
    type: "browser-mode",
    mode: options.mode ?? "bulk",
    httpCache:
      options.mode === "perimeter" ? "browser-default" : "disabled-by-provider-routing",
    serviceWorkers: "blocked",
    sampling: "deliberately oversamples checkout edge cases",
  });
  result.resources.push(
    ...observations.map((value) => ({ type: "web-vital", ...value })),
    {
      type: "browser-coverage",
      ...validateBrowserCoverage({
        planned: plan.browserSlots,
        started,
        errors: result.errors,
      }),
    },
    {
      type: "vitals-gate",
      ...evaluateVitals(
        observations,
        ["/", "/store", "/store/:id", "/cart", "/checkout", "/checkout/success"],
        { minimumSamples: plan.profile === "smoke" ? 1 : 20 },
      ),
    },
  );
  return result;
}
