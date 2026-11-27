import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/db/database.types";
import { OrdersRepository } from "@/repositories/orders-repo";
import { ProductRepository } from "@/repositories/product-repo";

function catalogClient() {
  const requests: URL[] = [];
  const client = createClient<Database>("http://localhost:54321", "unit-test", {
    auth: { persistSession: false },
    global: {
      fetch: (input) => {
        const url = new URL(String(input));
        requests.push(url);
        return Promise.resolve(Response.json([]));
      },
    },
  });
  return { client, requests };
}

test("customer order history requests a cost-free line projection", async () => {
  const { client, requests } = catalogClient();
  await new OrdersRepository(client).listOrdersForUser("customer");
  const projection = requests[0].searchParams.get("select");
  expect(projection).toContain("items:order_items(");
  expect(projection).not.toMatch(/order_items\(\*|unit_cost/);
  expect(projection).toContain("unit_price");
});

test("product detail requests explicit public variants", async () => {
  const { client, requests } = catalogClient();
  await new ProductRepository(client).getById("product");
  const projection = requests[0].searchParams.get("select");
  expect(projection).toContain("variants:product_variants(");
  expect(projection).not.toMatch(/product_variants\(\*|unit_cost/);
  expect(projection).toContain("sale_price_cents");
});
