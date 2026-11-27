-- Run against the integrated isolated fixture. Check effective table and column ACLs,
-- which include privileges inherited from membership and PUBLIC.
do $test$
declare
  actor name;
begin
  foreach actor in array array['anon','authenticated','service_role'] loop
    if has_column_privilege(actor,'public.product_variants','unit_cost_cents','select') <> (actor='service_role')
      or has_column_privilege(actor,'public.product_variants','unit_cost_recorded','select') <> (actor='service_role')
      or has_column_privilege(actor,'public.order_items','unit_cost','select') <> (actor='service_role')
      or not has_column_privilege(actor,'public.product_variants','sale_price_cents','select')
      or not has_column_privilege(actor,'public.order_items','unit_price','select')
    then raise exception 'Incorrect effective cost/catalog ACL for %', actor; end if;
  end loop;
end $test$;
