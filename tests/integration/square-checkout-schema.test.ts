import { existsSync, readFileSync } from "node:fs";
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
  const lifecycleMigration = readFileSync(
    resolve("supabase/migrations/20260831120000_square_refunds_and_disputes.sql"),
    "utf8",
  );
  const deliveryTimingMigrationPath = resolve(
    "supabase/migrations/20260905190000_square_payment_event_timing.sql",
  );
  const deliveryTimingMigration = existsSync(deliveryTimingMigrationPath)
    ? readFileSync(deliveryTimingMigrationPath, "utf8")
    : "";
  const hostedShippingMigrationPath = resolve(
    "supabase/migrations/20260905200000_square_hosted_shipping_reservation.sql",
  );
  const hostedShippingMigration = existsSync(hostedShippingMigrationPath)
    ? readFileSync(hostedShippingMigrationPath, "utf8")
    : "";
  const webPaymentsMigrationPath = resolve(
    "supabase/migrations/20260906120000_square_web_payments_checkout.sql",
  );
  const webPaymentsMigration = existsSync(webPaymentsMigrationPath)
    ? readFileSync(webPaymentsMigrationPath, "utf8")
    : "";
  const billingMigrationPath = resolve(
    "supabase/migrations/20260908120000_square_checkout_billing_snapshot.sql",
  );
  const billingMigration = existsSync(billingMigrationPath)
    ? readFileSync(billingMigrationPath, "utf8")
    : "";

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

  it("deduplicates Square refunds and standard dispute notifications", () => {
    expect(lifecycleMigration).toContain(
      "create table if not exists public.square_refunds",
    );
    expect(lifecycleMigration).toContain(
      "create table if not exists public.square_disputes",
    );
    expect(lifecycleMigration).toContain(
      "create or replace function public.process_square_refund_event",
    );
    expect(lifecycleMigration).toContain(
      "create or replace function public.process_square_dispute_event",
    );
    expect(lifecycleMigration).toContain("on conflict (square_event_id) do nothing");
    expect(lifecycleMigration).toContain("refund_amount = v_completed_refund_cents");
    expect(lifecycleMigration).toContain("to service_role");
    expect(lifecycleMigration).toContain(
      "create table if not exists public.checkout_notification_outbox",
    );
    expect(lifecycleMigration).toContain("create trigger queue_paid_order_confirmation");
    expect(lifecycleMigration).toContain(
      "create trigger queue_square_refund_confirmation",
    );
    expect(lifecycleMigration).toContain(
      "create or replace function public.claim_checkout_notifications",
    );
  });

  it("uses Square event time instead of delayed webhook arrival time", () => {
    expect(deliveryTimingMigration).toContain("p_paid_at timestamp with time zone");
    expect(deliveryTimingMigration).toContain(
      "v_order.expires_at <= coalesce(p_paid_at, now())",
    );
    expect(deliveryTimingMigration).toContain("p_square_created_at");
  });

  it("allows Square to collect shipping details after inventory is reserved", () => {
    expect(hostedShippingMigration).toContain(
      "rename to reserve_square_checkout_inventory_with_address",
    );
    expect(hostedShippingMigration).toContain(
      "when p_fulfillment = 'ship' and p_shipping_address is null",
    );
    expect(hostedShippingMigration).toContain("delete from public.order_shipping");
    expect(hostedShippingMigration).toContain("square_synced_at is null");
    expect(hostedShippingMigration).toContain("to service_role");
  });

  it("attaches a direct Square order through a service-role-only RPC", () => {
    expect(webPaymentsMigration).toContain("square_order_version integer");
    expect(webPaymentsMigration).toContain(
      "create or replace function public.attach_square_checkout_order",
    );
    expect(webPaymentsMigration).toContain(
      "round(subtotal * 100)::integer + p_shipping_cents + p_tax_cents = p_total_cents",
    );
    expect(webPaymentsMigration).toContain("from public, anon, authenticated");
    expect(webPaymentsMigration).toContain("to service_role");
  });

  it("stores an immutable billing snapshot in the reservation transaction", () => {
    expect(billingMigration).toContain("p_payment_method text");
    expect(billingMigration).toContain("p_billing_address jsonb");
    expect(billingMigration).toContain("invalid_checkout_billing_address");
    expect(billingMigration).toContain("insert into public.order_billing");
    expect(billingMigration).toContain("on conflict (order_id) do nothing");
    expect(billingMigration).toContain("from public, anon, authenticated");
    expect(billingMigration).toContain("to service_role");
  });
});
