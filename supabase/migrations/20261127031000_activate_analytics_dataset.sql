create function public.activate_analytics_dataset(p_environment text, p_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  ds text := 'sole-' || p_environment;
  active public.analytics_datasets%rowtype;
  item record;
  rows_seeded integer := 0;
begin
  if p_environment is null or p_environment not in ('staging','production')
    or p_at is null or not isfinite(p_at) or p_at > statement_timestamp()
  then raise exception 'Invalid activation' using errcode='22023'; end if;
  -- Only one canonical environment belongs in an application database.
  lock table public.analytics_datasets in share row exclusive mode;
  select * into active from public.analytics_datasets where dataset_id in ('sole-staging','sole-production') limit 1;
  if found then
    if active.dataset_id <> ds or active.environment <> p_environment or active.activated_at <> p_at
      or active.financial_source <> 'warehouse'
    then raise exception 'Dataset activation already established' using errcode='23505'; end if;
    return jsonb_build_object('datasetId',ds,'created',false,'baselineVariants',0);
  end if;
  lock table public.product_variants in share mode;
  insert into public.analytics_datasets(dataset_id,environment,activated_at)
    values(ds,p_environment,p_at);
  for item in select id,product_id,stock from public.product_variants order by id loop
    perform analytics_source.publish(ds,'inventory',item.id,statement_timestamp(),null,null,
      jsonb_build_object('productId',item.product_id,'variantId',item.id,'availableUnits',item.stock));
    rows_seeded := rows_seeded + 1;
  end loop;
  return jsonb_build_object('datasetId',ds,'created',true,'baselineVariants',rows_seeded);
end $$;
revoke all on function public.activate_analytics_dataset(text,timestamptz) from public,anon,authenticated;
grant execute on function public.activate_analytics_dataset(text,timestamptz) to service_role;
