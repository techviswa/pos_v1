import prisma from "../../../database/prisma/client.js";
import { ensureBusiness } from "../../../database/prisma/helpers.js";
import env from "../../../config/env.js";

const ACTIVE_TABLE_RESERVATION_STATUSES = ["reserved", "occupied"];
let tableQrCodeTableAvailable = null;

const tableInclude = {
  area: true,
  reservations: {
    where: {
      status: {
        in: ACTIVE_TABLE_RESERVATION_STATUSES,
      },
    },
    orderBy: { createdAt: "desc" },
  },
};

const hasTableQrCodeTable = async () => {
  if (tableQrCodeTableAvailable !== null) {
    return tableQrCodeTableAvailable;
  }

  if (env.database.provider === "sqlite") {
    const rows = await prisma.$queryRaw`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'TableQrCode'
    `;
    tableQrCodeTableAvailable = rows.length > 0;
    return tableQrCodeTableAvailable;
  }

  tableQrCodeTableAvailable = true;
  return tableQrCodeTableAvailable;
};

class TableManagementRepository {
  async getBusinessContext({ tenantId, businessId }) {
    return ensureBusiness({ tenantId, businessId });
  }

  async listTables({ businessId }) {
    return prisma.diningTable.findMany({
      where: { businessId },
      include: tableInclude,
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  }

  async getTableById({ businessId, tableId }) {
    return prisma.diningTable.findFirst({
      where: { id: tableId, businessId },
      include: tableInclude,
    });
  }

  async listTableQrCodes({ businessId, tableIds = [] }) {
    if (!tableIds.length) {
      return [];
    }

    if (!(await hasTableQrCodeTable())) {
      return [];
    }

    try {
      return await prisma.tableQrCode.findMany({
        where: {
          businessId,
          tableId: {
            in: tableIds,
          },
        },
      });
    } catch (error) {
      if (error?.code === "P2021") {
        return [];
      }
      throw error;
    }
  }

  async getTableQrCodeByTableId({ businessId, tableId }) {
    if (!(await hasTableQrCodeTable())) {
      return null;
    }

    try {
      return await prisma.tableQrCode.findFirst({
        where: {
          businessId,
          tableId,
        },
      });
    } catch (error) {
      if (error?.code === "P2021") {
        return null;
      }
      throw error;
    }
  }

  async createTable({ businessId, data }) {
    return prisma.diningTable.create({
      data: { businessId, ...data },
      include: tableInclude,
    });
  }

  async updateTable({ tableId, data }) {
    return prisma.diningTable.update({
      where: { id: tableId },
      data,
      include: tableInclude,
    });
  }

  async deleteTable({ tableId }) {
    return prisma.diningTable.delete({
      where: { id: tableId },
      include: tableInclude,
    });
  }

  async upsertTableQrCode({ businessId, tableId, token, active = true, rotatedAt = null }) {
    return prisma.tableQrCode.upsert({
      where: { tableId },
      update: {
        token,
        active,
        rotatedAt,
      },
      create: {
        businessId,
        tableId,
        token,
        active,
        rotatedAt,
      },
      include: {
        table: {
          include: {
            area: true,
          },
        },
      },
    });
  }

  async updateTableQrCode({ tableId, data }) {
    return prisma.tableQrCode.update({
      where: { tableId },
      data,
      include: {
        table: {
          include: {
            area: true,
          },
        },
      },
    });
  }

  async listAreas({ businessId }) {
    return prisma.diningArea.findMany({
      where: { businessId },
      include: {
        tables: {
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        },
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  }

  async getAreaById({ businessId, areaId }) {
    return prisma.diningArea.findFirst({
      where: { id: areaId, businessId },
      include: {
        tables: {
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        },
      },
    });
  }

  async createArea({ businessId, data }) {
    return prisma.diningArea.create({
      data: { businessId, ...data },
      include: {
        tables: {
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        },
      },
    });
  }

  async updateArea({ areaId, data }) {
    return prisma.diningArea.update({
      where: { id: areaId },
      data,
      include: {
        tables: {
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        },
      },
    });
  }

  async deleteArea({ areaId }) {
    return prisma.diningArea.delete({
      where: { id: areaId },
    });
  }

  async getSettings({ businessId }) {
    return prisma.tableManagementSettings.findUnique({
      where: { businessId },
    });
  }

  async upsertSettings({ businessId, data }) {
    return prisma.tableManagementSettings.upsert({
      where: { businessId },
      update: data,
      create: { businessId, ...data },
    });
  }

  async listReservations({ businessId }) {
    return prisma.tableReservation.findMany({
      where: { businessId },
      include: {
        table: {
          include: {
            area: true,
          },
        },
      },
      orderBy: [{ createdAt: "desc" }],
    });
  }

  async getReservationById({ businessId, reservationId }) {
    return prisma.tableReservation.findFirst({
      where: { id: reservationId, businessId },
      include: {
        table: {
          include: {
            area: true,
          },
        },
      },
    });
  }

  async listReservationsForTable({ businessId, tableId }) {
    return prisma.tableReservation.findMany({
      where: {
        businessId,
        tableId,
        status: {
          in: ACTIVE_TABLE_RESERVATION_STATUSES,
        },
      },
      include: {
        table: {
          include: {
            area: true,
          },
        },
      },
      orderBy: [{ reservationDate: "asc" }, { createdAt: "desc" }],
    });
  }

  async updateReservation({ reservationId, data }) {
    return prisma.tableReservation.update({
      where: { id: reservationId },
      data,
      include: {
        table: {
          include: {
            area: true,
          },
        },
      },
    });
  }

  async deleteReservation({ reservationId }) {
    return prisma.tableReservation.delete({
      where: { id: reservationId },
      include: {
        table: {
          include: {
            area: true,
          },
        },
      },
    });
  }

  async withTransaction(callback) {
    return prisma.$transaction((tx) => callback(tx));
  }
}

export const tableManagementRepository = new TableManagementRepository();
