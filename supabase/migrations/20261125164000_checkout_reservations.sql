begin;

alter table public.orders add column checkout_expiry_marked_at timestamptz;

-- The unguarded overloads still use the historical transaction. Serialize their
-- order-key decision with v2 and keep them away from guarded preparations.
create schema checkout_preparation_private;
revoke all on schema checkout_preparation_private from public,anon,authenticated,service_role;
alter function public.reserve_square_checkout_inventory_with_address(uuid,uuid,text,text,text,text,text,timestamptz,integer,integer,integer,integer,text,text,jsonb,jsonb,jsonb)
  set schema checkout_preparation_private;
create function public.reserve_square_checkout_inventory_with_address(
 p_tenant_id uuid,p_user_id uuid,p_guest_email text,p_currency text,p_fulfillment text,p_idempotency_key text,p_cart_hash text,
 p_expires_at timestamptz,p_subtotal_cents integer,p_shipping_cents integer,p_tax_cents integer,p_total_cents integer,
 p_tax_calculation_id text,p_customer_state text,p_shipping_address jsonb,p_items jsonb,p_protection_evidence jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key,713));
 if exists(select 1 from public.orders where idempotency_key=p_idempotency_key and checkout_attempt_guarded)
 then raise exception 'checkout_idempotency_conflict'; end if;
 return checkout_preparation_private.reserve_square_checkout_inventory_with_address(
   p_tenant_id,p_user_id,p_guest_email,p_currency,p_fulfillment,p_idempotency_key,p_cart_hash,p_expires_at,
   p_subtotal_cents,p_shipping_cents,p_tax_cents,p_total_cents,p_tax_calculation_id,p_customer_state,
   p_shipping_address,p_items,p_protection_evidence);
end;
$$;
revoke all on function public.reserve_square_checkout_inventory_with_address(uuid,uuid,text,text,text,text,text,timestamptz,integer,integer,integer,integer,text,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.reserve_square_checkout_inventory_with_address(uuid,uuid,text,text,text,text,text,timestamptz,integer,integer,integer,integer,text,text,jsonb,jsonb,jsonb) to service_role;

-- All callers of the live release RPC take the same order, attempt, product,
-- variant and hold locks as preparation before the historical restore writes.
alter function public.release_square_checkout_reservation(uuid,text) set schema checkout_preparation_private;
create function checkout_preparation_private.release_ordered(p_order_id uuid,p_reason text)
returns boolean language plpgsql security definer set search_path='' as $fn$
declare o public.orders;
begin
 select * into o from public.orders where id=p_order_id for update;
 if not found or o.status in ('paid','shipped','refunded','partially_refunded') then return false; end if;
 perform a.id from public.checkout_payment_attempts a where a.order_id=o.id order by a.sequence for update;
 perform p.id from public.products p where p.id in (
   select v.product_id from public.product_variants v join public.inventory_reservations h on h.variant_id=v.id
   where h.order_id=o.id and h.status='active') order by p.id for update;
 perform v.id from public.product_variants v where v.id in (
   select h.variant_id from public.inventory_reservations h where h.order_id=o.id and h.status='active') order by v.id for update;
 perform h.id from public.inventory_reservations h where h.order_id=o.id and h.status='active' order by h.id for update;
 return checkout_preparation_private.release_square_checkout_reservation(o.id,p_reason);
end;
$fn$;
revoke all on function checkout_preparation_private.release_ordered(uuid,text) from public,anon,authenticated,service_role;
create function public.release_square_checkout_reservation(p_order_id uuid,p_reason text)
returns boolean language plpgsql security definer set search_path='' as $$
declare o public.orders;
begin
 select * into o from public.orders where id=p_order_id for update;
 if not found or not o.checkout_attempt_guarded or o.checkout_expiry_marked_at is not null
    or o.status is distinct from 'pending' or o.square_order_id is not null
    or o.failure_reason is distinct from 'preparation_quote_rejected' or p_reason is distinct from 'square_order_totals_changed'
    or o.checkout_financial_review is not null
    or exists(select 1 from public.checkout_payment_attempts where order_id=o.id) then return false; end if;
 return checkout_preparation_private.release_ordered(o.id,p_reason);
end;
$$;
revoke all on function public.release_square_checkout_reservation(uuid,text) from public,anon,authenticated;
grant execute on function public.release_square_checkout_reservation(uuid,text) to service_role;

-- Even a delayed attach cannot rewrite an issued financial quote. Preserve
-- the old attachment contract for legacy orders.
alter function public.attach_square_checkout_order(uuid,text,integer,integer,integer,integer,text) set schema checkout_preparation_private;
create function public.attach_square_checkout_order(p_order_id uuid,p_square_order_id text,p_square_order_version integer,
 p_shipping_cents integer,p_tax_cents integer,p_total_cents integer,p_tax_calculation_id text)
returns boolean language plpgsql security definer set search_path='' as $$
declare o public.orders;
begin
 select * into o from public.orders where id=p_order_id for update;
 if o.checkout_attempt_guarded then
   if o.checkout_expiry_marked_at is not null or o.failure_reason='preparation_quote_rejected' then return false; end if;
   if o.shipping*100 is distinct from p_shipping_cents or o.tax_amount*100 is distinct from p_tax_cents
     or o.total*100 is distinct from p_total_cents then return false; end if;
   if o.square_order_id is not null then
     return o.square_order_id=p_square_order_id and o.square_order_version=p_square_order_version
       and o.tax_calculation_id=p_tax_calculation_id and o.status='pending' and o.expires_at>clock_timestamp();
   end if;
   if exists(select 1 from public.checkout_payment_attempts where order_id=o.id) then return false; end if;
 end if;
 return checkout_preparation_private.attach_square_checkout_order(p_order_id,p_square_order_id,p_square_order_version,
   p_shipping_cents,p_tax_cents,p_total_cents,p_tax_calculation_id);
end;
$$;
revoke all on function public.attach_square_checkout_order(uuid,text,integer,integer,integer,integer,text) from public,anon,authenticated;
grant execute on function public.attach_square_checkout_order(uuid,text,integer,integer,integer,integer,text) to service_role;

-- A CreateOrder mismatch must win against attachment before remote cancellation.
create function public.reject_checkout_quote_before_attach(p_order_id uuid,p_owner_binding text) returns boolean
language plpgsql security definer set search_path='' as $fn$
declare o public.orders;
begin
 select * into o from public.orders where id=p_order_id for update;
 if not found or not o.checkout_attempt_guarded or o.status is distinct from 'pending' or o.square_order_id is not null
   or p_owner_binding is distinct from coalesce('account:'||o.user_id,'guest:'||o.checkout_guest_context_hash)
   or (o.failure_reason is not null and o.failure_reason<>'preparation_quote_rejected')
   or exists(select 1 from public.checkout_payment_attempts a where a.order_id=o.id) then return false; end if;
 if o.failure_reason is null then update public.orders set failure_reason='preparation_quote_rejected' where id=o.id; end if;
 return true;
end;
$fn$;
revoke all on function public.reject_checkout_quote_before_attach(uuid,text) from public,anon,authenticated;
grant execute on function public.reject_checkout_quote_before_attach(uuid,text) to service_role;
create function checkout_preparation_private.shape(value jsonb,required text[],optional text[] default '{}')
returns boolean language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(value)='object' and value ?& required and value-(required||optional)='{}'::jsonb,false);
$$;
create function checkout_preparation_private.cents(value jsonb) returns boolean language sql immutable set search_path='' as $$
 select case when jsonb_typeof(value)='number' and value::text ~ '^(0|[1-9][0-9]{0,9})$' then value::text::numeric<=2147483647 else false end;
$$;
create function checkout_preparation_private.valid_address(address jsonb,billing boolean) returns boolean
language sql immutable set search_path='' as $$
 select checkout_preparation_private.shape(address,array['line1','city','state','postalCode','country']||
   (case when billing then array['givenName','familyName'] else array['name','phone'] end),array['line2','phone'])
   and address->>'country'='US' and address->>'state' ~ '^[A-Z]{2}$'
   and address->>'postalCode' ~ '^[0-9]{5}(-[0-9]{4})?$'
   and not exists(select 1 from jsonb_each(address) x where case when x.key in ('line2','phone') and billing then
     jsonb_typeof(x.value) not in ('null','string') when x.key='line2' then jsonb_typeof(x.value) not in ('null','string')
     else jsonb_typeof(x.value)<>'string' or length(trim(x.value#>>'{}'))=0 end)
   and length(address->>'line1')<=120 and length(address->>'city')<=80
   and coalesce(length(address->>'line2'),0)<=120
   and (address->>'phone' is null or length(address->>'phone') between 7 and 30)
   and (case when billing then length(address->>'givenName') between 1 and 50 and length(address->>'familyName') between 1 and 50
        else length(address->>'name') between 1 and 100 end);
$$;

create function public.reserve_checkout_inventory_v2(p_request jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 r jsonb:=p_request;
 mode text:=r->>'action';
 uuid_pattern constant text:='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
 base_keys constant text[]:=array['version','action','tenantId','idempotencyKey','items'];
 full_keys constant text[]:=array['userId','guestEmail','ownerBinding','currency','fulfillment','paymentMethod','cartHash',
    'subtotalCents','shippingCents','taxCents','totalCents','taxCalculationId','customerState','shippingAddress',
    'billingAddress','pickupContact','protectionEvidence'];
 item_keys constant text[]:=array['productId','variantId','quantity'];
 amount_keys constant text[]:=array['subtotalCents','shippingCents','taxCents','totalCents'];
 evidence jsonb:=r->'protectionEvidence';
 bill jsonb:=r->'billingAddress';
 ship jsonb:=r->'shippingAddress';
 pickup jsonb:=r->'pickupContact';
 lines jsonb:=r->'items';
 tenant uuid;
 principal uuid;
 guest_hash text;
 o public.orders;
 i jsonb;
 conflicts jsonb;
 held_until timestamptz;
 observed_at timestamptz;
 owner_binding text:=r->>'ownerBinding';
 changed boolean;
begin
 if mode is null or mode not in ('reserve','inspect') or r->'version' is distinct from '2'::jsonb
   or not checkout_preparation_private.shape(r,base_keys||(case when mode='reserve' then full_keys else '{}'::text[] end),array['otherGuestContexts','ownerBinding'])
   or coalesce(r->>'tenantId','') !~ uuid_pattern or coalesce(r->>'idempotencyKey','') !~ uuid_pattern
   or jsonb_typeof(lines) is distinct from 'array' then raise exception 'invalid_checkout_request' using errcode='22023'; end if;
 if mode='inspect' and r ? 'ownerBinding' and (owner_binding is null or not (
   owner_binding ~ '^guest:[a-f0-9]{64}$' or (left(owner_binding,8)='account:' and substr(owner_binding,9) ~ uuid_pattern)))
 then raise exception 'invalid_checkout_owner' using errcode='22023'; end if;
 if r ? 'otherGuestContexts' then
   if jsonb_typeof(r->'otherGuestContexts')<>'array' or coalesce(owner_binding,'') !~ '^guest:[a-f0-9]{64}$'
   then raise exception 'invalid_checkout_contexts' using errcode='22023'; end if;
   if jsonb_array_length(r->'otherGuestContexts') not between 1 and 15 or exists(
       select 1 from jsonb_array_elements(r->'otherGuestContexts') h
       where jsonb_typeof(h)<>'string' or h#>>'{}' !~ '^[a-f0-9]{64}$')
   then raise exception 'invalid_checkout_contexts' using errcode='22023'; end if;
 end if;
 tenant:=(r->>'tenantId')::uuid;
 if jsonb_array_length(lines) not between 1 and 10 or (select count(distinct lower(j->>'variantId')) from jsonb_array_elements(lines) j)<>jsonb_array_length(lines)
 then raise exception 'invalid_checkout_lines' using errcode='22023'; end if;
 for i in select * from jsonb_array_elements(lines) loop
   if not checkout_preparation_private.shape(i,item_keys||(case when mode='reserve' then
     array['unitPriceCents','unitCostCents','lineTotalCents','variantSku','productName','brand','model','category','condition','sizeLabel'] else '{}'::text[] end))
     or coalesce(i->>'productId','') !~ uuid_pattern or coalesce(i->>'variantId','') !~ uuid_pattern
     or jsonb_typeof(i->'quantity') is distinct from 'number' or i->>'quantity' !~ '^[1-5]$'
   then raise exception 'invalid_checkout_line' using errcode='22023'; end if;
   if mode='reserve' and (exists(select 1 from unnest(array['unitPriceCents','unitCostCents','lineTotalCents']) k
      where not checkout_preparation_private.cents(i->k))
      or exists(select 1 from unnest(array['variantSku','productName','brand','category','condition','sizeLabel']) k
        where jsonb_typeof(i->k)<>'string' or length(i->>k)>1000)
      or jsonb_typeof(i->'model') not in ('string','null')
      or (i->>'quantity')::numeric*(i->>'unitPriceCents')::numeric<>(i->>'lineTotalCents')::numeric)
   then raise exception 'invalid_checkout_snapshot' using errcode='22023'; end if;
 end loop;
 if mode='reserve' then
   if r->>'currency' is distinct from 'USD' or coalesce(r->>'paymentMethod','') not in ('card','afterpay','applePay','cashAppPay')
      or coalesce(r->>'fulfillment','') not in ('ship','pickup') or coalesce(r->>'customerState','') !~ '^[A-Z]{2}$'
      or r->>'taxCalculationId' is distinct from 'square:calculated' or coalesce(r->>'cartHash','') !~ '^[0-9a-f]{64}$'
      or exists(select 1 from unnest(amount_keys) k where not checkout_preparation_private.cents(r->k))
      or (r->>'totalCents')::numeric<>(r->>'subtotalCents')::numeric+(r->>'shippingCents')::numeric+(r->>'taxCents')::numeric
      or (r->>'subtotalCents')::numeric<=0 or (r->>'subtotalCents')::numeric<>(select sum((j->>'lineTotalCents')::numeric) from jsonb_array_elements(lines) j)
      or not checkout_preparation_private.shape(evidence,array['version','device_session_id','payment_method','bot_verdict','client_ip_masked','normalized_email_hmac','created_at','shipping_address_override_confirmed'])
      or evidence->'version' is distinct from '2'::jsonb or coalesce(evidence->>'device_session_id','') !~ uuid_pattern
      or evidence->>'payment_method' is distinct from r->>'paymentMethod'
      or (evidence ? 'bot_verdict' and evidence->>'bot_verdict' is distinct from 'passed')
      or (evidence ? 'normalized_email_hmac' and coalesce(evidence->>'normalized_email_hmac','') !~ '^[0-9a-f]{64}$')
      or (evidence ? 'shipping_address_override_confirmed' and jsonb_typeof(evidence->'shipping_address_override_confirmed')<>'boolean')
      or (evidence ? 'client_ip_masked' and coalesce(evidence->>'client_ip_masked','') !~ '^([0-9.]{1,15}/24|[a-fA-F0-9:]{2,40}/64|unparseable)$')
      or (evidence ? 'created_at' and coalesce(evidence->>'created_at','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]{8,12}Z$')
   then raise exception 'invalid_checkout_quote' using errcode='22023'; end if;
   if (checkout_preparation_private.valid_address(bill,true)) is not true or
      (r->>'fulfillment'='ship' and (checkout_preparation_private.valid_address(ship,false) is not true
        or ship->>'state' is distinct from r->>'customerState' or pickup<>'null')) or
      (r->>'fulfillment'='pickup' and (ship<>'null' or (r->>'shippingCents')::integer<>0
        or not checkout_preparation_private.shape(pickup,array['name','phone'])
        or coalesce(length(trim(pickup->>'name')),0) not between 1 and 100
        or coalesce(pickup->>'phone','') !~ '^[+0-9 ().-]{7,30}$'
        or regexp_replace(pickup->>'phone','[^0-9]','','g') !~ '^[0-9]{7,15}$'))
   then raise exception 'invalid_checkout_address' using errcode='22023'; end if;
   if r->'userId'='null' then
     if coalesce(r->>'ownerBinding','') !~ '^guest:[a-f0-9]{64}$' or coalesce(r->>'guestEmail','') !~ '^[^ @]+@[^ @]+$'
       or length(r->>'guestEmail')>254 then raise exception 'invalid_checkout_owner' using errcode='22023'; end if;
     guest_hash:=substr(r->>'ownerBinding',7);
   else
     if coalesce(r->>'userId','') !~ uuid_pattern or r->>'ownerBinding' is distinct from 'account:'||(r->>'userId')
       or r->'guestEmail'<>'null' then raise exception 'invalid_checkout_owner' using errcode='22023'; end if;
     principal:=(r->>'userId')::uuid;
   end if;
 end if;

 perform pg_advisory_xact_lock(hashtextextended(r->>'idempotencyKey',713));
 select * into o from public.orders where idempotency_key=r->>'idempotencyKey' for update;
 if found then
   perform a.id from public.checkout_payment_attempts a where a.order_id=o.id order by a.sequence for update;
   if mode='inspect' or not o.checkout_attempt_guarded or o.tenant_id is distinct from tenant
      or o.user_id is distinct from principal or o.checkout_guest_context_hash is distinct from guest_hash
      or o.guest_email is distinct from r->>'guestEmail'
      or o.checkout_protection_evidence->>'device_session_id' is distinct from evidence->>'device_session_id'
   then raise exception 'checkout_recovery_required' using errcode='PC410'; end if;
   if o.cart_hash is distinct from r->>'cartHash' or o.checkout_protection_evidence->>'payment_method' is distinct from r->>'paymentMethod'
      or o.fulfillment is distinct from r->>'fulfillment' or o.status is distinct from 'pending' or o.failure_reason='preparation_quote_rejected'
      or o.subtotal*100 is distinct from (r->>'subtotalCents')::integer or o.shipping*100 is distinct from (r->>'shippingCents')::integer
      or o.tax_amount*100 is distinct from (r->>'taxCents')::integer or o.total*100 is distinct from (r->>'totalCents')::integer
      or o.pickup_name is distinct from pickup->>'name' or o.pickup_phone is distinct from pickup->>'phone'
      or not exists(select 1 from public.order_billing b where b.order_id=o.id and
        row(b.name,b.phone,b.line1,b.line2,b.city,b.state,b.postal_code,b.country) is not distinct from
        row(concat_ws(' ',bill->>'givenName',bill->>'familyName'),bill->>'phone',bill->>'line1',bill->>'line2',bill->>'city',bill->>'state',bill->>'postalCode','US'::text))
      or (o.fulfillment='ship' and not exists(select 1 from public.order_shipping s where s.order_id=o.id and
        row(s.name,s.phone,s.line1,s.line2,s.city,s.state,s.postal_code,s.country) is not distinct from
        row(ship->>'name',ship->>'phone',ship->>'line1',ship->>'line2',ship->>'city',ship->>'state',ship->>'postalCode','US'::text)))
      or exists(select 1 from (select * from public.order_items where order_id=o.id) oi
        full join jsonb_array_elements(lines) j on oi.variant_id=(j->>'variantId')::uuid
        where oi.product_id is distinct from (j->>'productId')::uuid or oi.quantity is distinct from (j->>'quantity')::integer
          or oi.unit_price*100 is distinct from (j->>'unitPriceCents')::integer
          or row(oi.variant_sku,oi.product_name,oi.size_label) is distinct from row(j->>'variantSku',j->>'productName',j->>'sizeLabel'))
   then raise exception 'checkout_preparation_changed' using errcode='PC410'; end if;
   perform h.id from public.inventory_reservations h where h.order_id=o.id order by h.id for update;
   if o.expires_at is null or o.expires_at<=clock_timestamp() or exists(
     select 1 from (select * from public.inventory_reservations where order_id=o.id) h
     full join jsonb_array_elements(lines) j on h.variant_id=(j->>'variantId')::uuid
     where h.status is distinct from 'active' or h.quantity is distinct from (j->>'quantity')::integer or h.expires_at<=clock_timestamp())
   then raise exception 'checkout_preparation_changed' using errcode='PC410'; end if;
   return jsonb_build_object('kind','reserved','orderId',o.id,'expiresAt',o.expires_at,'reused',true);
 end if;

 -- Lock parents before variants; stock updates also write their parent's aggregate flag.
 perform p.id from public.products p where p.tenant_id=tenant and p.id in (select (j->>'productId')::uuid from jsonb_array_elements(lines) j) order by p.id for update;
 perform v.id from public.product_variants v where v.tenant_id=tenant and v.id in (select (j->>'variantId')::uuid from jsonb_array_elements(lines) j) order by v.id for update;
 perform h.id from public.inventory_reservations h where h.tenant_id=tenant and h.status='active' and h.variant_id in
   (select (j->>'variantId')::uuid from jsonb_array_elements(lines) j) order by h.id for update;
 observed_at:=clock_timestamp();
 with requested as (
   select (j->>'productId')::uuid pid,(j->>'variantId')::uuid vid,(j->>'quantity')::integer qty,(j->>'unitPriceCents')::integer price,(j->>'unitCostCents')::integer cost,j->>'category' category
   from jsonb_array_elements(lines) j
 ), availability as (
   select requested.*,v.sale_price_cents,v.unit_cost_cents,p.category current_category,v.stock,
     (p.id is not null and p.is_active and p.go_live_at<=clock_timestamp() and v.id is not null
       and (not p.is_out_of_stock or v.stock=0)) as eligible,
     held.active_quantity,held.other_quantity
   from requested left join public.products p on p.id=pid and p.tenant_id=tenant
   left join public.product_variants v on v.id=vid and v.product_id=pid and v.tenant_id=tenant
   cross join lateral (
     select coalesce(sum(h.quantity),0) active_quantity, coalesce(sum(h.quantity) filter(where
       h.expires_at>observed_at and ho.expires_at>observed_at and ho.status='pending'
       and ho.checkout_attempt_guarded and ho.tenant_id=tenant and (
         (left(owner_binding,8)='account:' and ho.user_id is not null and 'account:'||ho.user_id<>owner_binding)
         or (left(owner_binding,6)='guest:' and ho.checkout_guest_context_hash is not null
           and 'guest:'||ho.checkout_guest_context_hash<>owner_binding
           and not (coalesce(r->'otherGuestContexts','[]') ? ho.checkout_guest_context_hash))
       )),0) other_quantity
     from public.inventory_reservations h join public.orders ho on ho.id=h.order_id
     where h.variant_id=vid and h.tenant_id=tenant and h.status='active'
   ) held
 )
 select jsonb_agg(jsonb_build_object('productId',pid,'variantId',vid,'requestedQuantity',qty,
   'availableQuantity',case when eligible then stock else 0 end,'reason',case when eligible is not true then 'unavailable'
   when stock+other_quantity>=qty then 'reserved_by_other'
   when stock=0 and active_quantity=0 then 'sold_out' else 'unavailable' end) order by pid,vid) filter(where eligible is not true or stock<qty),
   bool_or(sale_price_cents is distinct from price or unit_cost_cents is distinct from cost or category is distinct from current_category) into conflicts,changed from availability;
 if conflicts is not null then raise exception 'checkout_inventory_conflict' using errcode='PC409',detail=conflicts::text; end if;
 if mode='inspect' or changed then raise exception 'checkout_preparation_changed' using errcode='PC410'; end if;

 if r->>'fulfillment'='ship' then
   perform s.id from public.shipping_defaults s where s.tenant_id=tenant and s.category in
     (select j->>'category' from jsonb_array_elements(lines) j) order by s.category for share;
   if exists(select 1 from (select distinct j->>'category' category from jsonb_array_elements(lines) j) cats
      left join public.shipping_defaults s on s.category=cats.category and s.tenant_id=tenant where s.shipping_cost_cents is null)
      or (select max(s.shipping_cost_cents) from public.shipping_defaults s where s.tenant_id=tenant and s.category in
         (select j->>'category' from jsonb_array_elements(lines) j)) is distinct from (r->>'shippingCents')::int
   then raise exception 'checkout_preparation_changed' using errcode='PC410'; end if;
 end if;
 held_until:=clock_timestamp()+interval '15 minutes';
 insert into public.orders(tenant_id,user_id,guest_email,checkout_guest_context_hash,checkout_attempt_guarded,
   currency,fulfillment,status,idempotency_key,cart_hash,expires_at,subtotal,shipping,tax_amount,total,
   tax_calculation_id,customer_state,checkout_protection_evidence,pickup_name,pickup_phone)
 values(tenant,principal,r->>'guestEmail',guest_hash,true,'USD',r->>'fulfillment','pending',r->>'idempotencyKey',
   r->>'cartHash',held_until,(r->>'subtotalCents')::numeric/100,(r->>'shippingCents')::numeric/100,
   (r->>'taxCents')::numeric/100,(r->>'totalCents')::numeric/100,r->>'taxCalculationId',r->>'customerState',evidence,
   pickup->>'name',pickup->>'phone') returning * into o;
 insert into public.order_billing(order_id,name,phone,line1,line2,city,state,postal_code,country)
 values(o.id,concat_ws(' ',bill->>'givenName',bill->>'familyName'),bill->>'phone',bill->>'line1',bill->>'line2',bill->>'city',bill->>'state',bill->>'postalCode','US');
 if o.fulfillment='ship' then
   insert into public.order_shipping(order_id,name,phone,line1,line2,city,state,postal_code,country)
   values(o.id,ship->>'name',ship->>'phone',ship->>'line1',ship->>'line2',ship->>'city',ship->>'state',ship->>'postalCode','US');
 end if;
 for i in select j from jsonb_array_elements(lines) j order by j->>'variantId' loop
   update public.product_variants set stock=stock-(i->>'quantity')::integer where id=(i->>'variantId')::uuid;
   insert into public.order_items(order_id,product_id,variant_id,quantity,unit_price,unit_cost,line_total,variant_sku,
     product_name,brand,model,category,condition,size_label)
   values(o.id,(i->>'productId')::uuid,(i->>'variantId')::uuid,(i->>'quantity')::integer,
     (i->>'unitPriceCents')::numeric/100,(i->>'unitCostCents')::numeric/100,(i->>'lineTotalCents')::numeric/100,
     i->>'variantSku',i->>'productName',i->>'brand',i->>'model',i->>'category',i->>'condition',i->>'sizeLabel');
   insert into public.inventory_reservations(tenant_id,order_id,variant_id,quantity,expires_at)
   values(tenant,o.id,(i->>'variantId')::uuid,(i->>'quantity')::integer,held_until);
 end loop;
 perform public.enqueue_checkout_recovery('expire_reservation','expire_reservation:'||o.id,held_until,'reservation_expiring',o.id);
 return jsonb_build_object('kind','reserved','orderId',o.id,'expiresAt',held_until,'reused',false);
end;
$$;
revoke all on function public.reserve_checkout_inventory_v2(jsonb) from public,anon,authenticated;
grant execute on function public.reserve_checkout_inventory_v2(jsonb) to service_role;
notify pgrst,'reload schema';
alter function checkout_attempt_private.require_payable(public.orders,public.checkout_payment_attempts) rename to require_live_hold;
create function checkout_attempt_private.require_payable(o public.orders,a public.checkout_payment_attempts)
returns void language plpgsql set search_path='' as $$
begin
 if o.checkout_expiry_marked_at is not null or o.checkout_financial_review is not null then raise exception 'checkout_order_not_payable'; end if;
 perform checkout_attempt_private.require_live_hold(o,a);
end;
$$;
revoke all on function checkout_attempt_private.require_payable(public.orders,public.checkout_payment_attempts)
 from public,anon,authenticated,service_role;

create function public.mark_checkout_expiry(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders; keys jsonb;
begin
 select * into strict o from public.orders where id=p_order_id for update;
 if o.expires_at is null or o.expires_at>clock_timestamp() or
  not exists(select 1 from public.inventory_reservations where order_id=o.id and status='active')
 then return jsonb_build_object('kind','unchanged'); end if;
 perform id from public.checkout_payment_attempts where order_id=o.id order by sequence for update;
 update public.orders set checkout_expiry_marked_at=clock_timestamp() where id=o.id and checkout_expiry_marked_at is null;
 if not o.checkout_attempt_guarded then return jsonb_build_object('kind','review'); end if;
 with retired as (
  update public.checkout_payment_attempts set state='canceled',reason='expiry_not_dispatched',updated_at=clock_timestamp()
  where order_id=o.id and state='ready' and dispatched_at is null and provider_payment_id is null returning id
 ) insert into public.checkout_payment_attempt_history(attempt_id,state,reason) select id,'canceled','expiry_not_dispatched' from retired;
 select coalesce(jsonb_agg(square_idempotency_key order by sequence),'[]') into keys
 from public.checkout_payment_attempts where order_id=o.id and dispatched_at is not null
 and state in ('dispatch_started','unknown','pending','review') and provider_payment_id is null;
 return jsonb_build_object('kind','inquire','squareOrderId',o.square_order_id,'unknownKeys',keys);
end;
$$;

create function public.finish_checkout_expiry(p_order_id uuid,p_canceled_square_order_id text default null) returns text
language plpgsql security definer set search_path='' as $$
declare o public.orders;
begin
 select * into strict o from public.orders where id=p_order_id for update;
 perform id from public.checkout_payment_attempts where order_id=o.id order by sequence for update;
 if o.checkout_expiry_marked_at is null or o.expires_at>clock_timestamp() or not exists(
   select 1 from public.inventory_reservations where order_id=o.id and status='active') then return 'unchanged'; end if;
 if not o.checkout_attempt_guarded or o.checkout_financial_review is not null or o.status not in ('pending','canceled')
  or coalesce(o.refund_amount,0)>0 or exists(select 1 from public.square_refunds where order_id=o.id)
  or exists(select 1 from public.checkout_financial_facts where order_id=o.id and (kind='refund' or status='COMPLETED'))
 then return 'review'; end if;
 if o.square_order_id is distinct from p_canceled_square_order_id then return 'reconcile'; end if;
 -- Neither an order cancellation nor a no-match cancel-by-key proves an
 -- in-flight dispatch was unsuccessful. Check every sequence independently.
 if exists(select 1 from public.checkout_payment_attempts a where a.order_id=o.id and (
   (a.dispatched_at is null and a.provider_payment_id is null and a.state='canceled' and a.reason in ('expiry_not_dispatched','unused_method_changed')) or
   (a.dispatched_at is not null and a.state='declined' and a.provider_payment_id is null and exists(
     select 1 from public.checkout_payment_attempt_history h where h.attempt_id=a.id and h.state='declined'
     and h.reason='verified_square_decline' and h.verified_facts->>'requestDigest'=a.request_digest)) or
   (a.dispatched_at is not null and a.state in ('declined','canceled') and exists(
     select 1 from public.checkout_financial_facts f where f.kind='payment' and f.order_id=o.id
     and f.payment_id=a.provider_payment_id and f.amount_cents=a.amount_cents and f.currency=a.currency
     and f.status=case a.state when 'declined' then 'FAILED' else 'CANCELED' end))
  ) is not true) then return 'reconcile'; end if;
 if o.payment_transaction_id is not null and not exists(select 1 from public.checkout_payment_attempts
   where order_id=o.id and provider_payment_id=o.payment_transaction_id and state in ('declined','canceled'))
 then return 'reconcile'; end if;
 if checkout_preparation_private.release_ordered(o.id,'checkout_expired') then return 'released'; end if;
 return 'unchanged';
end;
$$;
revoke all on function public.mark_checkout_expiry(uuid),public.finish_checkout_expiry(uuid,text) from public,anon,authenticated;
grant execute on function public.mark_checkout_expiry(uuid),public.finish_checkout_expiry(uuid,text) to service_role;
create function public.sweep_checkout_recovery(p_limit integer) returns void
language plpgsql security definer set search_path='' as $$
declare candidate record;
begin
 if p_limit not between 1 and 50 or p_limit is null then raise exception 'invalid_recovery_sweep'; end if;
 for candidate in
  select o.id from public.orders o where not o.checkout_attempt_guarded and o.status='pending'
   and not exists(select 1 from public.checkout_payment_attempts a where a.order_id=o.id)
   and not exists(select 1 from public.checkout_recovery_jobs j where j.unique_key='legacy_payment_order:'||o.id)
  order by o.created_at,o.id limit p_limit
 loop perform public.enqueue_checkout_recovery('reconcile_payment','legacy_payment_order:'||candidate.id,clock_timestamp(),'legacy_inquiry',candidate.id); end loop;
 for candidate in
  select a.id,a.order_id from public.checkout_payment_attempts a where a.state<>'ready'
   and not exists(select 1 from public.checkout_recovery_jobs j where j.unique_key='payment_attempt:'||a.id)
  order by a.updated_at,a.id limit p_limit
 loop perform public.enqueue_checkout_recovery('reconcile_payment','payment_attempt:'||candidate.id,clock_timestamp(),'payment_inquiry',candidate.order_id); end loop;
 for candidate in
  select o.id from public.orders o where o.expires_at<=clock_timestamp()
  and exists(select 1 from public.inventory_reservations h where h.order_id=o.id and h.status='active')
  and not exists(select 1 from public.checkout_recovery_jobs j where j.unique_key='expire_reservation:'||o.id)
  order by o.expires_at,o.id limit p_limit
 loop perform public.enqueue_checkout_recovery('expire_reservation','expire_reservation:'||candidate.id,clock_timestamp(),'reservation_expiring',candidate.id); end loop;
 for candidate in
  select e.square_event_id from public.square_webhook_events e where e.processed_at is null
  and not exists(select 1 from public.checkout_recovery_jobs j where j.event_id=e.square_event_id)
  order by e.received_at,e.square_event_id limit p_limit
 loop
  if candidate.square_event_id ~ '^[A-Za-z0-9._:=+-]{1,128}$' then
   perform public.enqueue_checkout_recovery('square_event','square_event:'||candidate.square_event_id,clock_timestamp(),'receipt_pending',null,candidate.square_event_id);
  else
   -- Preserve an unprocessable historical identifier as an operator obligation.
   insert into public.checkout_recovery_jobs(kind,unique_key,event_id,status,next_attempt_at,reason)
   values('square_event','legacy_event_review:'||md5(candidate.square_event_id),candidate.square_event_id,'review',clock_timestamp(),'legacy_event_id_invalid')
   on conflict do nothing;
  end if;
 end loop;
end;
$$;
revoke all on function public.sweep_checkout_recovery(integer) from public,anon,authenticated;
grant execute on function public.sweep_checkout_recovery(integer) to service_role;
commit;
