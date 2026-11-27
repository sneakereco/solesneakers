import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/db/database.types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { GET } from "@/app/api/store/products/[id]/route";

jest.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: jest.fn() }));
jest.mock("@/lib/auth/session", () => ({ getServerSession: jest.fn() }));
test("a previously cached detail validator receives the cost-free representation and a new public validator", async () => {
  const id = "11111111-1111-4111-8111-111111111111",
    stamp = "2026-11-25T12:00:00Z";
  const old = `"${id}-${stamp}"`;
  const db = createClient<Database>("http://localhost:54321", "fixture", {
    auth: { persistSession: false },
    global: {
      fetch: () =>
        Promise.resolve(
          Response.json([
            {
              id,
              updated_at: stamp,
              brand: { id, canonical_label: "Fixture" },
              variants: [
                {
                  id,
                  stock: 2,
                  size: { id, canonical_label: "9" },
                  unit_cost_cents: 4900,
                  unit_cost_recorded: true,
                },
              ],
              images: [],
            },
          ]),
        ),
    },
  });
  jest.mocked(createSupabaseServerClient).mockResolvedValue(db);
  const response = await GET(
    new NextRequest("http://localhost/api/store/products/" + id, {
      headers: { "If-None-Match": old },
    }),
    { params: Promise.resolve({ id }) },
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("etag")).toBeTruthy();
  expect(response.headers.get("etag")).not.toBe(old);
  expect(response.headers.get("cache-control")).toContain("public");
  const data = await response.json();
  expect(data.variants[0].stock).toBe(2);
  expect(data.variants[0]).not.toHaveProperty("unit_cost_cents");
  expect(data.variants[0]).not.toHaveProperty("unit_cost_recorded");
});
