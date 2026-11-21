import { Prisma } from "@prisma/client";

export const verifyRlsConnection = async (client, { system = false } = {}) => {
  const roles = await client.$queryRawUnsafe(`SELECT current_user AS name, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb, rolreplication FROM pg_roles WHERE rolname=current_user`);
  const role = roles[0];
  if (!role || [role.rolsuper, role.rolbypassrls, role.rolcreaterole, role.rolcreatedb, role.rolreplication].some(Boolean)) throw new Error("TENANT_DATABASE_URL must use a restricted NOBYPASSRLS role");
  const tables = await client.$queryRawUnsafe(`SELECT c.relname AS name, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced,
    pg_has_role(current_user, c.relowner, 'MEMBER') AS owner_access,
    has_table_privilege(current_user, c.oid, 'TRUNCATE') AS can_truncate,
    EXISTS (SELECT 1 FROM pg_policy p, unnest(p.polroles) r WHERE p.polrelid=c.oid AND p.polname='pos_system' AND r<>0 AND pg_has_role(current_user, r, 'MEMBER')) AS system_access,
    (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid=c.oid) AS policies
    FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind='r'`);
  for (const model of Prisma.dmmf.datamodel.models) {
    const row = tables.find((entry) => entry.name === (model.dbName || model.name));
    if (!row?.enabled || !row.forced || !row.policies || row.owner_access || row.can_truncate) throw new Error(`Unsafe or missing RLS configuration for ${model.name}`);
    if (row.system_access !== system) throw new Error(`Incorrect system-policy access for ${model.name}`);
  }
  const [{ can_create }] = await client.$queryRawUnsafe(`SELECT has_schema_privilege(current_user, 'public', 'CREATE') AS can_create`);
  if (can_create) throw new Error("Tenant database role must not CREATE objects in public");
  return { enabled: true, role: role.name, protected_models: Prisma.dmmf.datamodel.models.length };
};
