begin;

-- Square calls this trigger with an empty search path. Qualify the tax table.
CREATE OR REPLACE FUNCTION public.update_state_sales_tracking()
 RETURNS trigger
 LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF NEW.status = 'paid' AND (OLD.status IS NULL OR OLD.status != 'paid') THEN
    INSERT INTO public.state_sales_tracking AS tracking (
      tenant_id,
      state_code,
      year,
      month,
      total_sales,
      taxable_sales,
      transaction_count
    )
    VALUES (
      NEW.tenant_id,
      COALESCE(NEW.customer_state, 'SC'), -- Default to SC for pickups
      EXTRACT(YEAR FROM NEW.created_at),
      EXTRACT(MONTH FROM NEW.created_at),
      NEW.total,
      NEW.total - COALESCE(NEW.shipping, 0),
      1
    )
    ON CONFLICT (tenant_id, state_code, year, month)
    DO UPDATE SET
      total_sales = tracking.total_sales + EXCLUDED.total_sales,
      taxable_sales = tracking.taxable_sales + EXCLUDED.taxable_sales,
      transaction_count = tracking.transaction_count + EXCLUDED.transaction_count,
      updated_at = NOW();
  END IF;
  RETURN NEW;
END;
$function$
;

commit;
