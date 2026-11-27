import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Only closed gate names, counts and hashes are suitable for the CI log. Raw
// child output and browser screenshots stay in the private ephemeral run folder.
export async function createCheckoutGate(family) {
  const directory = await mkdtemp(
    join(process.env.CHECKOUT_GATE_PRIVATE_DIR ?? tmpdir(), "checkout-" + family + "-"),
  );
  if (!process.env.CI) console.log("Local diagnostics " + directory);
  return async (
    name,
    args,
    { env = {}, expectedFailure, propagateFailure = false } = {},
  ) => {
    assert.match(name, /^[a-z0-9-]+$/);
    const child = spawn(process.execPath, args, {
      env: {
        ...process.env,
        NODE_DISABLE_COLORS: "1",
        CHECKOUT_GATE_FAULT: "",
        CHECKOUT_BROWSER_OUTPUT: directory,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks = [];
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (chunk) => chunks.push(chunk));
    const status = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    const raw = Buffer.concat(chunks);
    await writeFile(join(directory, name + ".log"), raw, { mode: 0o600, flag: "wx" });
    const output = raw.toString();
    const detected = expectedFailure && status === 1 && output.includes(expectedFailure);
    const passed = expectedFailure ? detected && !propagateFailure : status === 0;
    const counts = [
      ...output.matchAll(/(?:ℹ |# )(tests|pass|fail|skipped|cancelled) (\d+)\b/g),
    ].map((m) => m[1] + "=" + m[2]);
    const hash = createHash("sha256").update(raw).digest("hex");
    const identity =
      output.match(
        /source=([a-f0-9]{40}) worktree=([a-f0-9]{64}) schema=([a-f0-9]{64}) migrations=(\d+)/,
      )?.[0] ?? "";
    console.log(
      [passed ? "PASS" : "FAIL", family, name, ...counts, identity, "sha256=" + hash]
        .filter(Boolean)
        .join(" "),
    );
    if (expectedFailure && !detected)
      throw Error(family + " fault injection inconclusive: " + name);
    if (!passed)
      throw Error(family + " gate failed: " + (detected ? expectedFailure : name));
  };
}
