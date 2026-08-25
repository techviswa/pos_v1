import { randomUUID } from "crypto";

import { createNotFoundError } from "./http-error.js";

export class InMemoryRepository {
  constructor({ seedData = [], idPrefix }) {
    this.items = [...seedData];
    this.idPrefix = idPrefix;
  }

  listByTenant(tenantId) {
    return this.items.filter((item) => item.tenantId === tenantId);
  }

  getByTenantAndId({ tenantId, entityId, entityName }) {
    const item = this.items.find(
      (currentItem) => currentItem.tenantId === tenantId && currentItem.id === entityId
    );

    if (!item) {
      throw createNotFoundError(entityName);
    }

    return item;
  }

  create({ tenantId, payload, buildEntity }) {
    const entityId = `${this.idPrefix}_${randomUUID()}`;
    const item = buildEntity({ entityId, tenantId, payload });
    this.items.push(item);
    return item;
  }

  update({ tenantId, entityId, payload, entityName, mergeEntity }) {
    const itemIndex = this.items.findIndex(
      (currentItem) => currentItem.tenantId === tenantId && currentItem.id === entityId
    );

    if (itemIndex === -1) {
      throw createNotFoundError(entityName);
    }

    this.items[itemIndex] = mergeEntity({
      currentEntity: this.items[itemIndex],
      payload,
    });

    return this.items[itemIndex];
  }

  delete({ tenantId, entityId, entityName }) {
    const itemIndex = this.items.findIndex(
      (currentItem) => currentItem.tenantId === tenantId && currentItem.id === entityId
    );

    if (itemIndex === -1) {
      throw createNotFoundError(entityName);
    }

    const [deletedEntity] = this.items.splice(itemIndex, 1);
    return deletedEntity;
  }
}
