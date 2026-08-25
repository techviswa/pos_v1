import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const permissionKeys = [
  "dashboard",
  "billing",
  "inventory",
  "reports",
  "products",
  "shift_swaps",
  "bills",
  "staff",
  "settings",
  "central_kitchen",
];

const roleDefaults = {
  Owner: permissionKeys,
  Manager: ["dashboard", "billing", "reports", "inventory", "products", "shift_swaps", "bills"],
  Waiter: ["billing", "bills"],
  Chef: ["bills"],
  Cashier: ["billing", "bills"],
};

async function main() {
  const business = await prisma.business.upsert({
    where: { tenantId: "demo-tenant" },
    update: {
      name: "Demo POS Business",
    },
    create: {
      id: "demo-business",
      name: "Demo POS Business",
      tenantId: "demo-tenant",
    },
  });

  const permissions = {};
  for (const key of permissionKeys) {
    permissions[key] = await prisma.permission.upsert({
      where: { key },
      update: { label: key },
      create: { key, label: key },
    });
  }

  const roles = {};
  for (const roleName of Object.keys(roleDefaults)) {
    roles[roleName] = await prisma.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName },
    });

    for (const permissionKey of roleDefaults[roleName]) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: roles[roleName].id,
            permissionId: permissions[permissionKey].id,
          },
        },
        update: {},
        create: {
          roleId: roles[roleName].id,
          permissionId: permissions[permissionKey].id,
        },
      });
    }
  }

  const mainOutlet = await prisma.outlet.upsert({
    where: { businessId_code: { businessId: business.id, code: "MO1" } },
    update: {},
    create: {
      businessId: business.id,
      name: "Main Outlet",
      code: "MO1",
      location: "Bengaluru",
      managerName: "System Owner",
      phone: "9876543210",
      status: "active",
    },
  });

  const owner = await prisma.user.upsert({
    where: { businessId_email: { businessId: business.id, email: "owner@pos.com" } },
    update: {},
    create: {
      businessId: business.id,
      roleId: roles.Owner.id,
      name: "System Owner",
      email: "owner@pos.com",
      passwordHash: "admin123",
      profileRequired: false,
      active: true,
    },
  });

  await prisma.userOutletAssignment.upsert({
    where: {
      userId_outletId: {
        userId: owner.id,
        outletId: mainOutlet.id,
      },
    },
    update: {},
    create: {
      userId: owner.id,
      outletId: mainOutlet.id,
    },
  });

  await prisma.product.upsert({
    where: { businessId_name: { businessId: business.id, name: "Classic Coffee" } },
    update: {},
    create: {
      businessId: business.id,
      name: "Classic Coffee",
      price: 120,
      costPrice: 42,
      stock: 40,
      active: true,
      category: "Beverages",
      dietaryType: "Veg",
    },
  });

  await prisma.inventoryItem.upsert({
    where: { businessId_name: { businessId: business.id, name: "Flour" } },
    update: {},
    create: {
      businessId: business.id,
      name: "Flour",
      stock: 100,
      unit: "kg",
      reorderLevel: 10,
      conversionCost: 45,
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
