import { AsyncLocalStorage } from "node:async_hooks";
import { currentTenantScope } from "./tenant-context.js";

const transactions = new AsyncLocalStorage();
export const hasActiveTransaction = () => Boolean(transactions.getStore());
const delegate = (name) => name[0].toLowerCase() + name.slice(1);

// Every tenant operation uses a transaction-local context on the restricted
// connection. Never SET session variables on a pooled connection outside a tx.
export const createRlsRuntime = ({ system, tenant, guard, convert }) => {
  const initialize = async (tx, scope) => {
    await tx.$executeRaw`SELECT set_config('pos.business_id', ${scope.businessId}, true), set_config('pos.tenant_id', ${scope.tenantId}, true)`;
  };
  const invoke = (client, operation, args) => operation.model
    ? client[delegate(operation.model)][operation.operation](args)
    : client[operation.operation](...(Array.isArray(args) ? args : [args]));
  const execute = async (operation) => {
    const scope = currentTenantScope();
    const active = transactions.getStore();
    if (active) {
      if (active.businessId !== scope?.businessId || active.tenantId !== scope?.tenantId) throw new Error("Database transaction cannot switch tenant context");
      return invoke(active.client, operation, operation.args);
    }
    if (!scope?.businessId || !tenant) return operation.query(operation.args);
    return tenant.$transaction(async (tx) => {
      await initialize(tx, scope);
      return invoke(tx, operation, operation.args);
    }, { maxWait: 15000, timeout: 20000 });
  };
  const wrap = (client) => new Proxy(client, {
    get(target, key) {
      const value = target[key];
      if (typeof key !== "string") return value;
      if (key.startsWith("$")) {
        if (["$queryRaw", "$executeRaw", "$queryRawUnsafe", "$executeRawUnsafe"].includes(key)) return (...args) => guard({ operation: key, args, query: (next) => value.apply(target, next) }).then(convert);
        return typeof value === "function" ? value.bind(target) : value;
      }
      if (!value || typeof value !== "object") return value;
      return new Proxy(value, { get(modelTarget, method) {
        if (typeof modelTarget[method] !== "function") return modelTarget[method];
        return (args) => guard({ model: key[0].toUpperCase() + key.slice(1), operation: method, args, query: (next) => modelTarget[method](next) }).then(convert);
      } });
    },
  });
  const transaction = (work, options) => {
    const scope = currentTenantScope();
    if (Array.isArray(work)) {
      if (scope?.businessId) throw new Error("Tenant transactions require the callback form so RLS context stays on one connection");
      return system.$transaction(work, options);
    }
    if (transactions.getStore()) throw new Error("Nested database transactions are not supported");
    const client = scope?.businessId && tenant ? tenant : system;
    return client.$transaction(async (tx) => {
      if (scope?.businessId && tenant) await initialize(tx, scope);
      return transactions.run({ client: tx, businessId: scope?.businessId, tenantId: scope?.tenantId }, () => work(wrap(tx)));
    }, { maxWait: 15000, timeout: 20000, ...options });
  };
  return { execute, transaction };
};
