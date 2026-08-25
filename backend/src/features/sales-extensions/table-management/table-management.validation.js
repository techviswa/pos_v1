import { createHttpError } from "../../../shared/utils/http-error.js";

const TABLE_STATUSES = new Set(["available", "reserved", "occupied", "blocked", "cleaning"]);
const NICHE_PRESETS = new Set(["restaurant", "cafe", "fast_food", "custom"]);
const SERVICE_MODES = new Set(["full_service", "hybrid", "counter_service"]);

const toTrimmedString = (value, fallback = "") => String(value ?? fallback).trim();
const toOptionalString = (value) => {
  const normalized = toTrimmedString(value);
  return normalized || null;
};

const toOptionalDate = (value, fieldName) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw createHttpError({ statusCode: 400, code: "INVALID_DATE", message: `${fieldName} must be a valid date` });
  }
  return parsed;
};

const toPositiveInt = (value, fieldName, fallback = null) => {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw createHttpError({
      statusCode: 400,
      code: "INVALID_NUMBER",
      message: `${fieldName} must be a valid whole number`,
    });
  }
  return parsed;
};

const validateEnum = (value, allowedValues, fieldName, fallback) => {
  const normalized = toTrimmedString(value || fallback).toLowerCase();
  if (!allowedValues.has(normalized)) {
    throw createHttpError({
      statusCode: 400,
      code: "INVALID_ENUM",
      message: `${fieldName} must be one of: ${Array.from(allowedValues).join(", ")}`,
    });
  }
  return normalized;
};

class TableManagementValidation {
  validateTablePayload(payload = {}, { partial = false } = {}) {
    const name = toTrimmedString(payload.name);
    if (!partial && !name) {
      throw createHttpError({ statusCode: 400, code: "TABLE_NAME_REQUIRED", message: "Table name is required" });
    }

    return {
      name: name || undefined,
      code: payload.code !== undefined ? toOptionalString(payload.code) : undefined,
      seats: toPositiveInt(payload.seats, "seats", partial ? undefined : 4),
      status: payload.status !== undefined ? validateEnum(payload.status, TABLE_STATUSES, "status", "available") : undefined,
      areaId:
        payload.areaId !== undefined || payload.area_id !== undefined
          ? toOptionalString(payload.areaId ?? payload.area_id)
          : undefined,
      active: payload.active !== undefined ? Boolean(payload.active) : undefined,
      shape: payload.shape !== undefined ? toOptionalString(payload.shape) : undefined,
      sortOrder:
        payload.sortOrder !== undefined || payload.sort_order !== undefined
          ? toPositiveInt(payload.sortOrder ?? payload.sort_order, "sortOrder", 0)
          : undefined,
      meta: payload.meta !== undefined ? payload.meta : undefined,
    };
  }

  validateAreaPayload(payload = {}, { partial = false } = {}) {
    const name = toTrimmedString(payload.name);
    if (!partial && !name) {
      throw createHttpError({ statusCode: 400, code: "AREA_NAME_REQUIRED", message: "Area name is required" });
    }

    return {
      name: name || undefined,
      code: payload.code !== undefined ? toOptionalString(payload.code) : undefined,
      sortOrder:
        payload.sortOrder !== undefined || payload.sort_order !== undefined
          ? toPositiveInt(payload.sortOrder ?? payload.sort_order, "sortOrder", 0)
          : undefined,
      active: payload.active !== undefined ? Boolean(payload.active) : undefined,
      meta: payload.meta !== undefined ? payload.meta : undefined,
    };
  }

  validateSettingsPayload(payload = {}) {
    return {
      nichePreset: validateEnum(payload.nichePreset, NICHE_PRESETS, "nichePreset", "restaurant"),
      serviceMode: validateEnum(payload.serviceMode, SERVICE_MODES, "serviceMode", "full_service"),
      capabilities: payload.capabilities ?? {},
      reservationRules: payload.reservationRules ?? {},
      uiPreferences: payload.uiPreferences ?? {},
    };
  }

  validateReservationPayload(payload = {}, { partial = false } = {}) {
    const tableId = toOptionalString(payload.tableId ?? payload.table_id);
    if (!partial && !tableId) {
      throw createHttpError({ statusCode: 400, code: "TABLE_ID_REQUIRED", message: "tableId is required" });
    }

    return {
      tableId: tableId ?? undefined,
      customerName:
        payload.customerName !== undefined || payload.customer_name !== undefined
          ? toOptionalString(payload.customerName ?? payload.customer_name)
          : undefined,
      customerPhone:
        payload.customerPhone !== undefined || payload.customer_phone !== undefined
          ? toOptionalString(payload.customerPhone ?? payload.customer_phone)
          : undefined,
      reservationDate:
        payload.reservationDate !== undefined || payload.reservation_for !== undefined
          ? toOptionalDate(payload.reservationDate ?? payload.reservation_for, "reservationDate")
          : undefined,
      guestsCount:
        payload.guestsCount !== undefined || payload.guests_count !== undefined
          ? toPositiveInt(payload.guestsCount ?? payload.guests_count, "guestsCount", null)
          : undefined,
      notes: payload.notes !== undefined ? toTrimmedString(payload.notes) : undefined,
      source: payload.source !== undefined ? toOptionalString(payload.source) : partial ? undefined : "manual",
      meta: payload.meta !== undefined ? payload.meta : undefined,
      status:
        payload.status !== undefined || payload.reservation_status !== undefined
          ? toTrimmedString(payload.status ?? payload.reservation_status).toLowerCase()
          : undefined,
    };
  }
}

export const tableManagementValidation = new TableManagementValidation();
