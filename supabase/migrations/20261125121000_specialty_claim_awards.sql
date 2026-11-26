begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create function public._record_specialty_claim_attempt(p_command jsonb,p_result jsonb,p_claim_id uuid default null)
returns jsonb language sql set search_path = '' as $$
  insert into public.specialty_claim_attempts(attempt_id,campaign_id,product_id,recovery_hash,input_hash,payload_hash,result,claim_id)
  values ((p_command->>'attemptId')::uuid,(p_command#>>'{eligibility,campaignId}')::uuid,
    (p_command#>>'{eligibility,productId}')::uuid,p_command->>'recoveryHash',p_command->>'inputHash',
    p_command->>'payloadHash',p_result,p_claim_id);
  select jsonb_build_object('result',p_result,'replayed',false);
$$;
revoke all on function public._record_specialty_claim_attempt(jsonb,jsonb,uuid) from public,anon,authenticated,service_role;

create function public.accept_specialty_claim(p_command jsonb)
returns jsonb language plpgsql security definer
set search_path = '' set lock_timeout = '2s' set statement_timeout = '5s' as $$
declare
  v_attempt_id uuid := (p_command->>'attemptId')::uuid;
  v_e jsonb := p_command->'eligibility';
  v_campaign_id uuid := (p_command#>>'{eligibility,campaignId}')::uuid;
  v_product_id uuid := (p_command#>>'{eligibility,productId}')::uuid;
  v_address_key text := p_command#>>'{eligibility,addressKey}';
  v_instagram_key text := p_command#>>'{eligibility,instagramKey}';
  v_handle text := p_command#>>'{eligibility,instagramHandle}';
  v_attempt public.specialty_claim_attempts%rowtype;
  v_campaign public.specialty_campaigns%rowtype;
  v_product public.products%rowtype;
  v_config public.specialty_product_config%rowtype;
  v_variant public.product_variants%rowtype;
  v_claim public.specialty_claims%rowtype;
  v_result jsonb; v_image text; v_instructions text;
  v_context text := coalesce(current_setting('app.specialty_write_context',true),'');
begin
  if v_attempt_id is null or coalesce(p_command->>'recoveryHash','') !~ '^[a-f0-9]{64}$'
    or coalesce(p_command->>'inputHash','') !~ '^[a-f0-9]{64}$'
    or coalesce(p_command->>'payloadHash','') !~ '^[a-f0-9]{64}$' then
    raise exception 'specialty_invalid_claim';
  end if;
  -- Only duplicate attempt IDs serialize here; unrelated shoppers do not.
  perform pg_advisory_xact_lock(57501,hashtext(v_attempt_id::text));
  select * into v_attempt from public.specialty_claim_attempts where attempt_id=v_attempt_id;
  if found then
    if v_attempt.recovery_hash is distinct from p_command->>'recoveryHash' then
      raise exception 'specialty_attempt_unauthorized' using errcode='42501';
    end if;
    if v_attempt.input_hash is distinct from p_command->>'inputHash' or v_attempt.payload_hash is distinct from p_command->>'payloadHash' then
      raise exception 'specialty_payload_conflict';
    end if;
    return jsonb_build_object('result',v_attempt.result,'replayed',true);
  end if;
  if v_campaign_id is null or v_product_id is null or jsonb_typeof(v_e->'address') is distinct from 'object'
    or v_e#>>'{address,country}' is distinct from 'US' or nullif(trim(v_e#>>'{address,line1}'),'') is null
    or coalesce(v_address_key,'') !~ '^[a-f0-9]{64}$' or coalesce(v_instagram_key,'') !~ '^[a-f0-9]{64}$'
    or coalesce(v_handle,'') !~ '^[a-z0-9._]{1,30}$' then raise exception 'specialty_invalid_claim'; end if;

  -- Shared campaign lock allows independent products and makes disable atomic.
  select * into v_campaign from public.specialty_campaigns where id=v_campaign_id for share;
  if not found then raise exception 'specialty_campaign_missing'; end if;
  if not v_campaign.enabled then
    return public._record_specialty_claim_attempt(p_command,jsonb_build_object('status','closed'));
  end if;
  if (v_e->>'normalizationVersion')::integer is distinct from v_campaign.normalization_version
    or v_e->>'identityKeyFingerprint' is distinct from v_campaign.identity_key_fingerprint then
    raise exception 'specialty_identity_key_mismatch';
  end if;
  select * into v_product from public.products where id=v_product_id for update;
  if not found or v_product.category<>'specialty' or not v_product.is_active
    or v_product.archived_at is not null or v_product.go_live_at>clock_timestamp() then
    return public._record_specialty_claim_attempt(p_command,jsonb_build_object('status','closed'));
  end if;
  select * into v_config from public.specialty_product_config
    where product_id=v_product_id and campaign_id=v_campaign_id for update;
  if not found then return public._record_specialty_claim_attempt(p_command,jsonb_build_object('status','closed')); end if;
  select * into v_variant from public.product_variants where id=v_config.variant_id for update;
  if not found or v_variant.product_id<>v_product_id or v_variant.sale_price_cents<>0 then
    raise exception 'specialty_product_config_invalid';
  end if;
  if nullif(v_e->>'expiresAt','') is null
    or to_timestamp((v_e->>'expiresAt')::numeric/1000)<=clock_timestamp() then
    raise exception 'specialty_proof_expired';
  end if;
  if exists(select 1 from public.specialty_claims where campaign_id=v_campaign_id
    and (address_key=v_address_key or instagram_key=v_instagram_key)) then
    return public._record_specialty_claim_attempt(p_command,jsonb_build_object('status','already_claimed'));
  end if;
  if v_variant.stock<=0 then
    return public._record_specialty_claim_attempt(p_command,jsonb_build_object('status','sold_out'));
  end if;
  select url into v_image from public.product_images where product_id=v_product_id
    order by is_primary desc,sort_order,id limit 1;
  v_instructions := coalesce(nullif(v_config.winning_instructions,''),
    'You claimed '||v_product.name||'. The reseller will contact @'||v_handle||' on Instagram to arrange your prize. Keep this confirmation for your records.');

  -- A conflict on either campaign identity means no stock is consumed here.
  insert into public.specialty_claims(campaign_id,product_id,variant_id,address_key,instagram_key,
    instagram_handle,eligibility_address,product_name,product_image_url,instructions,decision_ordinal)
  values(v_campaign_id,v_product_id,v_variant.id,v_address_key,v_instagram_key,v_handle,
    v_e->'address',v_product.name,v_image,v_instructions,v_config.decision_ordinal+1)
  on conflict do nothing returning * into v_claim;
  if not found then
    return public._record_specialty_claim_attempt(p_command,jsonb_build_object('status','already_claimed'));
  end if;
  perform set_config('app.specialty_write_context','award',true);
  update public.product_variants set stock=stock-1 where id=v_variant.id and stock>0;
  if not found then raise exception 'specialty_stock_changed'; end if;
  update public.specialty_product_config set decision_ordinal=decision_ordinal+1,
    revision=revision+1,updated_at=clock_timestamp() where product_id=v_product_id;
  perform set_config('app.specialty_write_context',v_context,true);

  v_result := jsonb_build_object('status','won','receipt',jsonb_build_object(
    'claimId',v_claim.id,'productId',v_claim.product_id,'productName',v_claim.product_name,
    'instagramHandle',v_claim.instagram_handle,'instructions',v_claim.instructions,
    'acceptedAt',v_claim.accepted_at,'decisionOrdinal',v_claim.decision_ordinal));
  return public._record_specialty_claim_attempt(p_command,v_result,v_claim.id);
exception when others then
  perform set_config('app.specialty_write_context',v_context,true);
  raise;
end;
$$;

create function public.read_specialty_claim_result(p_attempt_id uuid,p_recovery_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_attempt public.specialty_claim_attempts%rowtype;
begin
  select * into v_attempt from public.specialty_claim_attempts where attempt_id=p_attempt_id;
  if not found then return null; end if;
  if v_attempt.recovery_hash is distinct from p_recovery_hash then
    raise exception 'specialty_attempt_unauthorized' using errcode='42501';
  end if;
  return jsonb_build_object('inputHash',v_attempt.input_hash,'payloadHash',v_attempt.payload_hash,'result',v_attempt.result);
end;
$$;
revoke all on function public.accept_specialty_claim(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.read_specialty_claim_result(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.accept_specialty_claim(jsonb) to service_role;
grant execute on function public.read_specialty_claim_result(uuid,text) to service_role;

commit;
