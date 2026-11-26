begin;
-- Add metadata without changing the recovery contract used by older application instances.
create function public.read_specialty_claim_result_with_context(p_attempt_id uuid,p_recovery_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_attempt public.specialty_claim_attempts%rowtype;
begin
  select * into v_attempt from public.specialty_claim_attempts where attempt_id=p_attempt_id;
  if not found then return null; end if;
  if v_attempt.recovery_hash is distinct from p_recovery_hash then
    raise exception 'specialty_attempt_unauthorized' using errcode='42501';
  end if;
  return jsonb_build_object('inputHash',v_attempt.input_hash,'payloadHash',v_attempt.payload_hash,
    'result',v_attempt.result,'productId',v_attempt.product_id,'campaignId',v_attempt.campaign_id);
end;
$$;
revoke all on function public.read_specialty_claim_result_with_context(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.read_specialty_claim_result_with_context(uuid,text) to service_role;
commit;
