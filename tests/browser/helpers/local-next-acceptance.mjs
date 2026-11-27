import { createServer, request } from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

const backend = "http://127.0.0.1:64331";
async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}
export async function startLocalAcceptance() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== backend)
    throw Error("Local acceptance requires the existing loopback Supabase stack");
  const health = await fetch(backend + "/auth/v1/health", {
    headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
  });
  if (!health.ok) throw Error("Local backend unavailable");
  let intercept;
  const proxy = createServer(async (req, res) => {
    // The only upstream is the verified local stack. Never forward a mail-delivery operation.
    const target = new URL(req.url, backend);
    if (target.origin !== backend) {
      res.writeHead(400);
      res.end();
      return;
    }
    const path = target.pathname;
    if (
      [
        "/auth/v1/recover",
        "/auth/v1/resend",
        "/auth/v1/otp",
        "/auth/v1/signup",
        "/auth/v1/invite",
      ].includes(path)
    ) {
      res.writeHead(503);
      res.end();
      return;
    }
    if (intercept && (await intercept(req, res))) return;
    if (res.destroyed) return;
    const upstream = request(
      target,
      { method: req.method, headers: { ...req.headers, host: "127.0.0.1:64331" } },
      (reply) => {
        res.writeHead(reply.statusCode, reply.headers);
        reply.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    res.on("close", () => upstream.destroy());
    req.pipe(upstream);
  });
  const proxyPort = await listen(proxy);
  const probe = createServer();
  const appPort = await listen(probe);
  await new Promise((resolve) => probe.close(resolve));
  const origin = "http://127.0.0.1:" + appPort;
  const env = {
    ...process.env,
    NEXT_TELEMETRY_DISABLED: "1",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:" + proxyPort,
    NEXT_PUBLIC_SITE_URL: origin,
    UPSTASH_REDIS_REST_URL: origin + "/unused",
    SES_SMTP_HOST: "127.0.0.1",
    SES_SMTP_PORT: "1",
  };
  for (const key of Object.keys(env))
    if (/SQUARE_|SHIPPO_|TURNSTILE_|POSTHOG|ANALYTICS_TOKEN/.test(key)) delete env[key];
  Object.assign(env, {
    SQUARE_ENVIRONMENT: "sandbox",
    SQUARE_APPLICATION_ID: "sandbox-sq0idb-local",
    SQUARE_LOCATION_ID: "local-unused",
    SQUARE_ACCESS_TOKEN: "local-unused",
    SQUARE_WEBHOOK_SIGNATURE_KEY: "local-unused",
    SQUARE_WEBHOOK_NOTIFICATION_URL: "https://example.invalid/api/webhooks/square",
  });
  env.SHIPPO_API_TOKEN = "local-unused";
  env.SHIPPO_WEBHOOK_TOKEN = "local-unused";
  const child = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "dev",
      "--webpack",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(appPort),
    ],
    { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (data) => {
      output = (output + data.toString()).slice(-8000);
    });
  async function close() {
    intercept = undefined;
    if (child.exitCode === null && child.pid) {
      if (process.platform === "win32")
        spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
      else child.kill("SIGTERM");
    }
    proxy.closeAllConnections();
    await new Promise((resolve) => proxy.close(resolve));
  }
  try {
    for (let i = 0; i < 150; i++) {
      if (child.exitCode !== null)
        throw Error("Next stopped before startup (" + child.exitCode + ")");
      if (/Ready in|Ready on/i.test(output))
        return {
          origin,
          backend,
          nextPid: child.pid,
          proxyPort,
          intercept(fn) {
            intercept = fn;
          },
          close,
        };
      await delay(500);
    }
    throw Error("Next failed to become ready");
  } catch (error) {
    await close();
    throw error;
  }
}
