import http from "k6/http";
import { sleep } from "k6";
import { emit } from "./metrics.js";
export function createTransport(config, slot) {
  let requests = 0;
  const start = config.phaseStart + config.plan.warmupSeconds * 1000,
    end = start + config.plan.measurementSeconds * 1000;
  return {
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
            "x-load-test-credential": config.credential,
            "x-load-test-slot": String(slot),
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
}
export function initializeCookies(config, session) {
  for (const cookie of session.cookies ?? [])
    http.cookieJar().set(config.baseUrl, cookie.name, cookie.value, { path: "/" });
}
