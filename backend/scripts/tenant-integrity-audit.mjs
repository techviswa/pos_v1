import { Prisma } from "@prisma/client";
import prisma from "../src/database/prisma/client.js";
import { tenantModelPaths } from "../src/database/prisma/tenant-guard.js";

// Read-only audit. Identifiers come exclusively from the generated Prisma schema.
const models = new Map(Prisma.dmmf.datamodel.models.map((model) => [model.name, model]));
const quote = (name) => `"${name.replaceAll('"', '""')}"`;
const table = (model) => quote(models.get(model).dbName || model);
const column = (model, field) => quote(models.get(model).fields.find((entry) => entry.name === field).dbName || field);
let sequence = 0;
const ownerExpression = (model, alias, joins) => {
  let current = model, currentAlias = alias;
  for (const name of tenantModelPaths.get(model) || []) {
    const relation = models.get(current).fields.find((field) => field.name === name);
    const nextAlias = `j${sequence++}`;
    joins.push(`JOIN ${table(relation.type)} ${nextAlias} ON ${relation.relationFromFields.map((field, index) => `${currentAlias}.${column(current, field)} = ${nextAlias}.${column(relation.type, relation.relationToFields[index])}`).join(" AND ")}`);
    current = relation.type; currentAlias = nextAlias;
  }
  return `${currentAlias}.${column(current, current === "Business" ? "id" : "businessId")}`;
};
let relationships = 0;
const violations = [];
try {
  for (const model of models.values()) {
    if (!tenantModelPaths.has(model.name)) continue;
    for (const relation of model.fields.filter((field) => field.kind === "object" && field.relationFromFields?.length && tenantModelPaths.has(field.type))) {
      const joins = [];
      const fromOwner = ownerExpression(model.name, "s", joins);
      joins.push(`JOIN ${table(relation.type)} t ON ${relation.relationFromFields.map((field, index) => `s.${column(model.name, field)} = t.${column(relation.type, relation.relationToFields[index])}`).join(" AND ")}`);
      const toOwner = ownerExpression(relation.type, "t", joins);
      const sql = `SELECT COUNT(*)::int AS count FROM ${table(model.name)} s ${joins.join(" ")} WHERE ${fromOwner} <> ${toOwner}`;
      const [{ count }] = await prisma.$queryRawUnsafe(sql);
      relationships++;
      if (count) violations.push({ model: model.name, relation: relation.name, count });
    }
  }
  console.log(JSON.stringify({ relationships_checked: relationships, violations }, null, 2));
  if (violations.length) { process.exitCode = 1; console.error("Tenant integrity violations found. No records were changed; investigate these links before release."); }
} finally { await prisma.$disconnect(); }
