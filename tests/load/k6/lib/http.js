import http from "k6/http";
import { sleep } from "k6";
import { emit } from "./metrics.js";
import { requestOperation } from "../../shared/journeys.mjs";
export function createTransport(config, slot) {
  let requests = 0;
  let replayed = false;
  const start = config.phaseStart + config.plan.warmupSeconds * 1000,
    end = start + config.plan.measurementSeconds * 1000;
  const transport = {
    async replayNavigation() {
      if (replayed) return;
      replayed = true;
      for (const path of config.fixtures.navigation?.paths ?? []) {
        await requestOperation(
          transport,
          "asset",
          path,
          null,
          (_, response) => response.status === 200,
          { page: true },
        );
      }
      for (const input of config.fixtures.navigation?.replay ?? []) {
        await requestOperation(
          transport,
          "page",
          input.path,
          null,
          (value, response) =>
            typeof value === "string" &&
            value.length > 0 &&
            String(response.headers["Content-Type"] ?? "").includes("text/x-component"),
          { page: true, headers: input.headers },
        );
      }
    },
    get requests() {
      return requests;
    },
    measurementPhase: (at) => (at < start ? "warmup" : at < end ? "hold" : "drain"),
    nowMs: () => Date.now(),
    pause: sleep,
    random: Math.random,
    emit,
    request(input) {
      requests++;
      const name = input.path.split("?")[0].replace(/[a-f0-9]{8}-[a-f0-9-]{27}/gi, ":id");
      const response = http.request(
        input.method,
        config.baseUrl + input.path,
        input.body ? JSON.stringify(input.body) : null,
        {
          headers: {
            ...input.headers,
            "content-type": "application/json",
            Origin: config.baseUrl,
            ...(input.operation === "asset"
              ? {}
              : {
                  "x-load-test-credential": config.credential,
                  "x-load-test-slot": String(slot),
                }),
          },
          redirects: 0,
          timeout: "15s",
          tags: { name, operation: input.operation, phase: input.phase ?? "hold" },
        },
      );
      const cache = String(
        response.headers["X-Vercel-Cache"] ?? response.headers["X-Cache"] ?? "UNKNOWN",
      ).toUpperCase();
      emit("http_response", 1, {
        operation: input.operation,
        status: String(response.status),
        cache: ["HIT", "MISS", "STALE", "BYPASS"].includes(cache) ? cache : "UNKNOWN",
        phase: input.phase ?? "hold",
      });
      return {
        status: response.status,
        headers: response.headers,
        body: response.body,
        timing:
          input.operation === "page"
            ? response.timings.waiting
            : response.timings.duration,
      };
    },
  };
  return transport;
}
export function initializeCookies(config, session) {
  for (const cookie of session.cookies ?? [])
    http.cookieJar().set(config.baseUrl, cookie.name, cookie.value, { path: "/" });
}
export function resetSessionCookies(config, identity) {
  const jar = http.cookieJar(),
    current = jar.cookiesForURL(config.baseUrl);
  const names = new Set((identity.cookies ?? []).map((cookie) => cookie.name));
  jar.clear(config.baseUrl);
  if (identity.accountId || names.size)
    for (const [name, values] of Object.entries(current))
      if (names.has(name) || /^sb-.*-auth-token(?:\.\d+)?$/.test(name))
        for (const value of values) jar.set(config.baseUrl, name, value, { path: "/" });
}
