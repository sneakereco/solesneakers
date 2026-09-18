-- Retire unused features without rewriting applied migration history.
-- Deploy the application removal before applying this migration.
drop table if exists public.email_subscription_tokens;
drop table if exists public.email_subscribers;
alter table public.contact_messages drop column if exists attachments;

-- Remove the obsolete signup preference from existing auth metadata.
update auth.users
set raw_user_meta_data = raw_user_meta_data - 'updatesOptIn'
where raw_user_meta_data ? 'updatesOptIn';
