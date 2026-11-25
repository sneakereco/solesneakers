import { createRunPlan, acceptanceProfiles } from "../shared/profiles.mjs";
import { redactArtifact } from "../shared/redact.mjs";
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
      try {
        report.cleanup = await phase.cleanup(context);
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
  let arrivalEvidence;
  for (const item of acceptanceProfiles()) {
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
    if (report.status !== "pass" || report.cleanup?.status === "incomplete") break;
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
