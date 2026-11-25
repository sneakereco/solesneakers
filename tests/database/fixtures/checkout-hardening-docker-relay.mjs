import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { connect } from "node:net";
import { join, resolve } from "node:path";

const projectLabel = "com.supabase.cli.project";
const workdirLabel = "com.supabase.cli.workdir";
const platformInitializers = new Map([
  ["public.ecr.aws/supabase/realtime:v2.130.0", 3],
  ["public.ecr.aws/supabase/storage-api:v1.72.1", 2],
  ["public.ecr.aws/supabase/gotrue:v2.196.0", 2],
]);

export function rewriteStartupRequest(
  method,
  path,
  body,
  { projectId, directory, port, names, ids },
) {
  const url = new URL(path, "http://local-docker.invalid");
  const endpoint = url.pathname.replace(/^\/v\d+\.\d+/, "");
  if (method === "GET" || method === "HEAD") return body;
  const ownLabels = () => {
    assert.equal(body.Labels?.[projectLabel], projectId);
    if (body.Labels[workdirLabel])
      assert.equal(resolve(body.Labels[workdirLabel]), directory);
  };
  if (method === "POST" && endpoint === "/containers/create") {
    ownLabels();
    assert.equal(body.HostConfig.NetworkMode, names.network);
    if (!url.searchParams.has("name") && platformInitializers.has(body.Image)) {
      // The pinned CLI uses these unnamed containers to initialize platform schema.
      assert.equal(body.Cmd?.length, platformInitializers.get(body.Image));
      assert.equal(body.HostConfig.AutoRemove, true);
      assert.equal(Object.keys(body.HostConfig.PortBindings ?? {}).length, 0);
      assert.equal(body.HostConfig.Binds?.length ?? 0, 0);
      assert.equal(body.HostConfig.Mounts?.length ?? 0, 0);
      assert.equal(Boolean(body.HostConfig.Privileged), false);
      return body;
    }
    assert.equal(resolve(body.Labels[workdirLabel]), directory);
    assert.equal(url.searchParams.get("name"), names.container);
    const bindings = body.HostConfig.PortBindings;
    assert.deepEqual(Object.keys(bindings), ["5432/tcp"]);
    assert.equal(bindings["5432/tcp"].length, 1);
    assert.equal(bindings["5432/tcp"][0].HostPort, String(port));
    bindings["5432/tcp"][0].HostIp = "127.0.0.1";
    return body;
  }
  if (method === "POST" && ["/volumes/create", "/networks/create"].includes(endpoint)) {
    ownLabels();
    assert.equal(
      body.Name,
      endpoint === "/volumes/create" ? names.volume : names.network,
    );
    return body;
  }
  if (method === "POST" && endpoint === "/images/create") {
    assert.match(
      url.searchParams.get("fromImage") ?? "",
      /^public\.ecr\.aws\/supabase\/(?:postgres(?::17[.\d]+)?|realtime(?::v2\.130\.0)?|storage-api(?::v1\.72\.1)?|gotrue(?::v2\.196\.0)?)$/,
    );
    return body;
  }
  const ownsId = (candidate) =>
    ids.has(candidate) ||
    (/^[0-9a-f]{12,64}$/.test(candidate) &&
      [...ids].some((id) => id.startsWith(candidate)));
  const containerOperation =
    /^\/containers\/([^/]+)(\/start|\/stop|\/archive|\/attach|\/wait)?$/.exec(endpoint);
  if (
    containerOperation &&
    (containerOperation[1] === names.container || ownsId(containerOperation[1]))
  ) {
    if (
      method === "POST" &&
      ["/start", "/stop", "/attach", "/wait"].includes(containerOperation[2])
    )
      return body;
    if (method === "PUT" && containerOperation[2] === "/archive") return body;
    if (method === "DELETE" && !containerOperation[2]) return body;
  }
  const cleanup = /^\/(networks|volumes)\/([^/]+)$/.exec(endpoint);
  if (
    method === "DELETE" &&
    cleanup &&
    (cleanup[2] === (cleanup[1] === "networks" ? names.network : names.volume) ||
      ownsId(cleanup[2]))
  ) {
    return body;
  }
  throw new Error("Refusing unexpected checkout Docker mutation");
}

// The pinned CLI emits a numeric -p argument. Docker Desktop publishes it on
// every interface even when its bridge has a loopback default. Keep the relay
// private to the startup child and set HostIp on the one owned create request.
export async function withLoopbackPublishing(
  { directory, projectId },
  port,
  upstreamSocket,
  start,
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
  const ids = new Set();
  const rejectedMutations = new Set();
  const upgrades = new Set();
  const server = createServer(async (incoming, outgoing) => {
    try {
      let headers = incoming.headers;
      let body;
      if (incoming.method === "PUT") {
        rewriteStartupRequest(incoming.method, incoming.url, null, {
          projectId,
          directory,
          port,
          names,
          ids,
        });
      } else if (incoming.method !== "GET" && incoming.method !== "HEAD") {
        const chunks = [];
        for await (const chunk of incoming) chunks.push(chunk);
        const raw = Buffer.concat(chunks);
        const data = rewriteStartupRequest(
          incoming.method,
          incoming.url,
          raw.length ? JSON.parse(raw.toString()) : null,
          { projectId, directory, port, names, ids },
        );
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
          if (
            response.statusCode === 201 &&
            /\/(containers|networks)\/create\b/.test(incoming.url)
          ) {
            const chunks = [];
            for await (const chunk of response) chunks.push(chunk);
            const result = Buffer.concat(chunks);
            try {
              const { Id } = JSON.parse(result.toString());
              if (Id) ids.add(Id);
            } catch {
              outgoing.writeHead(502).end("Local Docker could not confirm ownership");
              return;
            }
            outgoing.writeHead(response.statusCode, response.headers).end(result);
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
      rewriteStartupRequest(incoming.method, incoming.url, null, {
        projectId,
        directory,
        port,
        names,
        ids,
      });
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
