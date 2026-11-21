import { Prisma } from "@prisma/client";
import { currentTenantScope } from "./tenant-context.js";
import { createHttpError } from "../../shared/utils/http-error.js";
import { ROLE_DEFAULT_PERMISSIONS, STAFF_PERMISSION_KEYS } from "../../shared/constants/access.constants.js";

const models = new Map(Prisma.dmmf.datamodel.models.map((model) => [model.name, model]));
const paths = new Map([["Business", []]]);
for (const model of models.values()) if (model.fields.some((field) => field.name === "businessId")) paths.set(model.name, null);
for (let pass = 0; pass < models.size; pass++) {
  for (const model of models.values()) {
    if (paths.has(model.name)) continue;
    const parent = model.fields.find((field) => field.kind === "object" && !field.isList && field.isRequired && paths.has(field.type));
    if (parent) paths.set(model.name, [parent.name, ...(paths.get(parent.type) || [])]);
  }
}
export const tenantModelPaths = paths;
export const systemModels = new Set(["Role", "Permission", "RolePermission", "AuthSession", "AuthToken", "BackgroundJob", "StateDocument", "DocumentSequence", "AdminCoreSyncLog"]);
export const modelScope = (model, businessId) => {
  if (!paths.has(model)) return null;
  const path = paths.get(model);
  let result = model === "Business" ? { id: businessId } : { businessId };
  // Indirect models terminate at a business-owned parent, not at Business itself.
  if (path?.length) {
    let target = models.get(model);
    for (const field of path) target = models.get(target.fields.find((entry) => entry.name === field).type);
    result = target.name === "Business" ? { id: businessId } : { businessId };
    for (const field of [...path].reverse()) result = { [field]: result };
  }
  return result;
};
const denied = () => createHttpError({ statusCode: 403, code: "TENANT_REFERENCE_FORBIDDEN", message: "A record reference belongs to another business" });
const stateKeys = (businessId) => ({
  exact: ["saas", "business-profile", "customer-settings", "staff-settings", "payroll-settings", "shift-swaps"].map((prefix) => `${prefix}:${businessId}`),
  prefixes: ["print", "printer-agent", "product-image", "shift", "report-schedule", "client-event"].map((prefix) => `${prefix}:${businessId}:`).concat(`payment-intent:${encodeURIComponent(businessId)}:`),
});
const delegate = (model) => model[0].toLowerCase() + model.slice(1);
const scopedWhere = (where, scope) => ({ ...(where || {}), AND: [...(where?.AND ? Array.isArray(where.AND) ? where.AND : [where.AND] : []), scope] });
const scalar = (value) => value && typeof value === "object" && "set" in value ? value.set : value;

const normalWhere = (model, where) => Object.fromEntries(Object.entries(where || {}).flatMap(([key, value]) => {
  const known = models.get(model).fields.some((field) => field.name === key);
  return !known && value && typeof value === "object" && !["AND", "OR", "NOT"].includes(key) ? Object.entries(value) : [[key, value]];
}));

const verifyReference = async (raw, model, where, businessId) => {
  const owned = modelScope(model, businessId);
  if (!owned || !where || !Object.keys(where).length) return;
  const wanted = normalWhere(model, where);
  const foreign = await raw[delegate(model)].findFirst({ where: { AND: [wanted, { NOT: owned }] }, select: { [models.get(model).fields.find((field) => field.isId)?.name || models.get(model).fields.find((field) => field.kind === "scalar").name]: true } });
  if (foreign) throw denied();
};

const validateData = async (raw, model, data, scope, inject = false) => {
  if (!data || typeof data !== "object") return;
  if (Array.isArray(data)) { for (const item of data) await validateData(raw, model, item, scope, inject); return; }
  const spec = models.get(model);
  if (model === "Business") {
    if (data.id !== undefined && scalar(data.id) !== scope.businessId) throw denied();
    if (data.tenantId !== undefined && scalar(data.tenantId) !== scope.tenantId) throw denied();
  }
  if (spec.fields.some((field) => field.name === "businessId")) {
    if (data.businessId !== undefined && scalar(data.businessId) !== scope.businessId) throw denied();
    if (inject && data.businessId === undefined && !data.business) data.businessId = scope.businessId;
  }
  for (const relation of spec.fields.filter((field) => field.kind === "object")) {
    const ids = relation.relationFromFields || [];
    if (ids.length === 1 && data[ids[0]] != null) await verifyReference(raw, relation.type, { [relation.relationToFields[0]]: scalar(data[ids[0]]) }, scope.businessId);
    const nested = data[relation.name];
    if (!nested || typeof nested !== "object") continue;
    for (const operation of ["connect", "set", "disconnect", "delete"]) {
      if (typeof nested[operation] !== "object" || nested[operation] === null) continue;
      for (const where of [].concat(nested[operation])) await verifyReference(raw, relation.type, where, scope.businessId);
    }
    for (const operation of ["create", "createMany", "update", "updateMany", "upsert", "connectOrCreate"]) {
      const supplied = nested[operation];
      if (!supplied) continue;
      for (const item of [].concat(operation === "createMany" ? supplied.data : supplied)) {
        if (item.where) await verifyReference(raw, relation.type, item.where, scope.businessId);
        for (const value of operation === "upsert" ? [item.create, item.update] : operation === "connectOrCreate" ? [item.create] : [item.data || item]) await validateData(raw, relation.type, value, scope);
      }
    }
  }
};

const filterRelations = (model, selection, businessId, forced) => {
  if (!selection || typeof selection !== "object") return;
  if (selection._count === true) selection._count = { select: Object.fromEntries(models.get(model).fields.filter((field) => field.kind === "object" && field.isList).map((field) => [field.name, true])) };
  if (selection._count?.select) for (const field of models.get(model).fields.filter((entry) => entry.kind === "object" && entry.isList)) {
    const predicate = modelScope(field.type, businessId);
    const chosen = selection._count.select[field.name];
    if (chosen && predicate) selection._count.select[field.name] = { ...(chosen === true ? {} : chosen), where: scopedWhere(chosen.where, predicate) };
  }
  for (const relation of models.get(model).fields.filter((field) => field.kind === "object")) {
    let chosen = selection[relation.name];
    if (!chosen) continue;
    const scope = modelScope(relation.type, businessId);
    if (relation.isList && scope) {
      if (chosen === true) chosen = selection[relation.name] = {};
      chosen.where = scopedWhere(chosen.where, scope);
    }
    if (chosen !== true) {
      if (chosen.select && scope) {
        const field = relation.type === "Business" ? "id" : models.get(relation.type).fields.some((entry) => entry.name === "businessId") ? "businessId" : null;
        if (field && !chosen.select[field]) { chosen.select[field] = true; forced.set(chosen.select, field); }
      }
      filterRelations(relation.type, chosen.include, businessId, forced);
      filterRelations(relation.type, chosen.select, businessId, forced);
    }
  }
};

const verifyOutput = (model, result, scope, selection, forced) => {
  if (!result || typeof result !== "object") return;
  if (Array.isArray(result)) { for (const row of result) verifyOutput(model, row, scope, selection, forced); return; }
  if (result.businessId != null && models.get(model).fields.some((field) => field.name === "businessId") && result.businessId !== scope.businessId) throw denied();
  if (model === "Business" && result.id != null && result.id !== scope.businessId) throw denied();
  if (model === "StateDocument") for (const owner of [result.data?.business_id, result.data?.businessId]) if (owner && owner !== scope.businessId) throw denied();
  for (const relation of models.get(model).fields.filter((field) => field.kind === "object")) {
    const nested = selection?.[relation.name];
    if (nested && result[relation.name]) verifyOutput(relation.type, result[relation.name], scope, nested.select || nested.include, forced);
  }
  if (forced.has(selection)) delete result[forced.get(selection)];
};

export const createTenantGuard = (raw) => async ({ model, operation, args, query }) => {
  const scope = currentTenantScope();
  if (scope?.businessId && operation.includes("Unsafe")) throw denied();
  if (!scope?.businessId || !model) return query(args);
  args ||= {};
  if (!paths.has(model) && !systemModels.has(model)) throw denied();
  if (["Role", "Permission", "RolePermission"].includes(model) && !operation.startsWith("find") && !["count", "aggregate", "groupBy"].includes(operation)) {
    // Staff provisioning may only materialize the source-defined, global role catalogue.
    if (operation !== "upsert") throw denied();
    if (model === "Role" && (!Object.hasOwn(ROLE_DEFAULT_PERMISSIONS, args.where?.name) || args.create?.name !== args.where.name || Object.keys(args.update || {}).length || Object.keys(args.create || {}).some((key) => key !== "name"))) throw denied();
    if (model === "Permission" && (!STAFF_PERMISSION_KEYS.includes(args.where?.key) || args.create?.key !== args.where.key || args.create?.label !== args.where.key || args.update?.label !== args.where.key || Object.keys(args.create || {}).some((key) => !["key", "label"].includes(key)) || Object.keys(args.update || {}).some((key) => key !== "label"))) throw denied();
    if (model === "RolePermission") {
      const role = await raw.role.findUnique({ where: { id: args.create?.roleId || "" }, select: { name: true } });
      const permission = await raw.permission.findUnique({ where: { id: args.create?.permissionId || "" }, select: { key: true } });
      if (!ROLE_DEFAULT_PERMISSIONS[role?.name]?.includes(permission?.key) || Object.keys(args.update || {}).length || Object.keys(args.create || {}).some((key) => !["roleId", "permissionId"].includes(key)) || args.where?.roleId_permissionId?.roleId !== args.create.roleId || args.where?.roleId_permissionId?.permissionId !== args.create.permissionId) throw denied();
    }
  }
  let predicate = modelScope(model, scope.businessId);
  if (model === "AdminCoreSyncLog") predicate = { tenantId: scope.tenantId };
  if (model === "BackgroundJob") predicate = { OR: [{ payload: { path: ["business_id"], equals: scope.businessId } }, { payload: { path: ["businessId"], equals: scope.businessId } }] };
  if (model === "AuthSession") predicate = { userId: { in: (await raw.user.findMany({ where: { businessId: scope.businessId }, select: { id: true } })).map((user) => user.id) } };
  if (model === "AuthToken") {
    predicate = { OR: [{ user: { businessId: scope.businessId } }, { metadata: { path: ["business_id"], equals: scope.businessId } }, { metadata: { path: ["businessId"], equals: scope.businessId } }] };
    for (const item of [args.data, args.create, args.update].filter(Boolean)) {
      if (item.userId) await verifyReference(raw, "User", { id: item.userId }, scope.businessId);
      for (const owner of [item.metadata?.business_id, item.metadata?.businessId]) if (owner && owner !== scope.businessId) throw denied();
      if (operation.startsWith("create") && !item.userId && (item.metadata?.business_id || item.metadata?.businessId) !== scope.businessId) throw denied();
    }
  }
  if (model === "DocumentSequence") {
    predicate = { key: { in: [`invoice:${scope.businessId}`, `kot:${scope.businessId}`] } };
    for (const item of [args.data, args.create, args.update].filter(Boolean)) if (item.key && !predicate.key.in.includes(item.key)) throw denied();
  }
  if (model === "StateDocument") {
    const keys = stateKeys(scope.businessId);
    predicate = { OR: [{ key: { in: keys.exact } }, ...keys.prefixes.map((prefix) => ({ key: { startsWith: prefix } })), { data: { path: ["business_id"], equals: scope.businessId } }, { data: { path: ["businessId"], equals: scope.businessId } }] };
    for (const item of [args.data, args.create, args.update].filter(Boolean)) {
      const key = item.key || args.where?.key;
      const owner = item.data?.business_id || item.data?.businessId;
      for (const ownerId of [item.data?.business_id, item.data?.businessId]) if (ownerId && ownerId !== scope.businessId) throw denied();
      const reserved = ["saas", "business-profile", "customer-settings", "staff-settings", "payroll-settings", "shift-swaps", "print", "printer-agent", "product-image", "shift", "payment-intent", "report-schedule", "client-event"];
      if (key && reserved.includes(key.split(":")[0]) && !keys.exact.includes(key) && !keys.prefixes.some((prefix) => key.startsWith(prefix))) throw denied();
      if (owner && owner !== scope.businessId) throw denied();
      if (key && !keys.exact.includes(key) && !keys.prefixes.some((prefix) => key.startsWith(prefix)) && owner !== scope.businessId) {
        const existing = await raw.stateDocument.findUnique({ where: { key }, select: { data: true } });
        if ((existing?.data?.business_id || existing?.data?.businessId) !== scope.businessId) throw denied();
      }
    }
  }
  if (predicate) {
    if (!["create", "createMany", "createManyAndReturn"].includes(operation)) args.where = scopedWhere(args.where, predicate);
    for (const field of ["data", "create", "update"]) if (args[field]) await validateData(raw, model, args[field], scope, field === "create" || operation.startsWith("create"));
    if (model === "BackgroundJob") {
      for (const item of [].concat(args.data || args.create || []).filter(Boolean)) if (Object.hasOwn(item, "payload") && (item.payload?.business_id || item.payload?.businessId) !== scope.businessId) throw denied();
    }
    if (model === "AdminCoreSyncLog") for (const item of [args.data, args.create, args.update].filter(Boolean)) {
      if (Object.hasOwn(item, "tenantId") && item.tenantId !== scope.tenantId) throw denied();
      if (operation.startsWith("create") && !Object.hasOwn(item, "tenantId")) item.tenantId = scope.tenantId;
    }
    if (model === "AuthSession") for (const item of [args.data, args.create, args.update].filter(Boolean)) if (item.userId) await verifyReference(raw, "User", { id: scalar(item.userId) }, scope.businessId);
  }
  const forced = new Map();
  filterRelations(model, args.include, scope.businessId, forced);
  filterRelations(model, args.select, scope.businessId, forced);
  const result = await query(args);
  if (["count", "aggregate"].includes(operation)) return result;
  verifyOutput(model, result, scope, args.select || args.include, forced);
  return result;
};
