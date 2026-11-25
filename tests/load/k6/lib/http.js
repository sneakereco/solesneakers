import http from "k6/http";
import { sleep } from "k6";
import { emit } from "./metrics.js";
export function createTransport(config, slot) {
  return {
    nowMs: () => Date.now(),
    pause: sleep,
    random: Math.random,
    emit,
    request(input) {
      const name = input.path.split("?")[0].replace(/[a-f0-9]{8}-[a-f0-9-]{27}/gi, ":id");
      const response = http.request(
        input.method,
        config.baseUrl + input.path,
        input.body ? JSON.stringify(input.body) : null,
        {
          headers: {
            "content-type": "application/json",
            Origin: config.baseUrl,
            "x-load-test-credential": config.credential,
            "x-load-test-slot": String(slot),
          },
          redirects: 0,
          timeout: "15s",
          tags: { name, operation: input.operation },
        },
      );
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
