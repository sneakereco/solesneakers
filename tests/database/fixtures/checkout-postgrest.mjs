import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { SignJWT } from "jose";
import { PostgrestClient } from "@supabase/postgrest-js";

export const postgrestImage =
  "postgrest/postgrest@sha256:e9490aa503a5fb07d8e8c80da46e5c0c193894e583b59ed9077e74c4101ffae2";
const exec = promisify(execFile);
async function docker(args, env = process.env) {
  // execFile error messages include the command. Pass fixture credentials by
  // environment inheritance only and keep startup diagnostics free of values.
  try {
    return (await exec("docker", args, { env, timeout: 30000 })).stdout.trim();
  } catch {
    throw Error("PostgREST fixture Docker " + args[0] + " failed");
  }
}

// The caller has already checked the live database container, ownership token
// and database name over SQL. Resolve the isolated network by immutable ID.
export async function withPostgrest(lease, work) {
  const { projectId } = lease.ownership;
  assert.match(projectId, /^checkout-hardening-test-[0-9a-f]{14}$/);
  assert.equal(lease.database, projectId.replaceAll("-", "_"));
  const networkName = "supabase_network_" + projectId;
  const [network] = JSON.parse(await docker(["network", "inspect", networkName]));
  assert.equal(network.Name, networkName);
  assert.equal(network.Labels["com.supabase.cli.project"], projectId);
  assert.equal(network.Containers[lease.containerId].Name, "supabase_db_" + projectId);
  const owner = randomUUID(),
    name = "checkout-postgrest-" + owner,
    label = "checkout.http.owner";
  const secret = randomBytes(36).toString("hex");
  const env = {
    ...process.env,
    PGRST_DB_URI:
      "postgresql://authenticator:postgres@supabase_db_" +
      projectId +
      ":5432/" +
      lease.database,
    PGRST_JWT_SECRET: secret,
  };
  const id = await docker(
    [
      "create",
      "--pull=never",
      "--name",
      name,
      "--label",
      label + "=" + owner,
      "--network",
      network.Id,
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      "--publish",
      "127.0.0.1::3000",
      "--env",
      "PGRST_DB_URI",
      "--env",
      "PGRST_JWT_SECRET",
      "--env",
      "PGRST_DB_ANON_ROLE=anon",
      "--env",
      "PGRST_DB_MAX_ROWS=8",
      postgrestImage,
    ],
    env,
  );
  assert.match(id, /^[0-9a-f]{64}$/);
  try {
    await docker(["start", id]);
    const published = await docker(["port", id, "3000/tcp"]);
    assert.match(published, /^127\.0\.0\.1:\d+$/);
    const url = "http://" + published;
    const token = await new SignJWT({ role: "service_role" })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode(secret));
    const api = new PostgrestClient(url, {
      headers: { Authorization: "Bearer " + token },
    });
    for (let i = 0; i < 80; i++) {
      const ready = await api
        .from("orders")
        .select("id")
        .limit(0)
        .abortSignal(AbortSignal.timeout(1000));
      if (!ready.error) return await work(api);
      await delay(200);
    }
    throw Error("PostgREST fixture did not serve the owned orders relation");
  } finally {
    const identity = await docker([
      "inspect",
      "--format",
      '{{.Id}} {{.Name}} {{index .Config.Labels "checkout.http.owner"}}',
      id,
    ]);
    assert.equal(identity, id + " /" + name + " " + owner);
    await docker(["rm", "--force", id]);
    assert.equal(await docker(["ps", "--all", "--quiet", "--filter", "id=" + id]), "");
  }
}
