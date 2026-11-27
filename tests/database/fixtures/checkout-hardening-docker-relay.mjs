import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, request } from "node:http";
import { connect } from "node:net";
import { join, resolve } from "node:path";

const projectLabel = "com.supabase.cli.project";
const workdirLabel = "com.supabase.cli.workdir";
export const runLabel = "com.solesneakers.checkout-hardening.owner";
const databaseImage = "public.ecr.aws/supabase/postgres:17.6.1.167";
const pinnedDatabaseCommandHash =
  "ec6b2bcd8e000bd2bbb4a773aaf89b1e13628c4b525d2396aba384a3069c3dc6";
const platformInitializers = new Map([
  [
    "public.ecr.aws/supabase/realtime:v2.130.0",
    [
      "/app/bin/realtime",
      "eval",
      '{:ok, _} = Application.ensure_all_started(:realtime)\n{:ok, _} = Realtime.Tenants.health_check("realtime-dev")',
    ],
  ],
  [
    "public.ecr.aws/supabase/storage-api:v1.72.1",
    ["node", "dist/scripts/migrate-call.js"],
  ],
  ["public.ecr.aws/supabase/gotrue:v2.196.0", ["gotrue", "migrate"]],
]);

function dockerEndpoint(path) {
  return new URL(path, "http://local-docker.invalid").pathname.replace(
    /^\/v\d+\.\d+/,
    "",
  );
}

function resourceKind(method, path) {
  if (method !== "POST") return undefined;
  return {
    "/containers/create": "container",
    "/volumes/create": "volume",
    "/networks/create": "network",
  }[dockerEndpoint(path)];
}

export function rewriteStartupRequest(
  method,
  path,
  body,
  {
    projectId,
    directory,
    token,
    port,
    names,
    resources,
    databaseCommandHash = pinnedDatabaseCommandHash,
  },
) {
  const url = new URL(path, "http://local-docker.invalid");
  const endpoint = dockerEndpoint(path);
  if (method === "GET" || method === "HEAD") return body;
  const kind = resourceKind(method, path);
  if (kind) {
    assert.equal(body.Labels?.[projectLabel], projectId);
    if (body.Labels[workdirLabel])
      assert.equal(resolve(body.Labels[workdirLabel]), directory);
    const name = kind === "container" ? url.searchParams.get("name") : body.Name;
    if (name)
      assert.ok(
        !resources.some((resource) => resource.kind === kind && resource.name === name),
        "Repeated create for an owned Docker name",
      );
    if (kind === "container") {
      const config = body.HostConfig;
      assert.equal(config.NetworkMode, names.network);
      assert.ok(
        Object.keys(body.NetworkingConfig?.EndpointsConfig ?? {}).every(
          (name) => name === names.network,
        ),
      );
      assert.ok(
        resources.some(
          (resource) => resource.kind === "network" && resource.name === names.network,
        ),
      );
      assert.equal(config.Mounts?.length ?? 0, 0);
      assert.equal(config.VolumesFrom?.length ?? 0, 0);
      assert.deepEqual(Object.keys(config.Tmpfs ?? {}), []);
      assert.deepEqual(Object.keys(body.Volumes ?? {}), []);
      assert.equal(Boolean(config.Privileged), false);
      if (!name) {
        assert.ok(platformInitializers.has(body.Image));
        assert.deepEqual(body.Cmd, platformInitializers.get(body.Image));
        assert.equal(body.Entrypoint, null);
        assert.equal(config.AutoRemove, true);
        assert.deepEqual(Object.keys(config.PortBindings ?? {}), []);
        assert.equal(config.Binds?.length ?? 0, 0);
      } else {
        assert.equal(resolve(body.Labels[workdirLabel]), directory);
        assert.equal(name, names.container);
        assert.equal(body.Image, databaseImage);
        assert.deepEqual(body.Entrypoint, ["sh"]);
        assert.equal(
          createHash("sha256").update(JSON.stringify(body.Cmd)).digest("hex"),
          databaseCommandHash,
        );
        assert.ok(
          resources.some(
            (resource) => resource.kind === "volume" && resource.name === names.volume,
          ),
        );
        assert.deepEqual(config.Binds, [names.volume + ":/var/lib/postgresql/data"]);
        const bindings = config.PortBindings;
        assert.deepEqual(Object.keys(bindings), ["5432/tcp"]);
        assert.equal(bindings["5432/tcp"].length, 1);
        assert.equal(bindings["5432/tcp"][0].HostPort, String(port));
        bindings["5432/tcp"][0].HostIp = "127.0.0.1";
      }
    } else {
      assert.equal(name, names[kind]);
      assert.equal(body.Driver, kind === "volume" ? "local" : "bridge");
      assert.deepEqual(Object.keys(body.DriverOpts ?? {}), []);
      assert.deepEqual(Object.keys(body.Options ?? {}), []);
    }
    assert.equal(typeof token, "string");
    body.Labels[runLabel] = token;
    return body;
  }
  if (method === "POST" && endpoint === "/images/create") {
    const repository = url.searchParams.get("fromImage");
    const tag = url.searchParams.get("tag");
    const image = tag ? repository + ":" + tag : repository;
    assert.ok(image === databaseImage || platformInitializers.has(image));
    return body;
  }
  const ownsId = (kind, candidate) =>
    resources.some((resource) => resource.kind === kind && resource.id === candidate);
  const container =
    /^\/containers\/([^/]+)(\/start|\/stop|\/archive|\/attach|\/wait)?$/.exec(endpoint);
  if (container && ownsId("container", container[1])) {
    if (
      method === "POST" &&
      ["/start", "/stop", "/attach", "/wait"].includes(container[2])
    )
      return body;
    if (method === "PUT" && container[2] === "/archive") return body;
    if (method === "DELETE" && !container[2]) return body;
  }
  const network = /^\/networks\/([^/]+)$/.exec(endpoint);
  if (method === "DELETE" && network && ownsId("network", network[1])) return body;
  throw new Error("Refusing unexpected checkout Docker mutation");
}

function recordCreation(resources, kind, requestedName, result, token) {
  if (kind === "volume") {
    // Docker returns 201 with the existing object on a duplicate volume create.
    assert.equal(result.Name, requestedName);
    assert.equal(result.Labels?.[runLabel], token);
    assert.equal(result.Driver, "local");
    assert.ok(result.CreatedAt);
    resources.push({ kind, name: result.Name, createdAt: result.CreatedAt });
  } else {
    assert.match(result.Id, /^[0-9a-f]{64}$/);
    resources.push({ kind, name: requestedName, id: result.Id });
  }
}

// The pinned CLI emits a numeric -p argument. Docker Desktop publishes it on
// every interface even when its bridge has a loopback default. Keep the relay
// private to the startup child and set HostIp on the one owned create request.
export async function withLoopbackPublishing(
  { directory, projectId, token },
  port,
  upstreamSocket,
  start,
  resources = [],
) {
  const names = {
    container: "supabase_db_" + projectId,
    volume: "supabase_db_" + projectId,
    network: "supabase_network_" + projectId,
  };
  const socketPath =
    process.platform === "win32"
      ? "\\\\.\\pipe\\" + projectId
      : join(directory, "docker.sock");
  const host =
    process.platform === "win32"
      ? "npipe:////./pipe/" + projectId
      : "unix://" + socketPath;
  const options = { projectId, directory, token, port, names, resources };
  const rejectedMutations = new Set();
  const upgrades = new Set();
  const server = createServer(async (incoming, outgoing) => {
    try {
      let headers = incoming.headers;
      let body;
      let requestedName;
      const kind = resourceKind(incoming.method, incoming.url);
      if (incoming.method === "PUT") {
        rewriteStartupRequest(incoming.method, incoming.url, null, options);
      } else if (incoming.method !== "GET" && incoming.method !== "HEAD") {
        const chunks = [];
        for await (const chunk of incoming) chunks.push(chunk);
        const raw = Buffer.concat(chunks);
        const data = rewriteStartupRequest(
          incoming.method,
          incoming.url,
          raw.length ? JSON.parse(raw.toString()) : null,
          options,
        );
        if (kind) {
          const url = new URL(incoming.url, "http://local-docker.invalid");
          requestedName = kind === "container" ? url.searchParams.get("name") : data.Name;
        }
        body = data ? JSON.stringify(data) : "";
        headers = { ...headers, "content-length": Buffer.byteLength(body) };
        delete headers["transfer-encoding"];
      }
      const upstream = request(
        {
          socketPath: upstreamSocket,
          path: incoming.url,
          method: incoming.method,
          headers,
        },
        async (response) => {
          if (response.statusCode === 201 && kind) {
            try {
              const chunks = [];
              for await (const chunk of response) chunks.push(chunk);
              const result = Buffer.concat(chunks);
              recordCreation(
                resources,
                kind,
                requestedName,
                JSON.parse(result.toString()),
                token,
              );
              outgoing.writeHead(response.statusCode, response.headers).end(result);
            } catch {
              outgoing.writeHead(502).end("Local Docker could not confirm ownership");
            }
            return;
          }
          outgoing.writeHead(response.statusCode, response.headers);
          // Docker waits for the /wait response headers before starting its container.
          outgoing.flushHeaders();
          response.pipe(outgoing);
        },
      );
      outgoing.once("close", () => upstream.destroy());
      upstream.on("error", () => {
        if (outgoing.headersSent) outgoing.destroy();
        else outgoing.writeHead(502).end("Local Docker socket unavailable");
      });
      if (body !== undefined) upstream.end(body);
      else incoming.pipe(upstream);
    } catch {
      const endpoint = new URL(incoming.url, "http://local-docker.invalid").pathname;
      rejectedMutations.add(incoming.method + " " + endpoint);
      outgoing.writeHead(400).end("Refusing unexpected checkout Docker mutation");
    }
  });
  server.on("upgrade", (incoming, socket, head) => {
    try {
      rewriteStartupRequest(incoming.method, incoming.url, null, options);
      assert.match(incoming.url, /\/attach(?:\?|$)/);
      const upstream = connect(upstreamSocket);
      upgrades.add(socket);
      socket.once("close", () => {
        upgrades.delete(socket);
        upstream.destroy();
      });
      socket.once("error", () => upstream.destroy());
      upstream.once("error", () => socket.destroy());
      upstream.once("connect", () => {
        const headers = incoming.rawHeaders
          .flatMap((header, i) =>
            i % 2 === 0 ? [header + ": " + incoming.rawHeaders[i + 1]] : [],
          )
          .join("\r\n");
        upstream.write(
          incoming.method +
            " " +
            incoming.url +
            " HTTP/" +
            incoming.httpVersion +
            "\r\n" +
            headers +
            "\r\n\r\n",
        );
        if (head.length) upstream.write(head);
        socket.pipe(upstream).pipe(socket);
      });
    } catch {
      socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    }
  });
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolveListen);
  });
  try {
    const env = {
      ...process.env,
      DOCKER_HOST: host,
      SUPABASE_SERVICES_HOSTNAME: "127.0.0.1",
    };
    for (const key of ["DOCKER_CONTEXT", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"])
      delete env[key];
    await start(env);
  } catch (error) {
    if (!rejectedMutations.size) throw error;
    throw new Error(
      error.message +
        "\nRefused Docker startup requests: " +
        [...rejectedMutations].join(", "),
      { cause: error },
    );
  } finally {
    for (const socket of upgrades) socket.destroy();
    server.closeAllConnections();
    await new Promise((resolveClose, reject) => {
      server.close((error) => (error ? reject(error) : resolveClose()));
    });
  }
}
