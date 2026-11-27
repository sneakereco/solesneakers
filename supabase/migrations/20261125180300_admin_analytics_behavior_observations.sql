-- Only opaque catalog references and an explicitly observed count cross the archive boundary.
alter table analytics_archive.analytics_behavior_archive
 drop constraint analytics_behavior_archive_event_name_check,
 drop constraint analytics_behavior_archive_check,
 drop constraint analytics_behavior_archive_check1,
 drop constraint analytics_behavior_archive_check2,
 add column result_count integer,
 add column concept_kind text,
 add column concept_id uuid,
 add constraint behavior_admitted_event check(event_name in ('public_page_viewed','storefront_viewed','product_viewed','product_added_to_cart','checkout_started','catalog_search_results','out_of_stock_viewed','variant_selected','unavailable_size_requested')),
 add constraint behavior_product check((event_name in ('product_viewed','product_added_to_cart','out_of_stock_viewed','variant_selected','unavailable_size_requested'))=(product_id is not null)),
 add constraint behavior_variant check((event_name in ('product_added_to_cart','variant_selected','unavailable_size_requested'))=(variant_id is not null)),
 add constraint behavior_product_path check(product_id is null or pathname='/store/'||product_id),
 add constraint behavior_search_total check((event_name='catalog_search_results')=(result_count is not null) and result_count>=0),
 add constraint behavior_search_concept check((concept_id is null and concept_kind is null) or
 (event_name='catalog_search_results' and concept_id is not null and concept_kind is not null and concept_kind in ('brand','model','product')));
create or replace view analytics_reporting.analytics_behavior_export as
 select distinct on (a.dataset_id,a.event_uuid) a.dataset_id,a.event_uuid,a.event_name,a.occurred_at,a.visitor_id,a.session_id,a.pathname,a.device,a.product_id,a.variant_id,a.landing_pathname,a.referrer_host,a.discovery_source,a.discovery_channel,a.discovery_campaign,a.discovery_placement,a.session_source,a.session_channel,a.session_campaign,a.session_placement,a.updated_at,a.result_count,a.concept_kind,a.concept_id
 from analytics_archive.analytics_behavior_archive a join analytics_reporting.eligible_datasets d using(dataset_id)
 join public.analytics_datasets launch using(dataset_id)
 where a.occurred_at>=launch.activated_at order by a.dataset_id,a.event_uuid,a.updated_at;
