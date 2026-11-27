-- The restricted runtime roles (created by scripts/setup-rls-role.mjs, any names) get the same access to the new QR
-- link tables as they already have to table QR codes. Does nothing on databases without those roles.
DO $access$
DECLARE grantee_name text; system_roles text;
BEGIN
  FOR grantee_name IN
    SELECT DISTINCT pg_get_userbyid(acl.grantee) FROM pg_class c, aclexplode(c.relacl) acl
    WHERE c.oid = 'public."TableQrCode"'::regclass AND acl.privilege_type = 'SELECT' AND acl.grantee <> c.relowner AND acl.grantee <> 0
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."QrLink", public."QrLinkScan" TO %I', grantee_name);
  END LOOP;
  SELECT string_agg(quote_ident(pg_get_userbyid(role_id)), ', ') INTO system_roles
    FROM pg_policy p, unnest(p.polroles) role_id
    WHERE p.polrelid = 'public."TableQrCode"'::regclass AND p.polname = 'pos_system' AND role_id <> 0;
  IF system_roles IS NOT NULL THEN
    EXECUTE format('ALTER POLICY pos_system ON public."QrLink" TO %s', system_roles);
    EXECUTE format('ALTER POLICY pos_system ON public."QrLinkScan" TO %s', system_roles);
  END IF;
END $access$;
