jest.mock("@/lib/supabase/service-role", () => ({
  createSupabaseAdminClient: jest.fn(),
}));

import { createClient } from "@supabase/supabase-js";
import type { getStoreAccessSettings } from "@/lib/store-access/get-store-access-settings";
import type { Database } from "@/types/db/database.types";

const opening = new Date("2026-11-27T14:00:00.000Z");
const row = {
  site_lock_enabled: true,
  site_unlock_at: opening.toISOString(),
  checkout_lock_enabled: false,
  checkout_lock_message: "Payments paused",
};

let getAccess: typeof getStoreAccessSettings;
let databaseFetch: jest.Mock;

beforeEach(async () => {
  jest.resetModules();
  jest.useFakeTimers();
  jest.setSystemTime(opening.getTime() - 1000);
  databaseFetch = jest.fn((input: RequestInfo | URL) => {
    const url = new URL(String(input));
    return Promise.resolve(
      Response.json(
        url.pathname.endsWith("/tenants")
          ? [{ id: "store-1", tenant_store_access_settings: [row] }]
          : [row],
      ),
    );
  });
  const { createSupabaseAdminClient } = await import("@/lib/supabase/service-role");
  jest.mocked(createSupabaseAdminClient).mockReturnValue(
    createClient<Database>("https://database.example.com", "test-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: databaseFetch },
    }),
  );
  getAccess = (await import("@/lib/store-access/get-store-access-settings"))
    .getStoreAccessSettings;
});

afterEach(() => jest.useRealTimers());

it("settles a simultaneous storefront burst with one joined database request", async () => {
  const results = await Promise.all(
    Array.from({ length: 20 }, () => getAccess({ fresh: false })),
  );
  expect(results).toHaveLength(20);
  expect(results.every((access) => access?.isSiteLocked)).toBe(true);
  expect(databaseFetch).toHaveBeenCalledTimes(1);
  const url = new URL(String(databaseFetch.mock.calls[0][0]));
  expect(url.pathname).toBe("/rest/v1/tenants");
  expect(url.searchParams.get("select")).toContain("tenant_store_access_settings");
  expect(url.searchParams.get("order")).toBe("created_at.asc");
  expect(url.searchParams.get("limit")).toBe("1");
});

it("opens at the scheduled second while reusing the bounded settings snapshot", async () => {
  await expect(getAccess({ fresh: false })).resolves.toMatchObject({
    isSiteLocked: true,
  });
  await jest.advanceTimersByTimeAsync(1000);
  await expect(getAccess({ fresh: false })).resolves.toMatchObject({
    isSiteLocked: false,
  });
  expect(databaseFetch).toHaveBeenCalledTimes(1);
});

it("refuses an expired open snapshot when a fresh database lookup fails", async () => {
  jest.setSystemTime(opening);
  await expect(getAccess({ fresh: false })).resolves.toMatchObject({
    isSiteLocked: false,
  });
  await jest.advanceTimersByTimeAsync(2001);
  databaseFetch.mockResolvedValueOnce(
    Response.json({ message: "Data API unavailable" }, { status: 503 }),
  );
  await expect(getAccess({ fresh: false })).rejects.toMatchObject({
    message: "Data API unavailable",
  });
  await expect(getAccess({ fresh: false })).resolves.toMatchObject({
    isSiteLocked: false,
  });
});

it.each([undefined, { fresh: true }])(
  "keeps mutation reads fresh with options %j",
  async (options) => {
    jest.setSystemTime(opening);
    await expect(getAccess({ fresh: false })).resolves.toMatchObject({
      isSiteLocked: false,
    });
    databaseFetch.mockResolvedValueOnce(
      Response.json([
        {
          id: "store-1",
          tenant_store_access_settings: [{ ...row, site_unlock_at: null }],
        },
      ]),
    );
    await expect(getAccess(options)).resolves.toMatchObject({
      isSiteLocked: true,
    });
    expect(databaseFetch).toHaveBeenCalledTimes(2);
  },
);

it("aborts the actual database request when the access deadline expires", async () => {
  let requestSignal: AbortSignal | undefined;
  databaseFetch.mockImplementationOnce(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        requestSignal = init?.signal ?? undefined;
        requestSignal?.addEventListener("abort", () => reject(requestSignal?.reason));
      }),
  );
  const rejected = expect(getAccess()).rejects.toMatchObject({ name: "TimeoutError" });
  await jest.advanceTimersByTimeAsync(15000);
  await rejected;
  expect(requestSignal?.aborted).toBe(true);
});

it("preserves a missing-store result without admitting a visitor", async () => {
  databaseFetch.mockResolvedValueOnce(Response.json([]));
  await expect(getAccess()).resolves.toBeNull();
  expect(databaseFetch).toHaveBeenCalledTimes(1);
});
