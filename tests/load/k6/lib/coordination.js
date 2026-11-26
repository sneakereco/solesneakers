import http from "k6/http";
import { sleep } from "k6";
export function coordinate(config, path, slot) {
  if (!config.coordinator) return { phaseStart: config.phaseStart };
  const response = http.post(
    config.coordinator.url + path,
    JSON.stringify({ workerId: config.shard.workerId, slot }),
    {
      headers: {
        "Content-Type": "application/json",
        "x-worker-token": config.coordinator.token,
      },
      timeout: "3s",
      redirects: 0,
      tags: {
        name: "local-worker-coordination",
        operation: "coordination",
        phase: "warmup",
      },
    },
  );
  if (response.status !== 200) throw Error("Worker coordination unavailable");
  return response.json();
}
export function waitForRelease(config, slot) {
  if (!config.coordinator) return config.phaseStart;
  if (slot !== undefined) coordinate(config, "/prepared", slot);
  const deadline = Date.now() + 120000;
  do {
    const value = coordinate(config, "/release");
    if (Number.isFinite(value.phaseStart) && value.phaseStart > 0)
      return value.phaseStart;
    sleep(0.25);
  } while (Date.now() < deadline);
  throw Error("Worker readiness deadline exceeded");
}
