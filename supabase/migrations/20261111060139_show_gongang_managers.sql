CREATE POLICY "profile_permissions_select_gongang_managers" ON "public"."profile_permissions"
  FOR SELECT
  TO "authenticated"
  USING (((permission_key = 'gongang.manage'::text) AND (( SELECT private.current_profile_id() AS current_profile_id) IS NOT NULL)));
