import { setTimeout as delay } from "node:timers/promises";

const retryDelayMs = 2_000;

export async function readNativeMarkers(read, expected, deadline, sleep = delay) {
  for (let attempt = 1; attempt <= 3 && performance.now() < deadline; attempt++) {
    const data = await read();
    const row = data?.results?.[0];
    if (
      data?.hasMore !== false ||
      (data.truncated !== undefined && data.truncated !== false) ||
      !Array.isArray(data.columns) ||
      data.columns.length !== 2 ||
      data.columns[0] !== "visible_events" ||
      data.columns[1] !== "markers" ||
      !Array.isArray(data.results) ||
      data.results.length !== 1 ||
      !Array.isArray(row) ||
      row.length !== 2 ||
      row.some((count) => !Number.isSafeInteger(count) || count < 0) ||
      row[1] > expected
    ) {
      throw Error("Invalid native marker response");
    }
    if (row[1] === expected) return;
    if (attempt === 3 || performance.now() + retryDelayMs >= deadline) break;
    await sleep(retryDelayMs);
  }
  throw Error("Native markers not yet visible");
}
