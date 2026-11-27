import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

export const BOOTSTRAP_VERSION = "20261127134000";
const MIGRATIONS = "supabase/migrations";
// Reviewed migration bytes from the combined checkout release and PR #56.
// This exception authorizes this one already-recorded bootstrap, never arbitrary gaps.
const APPROVED = [
  ["20261127040000_checkout_authority.sql", "74d5757641b33b953fb75c08e8a1b145b1c281bf"],
  ["20261127041000_checkout_recovery.sql", "03efc9e1cfee42dccc66076eb7502ee8099cc556"],
  ["20261127042000_checkout_attempts.sql", "af2bbd7324cd14801ecde0e39942e8e07bfadb2f"],
  [
    "20261127043000_checkout_financial_facts.sql",
    "e3a8cfd085c15d6b9b6a6f96f9e345878fc6e0e0",
  ],
  [
    "20261127044000_checkout_reservations.sql",
    "80e6be03acd03a7de79927d6e3030ffc43e943cc",
  ],
  ["20261127045000_checkout_operations.sql", "835ffc0a35f560ee858b1aceed9f8984532a57ef"],
  [
    "20261127046000_checkout_release_mail_authority.sql",
    "6ff97f32e4a7b51ae05d9590135252c2171580da",
  ],
  [
    "20261127047000_checkout_analytics_integration.sql",
    "07611bbfc1405ed0deb1a5ec90044056d3ad0822",
  ],
  [
    "20261127134000_analytics_schema_bootstrap.sql",
    "6f180972e8916dce48a6f9fec22a2f9579ee18a9",
  ],
];
const CHECKOUT = APPROVED.slice(0, 8).map(([file]) => file.slice(0, 14));

export function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function readMigrationInventory(root) {
  const git = (args, input) =>
    execFileSync("git", args, {
      cwd: root,
      input,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    });
  const head = git(["rev-parse", "HEAD"]).toString().trim();
  const entries = git(["ls-tree", "-r", "-z", head, "--", MIGRATIONS])
    .toString()
    .split("\0")
    .filter(Boolean)
    .filter((line) => /\.sql$/i.test(line))
    .map((line) => {
      const match =
        /^(100644|100755) blob ([a-f0-9]+)\t(supabase\/migrations\/(\d{14})_[^/\\\r\n]+\.sql)$/.exec(
          line,
        );
      if (!match) throw new Error("invalid_committed_migration_inventory");
      return { path: match[3], version: match[4], blob: match[2] };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
  if (
    !entries.length ||
    new Set(entries.map(({ version }) => version)).size !== entries.length
  )
    throw new Error("invalid_committed_migration_inventory");
  const disk = [];
  function scan(relative) {
    const absolute = join(root, relative);
    if (lstatSync(absolute).isSymbolicLink())
      throw new Error("migration_inventory_drift");
    for (const name of readdirSync(absolute)) {
      const path = `${relative}/${name}`;
      const stat = lstatSync(join(root, path));
      if (stat.isSymbolicLink()) throw new Error("migration_inventory_drift");
      if (stat.isDirectory()) scan(path);
      else if (/\.sql$/i.test(name)) {
        if (!stat.isFile()) throw new Error("migration_inventory_drift");
        disk.push(path);
      }
    }
  }
  try {
    scan(MIGRATIONS);
    if (
      JSON.stringify(disk.sort()) !==
      JSON.stringify(entries.map(({ path }) => path).sort())
    )
      throw new Error("migration_inventory_drift");
    // stdin-paths applies the same per-path clean filters as hash-object --path.
    // A clean Windows CRLF checkout therefore matches the committed LF blob.
    const hashes = git(
      ["hash-object", "--stdin-paths"],
      entries.map(({ path }) => path).join("\n") + "\n",
    )
      .toString()
      .trim()
      .split(/\r?\n/);
    if (
      hashes.length !== entries.length ||
      entries.some((entry, index) => entry.blob !== hashes[index])
    )
      throw new Error("migration_inventory_drift");
    // Compare registry SQL against immutable committed bytes, not checkout line endings.
    const committed = git(
      ["cat-file", "--batch"],
      entries.map(({ blob }) => blob).join("\n") + "\n",
    );
    let offset = 0;
    for (const entry of entries) {
      const end = committed.indexOf("\n", offset);
      const header = /^([a-f0-9]+) blob (\d+)$/.exec(
        committed.subarray(offset, end).toString(),
      );
      if (!header || header[1] !== entry.blob)
        throw new Error("migration_inventory_drift");
      const size = Number(header[2]);
      offset = end + 1;
      if (committed[offset + size] !== 10) throw new Error("migration_inventory_drift");
      entry.sql = committed.subarray(offset, offset + size).toString("utf8");
      offset += size + 1;
    }
  } catch {
    throw new Error("migration_inventory_drift");
  }
  return {
    head,
    entries,
    inventoryDigest: digest(
      entries.map(({ path, version, blob }) => ({ path, version, blob })),
    ),
  };
}

// Tokenize SQL instead of splitting on semicolons or deleting comment-looking
// text inside strings. Dollar-quoted bodies remain indivisible, exact tokens.
export function canonicalSqlStatements(value) {
  const sql = value.replace(/\r\n/g, "\n");
  const statements = [];
  let tokens = [];
  let index = 0;
  const finish = () => {
    if (tokens.length) statements.push(tokens);
    tokens = [];
  };
  while (index < sql.length) {
    const rest = sql.slice(index);
    if (/^\s/.test(rest)) {
      index++;
      continue;
    }
    if (rest.startsWith("--")) {
      const end = sql.indexOf("\n", index + 2);
      index = end < 0 ? sql.length : end + 1;
      continue;
    }
    if (rest.startsWith("/*")) {
      let depth = 1;
      index += 2;
      while (depth && index < sql.length) {
        if (sql.startsWith("/*", index)) {
          depth++;
          index += 2;
        } else if (sql.startsWith("*/", index)) {
          depth--;
          index += 2;
        } else index++;
      }
      if (depth) throw new Error("invalid_migration_sql");
      continue;
    }
    const quote = sql[index];
    if (quote === "'" || quote === '"') {
      const start = index++;
      const escaped =
        quote === "'" && /(?:^|[^A-Za-z0-9_$])[eE]$/.test(sql.slice(0, start));
      let closed = false;
      while (index < sql.length) {
        if (escaped && sql[index] === "\\") {
          index += 2;
          continue;
        }
        if (sql[index++] === quote) {
          if (sql[index] === quote) index++;
          else {
            closed = true;
            break;
          }
        }
      }
      if (!closed) throw new Error("invalid_migration_sql");
      tokens.push(sql.slice(start, index));
      continue;
    }
    const dollar = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(rest)?.[0];
    if (dollar) {
      const end = sql.indexOf(dollar, index + dollar.length);
      if (end < 0) throw new Error("invalid_migration_sql");
      tokens.push(sql.slice(index, end + dollar.length));
      index = end + dollar.length;
      continue;
    }
    if (quote === ";") {
      finish();
      index++;
      continue;
    }
    const token =
      /^[A-Za-z_][A-Za-z0-9_$]*|^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|^[~!@#%^&|`?+*/<>=:\-]+/.exec(
        rest,
      )?.[0] ?? quote;
    tokens.push(token.toLowerCase());
    index += token.length;
  }
  finish();
  if (
    JSON.stringify(statements[0]) === '["begin"]' &&
    JSON.stringify(statements.at(-1)) === '["commit"]'
  ) {
    statements.shift();
    statements.pop();
  }
  return statements.map((statement) => JSON.stringify(statement));
}

export function bootstrapMatches(inventory, recordedRows) {
  const recorded = recordedRows.find(({ version }) => version === BOOTSTRAP_VERSION);
  if (!recorded) return true;
  const committed = inventory.entries.find(
    ({ version }) => version === BOOTSTRAP_VERSION,
  );
  if (
    !committed ||
    recorded.name !== "analytics_schema_bootstrap" ||
    !Array.isArray(recorded.statements) ||
    !recorded.statements.every((statement) => typeof statement === "string")
  )
    return false;
  try {
    return (
      JSON.stringify(canonicalSqlStatements(committed.sql)) ===
      JSON.stringify(canonicalSqlStatements(recorded.statements.join("\n;\n")))
    );
  } catch {
    return false;
  }
}

export function reviewedBackfill(inventory, recorded) {
  if (!recorded.includes(BOOTSTRAP_VERSION)) return false;
  const known = inventory.entries.map(({ version }) => version);
  if (
    !APPROVED.every(([file, blob]) =>
      inventory.entries.some(
        (entry) => entry.path === `${MIGRATIONS}/${file}` && entry.blob === blob,
      ),
    )
  )
    return false;
  const baseline = known.filter((version) => version <= "20261127034000");
  if (baseline.length !== 122 || baseline.some((version) => !recorded.includes(version)))
    return false;
  const intervening = known.filter(
    (version) => version > "20261127034000" && version < BOOTSTRAP_VERSION,
  );
  if (JSON.stringify(intervening) !== JSON.stringify(CHECKOUT)) return false;
  const applied = CHECKOUT.filter((version) => recorded.includes(version));
  if (JSON.stringify(applied) !== JSON.stringify(CHECKOUT.slice(0, applied.length)))
    return false;
  // A reviewed early gap cannot hide any unrelated gap later in the registry.
  const through = recorded.at(-1);
  const missing = known.filter(
    (version) => version <= through && !recorded.includes(version),
  );
  return (
    missing.length > 0 &&
    JSON.stringify(missing) === JSON.stringify(CHECKOUT.slice(applied.length))
  );
}

export function databaseFingerprint(connectionString) {
  // Use pg's parsed effective connection identity, including libpq query overrides.
  // Passwords, certificate paths and other connection secrets never enter the hash.
  const parsed = new Client({ connectionString }).connectionParameters;
  return digest({
    host: parsed.host.toLowerCase(),
    port: Number(parsed.port),
    database: parsed.database,
    user: parsed.user,
  });
}
