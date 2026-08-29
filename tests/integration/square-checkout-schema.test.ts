import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Square checkout reservation schema", () => {
  const migration = readFileSync(
    resolve("supabase/migrations/20260826120000_square_checkout_foundation.sql"),
    "utf8",
  );
  const settingsMigration = readFileSync(
    resolve("supabase/migrations/20260828190000_tenant_checkout_settings.sql"),
    "utf8",
  );

  it("stores provider identifiers and atomic inventory reservations", () => {
    expect(migration).toContain("square_payment_link_id");
    expect(migration).toContain("square_order_id");
    expect(migration).toContain("create table public.inventory_reservations");
    expect(migration).toContain(
      "create function public.reserve_square_checkout_inventory",
    );
    expect(migration).toContain("set stock = product_variant.stock - requested.quantity");
    expect(migration).toContain("p_shipping_address jsonb");
    expect(migration).toContain("insert into public.order_shipping");
    expect(migration).toContain("p_tax_calculation_id text");
  });

  it("requires link deletion evidence before reserved stock can be released", () => {
    expect(migration).toContain(
      "create function public.mark_square_payment_link_deleted",
    );
    expect(migration).toContain(
      "create function public.release_square_checkout_reservation",
    );
    expect(migration).toContain("square_payment_link_deleted_at is null");
    expect(migration).toContain("square_link_must_be_deleted_before_inventory_release");
  });

  it("routes late or released payments to review instead of fulfillment", () => {
    expect(migration).toContain(
      "create function public.consume_square_checkout_reservation",
    );
    expect(migration).toContain("set status = 'review'");
    expect(migration).toContain("return false");
  });

  it("deduplicates durable Square webhook evidence", () => {
    expect(migration).toContain("create table public.square_webhook_events");
    expect(migration).toContain("square_event_id text primary key");
    expect(migration).toContain("payload_sha256 text not null");
    expect(migration).toContain("create function public.process_square_payment_event");
    expect(migration).toContain("on conflict (square_event_id) do nothing");
    expect(migration).toContain("square_payment_amount_mismatch");
  });

  it("persists a required flat rate and atomically attaches Square totals", () => {
    expect(settingsMigration).toContain(
      "create table if not exists public.tenant_checkout_settings",
    );
    expect(settingsMigration).toContain("flat_shipping_cents integer not null");
    expect(settingsMigration).toContain("p_tax_calculation_id text");
    expect(settingsMigration).toContain("tax_amount = p_tax_cents::numeric / 100");
    expect(settingsMigration).toContain(
      "round(subtotal * 100)::integer + p_shipping_cents + p_tax_cents = p_total_cents",
    );
  });
});
