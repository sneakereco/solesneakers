-- Repair environments where the table exists but role grants or the original
-- admin policy drifted from the application's current role definitions.
GRANT SELECT ON TABLE public.featured_items TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.featured_items TO authenticated;
GRANT ALL PRIVILEGES ON TABLE public.featured_items TO service_role;

DROP POLICY IF EXISTS "Admins can manage featured items" ON public.featured_items;
CREATE POLICY "Admins can manage featured items"
  ON public.featured_items
  FOR ALL
  USING (
    auth.uid() IN (
      SELECT id
      FROM public.profiles
      WHERE role IN ('admin', 'super_admin', 'dev')
    )
  )
  WITH CHECK (
    auth.uid() IN (
      SELECT id
      FROM public.profiles
      WHERE role IN ('admin', 'super_admin', 'dev')
    )
  );
