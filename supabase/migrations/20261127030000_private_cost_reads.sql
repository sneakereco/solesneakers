begin;

-- A table SELECT covers every column, including columns added by later migrations.
-- Retain the existing row policies, writes, and service-role checkout access.
revoke select on public.product_variants, public.order_items from public, anon, authenticated;
revoke select (unit_cost_cents, unit_cost_recorded) on public.product_variants from public, anon, authenticated;
revoke select (unit_cost) on public.order_items from public, anon, authenticated;
grant select (id, product_id, tenant_id, size_id, sku, stock, sale_price_cents,
  sort_order, created_at, updated_at) on public.product_variants to anon, authenticated;
grant select (id, order_id, variant_id, product_id, product_name, variant_sku,
  size_label, brand, model, category, condition, quantity, unit_price, line_total,
  refund_amount, refunded_at, created_at) on public.order_items to anon, authenticated;

do $boundary$
declare actor name;
begin
  foreach actor in array array['anon','authenticated'] loop
    if has_column_privilege(actor,'public.product_variants','unit_cost_cents','select')
      or has_column_privilege(actor,'public.product_variants','unit_cost_recorded','select')
      or has_column_privilege(actor,'public.order_items','unit_cost','select')
    then raise exception 'Inherited private cost access requires review'; end if;
  end loop;
end $boundary$;

-- Existing triggers continue to run with their original owner and binding.
-- Only migration owners need to bind these three integrated-schema trigger functions.
revoke execute on function public.block_privileged_field_changes(),
  public.queue_paid_order_confirmation(), public.queue_square_refund_confirmation()
  from public;
notify pgrst, 'reload schema';
commit;
