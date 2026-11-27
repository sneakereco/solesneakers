import { renderToStaticMarkup } from "react-dom/server";
import DashboardPage from "@/app/admin/dashboard/page";
const loads = new Map<string, (signal: AbortSignal) => Promise<unknown>>();
const snapshots = new Map<string, unknown>();
jest.mock("@/components/admin/useAdminRead", () => ({
  useAdminRead: (load: (signal: AbortSignal) => Promise<unknown>, label: string) => {
    loads.set(label, load);
    return { data: snapshots.get(label), pending: false, retry: jest.fn() };
  },
}));
it("shows the independently observed sales total when a paid order moves outside the first 20", async () => {
  let orders = Array.from({ length: 20 }, (_, n) => ({
    id: `order-${n}`,
    total: n === 0 ? 49.99 : 0,
    status: "paid",
  }));
  const fetcher = jest.spyOn(globalThis, "fetch").mockImplementation((url) => {
    const path = String(url);
    if (path === "/api/admin/orders") return Promise.resolve(Response.json({ orders }));
    if (path === "/api/store/products?limit=1")
      return Promise.resolve(Response.json({ total: 11 }));
    if (path === "/api/admin/analytics/summary")
      return Promise.resolve(
        Response.json({
          state: "stale",
          netMerchandise: { cents: 5705, complete: true, missingCount: 0 },
          confirmedOrders: 21,
          ingestionAsOf: "2026-06-01T16:00:00Z",
        }),
      );
    throw Error("Unexpected dashboard read");
  });
  const render = async () => {
    renderToStaticMarkup(<DashboardPage />);
    for (const [label, load] of loads)
      snapshots.set(label, await load(new AbortController().signal));
    return renderToStaticMarkup(<DashboardPage />);
  };
  try {
    const first = await render();
    expect(first).toContain("$57.05");
    expect(first).toContain("$49.99");
    expect(first).toContain("Stale");
    orders = [{ id: "order-new", total: 0, status: "pending" }, ...orders.slice(1)];
    const second = await render();
    expect(second).not.toContain("$49.99");
    expect(second).toContain("$57.05");
    expect(second).toContain(">21<");
  } finally {
    fetcher.mockRestore();
  }
});
