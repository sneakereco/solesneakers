import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, rmdir } from "node:fs/promises";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  rewriteStartupRequest,
  runLabel,
  withLoopbackPublishing,
} from "./fixtures/checkout-hardening-docker-relay.mjs";

import {
  claimProjectDirectory,
  removeCreatedDockerResources,
  removeOwnedDirectory,
} from "./fixtures/checkout-hardening.mjs";

const projectId = "checkout-hardening-test-0123456789abcd";
const containerId = "a".repeat(64);
const networkId = "b".repeat(64);
const command = ["-c", "fixture database bootstrap"];
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
  token: "synthetic-test-owner",
  databaseCommandHash: createHash("sha256").update(JSON.stringify(command)).digest("hex"),
  resources: [
    { kind: "network", name: names.network, id: networkId },
    { kind: "volume", name: names.volume, createdAt: "2026-11-25T00:00:00Z" },
    { kind: "container", name: null, id: containerId },
  ],
};
const labels = {
  "com.supabase.cli.project": projectId,
  "com.supabase.cli.workdir": directory,
};
const container = {
  Image: "public.ecr.aws/supabase/postgres:17.6.1.167",
  Entrypoint: ["sh"],
  Cmd: command,
  Labels: labels,
  HostConfig: {
    NetworkMode: names.network,
    Binds: [names.volume + ":/var/lib/postgresql/data"],
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

test("the CLI can pull and create the pinned fixtures using its registry fallbacks", () => {
  for (const registry of ["public.ecr.aws/", "ghcr.io/", "", "docker.io/"]) {
    const database = registry + "supabase/postgres:17.6.1.167";
    const initializer = registry + "supabase/gotrue:v2.196.0";
    for (const image of [database, initializer]) {
      const [repository, tag] = image.split(":");
      assert.equal(
        rewriteStartupRequest(
          "POST",
          "/v1.47/images/create?" + new URLSearchParams({ fromImage: repository, tag }),
          null,
          options,
        ),
        null,
      );
    }
    const db = create(names.container, {
      ...structuredClone(container),
      Image: database,
    });
    assert.equal(db.Image, database);
    assert.equal(db.HostConfig.PortBindings["5432/tcp"][0].HostIp, "127.0.0.1");
    const auth = {
      Image: initializer,
      Cmd: ["gotrue", "migrate"],
      Entrypoint: null,
      Labels: { ...labels },
      HostConfig: { NetworkMode: names.network, AutoRemove: true },
    };
    assert.equal(
      rewriteStartupRequest("POST", "/containers/create", auth, options).Image,
      initializer,
    );
    assert.throws(() =>
      rewriteStartupRequest(
        "POST",
        "/containers/create",
        { ...auth, Cmd: ["sh"] },
        options,
      ),
    );
  }
});

test("registry fallbacks do not authorize unpinned images or unrelated pull sources", () => {
  for (const fromImage of [
    "ghcr.io/supabase/postgres:latest",
    "ghcr.io/supabase/postgres:17.6.1.168",
    "ghcr.io/supabase/pgmeta:0.99.0",
    "ghcr.io/other/postgres:17.6.1.167",
    "foreign.invalid/supabase/postgres:17.6.1.167",
  ]) {
    assert.throws(() =>
      rewriteStartupRequest(
        "POST",
        "/images/create?" + new URLSearchParams({ fromImage }),
        null,
        options,
      ),
    );
  }
});

test("a refused startup request retains its validation cause for bounded diagnostics", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "checkout-relay-cause-"));
  const projectId = "checkout-hardening-test-" + randomBytes(7).toString("hex");
  try {
    await assert.rejects(
      withLoopbackPublishing(
        { directory: workspace, projectId, token: "synthetic-owner" },
        56123,
        join(workspace, "unused-upstream.sock"),
        async ({ DOCKER_HOST }) => {
          const socketPath =
            process.platform === "win32"
              ? DOCKER_HOST.slice("npipe://".length).replaceAll("/", "\\")
              : DOCKER_HOST.slice("unix://".length);
          const status = await new Promise((resolve, reject) => {
            const req = request(
              { socketPath, path: "/volumes/create", method: "POST" },
              (res) => {
                res.resume();
                res.once("end", () => resolve(res.statusCode));
              },
            );
            req.once("error", reject);
            req.end(
              JSON.stringify({
                Name: "synthetic-foreign-volume",
                Labels: { "com.supabase.cli.project": projectId },
              }),
            );
          });
          assert.equal(status, 400);
          throw Error("synthetic startup failure");
        },
      ),
      (error) =>
        error.cause instanceof assert.AssertionError &&
        error.cause.code === "ERR_ASSERTION",
    );
  } finally {
    await rmdir(workspace);
  }
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
      "/v1.47/containers/" + containerId + "/start",
      null,
      options,
    ),
  );
  assert.throws(() =>
    rewriteStartupRequest("POST", "/v1.47/containers/prune", null, options),
  );
  const initializer = {
    Image: "public.ecr.aws/supabase/storage-api:v1.72.1",
    Cmd: ["node", "dist/scripts/migrate-call.js"],
    Entrypoint: null,
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
    const options = {
      directory: workspace,
      projectId,
      token: "synthetic-lifecycle-owner",
    };
    const socket =
      process.platform === "win32"
        ? "\\\\.\\pipe\\" + projectId + "-fake"
        : join(workspace, "upstream.sock");
    const network = "supabase_network_" + projectId;
    const identifier = "a".repeat(64);
    let pendingWait;
    let upstreamAttach;
    let attachClosed;
    const upstream = createServer((req, res) => {
      if (req.url.startsWith("/networks/create")) {
        req.resume();
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ Id: networkId }));
        return;
      }
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
        const ownedLabels = { "com.supabase.cli.project": projectId };
        const createdNetwork = await connectRelay(
          relaySocket,
          "/networks/create",
          JSON.stringify({
            Name: network,
            Driver: "bridge",
            Labels: ownedLabels,
          }),
        );
        assert.equal(createdNetwork.statusCode, 201);
        for await (const chunk of createdNetwork)
          assert.match(chunk.toString(), new RegExp(networkId));
        const spec = JSON.stringify({
          Image: "public.ecr.aws/supabase/storage-api:v1.72.1",
          Entrypoint: null,
          Cmd: ["node", "dist/scripts/migrate-call.js"],
          Labels: ownedLabels,
          HostConfig: { NetworkMode: network, AutoRemove: true },
        });
        const created = await connectRelay(relaySocket, "/containers/create", spec);
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

test("refuses changed initializer commands, entrypoints, database images, or storage", () => {
  const spec = {
    Image: "public.ecr.aws/supabase/storage-api:v1.72.1",
    Cmd: ["node", "dist/scripts/migrate-call.js"],
    Entrypoint: null,
    Labels: labels,
    HostConfig: { NetworkMode: names.network, AutoRemove: true },
  };
  const initialize = (body) =>
    rewriteStartupRequest("POST", "/containers/create", body, options);
  assert.throws(() => initialize({ ...spec, Cmd: ["node", "unreviewed.js"] }));
  assert.throws(() => initialize({ ...spec, Entrypoint: ["sh"] }));
  assert.throws(() => create(names.container, { ...container, Image: "postgres:17" }));
  assert.throws(() =>
    create(names.container, { ...container, Cmd: ["-c", "another script"] }),
  );
  assert.throws(() =>
    create(names.container, {
      ...container,
      NetworkingConfig: { EndpointsConfig: { foreign: {} } },
    }),
  );
  assert.throws(() =>
    rewriteStartupRequest(
      "POST",
      "/containers/create?name=" + names.container,
      structuredClone(container),
      {
        ...options,
        resources: options.resources.filter(({ kind }) => kind !== "volume"),
      },
    ),
  );
  assert.throws(() =>
    create(names.container, {
      ...container,
      HostConfig: {
        ...container.HostConfig,
        Mounts: [{ Source: "foreign", Target: "/app" }],
      },
    }),
  );
  assert.throws(() =>
    create(names.container, {
      ...container,
      HostConfig: {
        ...container.HostConfig,
        Binds: ["existing:/var/lib/postgresql/data"],
      },
    }),
  );
});

test("partial startup refuses to remove a never-created volume at the planned name", () => {
  assert.throws(() =>
    rewriteStartupRequest(
      "DELETE",
      "/containers/" + containerId.slice(0, 12),
      null,
      options,
    ),
  );
  assert.throws(() =>
    rewriteStartupRequest("DELETE", "/containers/" + networkId, null, options),
  );

  assert.throws(() =>
    rewriteStartupRequest("DELETE", "/volumes/" + names.volume, null, options),
  );
  assert.throws(() =>
    rewriteStartupRequest("DELETE", "/networks/" + names.network, null, options),
  );
  assert.throws(() =>
    rewriteStartupRequest("DELETE", "/containers/" + names.container, null, options),
  );
});

test("partial startup preserves a pre-existing volume returned by a duplicate create", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "checkout-relay-partial-"));
  const id = "checkout-hardening-test-" + randomBytes(7).toString("hex");
  const ownership = await claimProjectDirectory(workspace, id);
  const volume = {
    Name: "supabase_db_" + id,
    CreatedAt: "2026-11-24T12:00:00Z",
    Driver: "local",
    Labels: { "com.supabase.cli.project": id, [runLabel]: "foreign-owner" },
  };
  const network = { Name: "supabase_network_" + id, Id: networkId };
  const resources = [];
  let networkExists = false;
  const foreignBefore = structuredClone(volume);
  const socket =
    process.platform === "win32"
      ? "\\\\.\\pipe\\" + id + "-fake"
      : join(ownership.directory, "upstream.sock");
  const upstream = createServer(async (request, response) => {
    const body = [];
    for await (const chunk of request) body.push(chunk);
    const spec = JSON.parse(Buffer.concat(body));
    assert.equal(spec.Labels[runLabel], ownership.token);
    response.writeHead(201, { "Content-Type": "application/json" });
    if (request.url === "/networks/create") {
      networkExists = true;
      network.Labels = spec.Labels;
      response.end(JSON.stringify({ Id: networkId }));
    } else {
      assert.equal(request.url, "/volumes/create");
      response.end(JSON.stringify(volume));
    }
  });
  await new Promise((ready) => upstream.listen(socket, ready));
  const receipts = [];
  const commands = [];
  const cleanDocker = async (args) => {
    commands.push(args);
    if (args[1] === "ls") {
      assert.ok(args.includes("label=" + runLabel + "=" + ownership.token));
      return args[0] === "network" && networkExists ? networkId : "";
    }
    if (args[0] === "volume") {
      assert.equal(args[1], "inspect", "the replacement volume must survive");
      return JSON.stringify(volume);
    }
    assert.equal(args[0], "network");
    assert.equal(args.at(-1), networkId);
    if (args[1] === "rm") {
      networkExists = false;
      return networkId;
    }
    if (!networkExists) throw new Error("No such network");
    return JSON.stringify(network);
  };
  try {
    await assert.rejects(
      withLoopbackPublishing(
        ownership,
        56123,
        socket,
        async ({ DOCKER_HOST }) => {
          const socketPath =
            process.platform === "win32"
              ? DOCKER_HOST.slice("npipe://".length).replaceAll("/", "\\")
              : DOCKER_HOST.slice("unix://".length);
          const create = async (kind, name, driver) => {
            return new Promise((done, fail) => {
              const req = request(
                { socketPath, path: "/" + kind + "/create", method: "POST" },
                (resp) => {
                  resp.resume().once("end", () => done(resp.statusCode));
                },
              );
              req.once("error", fail);
              req.end(
                JSON.stringify({
                  Name: name,
                  Driver: driver,
                  Labels: { "com.supabase.cli.project": id },
                }),
              );
            });
          };
          assert.equal(await create("networks", network.Name, "bridge"), 201);
          if ((await create("volumes", volume.Name, "local")) !== 201) {
            throw new Error("partial start refused foreign volume");
          }
        },
        resources,
      ),
      /partial start refused foreign volume/,
    );
    assert.deepEqual(resources, [{ kind: "network", name: network.Name, id: networkId }]);
    await removeCreatedDockerResources(ownership, resources, {
      command: cleanDocker,
      receipt: (entry) => receipts.push(entry),
    });
    assert.equal(networkExists, false);
    assert.ok(
      !commands.some(([kind, operation]) => kind === "volume" && operation !== "ls"),
    );
    assert.deepEqual(volume, foreignBefore);
    await assert.rejects(
      removeCreatedDockerResources(
        ownership,
        [{ kind: "volume", name: volume.Name, createdAt: volume.CreatedAt }],
        { command: cleanDocker },
      ),
      /Refusing cleanup of changed Docker identity/,
    );
    assert.deepEqual(volume, foreignBefore);
    t.diagnostic(
      JSON.stringify({
        receipts,
        foreignVolume: {
          name: volume.Name,
          createdAt: volume.CreatedAt,
          unchanged: true,
        },
      }),
    );
  } finally {
    upstream.closeAllConnections();
    await new Promise((closed) => upstream.close(closed));
    await removeOwnedDirectory(ownership);
    await rmdir(workspace);
  }
});

test(
  "reconciles a daemon create when the response disconnects before its receipt",
  { timeout: 5000 },
  async (t) => {
    const workspace = await mkdtemp(join(tmpdir(), "checkout-relay-disconnect-"));
    const id = "checkout-hardening-test-" + randomBytes(7).toString("hex");
    const ownership = await claimProjectDirectory(workspace, id);
    const name = "supabase_network_" + id;
    const resources = [];
    let created;
    const socket =
      process.platform === "win32"
        ? "\\\\.\\pipe\\" + id + "-fake"
        : join(ownership.directory, "upstream.sock");
    const upstream = createServer(async (incoming, outgoing) => {
      const chunks = [];
      for await (const chunk of incoming) chunks.push(chunk);
      const spec = JSON.parse(Buffer.concat(chunks));
      assert.equal(incoming.url, "/networks/create");
      assert.equal(spec.Name, name);
      assert.equal(spec.Labels[runLabel], ownership.token);
      created = { Name: name, Id: networkId, Labels: spec.Labels };
      outgoing.socket.destroy();
    });
    await new Promise((ready) => upstream.listen(socket, ready));
    try {
      await assert.rejects(
        withLoopbackPublishing(
          ownership,
          56123,
          socket,
          async ({ DOCKER_HOST }) => {
            const socketPath =
              process.platform === "win32"
                ? DOCKER_HOST.slice("npipe://".length).replaceAll("/", "\\")
                : DOCKER_HOST.slice("unix://".length);
            await new Promise((done, fail) => {
              const req = request(
                { socketPath, path: "/networks/create", method: "POST" },
                (response) => {
                  response.resume().once("end", () => {
                    if (response.statusCode === 502)
                      fail(new Error("daemon lost create response"));
                    else done();
                  });
                },
              );
              req.once("error", fail);
              req.end(
                JSON.stringify({
                  Name: name,
                  Driver: "bridge",
                  Labels: { "com.supabase.cli.project": id },
                }),
              );
            });
          },
          resources,
        ),
        /daemon lost create response/,
      );
      assert.equal(created.Id, networkId);
      assert.deepEqual(resources, []);
      const receipts = [];
      await removeCreatedDockerResources(ownership, resources, {
        receipt: (entry) => receipts.push(entry),
        command: async ([kind, operation, ...args]) => {
          if (operation === "ls") {
            assert.ok(args.includes("label=" + runLabel + "=" + ownership.token));
            return kind === "network" && created ? created.Id : "";
          }
          assert.equal(kind, "network");
          assert.equal(args.at(-1), networkId);
          if (operation === "rm") {
            created = undefined;
            return networkId;
          }
          assert.equal(operation, "inspect");
          if (!created) throw new Error("No such network");
          return JSON.stringify(created);
        },
      });
      assert.ok(!created, "lost create receipt must not leave the owned network");
      assert.deepEqual(
        receipts.map(({ phase, id, present }) => ({ phase, id, present })),
        [
          { phase: "before", id: networkId, present: true },
          { phase: "after", id: networkId, present: false },
        ],
      );
      t.diagnostic(JSON.stringify(receipts));
    } finally {
      upstream.closeAllConnections();
      await new Promise((closed) => upstream.close(closed));
      await removeOwnedDirectory(ownership);
      await rmdir(workspace);
    }
  },
);
