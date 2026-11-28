import { build } from "esbuild";
import { GET as csv } from "@/app/api/admin/analytics/[report]/export/route";
import { GET as json } from "@/app/api/admin/analytics/[report]/route";
import { GET as summary } from "@/app/api/admin/analytics/summary/route";
import { createScopedSupabaseAdminClient } from "@/lib/supabase/service-role";
import { createReportStore } from "../../../Source/Features/Reporting/report-store";
import { scope } from "./commerce-fixture";
import { makeAudienceFixture } from "./audience-fixture";
import {
  validEnv,
  identitySecret,
  privateQueryKey,
} from "../Configuration/config-fixture";
import type { CompiledQuery } from "../../../Source/Features/Reporting/query-contract";

jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@/lib/auth/session", () => ({
  requireAdminApi: async () => {},
  AuthError: class extends Error {},
}));
jest.mock("@/lib/supabase/service-role", () => ({
  createScopedSupabaseAdminClient: jest.fn(),
}));
jest.mock("../../../Source/Features/Reporting/report-store", () => ({
  ...jest.requireActual("../../../Source/Features/Reporting/report-store"),
  createReportStore: jest.fn(),
}));
const call = (route: typeof csv, report: string, params = "") =>
  route(
    new Request(
      "http://localhost/api/admin/analytics/" +
        report +
        "?from=2026-06-10&to=2026-06-10" +
        params,
    ),
    { params: Promise.resolve({ report }) },
  );
test("closed server configuration binds the active dataset and external transport without exposing credentials", async () => {
  const before = { ...process.env },
    originalFetch = global.fetch;
  const f = makeAudienceFixture();
  try {
    Object.assign(process.env, validEnv);
    const eq = jest.fn(() => ({
      maybeSingle: () =>
        Promise.resolve({
          data: {
            dataset_id: scope.datasetId,
            environment: scope.environment,
            activated_at: scope.activatedAt,
            schema_version: 2,
            financial_source: "warehouse",
            behavior_archive_cutoff: null,
          },
        }),
    }));
    let historyUnavailable = false;
    jest.mocked(createScopedSupabaseAdminClient).mockReturnValue({
      from: () => ({ select: () => ({ eq }) }),
      rpc: () =>
        historyUnavailable
          ? Promise.resolve({ error: { message: "fixture observation unavailable" } })
          : Promise.resolve({ data: f.deps.history }),
    } as never);
    jest.mocked(createReportStore).mockReturnValue({
      read: () => Promise.resolve(null),
      lock: () => Promise.resolve(true),
      finish: async () => {},
      admit: () => Promise.resolve("ok"),
      release: async () => {},
      cooldown: async () => {},
    });
    let truncated = false;
    const observed: CompiledQuery[] = [];
    global.fetch = jest.fn(async (url, init) => {
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        "Bearer " + privateQueryKey,
      );
      const endpoint = String(url).split("/").at(-3) as CompiledQuery["endpoint"];
      const query = { ...JSON.parse(String(init?.body)), endpoint };
      observed.push(query);
      const result = await f.execute(query);
      return Response.json({
        ...result,
        name: endpoint,
        endpoint_version: endpoint === "sole_analytics_products" ? 2 : 1,
        execution_id: "bdbba353-57b6-4ca3-91b5-79c4dada3767",
        debug: identitySecret,
        hasMore: truncated && endpoint === "sole_analytics_products",
      });
    });
    for (const [route, report] of [
      [json, "payments"],
      [csv, "products"],
    ] as const) {
      const res = await call(route, report);
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).not.toContain(privateQueryKey);
      expect(body).not.toContain(identitySecret);
    }
    expect(eq).toHaveBeenCalledWith("dataset_id", "sole-staging");
    expect(observed).toContainEqual(
      expect.objectContaining({
        endpoint: "sole_analytics_products",
        version: 2,
        limit: 25000,
        offset: 0,
      }),
    );
    truncated = true;
    const failure = await call(csv, "products", "&sort=views");
    expect(failure.status).toBe(422);
    expect(failure.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await failure.text()).not.toContain(privateQueryKey);
    historyUnavailable = true;
    const financial = await summary();
    expect(financial.status).toBe(200);
    expect(await financial.json()).toMatchObject({
      state: "unavailable",
      ingestionAsOf: null,
      netMerchandise: null,
      confirmedOrders: null,
    });
    historyUnavailable = false;
    const observedAt = new Date(Date.now() - 1000).toISOString();
    f.deps.history.observation = { observedAt, sourceFreshThrough: observedAt };
    expect(await (await summary()).json()).toMatchObject({
      state: "empty",
      ingestionAsOf: observedAt,
      netMerchandise: { cents: 0, complete: true },
      confirmedOrders: 0,
    });
  } finally {
    global.fetch = originalFetch;
    process.env = before;
    f.db.close();
  }
});
test("generated analytics client chunks have no server reporting graph or private canaries", async () => {
  const root = "src/Modules/Analytics/Source/Features/";
  const bundle = await build({
    entryPoints: [
      root + "ReportContract/filters.ts",
      root + "VisitorMeasurement/MeasurementProvider.tsx",
      root + "VisitorMeasurement/use-checkout-start.ts",
    ],
    platform: "browser",
    bundle: true,
    splitting: true,
    format: "esm",
    external: ["next/*", "react", "posthog-js", "@supabase/*"],
    write: false,
    outdir: "analytics-canary-chunks",
    metafile: true,
    define: {
      "process.env.POSTHOG_QUERY_API_KEY": JSON.stringify(privateQueryKey),
      "process.env.ANALYTICS_IDENTITY_SECRET": JSON.stringify(identitySecret),
      "process.env.UPSTASH_REDIS_REST_TOKEN": JSON.stringify("cache-secret-canary"),
      "process.env.SUPABASE_SECRET_KEY": JSON.stringify("database-secret-canary"),
    },
  });
  expect(bundle.outputFiles.length).toBeGreaterThan(2);
  expect(
    Object.keys(bundle.metafile.inputs).filter((name) =>
      name.includes("/Features/Reporting/"),
    ),
  ).toEqual([]);
  for (const file of bundle.outputFiles)
    for (const canary of [
      privateQueryKey,
      identitySecret,
      "cache-secret-canary",
      "database-secret-canary",
    ])
      expect(file.text).not.toContain(canary);
});
