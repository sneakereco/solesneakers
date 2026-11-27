-- Real ledger/observer at a single effective instant; all data rolls back.
begin;
set local statement_timeout='30s';
select public.activate_analytics_dataset('staging',statement_timestamp()-interval '2 days','archive');
do $proof$
declare
 ds text:='sole-staging'; effective timestamptz:=statement_timestamp()-interval '1 day';
 uid uuid; product uuid:=gen_random_uuid(); victim uuid; j jsonb; snap jsonb;
 ids text[]:='{}'; rows_in_leaf integer; i integer; changed boolean:=false;
begin
 for i in 1..2025 loop
   uid:=gen_random_uuid();
   if i=1 then victim:=uid; end if;
   perform analytics_source.publish(ds,'inventory',uid,effective,null,null,
     jsonb_build_object('productId',product,'variantId',uid,'availableUnits',1));
 end loop;
 for generation in 1..2 loop
   j:=public.analytics_refresh_claim(ds);
   snap:=public.analytics_refresh_snapshot(ds,(j->>'token')::uuid);
   if jsonb_array_length(snap->'finance')<>501 then raise exception 'Missing partition overflow'; end if;
   perform public.analytics_refresh_finish(ds,(j->>'token')::uuid,'split',null);
   ids:='{}';
   for i in 0..15 loop
     j:=public.analytics_refresh_claim(ds);
     snap:=public.analytics_refresh_snapshot(ds,(j->>'token')::uuid);
     rows_in_leaf:=jsonb_array_length(snap->'finance');
     if rows_in_leaf not between 1 and 500 then raise exception 'Unbounded leaf'; end if;
     select ids||array(select x->>'fact_id' from jsonb_array_elements(snap->'finance') x) into ids;
     if generation=2 and exists(select from jsonb_array_elements(snap->'finance') x where x->>'fact_id'='inventory:'||victim and x->>'revision'='2' and x#>>'{payload,availableUnits}'='7') then changed:=true; end if;
     perform public.analytics_refresh_finish(ds,(j->>'token')::uuid,'matched',(snap->>'observedAt')::timestamptz);
   end loop;
   if cardinality(ids)<>2025 or (select count(distinct v) from unnest(ids) v)<>2025 then raise exception 'Sweep incomplete'; end if;
   if generation=1 then
     perform analytics_source.publish(ds,'inventory',victim,effective,null,null,
       jsonb_build_object('productId',product,'variantId',victim,'availableUnits',7));
   end if;
 end loop;
 if not changed then raise exception 'Missed later revision to an old instant'; end if;
end $proof$;
rollback;
