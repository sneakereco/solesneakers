alter table public.order_shipping
  add column if not exists square_synced_at timestamp with time zone;
