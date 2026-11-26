import { createRunPlan, acceptanceProfiles } from "../shared/profiles.mjs";
import { redactArtifact } from "../shared/redact.mjs";
export function mayAdvance(report, profile) {
  if (report.status === "fail" || report.cleanup?.status === "incomplete") return false;
  if (report.status === "pass") return true;
  const pending = (report.gates ?? []).filter((gate) => gate.status !== "pass");
  const readiness = new Set([
    "provider-perimeter",
    "resource-cost",
    "tier-parity",
    "redis-health",
  ]);
  return (
    pending.length > 0 &&
    pending.every(
      (gate) =>
        gate.status === "unmet" &&
        (readiness.has(gate.name) ||
          (profile === "calibration" &&
            gate.name === "browser-vitals" &&
            gate.reasons?.length &&
            gate.reasons.every((reason) =>
              /insufficient samples \([1-9][0-9]*\/20\)$/.test(reason),
            )) ||
          (profile === "smoke" &&
            /^(?:telemetry:|database-headroom-evidence$|generator-headroom$|redis-health$|browser-vitals$)/.test(
              gate.name,
            ))),
    )
  );
}
export async function executeSelectedProfile(profile, run) {
  if (profile === "smoke") return run(profile);
  const smoke = await run("smoke");
  const functional =
    /^(?:operation:|achieved-cohort$|offered-work$|browser-journeys$|browser-assertions$|eligible-checkout$|durable-invariants$)/;
  if (
    smoke.status === "fail" ||
    smoke.cleanup?.status === "incomplete" ||
    smoke.gates?.some((gate) => functional.test(gate.name) && gate.status !== "pass")
  )
    return { ...smoke, requestedProfile: profile };
  return run(profile);
}
export async function executeRun(target, profile, dependencies) {
  const phase = dependencies.phase,
    plan = dependencies.plan ?? createRunPlan(target, profile, dependencies.options),
    context = { target, profile, plan };
  let enrolled = false,
    report,
    preflight,
    measured;
  try {
    preflight = await phase.preflight(context);
    context.preflight = preflight;
    if (!preflight.allowed) throw Error("Preflight did not authorize staging traffic");
    await phase.recheck(context);
    enrolled = true;
    context.registration = await phase.register(context);
    context.fixtures = await phase.seed(context);
    context.sessions = await phase.sessions(context);
    await phase.recheck(context);
    measured = await phase.measure(context);
    context.measured = measured;
  } catch (error) {
    context.failure = redactArtifact(error.message);
  } finally {
    if (enrolled) {
      try {
        await phase.revoke(context);
      } catch {
        context.failure ??= "Admission revocation failed";
      }
      try {
        context.drain = await phase.drain(context);
      } catch {
        context.drain = {
          status: "incomplete",
          reasons: ["Recovery evidence unavailable"],
        };
      }
      try {
        context.invariants = await phase.assert(context);
      } catch {
        context.invariants = null;
        context.failure ??= "Durable assertions unavailable";
      }
    }
    try {
      report = await dependencies.evaluate(context);
    } catch {
      report = { status: "unmet", gates: [], operations: [] };
    }
    report = {
      ...report,
      version: 1,
      runId: plan.runId,
      profile,
      gates: [...(preflight?.gates ?? []), ...(report.gates ?? [])],
      coverage: preflight?.coverage ?? [],
      drain: context.drain,
    };
    if (context.failure) {
      report.status = measured ? "fail" : "unmet";
      report.gates.push({
        name: "lifecycle",
        status: report.status,
        reasons: [context.failure],
      });
    }
    if (enrolled) {
      let saved = false;
      context.report = redactArtifact(report);
      try {
        await phase.report(context);
        saved = true;
      } catch {
        report.gates.push({
          name: "evidence-storage",
          status: "unmet",
          reasons: ["Evidence could not be saved; owned fixtures retained"],
        });
        report.status = "unmet";
      }
      try {
        report.cleanup = saved
          ? await phase.cleanup(context)
          : { status: "incomplete", reasons: ["Evidence was not saved before cleanup"] };
      } catch {
        report.cleanup = {
          status: "incomplete",
          reasons: ["Cleanup failed; recover the same run ID"],
        };
      }
      if (context.drain?.status === "incomplete") {
        report.status = "fail";
        report.gates.push({
          name: "recovery",
          status: "fail",
          reasons: context.drain.reasons ?? [],
        });
      }
    }
    context.report = redactArtifact(report);
    await phase.report(context);
    return context.report;
  }
}
export async function executeAcceptance(target, dependencies) {
  const reports = [];
  const now = dependencies.now ?? Date.now,
    deadline = now() + (target.budget?.maxDurationSeconds ?? 86400) * 1000;
  let arrivalEvidence,
    blocked = false;
  for (const item of [
    ...acceptanceProfiles(),
    { profile: "perimeter" },
    { profile: "sandbox" },
  ]) {
    if (blocked || now() >= deadline) {
      blocked = true;
      reports.push({
        ...item,
        status: "unmet",
        reasons: [
          "Not run: a lower stage or the aggregate duration budget stopped escalation",
        ],
      });
      continue;
    }
    if (
      item.profile === "claim-rush" &&
      !dependencies.capabilities?.includes("specialty-claims")
    ) {
      reports.push({
        profile: "claim-rush",
        status: "unmet",
        contenders: item.contenders,
        reasons: ["Actual specialty capability is absent"],
      });
      continue;
    }
    const report = await dependencies.run(item.profile, {
      ...item,
      profile: undefined,
      ...(item.profile === "arrival" ? { arrivalEvidence } : {}),
    });
    reports.push(report);
    if (!mayAdvance(report, item.profile)) blocked = true;
    if (item.profile === "peak") {
      const evidence = report.fullSessionEvidence;
      arrivalEvidence = evidence && {
        ...evidence,
        profile: "peak",
        passed: true,
        totalSlots: 10000,
      };
    }
  }
  return {
    version: 1,
    profile: "acceptance",
    status: reports.some((x) => x.status === "fail")
      ? "fail"
      : reports.some((x) => x.status !== "pass")
        ? "unmet"
        : "pass",
    stages: reports,
    cleanup: {
      status: reports.some((report) => report.cleanup?.status === "incomplete")
        ? "incomplete"
        : "cleaned",
    },
  };
}
export function dryRunDescription(profile) {
  return {
    mode: "dry-run",
    writes: false,
    load: false,
    profile,
    stages:
      profile === "acceptance"
        ? [
            ...acceptanceProfiles(),
            { profile: "perimeter", required: true },
            { profile: "sandbox", required: true },
          ]
        : [{ profile }],
    specialty: { status: "unmet until deployed capability is attested" },
    setup: [
      "Deploy the isolated staging implementation",
      "Install the pinned k6 executable",
      "Authorize staging secrets and immutable target once; seeding, sessions, workers, reporting and cleanup are automatic",
    ],
  };
}
