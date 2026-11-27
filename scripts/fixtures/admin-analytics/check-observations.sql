-- All launch/probe/work state in this test is rolled back.
begin;
insert into public.tenants(id,name) values('60606060-0000-4000-8000-000000000001','Activation fixture');
insert into public.tag_brands(id,canonical_label) values('60606060-0000-4000-8000-000000000002','Activation fixture');
insert into public.tag_sizes(id,canonical_label,size_type) values('60606060-0000-4000-8000-000000000003','Fixture','shoe');
insert into public.products(id,tenant_id,name,category,condition,brand_id,size_type)
 values('60606060-0000-4000-8000-000000000004','60606060-0000-4000-8000-000000000001','Unsold','sneakers','new','60606060-0000-4000-8000-000000000002','shoe');
insert into public.product_variants(id,tenant_id,product_id,size_id,sku,stock,sale_price_cents)
 values('60606060-0000-4000-8000-000000000005','60606060-0000-4000-8000-000000000001','60606060-0000-4000-8000-000000000004','60606060-0000-4000-8000-000000000003','UNSOLD-FIXTURE',4,1200);
set constraints all immediate;
set local role service_role;
do $proof$
declare
 ds text:='sole-staging'; launch timestamptz:=statement_timestamp()-interval '1 second';
 a jsonb; j jsonb; prior uuid; first_leaf jsonb; second_leaf jsonb; i integer;
begin
 a:=public.activate_analytics_dataset('staging',launch,'archive');
 if a->>'created'<>'true' or a->>'baselineVariants'<>'1' or public.activate_analytics_dataset('staging',launch,'archive')->>'created'<>'false'
 then raise exception 'Activation replay'; end if;
 begin perform public.activate_analytics_dataset('production',launch,'archive'); raise exception 'Mixed environment accepted';
 exception when unique_violation then null; end;
 j:=public.analytics_refresh_claim(ds);
 prior:=(j->>'token')::uuid;
 if j->>'prefix'<>'' or public.analytics_refresh_claim(ds) is not null then raise exception 'Lease exclusion'; end if;
 first_leaf:=public.analytics_refresh_snapshot(ds,prior);
 if jsonb_array_length(first_leaf->'finance')<>1 or first_leaf#>>'{finance,0,payload,availableUnits}'<>'4' or first_leaf->'links'<>'[]' then raise exception 'Unsold baseline missing'; end if;
 if not public.analytics_refresh_finish(ds,prior,'split',null) then raise exception 'Split failed'; end if;
 if public.analytics_refresh_finish(ds,prior,'matched',statement_timestamp()) then raise exception 'Old lease accepted'; end if;
 for i in 0..15 loop
   j:=public.analytics_refresh_claim(ds);
   if j->>'prefix'<>to_hex(i) then raise exception 'Non-exhaustive partition'; end if;
   prior:=(j->>'token')::uuid;
   second_leaf:=public.analytics_refresh_snapshot(ds,prior);
   if (public.analytics_read_history_evidence(ds)->'observation')<>'null' then raise exception 'Premature proof'; end if;
   if not public.analytics_refresh_finish(ds,prior,'matched',(second_leaf->>'observedAt')::timestamptz) then raise exception 'Fence'; end if;
 end loop;
 if (public.analytics_read_history_evidence(ds)->'observation'->>'sourceFreshThrough')::timestamptz is distinct from statement_timestamp()
 then raise exception 'Idle source cutoff'; end if;
 perform public.analytics_record_native_retention(ds,24,current_date-800,statement_timestamp());
 j:=public.analytics_native_probe(ds);
 prior:=(j->>'last_id')::uuid;
 if not public.analytics_native_advance(ds,prior) or public.analytics_native_advance(ds,prior) then raise exception 'Native probe fence'; end if;
 if public.analytics_read_history_evidence(ds)->'native'<>'[]' then raise exception 'First marker certifies a range'; end if;
end $proof$;
rollback;
