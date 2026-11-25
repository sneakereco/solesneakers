import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rmdir } from "node:fs/promises";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  rewriteStartupRequest,
  withLoopbackPublishing,
} from "./fixtures/checkout-hardening-docker-relay.mjs";

const projectId = "checkout-hardening-test-0123456789abcd";
const directory = process.cwd();
const names = {
  container: "supabase_db_" + projectId,
  network: "supabase_network_" + projectId,
  volume: "supabase_db_" + projectId,
};
const options = {
  projectId,
  directory,
  port: 56123,
  names,
  ids: new Set(["owned-container-id"]),
};
const labels = {
  "com.supabase.cli.project": projectId,
  "com.supabase.cli.workdir": directory,
};
const container = {
  Labels: labels,
  HostConfig: {
    NetworkMode: names.network,
    PortBindings: { "5432/tcp": [{ HostIp: "", HostPort: "56123" }] },
  },
};
const create = (name, body = container) =>
  rewriteStartupRequest("POST", "/v1.47/containers/create?name=" + name, body, options);

test("only the owned database publish address is narrowed to IPv4 loopback", () => {
  const body = structuredClone(container);
  const result = create(names.container, body);
  assert.equal(result.HostConfig.PortBindings["5432/tcp"][0].HostIp, "127.0.0.1");
  assert.equal(result.HostConfig.PortBindings["5432/tcp"][0].HostPort, "56123");
});

test("startup relay refuses foreign names, labels, ports and mutations", () => {
  assert.throws(() => create("supabase_db_existing_app"));
  assert.throws(() =>
    create(names.container, {
      ...container,
      Labels: { ...labels, "com.supabase.cli.project": "foreign" },
    }),
  );
  assert.throws(() =>
    create(names.container, {
      ...container,
      HostConfig: { PortBindings: { "5432/tcp": [{ HostPort: "64332" }] } },
    }),
  );
  assert.throws(() =>
    rewriteStartupRequest(
      "POST",
      "/v1.47/containers/supabase_db_existing_app/start",
      null,
      options,
    ),
  );
  assert.throws(() =>
    rewriteStartupRequest(
      "DELETE",
      "/v1.47/containers/supabase_db_existing_app",
      null,
      options,
    ),
  );
  assert.throws(() =>
    rewriteStartupRequest(
      "POST",
      "/v1.47/volumes/create",
      { Name: "foreign", Labels: labels },
      options,
    ),
  );
  assert.throws(() =>
    rewriteStartupRequest(
      "POST",
      "/v1.47/networks/create",
      { Name: names.network, Labels: {} },
      options,
    ),
  );
  assert.doesNotThrow(() =>
    rewriteStartupRequest(
      "POST",
      "/v1.47/containers/owned-container-id/start",
      null,
      options,
    ),
  );
  assert.throws(() =>
    rewriteStartupRequest("POST", "/v1.47/containers/prune", null, options),
  );
  const initializer = {
    Image: "public.ecr.aws/supabase/storage-api:v1.72.1",
    Cmd: ["entrypoint", "migrate"],
    Labels: labels,
    HostConfig: { NetworkMode: names.network, AutoRemove: true },
  };
  assert.doesNotThrow(() =>
    rewriteStartupRequest("POST", "/v1.47/containers/create", initializer, options),
  );
  for (const extra of [
    { NetworkMode: "foreign" },
    { AutoRemove: false },
    { Binds: ["/foreign:/mnt"] },
  ]) {
    const body = { ...initializer, HostConfig: { ...initializer.HostConfig, ...extra } };
    assert.throws(() =>
      rewriteStartupRequest("POST", "/v1.47/containers/create", body, options),
    );
  }
});

test(
  "relays wait headers before exit and closes an upgraded attach stream",
  { timeout: 5000 },
  async () => {
    const workspace = await mkdtemp(join(tmpdir(), "checkout-relay-test-"));
    const projectId = "checkout-hardening-test-" + randomBytes(7).toString("hex");
    const options = { directory: workspace, projectId };
    const socket =
      process.platform === "win32"
        ? "\\\\.\\pipe\\" + projectId + "-fake"
        : join(workspace, "upstream.sock");
    const name = "supabase_db_" + projectId;
    const network = "supabase_network_" + projectId;
    const identifier = "a".repeat(64);
    let pendingWait;
    let upstreamAttach;
    let attachClosed;
    const upstream = createServer((req, res) => {
      if (req.url.startsWith("/containers/create")) {
        req.resume();
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ Id: identifier }));
        return;
      }
      assert.equal(req.url, "/containers/" + identifier + "/wait");
      pendingWait = res;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.flushHeaders();
    });
    upstream.on("upgrade", (req, socket) => {
      upstreamAttach = socket;
      assert.equal(req.url, "/containers/" + identifier + "/attach");
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: tcp\r\n\r\nfixture stream",
      );
    });
    await new Promise((ready) => upstream.listen(socket, ready));
    const connectRelay = (socketPath, path, body, headers) =>
      new Promise((onResponse, onError) => {
        const req = request({ socketPath, path, method: "POST", headers }, onResponse);
        req.setTimeout(1200, () =>
          req.destroy(new Error("Docker response headers stalled")),
        );
        req.on("error", onError);
        req.end(body);
      });
    try {
      await withLoopbackPublishing(options, 56123, socket, async ({ DOCKER_HOST }) => {
        const relaySocket =
          process.platform === "win32"
            ? DOCKER_HOST.slice("npipe://".length).replaceAll("/", "\\")
            : DOCKER_HOST.slice("unix://".length);
        const spec = JSON.stringify({
          Labels: {
            "com.supabase.cli.project": projectId,
            "com.supabase.cli.workdir": workspace,
          },
          HostConfig: {
            NetworkMode: network,
            PortBindings: { "5432/tcp": [{ HostPort: "56123" }] },
          },
        });
        const created = await connectRelay(
          relaySocket,
          "/containers/create?name=" + name,
          spec,
        );
        for await (const chunk of created)
          assert.match(chunk.toString(), new RegExp(identifier));
        const waited = await connectRelay(
          relaySocket,
          "/containers/" + identifier + "/wait",
        );
        assert.equal(waited.statusCode, 200);
        pendingWait.end('{"StatusCode":0}');
        const waitParts = [];
        for await (const chunk of waited) waitParts.push(chunk);
        assert.deepEqual(JSON.parse(Buffer.concat(waitParts)), { StatusCode: 0 });

        await new Promise((ready, fail) => {
          const attach = request({
            socketPath: relaySocket,
            path: "/containers/" + identifier + "/attach",
            method: "POST",
            headers: { Connection: "Upgrade", Upgrade: "tcp", "Content-Length": 0 },
          });
          attach.setTimeout(1200, () =>
            attach.destroy(new Error("Docker attach upgrade stalled")),
          );
          attach.on("error", fail);
          attach.on("upgrade", (response, client, head) => {
            assert.equal(response.statusCode, 101);
            attachClosed = new Promise((closed) => client.once("close", closed));
            if (head.length) {
              assert.equal(head.toString(), "fixture stream");
              ready();
            } else {
              client.once("data", (chunk) => {
                assert.equal(chunk.toString(), "fixture stream");
                ready();
              });
            }
          });
          attach.end();
        });
      });
      await attachClosed;
    } finally {
      pendingWait?.end();
      upstreamAttach?.destroy();
      upstream.closeAllConnections();
      await new Promise((closed) => upstream.close(closed));
      await rmdir(workspace);
    }
  },
);
