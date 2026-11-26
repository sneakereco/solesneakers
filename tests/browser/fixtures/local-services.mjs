// Test-owned provider boundary: real PostgREST + Redis, synthetic local Auth responses.
// Never import this from application code.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createConnection } from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { testUrl } from "../../database/fixtures/specialty-claims.mjs";
const execute = promisify(execFile);
const runDocker = (args) =>
  execute("docker", args, { windowsHide: true, maxBuffer: 1024 * 1024 });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function listen(server, port = 0) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return server.address().port;
}
async function freePort() {
  const server = createServer();
  const port = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  return port;
}
function parseRESP(bytes, start = 0) {
  const end = bytes.indexOf("\r\n", start);
  if (end < 0) return null;
  const kind = String.fromCharCode(bytes[start]),
    text = bytes.toString("utf8", start + 1, end);
  let next = end + 2;
  if (kind === "+") return { value: text, next };
  if (kind === "-") return { value: new Error(text), next };
  if (kind === ":") return { value: Number(text), next };
  const count = Number(text);
  if (count === -1) return { value: null, next };
  if (kind === "$") {
    if (bytes.length < next + count + 2) return null;
    return { value: bytes.toString("utf8", next, next + count), next: next + count + 2 };
  }
  if (kind === "*") {
    const value = [];
    for (let index = 0; index < count; index++) {
      const child = parseRESP(bytes, next);
      if (!child) return null;
      value.push(child.value);
      next = child.next;
    }
    return { value, next };
  }
  throw new Error("Unsupported local Redis protocol response.");
}
export class RedisWire {
  pending = [];
  buffer = Buffer.alloc(0);
  async connect(port) {
    this.socket = createConnection({ host: "127.0.0.1", port });
    await new Promise((resolve, reject) => {
      this.socket.once("connect", resolve);
      this.socket.once("error", reject);
    });
    const disconnected = () => this.rejectPending("Local Redis unavailable.");
    this.socket.on("error", disconnected);
    this.socket.on("close", disconnected);
    this.socket.on("data", (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      for (;;) {
        const parsed = parseRESP(this.buffer);
        if (!parsed) break;
        this.buffer = this.buffer.subarray(parsed.next);
        const item = this.pending.shift();
        if (!item) continue;
        if (parsed.value instanceof Error) item.reject(parsed.value);
        else item.resolve(parsed.value);
      }
    });
  }
  rejectPending(message) {
    for (const item of this.pending.splice(0)) item.reject(new Error(message));
  }
  command(args, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      if (!this.socket?.writable || this.socket.destroyed) {
        reject(new Error("Local Redis unavailable."));
        return;
      }
      const timer = setTimeout(() => {
        this.rejectPending("Local Redis request timed out.");
        this.socket.destroy();
      }, timeoutMs);
      this.pending.push({
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      const parts = [Buffer.from("*" + args.length + "\r\n")];
      for (const arg of args) {
        const part = Buffer.from(String(arg));
        parts.push(Buffer.from("$" + part.length + "\r\n"), part, Buffer.from("\r\n"));
      }
      this.socket.write(Buffer.concat(parts));
    });
  }
  close() {
    this.socket?.destroy();
  }
}
function jwt(payload, key) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
    "base64url",
  );
  const body = Buffer.from(
    JSON.stringify({
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 28800,
      ...payload,
    }),
  ).toString("base64url");
  const value = header + "." + body;
  return value + "." + createHmac("sha256", key).update(value).digest("base64url");
}
function verifyJwt(token, key) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const expected = createHmac("sha256", key)
      .update(parts[0] + "." + parts[1])
      .digest();
    const supplied = Buffer.from(parts[2], "base64url");
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied))
      return null;
    const data = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    return data.exp > Date.now() / 1000 ? data : null;
  } catch {
    return null;
  }
}
async function bodyBytes(request) {
  let size = 0;
  const parts = [];
  for await (const part of request) {
    size += part.length;
    if (size > 1024 * 1024) throw new Error("Fixture request too large.");
    parts.push(part);
  }
  return Buffer.concat(parts);
}
const encodeRedis = (value) =>
  Array.isArray(value)
    ? value.map(encodeRedis)
    : typeof value === "string" && value !== "OK"
      ? Buffer.from(value).toString("base64")
      : value;
export async function startLocalSpecialtyServices({
  runId,
  databaseUrl,
  privateDir,
  appOrigin,
  users,
}) {
  assert.match(runId, /^[a-f0-9-]{36}$/);
  const database = testUrl(databaseUrl);
  const jwtSecret = randomBytes(32).toString("hex"),
    redisToken = randomBytes(32).toString("hex");
  const suffix = runId.replaceAll("-", "").slice(0, 16);
  const containers = ["sole_specialty_rest_" + suffix, "sole_specialty_redis_" + suffix];
  const restPort = await freePort(),
    redisPort = await freePort();
  let gateway, wire;
  async function stop() {
    if (gateway)
      await new Promise((resolve) => {
        gateway.closeAllConnections();
        gateway.close(resolve);
      });
    wire?.close();
    for (const name of containers) {
      try {
        const marker = (
          await runDocker([
            "inspect",
            "--format",
            '{{ index .Config.Labels "sole.specialty.test-run" }}',
            name,
          ])
        ).stdout.trim();
        assert.equal(marker, runId, "Refusing to stop an unowned container.");
        await runDocker(["rm", "-f", name]);
      } catch (error) {
        if (error instanceof assert.AssertionError) throw error;
      }
    }
  }
  try {
    // Fixed, already-cached images; never pull or mutate another Supabase project.
    await runDocker(["image", "inspect", "public.ecr.aws/supabase/postgrest:v16.2"]);
    await runDocker(["image", "inspect", "redis:7.4-alpine"]);
    const dockerDatabase = new URL(database);
    dockerDatabase.hostname = "host.docker.internal";
    const envFile = join(privateDir, "postgrest.env");
    await writeFile(
      envFile,
      [
        "PGRST_DB_URI=" + dockerDatabase,
        "PGRST_DB_SCHEMAS=public",
        "PGRST_DB_ANON_ROLE=anon",
        "PGRST_JWT_SECRET=" + jwtSecret,
        "PGRST_DB_POOL=32",
        "PGRST_DB_POOL_ACQUISITION_TIMEOUT=10",
      ].join("\n"),
      { mode: 0o600 },
    );
    await runDocker([
      "run",
      "-d",
      "--name",
      containers[0],
      "--label",
      "sole.specialty.test-run=" + runId,
      "--env-file",
      envFile,
      "-p",
      "127.0.0.1:" + restPort + ":3000",
      "public.ecr.aws/supabase/postgrest:v16.2",
    ]);
    await runDocker([
      "run",
      "-d",
      "--name",
      containers[1],
      "--label",
      "sole.specialty.test-run=" + runId,
      "-p",
      "127.0.0.1:" + redisPort + ":6379",
      "redis:7.4-alpine",
      "redis-server",
      "--save",
      "",
      "--appendonly",
      "no",
    ]);
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        wire = new RedisWire();
        await wire.connect(redisPort);
        await wire.command(["PING"]);
        break;
      } catch {
        wire?.close();
        if (attempt === 99) throw new Error("Local Redis did not start.");
        await wait(100);
      }
    }
    const serviceKey = jwt({ role: "service_role", iss: "supabase" }, jwtSecret);
    const anonymousKey = jwt({ role: "anon", iss: "supabase" }, jwtSecret);
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const response = await fetch("http://127.0.0.1:" + restPort + "/", {
          headers: { Authorization: "Bearer " + serviceKey },
          signal: AbortSignal.timeout(2000),
        });
        const ok = response.ok;
        await response.body?.cancel();
        if (ok) break;
        if (attempt === 99) throw new Error("Local REST did not start.");
      } catch {
        if (attempt === 99) throw new Error("Local REST did not start.");
      }
      await wait(100);
    }
    const diagnostics = {};
    gateway = createServer(async (request, response) => {
      const started = performance.now();
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      const kind = pathname.startsWith("/redis")
        ? "redis"
        : pathname.startsWith("/rest/v1/rpc/")
          ? pathname.slice("/rest/v1/rpc/".length)
          : pathname.startsWith("/rest/v1/")
            ? "database_reads"
            : pathname.startsWith("/auth/")
              ? "auth"
              : "other";
      const entry = (diagnostics[kind] ??= { count: 0, errors: 0, maxMs: 0 });
      entry.count++;
      response.once("finish", () => {
        entry.maxMs = Math.max(entry.maxMs, performance.now() - started);
        if (response.statusCode >= 400) entry.errors++;
      });
      response.setHeader("Access-Control-Allow-Origin", appOrigin);
      response.setHeader(
        "Access-Control-Allow-Headers",
        "authorization,apikey,content-type,x-client-info,prefer,x-supabase-api-version",
      );
      response.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
      const send = (status, value) => {
        response.writeHead(status, { "Content-Type": "application/json" });
        response.end(JSON.stringify(value));
      };
      try {
        if (request.method === "OPTIONS") {
          response.writeHead(204);
          response.end();
          return;
        }
        const url = new URL(request.url, "http://127.0.0.1");
        if (url.pathname.startsWith("/redis")) {
          if (request.headers.authorization !== "Bearer " + redisToken)
            return send(401, { error: "Unauthorized" });
          const data = JSON.parse((await bodyBytes(request)).toString());
          const commands = Array.isArray(data[0]) ? data : [data];
          const results = await Promise.all(
            commands.map(async (command) => {
              try {
                const result = await wire.command(command);
                return {
                  result:
                    request.headers["upstash-encoding"] === "base64"
                      ? encodeRedis(result)
                      : result,
                };
              } catch (error) {
                return { error: error.message };
              }
            }),
          );
          return send(200, Array.isArray(data[0]) ? results : results[0]);
        }
        if (url.pathname === "/auth/v1/user") {
          const claims = verifyJwt(
            request.headers.authorization?.replace(/^Bearer /, "") ?? "",
            jwtSecret,
          );
          const user =
            claims && claims.role === "authenticated" ? users.get(claims.sub) : null;
          return user
            ? send(200, user)
            : send(401, { message: "Invalid fixture session." });
        }
        if (url.pathname === "/auth/v1/logout") {
          response.writeHead(204);
          response.end();
          return;
        }
        if (url.pathname.startsWith("/rest/v1/")) {
          const headers = { ...request.headers };
          delete headers.host;
          delete headers["content-length"];
          delete headers.connection;
          const body =
            request.method === "GET" || request.method === "HEAD"
              ? undefined
              : await bodyBytes(request);
          const upstream = await fetch(
            "http://127.0.0.1:" +
              restPort +
              url.pathname.slice("/rest/v1".length) +
              url.search,
            { method: request.method, headers, body },
          );
          response.statusCode = upstream.status;
          for (const [name, value] of upstream.headers)
            if (
              ![
                "transfer-encoding",
                "connection",
                "content-encoding",
                "content-length",
              ].includes(name)
            )
              response.setHeader(name, value);
          response.end(Buffer.from(await upstream.arrayBuffer()));
          return;
        }
        return send(404, { error: "Fixture provider path not supported." });
      } catch {
        if (!response.headersSent) send(503, { error: "Local provider unavailable." });
        else response.destroy();
      }
    });
    const port = await listen(gateway),
      origin = "http://127.0.0.1:" + port;
    return {
      origin,
      serviceKey,
      anonymousKey,
      redisUrl: origin + "/redis",
      redisToken,
      tokenForUser: (id) => {
        assert.ok(users.has(id));
        return jwt(
          {
            sub: id,
            role: "authenticated",
            aud: "authenticated",
            iss: origin + "/auth/v1",
          },
          jwtSecret,
        );
      },
      stop,
      getDiagnostics: () => structuredClone(diagnostics),
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
