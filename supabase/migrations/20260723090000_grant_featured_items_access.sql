-- RLS policies define which rows are accessible, but roles still need table privileges.
GRANT SELECT ON TABLE public.featured_items TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.featured_items TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.featured_items TO service_role;
