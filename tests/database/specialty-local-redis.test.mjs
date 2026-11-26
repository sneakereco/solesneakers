import assert from "node:assert/strict";
import { createServer } from "node:net";
import { test } from "node:test";
import { RedisWire } from "../browser/fixtures/local-services.mjs";
test("a Redis command has a bounded response deadline", async () => {
  const server = createServer((socket) => socket.on("data", () => {}));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const wire = new RedisWire();
  try {
    await wire.connect(server.address().port);
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Bridge command had no timeout.")), 200);
    });
    try {
      await assert.rejects(
        Promise.race([wire.command(["PING"], 50), deadline]),
        /Local Redis request timed out/,
      );
    } finally {
      clearTimeout(timer);
    }
  } finally {
    wire.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
test("a closed Redis startup connection rejects its pending request instead of hanging", async () => {
  const server = createServer((socket) => socket.once("data", () => socket.end()));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const wire = new RedisWire();
  try {
    await wire.connect(server.address().port);
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("Bridge hung after the connection closed.")),
        200,
      );
    });
    try {
      await assert.rejects(
        Promise.race([wire.command(["PING"]), deadline]),
        /Local Redis unavailable/,
      );
    } finally {
      clearTimeout(timer);
    }
  } finally {
    wire.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
