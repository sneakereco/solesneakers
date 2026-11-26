import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { SignJWT } from "jose";
const exec = promisify(execFile);
// Own GoTrue process and cloned database; never create auth users through the
// developer's shared local Supabase API or any hosted project.
export async function startDisposableAuth(databaseUrl) {
  const name = `sole-load-auth-${randomBytes(6).toString("hex")}`,
    secret = randomBytes(48).toString("base64url");
  const db = new URL(databaseUrl);
  db.hostname = "host.docker.internal";
  db.username = "supabase_auth_admin";
  db.search = "?search_path=auth";
  const settings = {
    GOTRUE_API_HOST: "0.0.0.0",
    GOTRUE_API_PORT: "9999",
    API_EXTERNAL_URL: "http://127.0.0.1:9999",
    GOTRUE_SITE_URL: "http://127.0.0.1",
    GOTRUE_DB_DRIVER: "postgres",
    GOTRUE_DB_DATABASE_URL: db.href,
    GOTRUE_JWT_SECRET: secret,
    GOTRUE_JWT_EXP: "3600",
    GOTRUE_JWT_AUD: "authenticated",
    GOTRUE_JWT_ADMIN_ROLES: "service_role",
    GOTRUE_EXTERNAL_EMAIL_ENABLED: "true",
    GOTRUE_MAILER_AUTOCONFIRM: "true",
    GOTRUE_DISABLE_SIGNUP: "true",
  };
  let proxy;
  async function close() {
    await new Promise((resolve) => (proxy ? proxy.close(resolve) : resolve()));
    await exec("docker", ["rm", "--force", name], { windowsHide: true }).catch(() => {});
  }
  try {
    await exec(
      "docker",
      [
        "run",
        "--detach",
        "--pull",
        "never",
        "--name",
        name,
        "--publish",
        "127.0.0.1::9999",
        ...Object.keys(settings).flatMap((key) => ["--env", key]),
        "public.ecr.aws/supabase/gotrue:v2.196.0",
      ],
      { env: { ...process.env, ...settings }, windowsHide: true },
    );
    const { stdout } = await exec("docker", ["port", name, "9999/tcp"], {
      windowsHide: true,
    });
    const endpoint = `http://${stdout.trim()}`;
    let healthy = false;
    for (let n = 0; n < 40; n++) {
      if (
        await fetch(`${endpoint}/health`).then(
          (r) => r.ok,
          () => false,
        )
      ) {
        healthy = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!healthy) {
      const log = await exec("docker", ["logs", "--tail", "12", name], {
        windowsHide: true,
      });
      throw Error(
        "Disposable auth service did not become healthy: " +
          (log.stdout + log.stderr)
            .replaceAll(secret, "[redacted]")
            .replaceAll(db.href, "[database]"),
      );
    }
    proxy = createServer(async (req, res) => {
      try {
        if (!req.url.startsWith("/auth/v1/")) {
          res.writeHead(404);
          res.end();
          return;
        }
        let body = "";
        for await (const part of req) body += part;
        const response = await fetch(endpoint + req.url.slice("/auth/v1".length), {
          method: req.method,
          headers: {
            "content-type": "application/json",
            authorization: req.headers.authorization ?? "",
            apikey: req.headers.apikey ?? "",
          },
          body: ["GET", "HEAD"].includes(req.method) ? undefined : body,
          redirect: "error",
        });
        res.writeHead(response.status, { "content-type": "application/json" });
        res.end(await response.text());
      } catch {
        res.writeHead(503);
        res.end("{}");
      }
    });
    proxy.listen(0, "127.0.0.1");
    await once(proxy, "listening");
    const key = new TextEncoder().encode(secret),
      jwt = (role) =>
        new SignJWT({ role })
          .setProtectedHeader({ alg: "HS256" })
          .setAudience("authenticated")
          .setIssuedAt()
          .setExpirationTime("1h")
          .sign(key);
    return {
      url: `http://127.0.0.1:${proxy.address().port}`,
      serviceKey: await jwt("service_role"),
      publishableKey: await jwt("anon"),
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
