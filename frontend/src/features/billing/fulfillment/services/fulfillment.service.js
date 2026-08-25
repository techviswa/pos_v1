import axios from "axios";

const API_URL = process.env.REACT_APP_BACKEND_URL;

const unwrap = (response) => response?.data?.data ?? response?.data;
let tableManagementRequest = null;
let tableManagementRequestKey = "";
let tableManagementCache = null;
let tableManagementCacheKey = "";
let tableManagementCacheAt = 0;
const TABLE_MANAGEMENT_CACHE_TTL_MS = 15000;

export const fulfillmentService = {
  async fetchTableManagement({ force = false, includeHistory = false } = {}) {
    const requestKey = includeHistory ? "history" : "active";
    const now = Date.now();
    if (
      !force &&
      tableManagementCache &&
      tableManagementCacheKey === requestKey &&
      now - tableManagementCacheAt < TABLE_MANAGEMENT_CACHE_TTL_MS
    ) {
      return tableManagementCache;
    }

    if (!force && tableManagementRequest && tableManagementRequestKey === requestKey) {
      return tableManagementRequest;
    }

    tableManagementRequestKey = requestKey;
    tableManagementRequest = Promise.all([
      axios.get(`${API_URL}/api/table-management`, { withCredentials: true }),
      axios.get(`${API_URL}/api/table-management/reservations`, {
        withCredentials: true,
        params: includeHistory ? { include_history: true } : undefined,
      }),
    ])
      .then(([tablesResponse, reservationsResponse]) => ({
        tables: unwrap(tablesResponse),
        reservations: unwrap(reservationsResponse),
      }))
      .then((result) => {
        tableManagementCache = result;
        tableManagementCacheKey = requestKey;
        tableManagementCacheAt = Date.now();
        return result;
      })
      .finally(() => {
        tableManagementRequest = null;
        tableManagementRequestKey = "";
      });

    return tableManagementRequest;
  },

  async createArea(payload) {
    tableManagementCache = null;
    const response = await axios.post(`${API_URL}/api/table-management/areas`, payload, { withCredentials: true });
    return unwrap(response);
  },

  async updateArea(areaId, payload) {
    tableManagementCache = null;
    const response = await axios.put(`${API_URL}/api/table-management/areas/${areaId}`, payload, { withCredentials: true });
    return unwrap(response);
  },

  async deleteArea(areaId) {
    tableManagementCache = null;
    const response = await axios.delete(`${API_URL}/api/table-management/areas/${areaId}`, { withCredentials: true });
    return unwrap(response);
  },

  async createTable(payload) {
    tableManagementCache = null;
    const response = await axios.post(`${API_URL}/api/table-management`, payload, { withCredentials: true });
    return unwrap(response);
  },

  async updateTable(tableId, payload) {
    tableManagementCache = null;
    const response = await axios.put(`${API_URL}/api/table-management/${tableId}`, payload, { withCredentials: true });
    return unwrap(response);
  },

  async deleteTable(tableId) {
    tableManagementCache = null;
    const response = await axios.delete(`${API_URL}/api/table-management/${tableId}`, { withCredentials: true });
    return unwrap(response);
  },

  async upsertTableQrCode(tableId, payload = {}) {
    tableManagementCache = null;
    const response = await axios.post(`${API_URL}/api/table-management/${tableId}/qr`, payload, { withCredentials: true });
    return unwrap(response);
  },

  async reserveTable(payload) {
    tableManagementCache = null;
    const response = await axios.post(`${API_URL}/api/table-management/reservations`, payload, { withCredentials: true });
    return unwrap(response);
  },

  async confirmReservation(reservationId) {
    tableManagementCache = null;
    const response = await axios.post(
      `${API_URL}/api/table-management/reservations/${reservationId}/confirm`,
      {},
      { withCredentials: true },
    );
    return unwrap(response);
  },

  async undoReservation(reservationId) {
    tableManagementCache = null;
    const response = await axios.post(
      `${API_URL}/api/table-management/reservations/${reservationId}/undo`,
      {},
      { withCredentials: true },
    );
    return unwrap(response);
  },

  async updateReservationStatus(reservationId, status) {
    tableManagementCache = null;
    const response = await axios.post(
      `${API_URL}/api/table-management/reservations/${reservationId}/status`,
      { status },
      { withCredentials: true },
    );
    return unwrap(response);
  },

  async deleteReservation(reservationId) {
    tableManagementCache = null;
    const response = await axios.delete(`${API_URL}/api/table-management/reservations/${reservationId}`, {
      withCredentials: true,
    });
    return unwrap(response);
  },

  async fetchSettings() {
    const response = await axios.get(`${API_URL}/api/table-management/settings`, { withCredentials: true });
    return unwrap(response);
  },

  async updateSettings(payload) {
    tableManagementCache = null;
    const response = await axios.put(`${API_URL}/api/table-management/settings`, payload, { withCredentials: true });
    return unwrap(response);
  },
};
