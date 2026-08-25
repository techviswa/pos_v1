import { tableManagementRepository } from "./table-management.repository.js";
import { tableManagementValidation } from "./table-management.validation.js";
import { createHttpError, createNotFoundError } from "../../../shared/utils/http-error.js";
import { randomBytes } from "node:crypto";

const CORE_STATUSES = new Set(["available", "reserved", "occupied"]);
const ACTIVE_RESERVATION_STATUSES = new Set(["reserved", "occupied"]);

const DEFAULT_SETTINGS = {
  nichePreset: "restaurant",
  serviceMode: "full_service",
  capabilities: {
    reservationsEnabled: true,
    areasEnabled: true,
    qrOrderingEnabled: false,
    splitBillEnabled: true,
    mergeTablesEnabled: false,
    waiterAssignmentEnabled: false,
    runnerDeliveryEnabled: false,
    cleaningStateEnabled: true,
    blockedStateEnabled: true,
  },
  reservationRules: {
    autoReleaseOnUndo: true,
    allowWalkInReservation: true,
    qrOrderingRules: {
      orderingPaused: false,
      requireCustomerPhone: false,
      minOrderTotal: 0,
      estimatedPrepMinutes: 20,
    },
  },
  uiPreferences: {
    boardLayout: "grid",
    highlightReserved: true,
  },
};

const cloneJson = (value, fallback) => {
  if (value === undefined || value === null) return fallback;
  return JSON.parse(JSON.stringify(value));
};

const createQrToken = () => randomBytes(24).toString("base64url");

const normalizeReservationStatus = (value, fallback = "reserved") => {
  const normalized = String(value || fallback).trim().toLowerCase();
  if (["pending_confirmation", "active", "reserved"].includes(normalized)) return "reserved";
  if (["confirmed", "occupied", "seated"].includes(normalized)) return "occupied";
  if (["cancelled", "canceled"].includes(normalized)) return "cancelled";
  if (["no_show", "noshow", "no-show"].includes(normalized)) return "no_show";
  if (["released", "available"].includes(normalized)) return "released";
  if (["blocked", "cleaning"].includes(normalized)) return normalized;
  return fallback;
};

const normalizeTableStatus = (value, fallback = "available") => {
  const normalized = normalizeReservationStatus(value, fallback);
  return normalized === "released" ? "available" : normalized;
};

const getBillingStatus = (tableStatus) => {
  const normalized = normalizeTableStatus(tableStatus);
  return CORE_STATUSES.has(normalized) ? normalized : "available";
};

const isFutureReservation = (reservation) => {
  if (!reservation?.reservationDate) return false;
  return reservation.reservationDate.getTime() > Date.now();
};

const getActiveReservation = (reservations = []) =>
  reservations.find((reservation) => {
    const status = normalizeReservationStatus(reservation.status);
    if (status === "occupied") return true;
    if (status !== "reserved") return false;
    return !isFutureReservation(reservation);
  });

const reservationWindowsOverlap = (left, right, windowMinutes = 120) => {
  if (!left || !right) return false;
  const leftTime = new Date(left).getTime();
  const rightTime = new Date(right).getTime();
  if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) return false;
  return Math.abs(leftTime - rightTime) < windowMinutes * 60 * 1000;
};

const createTableSummary = (items = []) =>
  items.reduce(
    (summary, table) => {
      summary.total += 1;
      if (table.billing_status === "reserved") summary.reserved += 1;
      else if (table.billing_status === "occupied") summary.occupied += 1;
      else summary.available += 1;
      return summary;
    },
    {
      total: 0,
      available: 0,
      reserved: 0,
      occupied: 0,
    },
  );

const attachQrCode = (table, qrCode = null) => ({
  ...table,
  qrCode,
});

const attachQrCodes = (tables = [], qrCodes = []) => {
  const qrCodeMap = new Map(qrCodes.map((qrCode) => [qrCode.tableId, qrCode]));
  return tables.map((table) => attachQrCode(table, qrCodeMap.get(table.id) || null));
};

class TableManagementService {
  async getBusiness({ tenantId, businessId }) {
    return tableManagementRepository.getBusinessContext({ tenantId, businessId });
  }

  serializeSettings(settings) {
    const source = settings || DEFAULT_SETTINGS;
    return {
      nichePreset: source.nichePreset || DEFAULT_SETTINGS.nichePreset,
      serviceMode: source.serviceMode || DEFAULT_SETTINGS.serviceMode,
      capabilities: cloneJson(source.capabilities, cloneJson(DEFAULT_SETTINGS.capabilities, {})),
      reservationRules: {
        ...cloneJson(DEFAULT_SETTINGS.reservationRules, {}),
        ...cloneJson(source.reservationRules, {}),
        qrOrderingRules: {
          ...cloneJson(DEFAULT_SETTINGS.reservationRules.qrOrderingRules, {}),
          ...cloneJson(source.reservationRules?.qrOrderingRules, {}),
        },
      },
      uiPreferences: cloneJson(source.uiPreferences, cloneJson(DEFAULT_SETTINGS.uiPreferences, {})),
    };
  }

  serializeReservation(reservation, tenantId = null) {
    if (!reservation) return null;
    const normalizedStatus = normalizeReservationStatus(reservation.status);
    const outputStatus = normalizedStatus === "released" ? "available" : normalizedStatus;
    const scheduledFor = reservation.reservationDate ? reservation.reservationDate.toISOString() : null;

    return {
      id: reservation.id,
      tenantId,
      tenant_id: tenantId,
      business_id: reservation.businessId,
      reservation_id: reservation.id,
      outlet_id: null,
      table_id: reservation.tableId || null,
      table_label: reservation.table?.name || null,
      table_name: reservation.table?.name || null,
      area_id: reservation.table?.areaId || null,
      area_name: reservation.table?.area?.name || null,
      customer_name: reservation.customerName || null,
      customer_phone: reservation.customerPhone || null,
      reservation_for: scheduledFor,
      reservation_date: scheduledFor,
      scheduled_for: scheduledFor,
      guests_count: reservation.guestsCount ?? null,
      notes: reservation.notes || "",
      source: reservation.source || "manual",
      status: outputStatus,
      reservation_status: outputStatus,
      confirmation_deadline: scheduledFor,
      confirmed_at: reservation.confirmedAt ? reservation.confirmedAt.toISOString() : null,
      released_at: reservation.releasedAt ? reservation.releasedAt.toISOString() : null,
      canceled_at: reservation.canceledAt ? reservation.canceledAt.toISOString() : null,
      is_active_hold: normalizedStatus === "reserved" && !isFutureReservation(reservation),
      is_upcoming_hold: normalizedStatus === "reserved" && isFutureReservation(reservation),
      is_occupied: normalizedStatus === "occupied",
      is_scheduled: Boolean(scheduledFor),
      can_confirm: normalizedStatus === "reserved",
      meta: cloneJson(reservation.meta, {}),
      sync_source: "pos-core",
      created_at: reservation.createdAt ? reservation.createdAt.toISOString() : null,
      updated_at: reservation.updatedAt ? reservation.updatedAt.toISOString() : null,
    };
  }

  serializeTable(table, tenantId = null) {
    const activeReservation = getActiveReservation(table.reservations);
    const derivedStatus = activeReservation
      ? normalizeReservationStatus(activeReservation.status) === "occupied"
        ? "occupied"
        : "reserved"
      : normalizeTableStatus(table.status);
    const billingStatus = getBillingStatus(derivedStatus);

    return {
      id: table.id,
      tenantId,
      tenant_id: tenantId,
      business_id: table.businessId,
      table_id: table.id,
      area_id: table.areaId || null,
      area_name: table.area?.name || null,
      name: table.name,
      code: table.code || null,
      seats: table.seats,
      status: derivedStatus,
      billing_status: billingStatus,
      active: table.active,
      shape: table.shape || null,
      sort_order: table.sortOrder ?? 0,
      meta: cloneJson(table.meta, {}),
      qr_ordering: table.qrCode
        ? {
            id: table.qrCode.id,
            token: table.qrCode.token,
            active: table.qrCode.active,
            scan_count: table.qrCode.scanCount || 0,
            last_scanned_at: table.qrCode.lastScannedAt ? table.qrCode.lastScannedAt.toISOString() : null,
            created_at: table.qrCode.createdAt ? table.qrCode.createdAt.toISOString() : null,
            rotated_at: table.qrCode.rotatedAt ? table.qrCode.rotatedAt.toISOString() : null,
          }
        : null,
      current_reservation: this.serializeReservation(activeReservation),
      reservation_id: activeReservation?.id || null,
      reservation_status: activeReservation ? billingStatus : "available",
      sync_source: "pos-core",
      sync_resource: "tables",
      last_synced_at: table.updatedAt ? table.updatedAt.toISOString() : table.createdAt?.toISOString() || new Date().toISOString(),
      created_at: table.createdAt ? table.createdAt.toISOString() : null,
      updated_at: table.updatedAt ? table.updatedAt.toISOString() : null,
    };
  }

  serializeArea(area) {
    return {
      id: area.id,
      business_id: area.businessId,
      name: area.name,
      code: area.code || null,
      sort_order: area.sortOrder ?? 0,
      active: area.active,
      meta: cloneJson(area.meta, {}),
      table_count: area.tables?.length || 0,
      tables: (area.tables || []).map((table) => ({
        id: table.id,
        name: table.name,
        seats: table.seats,
        status: normalizeTableStatus(table.status),
      })),
    };
  }

  async listTables({ tenantId, businessId }) {
    const business = await this.getBusiness({ tenantId, businessId });
    const [settings, tables, areas] = await Promise.all([
      tableManagementRepository.getSettings({ businessId: business.id }),
      tableManagementRepository.listTables({ businessId: business.id }),
      tableManagementRepository.listAreas({ businessId: business.id }),
    ]);
    const qrCodes = await tableManagementRepository.listTableQrCodes({
      businessId: business.id,
      tableIds: tables.map((table) => table.id),
    });

    const items = attachQrCodes(tables, qrCodes).map((table) => this.serializeTable(table, business.tenantId));
    return {
      business_id: business.id,
      settings: this.serializeSettings(settings),
      summary: createTableSummary(items),
      areas: areas.map((area) => this.serializeArea(area)),
      items,
    };
  }

  async createTable({ tenantId, businessId, payload }) {
    const business = await this.getBusiness({ tenantId, businessId });
    const data = tableManagementValidation.validateTablePayload(payload);
    const created = await tableManagementRepository.createTable({
      businessId: business.id,
      data: {
        name: data.name,
        code: data.code ?? null,
        seats: data.seats ?? 4,
        status: data.status || "available",
        areaId: data.areaId ?? null,
        active: data.active ?? true,
        shape: data.shape ?? null,
        sortOrder: data.sortOrder ?? 0,
        meta: data.meta ?? {},
      },
    });

    return this.serializeTable(created, business.tenantId);
  }

  async updateTable({ tenantId, businessId, tableId, payload }) {
    const business = await this.getBusiness({ tenantId, businessId });
    const existing = await tableManagementRepository.getTableById({ businessId: business.id, tableId });
    if (!existing) throw createNotFoundError("Table", { tableId });

    const data = tableManagementValidation.validateTablePayload(payload, { partial: true });
    const updated = await tableManagementRepository.updateTable({
      tableId,
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.code !== undefined ? { code: data.code } : {}),
        ...(data.seats !== undefined ? { seats: data.seats } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.areaId !== undefined ? { areaId: data.areaId } : {}),
        ...(data.active !== undefined ? { active: data.active } : {}),
        ...(data.shape !== undefined ? { shape: data.shape } : {}),
        ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
        ...(data.meta !== undefined ? { meta: data.meta } : {}),
      },
    });

    const qrCode = await tableManagementRepository.getTableQrCodeByTableId({
      businessId: business.id,
      tableId,
    });

    return this.serializeTable(attachQrCode(updated, qrCode), business.tenantId);
  }

  async upsertTableQrCode({ tenantId, businessId, tableId, rotate = false, active = true }) {
    const business = await this.getBusiness({ tenantId, businessId });
    const table = await tableManagementRepository.getTableById({ businessId: business.id, tableId });
    if (!table) throw createNotFoundError("Table", { tableId });

    const existingQrCode = await tableManagementRepository.getTableQrCodeByTableId({
      businessId: business.id,
      tableId,
    });
    const existingToken = existingQrCode?.token || null;
    const shouldRotate = rotate || !existingToken;
    const token = shouldRotate ? createQrToken() : existingToken;
    const qrCode = await tableManagementRepository.upsertTableQrCode({
      businessId: business.id,
      tableId,
      token,
      active,
      rotatedAt: shouldRotate && existingToken ? new Date() : existingQrCode?.rotatedAt || null,
    });

    return {
      id: qrCode.id,
      business_id: qrCode.businessId,
      table_id: qrCode.tableId,
      table_name: qrCode.table?.name || table.name,
      area_name: qrCode.table?.area?.name || table.area?.name || null,
      token: qrCode.token,
      active: qrCode.active,
      scan_count: qrCode.scanCount || 0,
      last_scanned_at: qrCode.lastScannedAt ? qrCode.lastScannedAt.toISOString() : null,
      created_at: qrCode.createdAt ? qrCode.createdAt.toISOString() : null,
      rotated_at: qrCode.rotatedAt ? qrCode.rotatedAt.toISOString() : null,
    };
  }

  async deleteTable({ tenantId, businessId, tableId }) {
    const business = await this.getBusiness({ tenantId, businessId });
    const existing = await tableManagementRepository.getTableById({ businessId: business.id, tableId });
    if (!existing) throw createNotFoundError("Table", { tableId });

    if (getActiveReservation(existing.reservations)) {
      throw createHttpError({
        statusCode: 409,
        code: "TABLE_HAS_ACTIVE_RESERVATION",
        message: "Release the active reservation before deleting this table",
      });
    }

    const deleted = await tableManagementRepository.deleteTable({ tableId });
    return this.serializeTable(deleted, business.tenantId);
  }

  async listAreas({ tenantId, businessId }) {
    const business = await this.getBusiness({ tenantId, businessId });
    const areas = await tableManagementRepository.listAreas({ businessId: business.id });
    return { business_id: business.id, items: areas.map((area) => this.serializeArea(area)) };
  }

  async createArea({ tenantId, businessId, payload }) {
    const business = await this.getBusiness({ tenantId, businessId });
    const data = tableManagementValidation.validateAreaPayload(payload);
    const created = await tableManagementRepository.createArea({
      businessId: business.id,
      data: {
        name: data.name,
        code: data.code ?? null,
        sortOrder: data.sortOrder ?? 0,
        active: data.active ?? true,
        meta: data.meta ?? {},
      },
    });

    return this.serializeArea(created);
  }

  async updateArea({ tenantId, businessId, areaId, payload }) {
    const business = await this.getBusiness({ tenantId, businessId });
    const existing = await tableManagementRepository.getAreaById({ businessId: business.id, areaId });
    if (!existing) throw createNotFoundError("Area", { areaId });

    const data = tableManagementValidation.validateAreaPayload(payload, { partial: true });
    const updated = await tableManagementRepository.updateArea({
      areaId,
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.code !== undefined ? { code: data.code } : {}),
        ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
        ...(data.active !== undefined ? { active: data.active } : {}),
        ...(data.meta !== undefined ? { meta: data.meta } : {}),
      },
    });

    return this.serializeArea(updated);
  }

  async deleteArea({ tenantId, businessId, areaId }) {
    const business = await this.getBusiness({ tenantId, businessId });
    const existing = await tableManagementRepository.getAreaById({ businessId: business.id, areaId });
    if (!existing) throw createNotFoundError("Area", { areaId });
    await tableManagementRepository.deleteArea({ areaId });
    return this.serializeArea(existing);
  }

  async getSettings({ tenantId, businessId }) {
    const business = await this.getBusiness({ tenantId, businessId });
    const settings = await tableManagementRepository.getSettings({ businessId: business.id });
    return { business_id: business.id, ...this.serializeSettings(settings) };
  }

  async updateSettings({ tenantId, businessId, payload }) {
    const business = await this.getBusiness({ tenantId, businessId });
    const updated = await tableManagementRepository.upsertSettings({
      businessId: business.id,
      data: tableManagementValidation.validateSettingsPayload(payload),
    });
    return { business_id: business.id, ...this.serializeSettings(updated) };
  }

  async listReservations({ tenantId, businessId, includeHistory = false }) {
    const business = await this.getBusiness({ tenantId, businessId });
    const reservations = await tableManagementRepository.listReservations({ businessId: business.id });
    const items = reservations
      .map((reservation) => this.serializeReservation(reservation, business.tenantId))
      .filter((reservation) => includeHistory || ["reserved", "occupied"].includes(reservation.status));
    return { business_id: business.id, items };
  }

  async createReservation({ tenantId, businessId, payload }) {
    const business = await this.getBusiness({ tenantId, businessId });
    const data = tableManagementValidation.validateReservationPayload(payload);
    const table = await tableManagementRepository.getTableById({ businessId: business.id, tableId: data.tableId });
    if (!table) throw createNotFoundError("Table", { tableId: data.tableId });
    if (table.active === false) {
      throw createHttpError({
        statusCode: 409,
        code: "TABLE_DISABLED",
        message: "This table is disabled and cannot be reserved",
      });
    }

    const activeReservation = getActiveReservation(table.reservations);
    if (activeReservation && (!data.reservationDate || !activeReservation.reservationDate)) {
      throw createHttpError({
        statusCode: 409,
        code: "TABLE_UNAVAILABLE",
        message: "This table already has an active reservation or seated guest",
      });
    }
    if (data.reservationDate) {
      const tableReservations = await tableManagementRepository.listReservationsForTable({
        businessId: business.id,
        tableId: data.tableId,
      });
      const conflictingReservation = tableReservations.find((reservation) =>
        reservation.id !== data.id && reservationWindowsOverlap(reservation.reservationDate, data.reservationDate),
      );
      if (conflictingReservation) {
        throw createHttpError({
          statusCode: 409,
          code: "TABLE_TIME_SLOT_UNAVAILABLE",
          message: "This table already has a reservation close to that time slot",
        });
      }
    }

    const reservationStatus = normalizeReservationStatus(data.status, "reserved");
    const shouldHoldTableNow = reservationStatus === "occupied" || !data.reservationDate || data.reservationDate.getTime() <= Date.now();
    const created = await tableManagementRepository.withTransaction(async (tx) => {
      const reservation = await tx.tableReservation.create({
        data: {
          businessId: business.id,
          tableId: data.tableId,
          customerName: data.customerName ?? null,
          customerPhone: data.customerPhone ?? null,
          reservationDate: data.reservationDate ?? null,
          status: reservationStatus === "occupied" ? "occupied" : "reserved",
          guestsCount: data.guestsCount ?? null,
          notes: data.notes ?? "",
          source: data.source ?? "manual",
          meta: data.meta ?? {},
          confirmedAt: reservationStatus === "occupied" ? new Date() : null,
        },
        include: { table: { include: { area: true } } },
      });

      if (shouldHoldTableNow) {
        await tx.diningTable.update({
          where: { id: data.tableId },
          data: { status: reservationStatus === "occupied" ? "occupied" : "reserved" },
        });
      }

      return reservation;
    });

    return this.serializeReservation(created, business.tenantId);
  }

  async confirmReservation({ tenantId, businessId, reservationId }) {
    const business = await this.getBusiness({ tenantId, businessId });
    const reservation = await tableManagementRepository.getReservationById({ businessId: business.id, reservationId });
    if (!reservation) throw createNotFoundError("Reservation", { reservationId });
    if (!reservation.tableId) {
      throw createHttpError({
        statusCode: 409,
        code: "RESERVATION_TABLE_MISSING",
        message: "This reservation is not linked to a table",
      });
    }

    const updated = await tableManagementRepository.withTransaction(async (tx) => {
      const nextReservation = await tx.tableReservation.update({
        where: { id: reservationId },
        data: { status: "occupied", confirmedAt: new Date(), releasedAt: null, canceledAt: null },
        include: { table: { include: { area: true } } },
      });
      await tx.diningTable.update({ where: { id: reservation.tableId }, data: { status: "occupied" } });
      return nextReservation;
    });

    return this.serializeReservation(updated, business.tenantId);
  }

  async undoReservation({ tenantId, businessId, reservationId }) {
    const business = await this.getBusiness({ tenantId, businessId });
    const reservation = await tableManagementRepository.getReservationById({ businessId: business.id, reservationId });
    if (!reservation) throw createNotFoundError("Reservation", { reservationId });

    const updated = await tableManagementRepository.withTransaction(async (tx) => {
      const nextReservation = await tx.tableReservation.update({
        where: { id: reservationId },
        data: { status: "released", releasedAt: new Date() },
        include: { table: { include: { area: true } } },
      });
      if (reservation.tableId) {
        await tx.diningTable.update({ where: { id: reservation.tableId }, data: { status: "available" } });
      }
      return nextReservation;
    });

    return this.serializeReservation(updated, business.tenantId);
  }

  async updateReservationStatus({ tenantId, businessId, reservationId, status }) {
    const business = await this.getBusiness({ tenantId, businessId });
    const reservation = await tableManagementRepository.getReservationById({ businessId: business.id, reservationId });
    if (!reservation) throw createNotFoundError("Reservation", { reservationId });

    const nextStatus = normalizeReservationStatus(status, "reserved");
    const releasesTable = ["cancelled", "no_show", "released"].includes(nextStatus);
    const updated = await tableManagementRepository.withTransaction(async (tx) => {
      const nextReservation = await tx.tableReservation.update({
        where: { id: reservationId },
        data: {
          status: nextStatus,
          confirmedAt: nextStatus === "occupied" ? reservation.confirmedAt || new Date() : reservation.confirmedAt,
          releasedAt: releasesTable ? new Date() : null,
          canceledAt: ["cancelled", "no_show"].includes(nextStatus) ? new Date() : reservation.canceledAt,
        },
        include: { table: { include: { area: true } } },
      });
      if (reservation.tableId) {
        const tableStatus = nextStatus === "occupied" ? "occupied" : nextStatus === "reserved" ? "reserved" : "available";
        await tx.diningTable.update({ where: { id: reservation.tableId }, data: { status: tableStatus } });
      }
      return nextReservation;
    });

    return this.serializeReservation(updated, business.tenantId);
  }

  async deleteReservation({ tenantId, businessId, reservationId }) {
    const business = await this.getBusiness({ tenantId, businessId });
    const reservation = await tableManagementRepository.getReservationById({ businessId: business.id, reservationId });
    if (!reservation) throw createNotFoundError("Reservation", { reservationId });

    if (ACTIVE_RESERVATION_STATUSES.has(normalizeReservationStatus(reservation.status))) {
      await this.undoReservation({ tenantId, businessId: business.id, reservationId });
    }

    const deleted = await tableManagementRepository.deleteReservation({ reservationId });
    return this.serializeReservation(deleted, business.tenantId);
  }

  async listLegacyReservations({ tenantId, businessId, includeHistory = false }) {
    const data = await this.listReservations({ tenantId, businessId, includeHistory });
    return data.items;
  }
}

export const tableManagementService = new TableManagementService();
