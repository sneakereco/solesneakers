-- Restore representative canonical ACLs omitted by the owned schema-only baseline.
-- 20251219155756 (variants), 20251226033604 (order lines) and related catalog joins.
grant select, insert, update, delete, references, trigger, truncate
  on public.product_variants, public.order_items to anon, authenticated, service_role;
grant select on public.products, public.product_images, public.tag_brands, public.tag_models,
  public.tag_sizes, public.orders, public.profiles, public.tenants to anon, authenticated, service_role;
-- Existing stock-maintenance trigger writes the parent product under its session role.
grant update on public.products to authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
-- 20260718170000 (tag review), 20260826 through 20260922 (Square, Shippo, outbox).
revoke all on function public.accept_tag_candidate(uuid, text) from public, anon, authenticated;
grant execute on function public.accept_tag_candidate(uuid, text) to authenticated;
revoke all on function public.attach_square_checkout_order(uuid, text, integer, integer, integer, integer, text) from public, anon, authenticated;
grant execute on function public.attach_square_checkout_order(uuid, text, integer, integer, integer, integer, text) to service_role;
revoke all on function public.claim_checkout_notifications(integer) from public, anon, authenticated;
grant execute on function public.claim_checkout_notifications(integer) to service_role;
revoke all on function public.claim_checkout_notifications_for_order(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_checkout_notifications_for_order(uuid, integer) to service_role;
revoke all on function public.consume_square_checkout_reservation(uuid, text) from public, anon, authenticated;
grant execute on function public.consume_square_checkout_reservation(uuid, text) to service_role;
revoke all on function public.consume_square_checkout_reservation(uuid, text, timestamp with time zone) from public, anon, authenticated;
grant execute on function public.consume_square_checkout_reservation(uuid, text, timestamp with time zone) to service_role;
revoke all on function public.finish_checkout_notification(uuid, boolean) from public, anon, authenticated;
grant execute on function public.finish_checkout_notification(uuid, boolean) to service_role;
revoke all on function public.process_square_dispute_event(text, text, text, text, timestamp with time zone, text, jsonb, text, text, text, text, timestamp with time zone, bigint, text) from public, anon, authenticated;
grant execute on function public.process_square_dispute_event(text, text, text, text, timestamp with time zone, text, jsonb, text, text, text, text, timestamp with time zone, bigint, text) to service_role;
revoke all on function public.process_square_refund_event(text, text, text, text, timestamp with time zone, text, jsonb, text, text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.process_square_refund_event(text, text, text, text, timestamp with time zone, text, jsonb, text, text, text, bigint, text) to service_role;
revoke all on function public.queue_label_created_notification() from public, anon, authenticated;
grant execute on function public.queue_label_created_notification() to service_role;
revoke all on function public.record_shippo_tracking_update(text, text, text, text) from public, anon, authenticated;
grant execute on function public.record_shippo_tracking_update(text, text, text, text) to service_role;
revoke all on function public.record_square_payment_details(text, text, text, bigint, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_square_payment_details(text, text, text, bigint, text, jsonb) to service_role;
revoke all on function public.release_square_checkout_reservation(uuid, text) from public, anon, authenticated;
grant execute on function public.release_square_checkout_reservation(uuid, text) to service_role;
revoke all on function public.reserve_square_checkout_inventory(uuid, uuid, text, text, text, text, text, text, timestamp with time zone, integer, integer, integer, integer, text, text, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.reserve_square_checkout_inventory(uuid, uuid, text, text, text, text, text, text, timestamp with time zone, integer, integer, integer, integer, text, text, jsonb, jsonb, jsonb, jsonb, jsonb) to service_role;
revoke all on function public.reserve_square_checkout_inventory_with_address(uuid, uuid, text, text, text, text, text, timestamp with time zone, integer, integer, integer, integer, text, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.reserve_square_checkout_inventory_with_address(uuid, uuid, text, text, text, text, text, timestamp with time zone, integer, integer, integer, integer, text, text, jsonb, jsonb, jsonb) from service_role;
revoke all on function public.reserve_square_checkout_inventory_without_billing(uuid, uuid, text, text, text, text, text, timestamp with time zone, integer, integer, integer, integer, text, text, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.reserve_square_checkout_inventory_without_billing(uuid, uuid, text, text, text, text, text, timestamp with time zone, integer, integer, integer, integer, text, text, jsonb, jsonb, jsonb) from service_role;
