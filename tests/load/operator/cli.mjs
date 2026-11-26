import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { PROFILE_NAMES } from "../shared/profiles.mjs";
import { dryRunDescription } from "./orchestrate.mjs";
import { redactArtifact } from "../shared/redact.mjs";
export function parseArgs(argv) {
  const input = { profile: "smoke" };
  let action = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      input.dryRun = true;
      continue;
    }
    if (arg === "--profile") {
      input.profile = argv[++i];
      if (!PROFILE_NAMES.includes(input.profile)) throw Error("Unknown load profile");
      continue;
    }
    if (["--stop", "--recover", "--cleanup"].includes(arg)) {
      if (action) throw Error("Select one recovery action");
      action = true;
      input.action = arg.slice(2);
      input.runId = argv[++i];
      if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(input.runId ?? ""))
        throw Error("A valid run UUID is required");
      continue;
    }
    throw Error("Unknown or incomplete CLI option");
  }
  return input;
}
export async function main(argv, dependencies = {}) {
  const print =
    dependencies.print ?? ((value) => console.log(JSON.stringify(value, null, 2)));
  try {
    const input = parseArgs(argv);
    if (input.dryRun) {
      print(dryRunDescription(input.profile));
      return 0;
    }
    const runtime = dependencies.runtime ?? (await import("./runtime.mjs"));
    const result = await runtime.runCommand(input);
    print(redactArtifact(result.summary ?? result));
    return result.exitCode ?? 2;
  } catch (error) {
    print({
      status: "unmet",
      reason: redactArtifact(error.message),
      action:
        "Deploy staging and authorize its immutable target and secrets; rerun the same command.",
    });
    return 2;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  process.exitCode = await main(process.argv.slice(2));
