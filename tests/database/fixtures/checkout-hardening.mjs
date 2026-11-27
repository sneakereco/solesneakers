import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { createServer as createTcpServer } from "node:net";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "pg";
import { validatePrefix } from "../../../scripts/single-store/check-migration-baseline.mjs";
import { runLabel, withLoopbackPublishing } from "./checkout-hardening-docker-relay.mjs";
import {
  createRaceCampaign,
  seedPrize,
  claimAttempt,
  award,
} from "./specialty-claims.mjs";
import { withPostgrest } from "./checkout-postgrest.mjs";

const run = promisify(execFile);
export const root = fileURLToPath(new URL("../../../", import.meta.url));
const supabase = join(root, "node_modules", "supabase", "dist", "supabase.js");
const historicalCutoff = "20260922120000";
const shippingThrough = "20261127034000";
const bootstrapVersion = "20261127134000";
const projectPattern = /^checkout-hardening-test-[0-9a-f]{14}$/;
const databasePattern = /^checkout_hardening_test_[0-9a-f]{14}$/;
const projectLabel = "com.supabase.cli.project";
const workdirLabel = "com.supabase.cli.workdir";
const leaseKey = "CHECKOUT_HARDENING_DB_LEASE";
const roles = new Set(["postgres", "anon", "authenticated", "service_role"]);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export function validateMutationTarget(value, { database, port }) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Refusing mutation target: invalid database URL");
  }
  assert.ok(
    databasePattern.test(database) &&
      Number.isInteger(port) &&
      ["postgres:", "postgresql:"].includes(url.protocol) &&
      url.hostname === "127.0.0.1" &&
      url.port === String(port) &&
      url.pathname === "/" + database &&
      !url.href.includes("?") &&
      !url.href.includes("#"),
    "Refusing mutation target: expected exact owned loopback database",
  );
  return url;
}

async function assertDescendant(parent, path) {
  const [resolvedParent, resolvedPath] = await Promise.all([
    realpath(parent),
    realpath(path),
  ]);
  const child = relative(resolvedParent, resolvedPath);
  assert.ok(
    child && child !== ".." && !child.startsWith(".." + sep) && !isAbsolute(child),
    "Checkout project path is outside the owned workspace",
  );
  return resolvedPath;
}

export async function claimProjectDirectory(workspace, projectId) {
  assert.match(projectId, projectPattern);
  const directory = join(await realpath(workspace), projectId);
  try {
    await mkdir(directory);
  } catch (error) {
    if (error.code === "EEXIST")
      throw new Error("Checkout project directory already exists");
    throw error;
  }
  const marker = join(directory, ".checkout-owner");
  const token = randomBytes(32).toString("hex");
  await writeFile(marker, JSON.stringify({ projectId, token }), {
    flag: "wx",
    mode: 0o600,
  });
  return { workspace, directory, marker, projectId, token };
}

async function verifyOwnership({ workspace, directory, marker, projectId, token }) {
  assert.match(projectId, projectPattern);
  const path = await assertDescendant(workspace, directory);
  assert.equal(
    path,
    join(await realpath(workspace), projectId),
    "Unexpected checkout project directory",
  );
  assert.equal(
    resolve(directory),
    path,
    "Checkout project may not be a symlink or junction",
  );
  assert.equal(
    marker,
    join(path, ".checkout-owner"),
    "Unexpected checkout ownership marker path",
  );
  const metadata = await lstat(marker).catch(() => null);
  assert.ok(
    metadata?.isFile() && !metadata.isSymbolicLink(),
    "Missing checkout ownership marker",
  );
  assert.deepEqual(
    JSON.parse(await readFile(marker, "utf8")),
    { projectId, token },
    "Checkout ownership marker does not match this run",
  );
  return path;
}

async function verifyTree(rootPath, directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    assert.ok(!entry.isSymbolicLink(), "Checkout cleanup found a symlink or junction");
    const resolved = await assertDescendant(rootPath, path);
    if (entry.isDirectory()) await verifyTree(rootPath, resolved);
  }
}

export async function removeOwnedDirectory(ownership) {
  const directory = await verifyOwnership(ownership);
  await verifyTree(directory, directory);
  await rm(directory, { recursive: true });
}

function safeDiagnostic(output) {
  return output
    .split(/\r?\n/)
    .filter(
      (line) =>
        !/postgres(?:ql)?:\/\/|password|jwt|secret|(?:anon|service.?role) key|authorization/i.test(
          line,
        ),
    )
    .slice(-12)
    .join("\n")
    .trim();
}

async function checked(executable, args, { env, action = executable, maxBuffer } = {}) {
  try {
    return (
      await run(executable, args, {
        cwd: root,
        env,
        timeout: 180_000,
        ...(maxBuffer && { maxBuffer }),
      })
    ).stdout.trim();
  } catch (error) {
    const diagnostic = safeDiagnostic((error.stderr ?? "") + "\n" + (error.stdout ?? ""));
    throw new Error(
      action +
        " failed (" +
        (error.code ?? error.signal) +
        ")" +
        (diagnostic ? "\n" + diagnostic : ""),
    );
  }
}

function docker(args) {
  return checked("docker", args, {
    action: "Local Docker " + args.slice(0, 2).join(" "),
  });
}

export async function localDockerSocket() {
  const configured = process.env.DOCKER_CONTEXT ? undefined : process.env.DOCKER_HOST;
  const host =
    configured ||
    (await docker(["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"]));
  if (host.startsWith("unix:///")) return host.slice("unix://".length);
  if (host.startsWith("npipe:////./pipe/"))
    return host.slice("npipe://".length).replaceAll("/", "\\");
  throw new Error(
    "Checkout fixture requires a local Docker Unix socket or Windows named pipe",
  );
}

async function reservePorts() {
  const servers = [];
  try {
    for (let index = 0; index < 3; index++) {
      const server = createTcpServer();
      servers.push(server);
      await new Promise((resolveListen, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolveListen);
      });
    }
    return servers.map((server) => server.address().port);
  } finally {
    await Promise.all(servers.map((server) => new Promise((done) => server.close(done))));
  }
}

function supabaseCommand(ownership, args, env = process.env) {
  return checked(
    process.execPath,
    [supabase, "--workdir", ownership.directory, ...args],
    {
      env: { ...env, SUPABASE_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1" },
      action: "Pinned Supabase " + args.slice(0, 2).join(" "),
    },
  );
}

async function projectResources(projectId) {
  const containers = await docker([
    "ps",
    "-a",
    "--format",
    "{{.Names}}",
    "--filter",
    "label=" + projectLabel + "=" + projectId,
  ]);
  const volumes = await docker([
    "volume",
    "ls",
    "--format",
    "{{.Name}}",
    "--filter",
    "label=" + projectLabel + "=" + projectId,
  ]);
  const networks = await docker([
    "network",
    "ls",
    "--format",
    "{{.Name}}",
    "--filter",
    "label=" + projectLabel + "=" + projectId,
  ]);
  return [containers, volumes, networks].flatMap((value) =>
    value.split(/\r?\n/).filter(Boolean),
  );
}

async function assertUnusedProject(projectId) {
  const names = (
    await Promise.all([
      docker(["ps", "-a", "--format", "{{.Names}}"]),
      docker(["volume", "ls", "--format", "{{.Name}}"]),
      docker(["network", "ls", "--format", "{{.Name}}"]),
    ])
  ).flatMap((value) => value.split(/\r?\n/));
  assert.deepEqual(
    await projectResources(projectId),
    [],
    "Checkout Docker project already exists",
  );
  assert.ok(
    !names.some((name) => name.endsWith("_" + projectId)),
    "Checkout Docker resource already exists",
  );
}

async function inspectDatabase(ownership, port) {
  const name = "supabase_db_" + ownership.projectId;
  const [container] = JSON.parse(await docker(["inspect", "--type", "container", name]));
  assert.equal(container.Config.Labels[projectLabel], ownership.projectId);
  assert.equal(resolve(container.Config.Labels[workdirLabel]), ownership.directory);
  const expected = [{ HostIp: "127.0.0.1", HostPort: String(port) }];
  assert.deepEqual(
    container.HostConfig.PortBindings,
    { "5432/tcp": expected },
    "Checkout container must configure its database port only on loopback",
  );
  assert.deepEqual(
    container.NetworkSettings.Ports,
    { "5432/tcp": expected },
    "Checkout container must publish its running database port only on loopback",
  );
  return container.Id;
}

async function inspectResource(resource, command) {
  const reference = resource.id ?? resource.name;
  try {
    return JSON.parse(
      await command([resource.kind, "inspect", "--format", "{{json .}}", reference]),
    );
  } catch (error) {
    if (
      /no such (?:object|container|volume|network)|network .* not found/i.test(
        error.message,
      )
    )
      return null;
    throw error;
  }
}

function assertCreatedIdentity(ownership, resource, observed) {
  const labels = resource.kind === "container" ? observed.Config.Labels : observed.Labels;
  const name =
    resource.kind === "container" ? observed.Name?.replace(/^\//, "") : observed.Name;
  const sameIdentity =
    resource.kind === "volume"
      ? observed.CreatedAt === resource.createdAt && observed.Driver === "local"
      : observed.Id === resource.id;
  assert.ok(
    sameIdentity &&
      (!resource.name || resource.name === name) &&
      labels?.[projectLabel] === ownership.projectId &&
      labels?.[runLabel] === ownership.token,
    "Refusing cleanup of changed Docker identity: " + (resource.name ?? resource.id),
  );
}

const cleanupOrder = ["container", "volume", "network"];

async function listOwnedDockerResources(ownership, command) {
  const filter = "label=" + runLabel + "=" + ownership.token;
  const inventory = await Promise.all(
    cleanupOrder.map(async (kind) => {
      const flags = kind === "volume" ? [] : ["--no-trunc"];
      if (kind === "container") flags.push("--all");
      const format = kind === "volume" ? "{{.Name}}" : "{{.ID}}";
      const found = await command([
        kind,
        "ls",
        ...flags,
        "--filter",
        filter,
        "--format",
        format,
      ]);
      return found
        .split(/\r?\n/)
        .filter(Boolean)
        .map((reference) => {
          if (kind === "volume") {
            assert.equal(reference, "supabase_db_" + ownership.projectId);
            return { kind, name: reference };
          }
          assert.match(reference, /^[0-9a-f]{64}$/);
          return { kind, id: reference };
        });
    }),
  );
  return inventory.flat();
}

export async function removeCreatedDockerResources(
  ownership,
  resources,
  { command = docker, receipt = () => {} } = {},
) {
  await verifyOwnership(ownership);
  const pending = resources.toReversed();
  // Docker may commit a create before the relay receives its response.
  // Only adopt resources stamped with this run's private ownership label.
  for (const entry of await listOwnedDockerResources(ownership, command)) {
    if (
      pending.some(
        ({ kind, id, name }) =>
          kind === entry.kind && (entry.id ? id === entry.id : name === entry.name),
      )
    )
      continue;
    const observed = await inspectResource(entry, command);
    if (!observed) continue;
    const resource =
      entry.kind === "volume"
        ? { ...entry, createdAt: observed.CreatedAt, reconciled: true }
        : { ...entry, reconciled: true };
    if (entry.kind === "volume")
      assert.ok(resource.createdAt, "Owned Docker volume has no creation timestamp");
    assertCreatedIdentity(ownership, resource, observed);
    pending.push(resource);
  }
  pending.sort(
    (left, right) => cleanupOrder.indexOf(left.kind) - cleanupOrder.indexOf(right.kind),
  );
  const failures = [];
  for (const resource of pending) {
    const reference = resource.id ?? resource.name;
    try {
      const before = await inspectResource(resource, command);
      if (before) assertCreatedIdentity(ownership, resource, before);
      receipt({ phase: "before", ...resource, present: !!before });
      if (before) {
        const args =
          resource.kind === "container"
            ? ["container", "rm", "--force"]
            : [resource.kind, "rm"];
        await command([...args, reference]);
        assert.equal(
          await inspectResource(resource, command),
          null,
          "Owned Docker resource remains after removal",
        );
      }
      receipt({ phase: "after", ...resource, present: false });
    } catch (error) {
      failures.push(error.message);
    }
  }
  if (failures.length) throw new Error(failures.join("\n"));
  const remaining = await listOwnedDockerResources(ownership, command);
  assert.equal(
    remaining.length,
    0,
    "Owned checkout Docker resources remain after cleanup",
  );
}

async function readMigrations() {
  const directory = join(root, "supabase", "migrations");
  const entries = (await readdir(directory))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const migrations = await Promise.all(
    entries.map(async (file) => {
      const match = /^(\d{14})_(.+)\.sql$/.exec(file);
      assert.ok(match, "Unexpected migration filename: " + file);
      const source = await readFile(join(directory, file));
      return {
        version: match[1],
        name: match[2],
        hash: sha256(source),
        source: source.toString(),
      };
    }),
  );
  assert.equal(new Set(migrations.map(({ version }) => version)).size, migrations.length);
  assert.ok(
    migrations.some(({ version }) => version === historicalCutoff),
    "Missing historical migration cutoff",
  );
  const [source, diff, untracked] = await Promise.all([
    checked("git", ["rev-parse", "HEAD"]),
    checked("git", ["diff", "--binary", "HEAD", "--", "src", "supabase"], {
      maxBuffer: 64 * 1024 * 1024,
    }),
    checked("git", [
      "ls-files",
      "-o",
      "--exclude-standard",
      "-z",
      "--",
      "src",
      "supabase",
    ]),
  ]);
  const untrackedHashes = await Promise.all(
    untracked
      .split("\0")
      .filter(Boolean)
      .sort()
      .map(async (path) => [path, sha256(await readFile(join(root, path)))]),
  );
  const workingTree = sha256(JSON.stringify({ diff, untracked: untrackedHashes }));
  const schema = sha256(
    JSON.stringify(
      migrations.map(({ version, name, hash }) => ({ version, name, hash })),
    ),
  );
  return { migrations, source, workingTree, schema };
}

async function pg(url) {
  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 60_000,
    application_name: "checkout-hardening",
  });
  await client.connect();
  return client;
}

async function readBootstrapFingerprint(client) {
  return (
    await client.query(
      "select current_database() as database, " +
        "to_regclass('auth.users')::text as auth, to_regclass('storage.objects')::text as storage, " +
        "to_regnamespace('extensions')::text as extensions, " +
        "to_regclass('public.orders')::text as orders, " +
        "to_regclass('supabase_migrations.schema_migrations')::text as migrations, " +
        "(select count(*) from auth.users) as users, " +
        "(select count(*) from storage.objects) as objects",
    )
  ).rows[0];
}

export async function assertFreshTarget(client, database) {
  assert.match(database, databasePattern);
  const { rowCount } = await client.query(
    "select datname from pg_database where datname = $1",
    [database],
  );
  assert.equal(rowCount, 0, "Checkout mutation database already exists");
}

async function withQuiescentBootstrap(maintenance, containerId, operation) {
  const sql = "select datallowconn from pg_database where datname = 'postgres'";
  const {
    rows: [{ datallowconn: original }],
  } = await maintenance.query(sql);
  try {
    await maintenance.query("alter database postgres allow_connections false");
    const { rows: sessions } = await maintenance.query(
      "select pid, backend_type, application_name from pg_stat_activity where datname = 'postgres'",
    );
    for (const session of sessions) {
      assert.ok(
        session.backend_type === "pg_cron launcher" ||
          session.backend_type.startsWith("pg_net "),
        "Unexpected session on the owned platform bootstrap",
      );
      assert.ok(Number.isSafeInteger(session.pid) && session.pid > 0);
      // The platform postgres role owns the DB but cannot terminate the
      // platform superuser's workers. Use the inspected owned container's
      // local socket and limit the operation to this exact database and PID.
      const stopped = await docker([
        "exec",
        containerId,
        "psql",
        "-X",
        "--no-password",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "supabase_admin",
        "-d",
        "template1",
        "-Atq",
        "-c",
        "select pg_terminate_backend(pid, 5000) from pg_stat_activity where datname = 'postgres' and pid = " +
          session.pid +
          " and (backend_type = 'pg_cron launcher' or backend_type like 'pg_net %')",
      ]);
      assert.ok(
        stopped === "t" || stopped === "",
        "Owned platform bootstrap worker did not terminate",
      );
    }
    await operation();
  } finally {
    // This is only the platform bootstrap in the exact inspected project,
    // reached through template1. Application migrations use the named clone.
    await maintenance.query(
      "alter database postgres allow_connections " + String(original),
    );
    const {
      rows: [{ datallowconn: restored }],
    } = await maintenance.query(sql);
    assert.equal(restored, original, "Owned bootstrap connection flag was not restored");
  }
}

async function createMutationDatabase(url, database, containerId, verifyFailedClone) {
  const adminURL = new URL(url);
  adminURL.pathname = "/postgres";
  const bootstrapURL = adminURL.href;
  const bootstrap = await pg(bootstrapURL);
  let baseline;
  try {
    baseline = await readBootstrapFingerprint(bootstrap);
    assert.deepEqual(baseline, {
      database: "postgres",
      auth: "auth.users",
      storage: "storage.objects",
      extensions: "extensions",
      orders: null,
      migrations: null,
      users: "0",
      objects: "0",
    });
    await assertFreshTarget(bootstrap, database);
  } finally {
    await bootstrap.end();
  }
  adminURL.pathname = "/template1";
  const maintenance = await pg(adminURL.href);
  try {
    await assertFreshTarget(maintenance, database);
    if (verifyFailedClone) {
      const failure = new Error("Synthetic failure before named database creation");
      await assert.rejects(
        withQuiescentBootstrap(maintenance, containerId, () => {
          throw failure;
        }),
        (error) => error === failure,
      );
      const observer = await pg(bootstrapURL);
      try {
        assert.deepEqual(await readBootstrapFingerprint(observer), baseline);
      } finally {
        await observer.end();
      }
    }
    await withQuiescentBootstrap(maintenance, containerId, () =>
      maintenance.query('create database "' + database + '" template postgres'),
    );
    // The original bootstrap database must stay empty on both success and setup failure.
    const unchanged = async () => {
      adminURL.pathname = "/postgres";
      const observer = await pg(adminURL.href);
      try {
        assert.deepEqual(await readBootstrapFingerprint(observer), baseline);
      } finally {
        await observer.end();
      }
    };
    return unchanged;
  } finally {
    await maintenance.end();
  }
}

async function initializeRegistry(client, lease) {
  await client.query(
    "create schema if not exists supabase_migrations; " +
      "create table if not exists supabase_migrations.schema_migrations " +
      "(version text primary key, statements text[], name text); " +
      "create schema checkout_hardening_fixture; " +
      "revoke all on schema checkout_hardening_fixture from public, anon, authenticated, service_role; " +
      "create table checkout_hardening_fixture.ownership (token text not null, schema_hash text not null)",
  );
  await client.query("insert into checkout_hardening_fixture.ownership values ($1, $2)", [
    lease.ownership.token,
    lease.schema,
  ]);
}

async function applyMigrations(client, migrations) {
  for (const { version, name, source } of migrations) {
    try {
      await client.query(source);
      await client.query(
        "insert into supabase_migrations.schema_migrations (version, name, statements) " +
          "values ($1, $2, array[$3])",
        [version, name, source],
      );
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw new Error("Migration " + version + "_" + name + " failed: " + error.message, {
        cause: error,
      });
    }
  }
}

async function verifyRegistry(client, migrations) {
  const { rows } = await client.query(
    "select version, name, statements[1] as source from supabase_migrations.schema_migrations order by version",
  );
  assert.deepEqual(
    rows.map(({ version, name, source }) => ({ version, name, hash: sha256(source) })),
    migrations.map(({ version, name, hash }) => ({ version, name, hash })),
  );
}

export function barrier(parties) {
  assert.ok(
    Number.isInteger(parties) && parties > 0,
    "A barrier needs a positive party count",
  );
  const { promise, resolve: open } = Promise.withResolvers();
  let arrivals = 0;
  let released = false;
  return {
    wait() {
      assert.ok(arrivals < parties, "Too many barrier arrivals");
      arrivals++;
      if (released && arrivals === parties) open();
      return promise;
    },
    release() {
      released = true;
      if (arrivals === parties) open();
    },
  };
}

export async function raceAtRowLock(admin, clients, lockRow, action, verifyWaiters) {
  const pids = await Promise.all(
    clients.map(
      async (c) => (await c.query("select pg_backend_pid() as pid")).rows[0].pid,
    ),
  );
  assert.equal(new Set(pids).size, clients.length);
  let completed;
  await admin.query("begin");
  try {
    await lockRow(admin);
    completed = Promise.allSettled(clients.map(action));
    const until = Date.now() + 5000;
    while (true) {
      const {
        rows: [{ waiting }],
      } = await admin.query(
        "select count(*)::int as waiting from unnest($1::int[]) p where cardinality(pg_blocking_pids(p))>0",
        [pids],
      );
      if (waiting === clients.length) break;
      assert.ok(
        Date.now() < until,
        "both independent sessions must reach a PostgreSQL lock",
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (verifyWaiters) await verifyWaiters(admin, pids);
  } finally {
    await admin.query("rollback");
    if (completed) await completed;
  }
  return completed;
}

export function completedValues(results) {
  return results.map((result) => {
    if (result.status === "rejected") throw result.reason;
    return result.value;
  });
}

async function seedOwner(client) {
  const owner = (await client.query("select id from public.tenants")).rows[0];
  if (owner) return owner.id;
  return (
    await client.query(
      "insert into public.tenants(name) values ('Synthetic checkout fixture') returning id",
    )
  ).rows[0].id;
}

async function seedCatalog(client, { stock }) {
  assert.ok(Number.isInteger(stock) && stock >= 0, "Stock must be a nonnegative integer");
  const owner = await seedOwner(client);
  const suffix = randomUUID();
  const brand = (
    await client.query(
      "insert into public.tag_brands(canonical_label) values ($1) returning id",
      ["Checkout fixture brand " + suffix],
    )
  ).rows[0].id;
  const size = (
    await client.query(
      "insert into public.tag_sizes(size_type, canonical_label) values ('none',$1) returning id",
      ["Checkout fixture size " + suffix],
    )
  ).rows[0].id;
  const productId = (
    await client.query(
      "insert into public.products(tenant_id,name,condition,category,brand_id,size_type) " +
        "values ($1,'Checkout fixture product','new','accessories',$2,'none') returning id",
      [owner, brand],
    )
  ).rows[0].id;
  const variantId = (
    await client.query(
      "insert into public.product_variants(tenant_id,product_id,size_id,sku,sale_price_cents,stock) " +
        "values ($1,$2,$3,$4,1000,$5) returning id",
      [owner, productId, size, "checkout-fixture-" + suffix, stock],
    )
  ).rows[0].id;
  return { productId, variantId };
}

async function seedOrder(
  client,
  { userId = randomUUID(), status = "pending", totalCents = 1000 } = {},
) {
  assert.ok(
    Number.isSafeInteger(totalCents) && totalCents >= 0,
    "Total must be nonnegative integer cents",
  );
  const owner = await seedOwner(client);
  if (userId !== null) {
    const email = "checkout-" + userId + "@fixture.invalid";
    await client.query(
      "insert into auth.users(id,email,role,aud) values ($1,$2,'authenticated','authenticated') on conflict (id) do nothing",
      [userId, email],
    );
    await client.query(
      "insert into public.profiles(id,email,tenant_id,role) values ($1,$2,$3,'customer') on conflict (id) do nothing",
      [userId, email, owner],
    );
  }
  const {
    rows: [{ id: orderId }],
  } = await client.query(
    "insert into public.orders(tenant_id,user_id,guest_email,status,subtotal,shipping,total,currency,fulfillment,expires_at) " +
      "values ($1,$2,$3,$4,$5 / 100.0,0,$5 / 100.0,'USD','pickup',now() + interval '15 minutes') returning id",
    [
      owner,
      userId,
      userId === null ? "checkout-guest@fixture.invalid" : null,
      status,
      totalCents,
    ],
  );
  return { orderId, userId };
}

async function seedLegacySquareEvents(client) {
  const processed = randomUUID();
  const unprocessed = randomUUID();
  await client.query(
    "insert into public.square_webhook_events " +
      "(square_event_id,event_type,merchant_id,location_id,square_created_at,payload_sha256,event_data,received_at,processed_at) " +
      "values ($1,'payment.updated','fixture-merchant','fixture-location',$3,$5,$6,$3,$4), " +
      "($2,'payment.updated','fixture-merchant','fixture-location',$3,$7,$8,$3,null)",
    [
      processed,
      unprocessed,
      "2026-09-21T12:00:00.000Z",
      "2026-09-21T12:01:00.000Z",
      "a".repeat(64),
      { paymentStatus: "COMPLETED", paymentId: "fixture-processed" },
      "b".repeat(64),
      { paymentStatus: "PENDING", paymentId: "fixture-unprocessed" },
    ],
  );
  return { processed, unprocessed };
}

export async function populatedRows(client, catalog, order) {
  return (
    await client.query(
      "select (select to_jsonb(p) from products p where id = $1) as product, " +
        "(select to_jsonb(v) from product_variants v where id = $2) as variant, " +
        '(select to_jsonb(o) from orders o where id = $3) as "order", ' +
        "(select to_jsonb(p) from profiles p where id = $4) as profile, " +
        '(select to_jsonb(u) from auth.users u where id = $4) as "auth user", ' +
        '(select to_jsonb(e) from public.square_webhook_events e where e.square_event_id = $5) as "processed Square event", ' +
        '(select to_jsonb(e) from public.square_webhook_events e where e.square_event_id = $6) as "unprocessed Square event"',
      [
        catalog.productId,
        catalog.variantId,
        order.orderId,
        order.userId,
        order.legacySquareEvents.processed,
        order.legacySquareEvents.unprocessed,
      ],
    )
  ).rows[0];
}

export function assertPopulatedRowsPreserved(before, after) {
  for (const table of Object.keys(before)) {
    assert.ok(before[table] && after[table], "Populated fixture lost its " + table);
    // Later additive migrations may add defaults. Compare every pre-existing field.
    assert.deepEqual(
      Object.fromEntries(
        Object.keys(before[table]).map((key) => [key, after[table][key]]),
      ),
      before[table],
      "Populated fixture changed its " + table,
    );
  }
}

async function applyCheckoutSuffix(client, migrations, lease) {
  const prefix = migrations.filter(({ version }) => version <= shippingThrough);
  const suffix = migrations.slice(prefix.length);
  if (!lease.bootstrapBeforeCheckout) {
    await applyMigrations(client, suffix);
    return;
  }
  const bootstrap = suffix.find(({ version }) => version === bootstrapVersion);
  assert.ok(bootstrap, "Missing reporting schema bootstrap migration");
  const checkout = suffix.filter(({ version }) => version < bootstrapVersion);
  const later = suffix.filter(({ version }) => version > bootstrapVersion);
  assert.deepEqual(
    checkout.map(({ version }) => version),
    [
      "20261127040000",
      "20261127041000",
      "20261127042000",
      "20261127043000",
      "20261127044000",
      "20261127045000",
      "20261127046000",
      "20261127047000",
    ],
    "Only the eight historical checkout migrations may precede the recorded bootstrap in the suffix",
  );
  const preCheckout = [...prefix, bootstrap];
  await applyMigrations(client, [bootstrap]);
  await verifyRegistry(client, preCheckout);
  lease.preCheckoutVersions = (
    await client.query(
      "select version from supabase_migrations.schema_migrations order by version",
    )
  ).rows.map(({ version }) => version);
  assert.equal(lease.preCheckoutVersions.length, preCheckout.length);
  const bootstrapRows = () =>
    client.query(
      "select environment, initialized_at from analytics_source.reporting_schema_bootstrap order by environment",
    );
  const before = (await bootstrapRows()).rows;
  assert.equal(
    before.length,
    2,
    "Both environment bootstrap cursors must exist before checkout",
  );
  await applyMigrations(client, [...checkout, ...later]);
  assert.deepEqual(
    (await bootstrapRows()).rows,
    before,
    "The remaining migrations must preserve already-recorded reporting bootstrap cursors",
  );
}

async function replay(client, { migrations }, lease) {
  await initializeRegistry(client, lease);
  if (lease.mode === "fresh") {
    if (lease.bootstrapBeforeCheckout) {
      await applyMigrations(
        client,
        migrations.filter(({ version }) => version <= shippingThrough),
      );
      await applyCheckoutSuffix(client, migrations, lease);
    } else {
      await applyMigrations(client, migrations);
    }
    const {
      rows: [counts],
    } = await client.query(
      "select (select count(*) from orders) as orders, " +
        "(select count(*) from products) as products, (select count(*) from auth.users) as users",
    );
    assert.deepEqual(counts, { orders: "0", products: "0", users: "0" });
  } else {
    const prefix = migrations.filter(({ version }) => version <= historicalCutoff);
    assert.ok(
      migrations.length > prefix.length,
      "Populated replay must exercise an additive suffix",
    );
    await applyMigrations(client, prefix);
    await verifyRegistry(client, prefix);
    const catalog = await seedCatalog(client, { stock: 3 });
    const order = {
      ...(await seedOrder(client, { status: "paid", totalCents: 1987 })),
      legacySquareEvents: await seedLegacySquareEvents(client),
    };
    const legacyReview = await seedOrder(client, { status: "review" });
    await client.query(
      "update public.orders set failure_reason='square_payment_high_risk',square_order_id=$2,payment_transaction_id=$3 where id=$1",
      [legacyReview.orderId, "sq-" + legacyReview.orderId, "pay-" + legacyReview.orderId],
    );
    const before = await populatedRows(client, catalog, order);
    const remaining = migrations.slice(prefix.length);
    // Rehearse the already-shipping schema before applying this branch's unpublished migrations.
    const shippingPrefix = migrations.filter(({ version }) => version <= shippingThrough);
    await applyMigrations(
      client,
      remaining.slice(0, shippingPrefix.length - prefix.length),
    );
    await verifyRegistry(client, shippingPrefix);
    const recorded = (
      await client.query(
        "select version from supabase_migrations.schema_migrations order by version",
      )
    ).rows.map(({ version }) => version);
    assert.equal(recorded.length, 122);
    assert.deepEqual(
      validatePrefix(
        migrations.map(({ version }) => version),
        recorded,
      ),
      { blockers: [], through: shippingThrough },
    );
    const campaign = await createRaceCampaign(client);
    const prize = await seedPrize(client, { quantity: 2, campaignSlug: campaign.slug });
    const attempt = claimAttempt(prize, campaign);
    const won = await award(client, attempt);
    assert.equal(won.result.status, "won");
    assert.equal(won.replayed, false);
    const shippingState = () =>
      client.query(
        "select to_jsonb(c) as campaign, to_jsonb(p) as config, to_jsonb(v) as variant, to_jsonb(w) as claim, to_jsonb(a) as attempt from specialty_campaigns c join specialty_product_config p on p.campaign_id=c.id join product_variants v on v.id=p.variant_id join specialty_claims w on w.product_id=p.product_id join specialty_claim_attempts a on a.claim_id=w.id where p.product_id=$1",
        [prize.productId],
      );
    const shippingBefore = (await shippingState()).rows;
    assert.equal(shippingBefore.length, 1);
    const historicalMail = () =>
      client.query(
        "select event_key,kind,status from checkout_notification_outbox where order_id=$1 order by event_key",
        [order.orderId],
      );
    const oldMail = (await historicalMail()).rows;
    await applyCheckoutSuffix(client, migrations, lease);
    assert.deepEqual(
      (await shippingState()).rows,
      shippingBefore,
      "shipping specialty award and stock preserved",
    );
    assert.deepEqual(
      (await historicalMail()).rows,
      oldMail,
      "no historical reseller backfill",
    );
    const after = await populatedRows(client, catalog, order);
    assertPopulatedRowsPreserved(before, after);
    lease.populated = { ...catalog, ...order, legacyReview };
  }
  await verifyRegistry(client, migrations);
}

async function withAttachedFixture(lease, runTest) {
  const { ownership, database, port, url, schema } = lease;
  await verifyOwnership(ownership);
  assert.equal(database, ownership.projectId.replaceAll("-", "_"));
  validateMutationTarget(url, { database, port });
  assert.equal(
    await inspectDatabase(ownership, port),
    lease.containerId,
    "Checkout container changed",
  );
  const clients = [];
  const connect = async (role = "postgres") => {
    assert.ok(roles.has(role), "Unsupported checkout fixture role");
    const client = await pg(url);
    clients.push(client);
    const {
      rows: [identity],
    } = await client.query(
      "select current_database() as database, token, schema_hash as schema from checkout_hardening_fixture.ownership",
    );
    assert.deepEqual(identity, { database, token: ownership.token, schema });
    if (role !== "postgres") await client.query("set role " + role);
    return client;
  };
  try {
    const admin = await connect();
    await runTest({
      admin,
      connect,
      seedCatalog: (options) => seedCatalog(admin, options),
      seedOrder: (options) => seedOrder(admin, options),
      barrier,
      populated: lease.populated,
      withPostgrest: (work) => withPostgrest(lease, work),
    });
  } finally {
    await Promise.all(clients.map((client) => client.end()));
  }
}

export async function withCheckoutProject(
  mode,
  runTest,
  {
    verifyFailedClone = false,
    onResourceReceipt = () => {},
    bootstrapBeforeCheckout = false,
  } = {},
) {
  assert.ok(mode === "fresh" || mode === "populated", "Unknown checkout database mode");
  assert.equal(
    typeof bootstrapBeforeCheckout,
    "boolean",
    "Expected a bootstrap ordering flag",
  );
  const mark = (state, phase) => {
    if (process.env.CHECKOUT_GATE_DIAGNOSTICS === "true") {
      console.error(`CHECKOUT_FIXTURE_PHASE ${state} ${phase}`);
    }
  };
  mark("start", "docker-access");
  const upstreamSocket = await localDockerSocket();
  mark("done", "docker-access");
  mark("start", "inventory");
  const inventory = await readMigrations();
  mark("done", "inventory");
  mark("start", "preflight");
  const workspace = await mkdtemp(join(tmpdir(), "checkout-hardening-"));
  const projectId = "checkout-hardening-test-" + randomBytes(7).toString("hex");
  const ownership = await claimProjectDirectory(workspace, projectId);
  const resources = [];
  let verifyBootstrap;
  try {
    await assertUnusedProject(projectId);
    mark("done", "preflight");
    mark("start", "ports-config");
    const [port, apiPort, shadowPort] = await reservePorts();
    const directory = join(ownership.directory, "supabase");
    await mkdir(directory);
    await writeFile(
      join(directory, "config.toml"),
      [
        'project_id = "' + projectId + '"',
        "[api]",
        "port = " + apiPort,
        "[db]",
        "port = " + port,
        "shadow_port = " + shadowPort,
        "major_version = 17",
        "[db.seed]",
        "enabled = false",
      ].join("\n") + "\n",
      { flag: "wx" },
    );
    mark("done", "ports-config");
    mark("start", "docker-start");
    await withLoopbackPublishing(
      ownership,
      port,
      upstreamSocket,
      (env) => supabaseCommand(ownership, ["db", "start"], env),
      resources,
    );
    mark("done", "docker-start");
    mark("start", "identity");
    const containerId = await inspectDatabase(ownership, port);
    const primary = resources.find(
      (resource) => resource.kind === "container" && resource.id === containerId,
    );
    assert.ok(
      primary?.name === "supabase_db_" + projectId,
      "Database was not created by the checkout startup relay",
    );
    for (const resource of resources.filter(
      ({ kind, name }) => kind !== "container" || name,
    )) {
      const observed = await inspectResource(resource, docker);
      assert.ok(observed, "Owned checkout Docker resource disappeared");
      assertCreatedIdentity(ownership, resource, observed);
    }
    const database = projectId.replaceAll("-", "_");
    const url = "postgresql://postgres:postgres@127.0.0.1:" + port + "/" + database;
    validateMutationTarget(url, { database, port });
    mark("done", "identity");
    mark("start", "clone");
    verifyBootstrap = await createMutationDatabase(
      url,
      database,
      containerId,
      verifyFailedClone,
    );
    mark("done", "clone");
    const lease = {
      ownership,
      mode,
      port,
      database,
      url,
      schema: inventory.schema,
      containerId,
      bootstrapBeforeCheckout,
    };
    mark("start", "connect");
    const admin = await pg(url);
    try {
      assert.equal(
        (await admin.query("select current_database() as name")).rows[0].name,
        database,
      );
      mark("done", "connect");
      mark("start", "replay");
      await replay(admin, inventory, lease);
    } finally {
      await admin.end();
    }
    mark("done", "replay");
    mark("start", "test");
    await runTest({
      source: inventory.source,
      workingTree: inventory.workingTree,
      schema: inventory.schema,
      migrations: inventory.migrations.length,
      projectId,
      mode,
      preCheckoutVersions: lease.preCheckoutVersions,
      childEnv: { [leaseKey]: JSON.stringify(lease) },
      withDatabase: (callback) => withAttachedFixture(lease, callback),
    });
    mark("done", "test");
  } finally {
    try {
      if (verifyBootstrap) {
        mark("start", "bootstrap-cleanup");
        await verifyBootstrap();
        mark("done", "bootstrap-cleanup");
      }
    } finally {
      mark("start", "resources-cleanup");
      await removeCreatedDockerResources(ownership, resources, {
        receipt: onResourceReceipt,
      });
      mark("done", "resources-cleanup");
      mark("start", "directory-cleanup");
      await removeOwnedDirectory(ownership);
      await rmdir(workspace);
      mark("done", "directory-cleanup");
    }
  }
}

export async function withCheckoutDatabase(mode, runTest) {
  if (process.env[leaseKey]) {
    const lease = JSON.parse(process.env[leaseKey]);
    assert.equal(mode, lease.mode, "CLI database mode differs from test mode");
    await withAttachedFixture(lease, runTest);
  } else {
    await withCheckoutProject(mode, ({ withDatabase }) => withDatabase(runTest));
  }
}
