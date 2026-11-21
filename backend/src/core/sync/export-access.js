import { createHttpError } from '../../shared/utils/http-error.js';

const permissions = {
  products: ['products'], orders: ['billing'], bills: ['bills'], payments: ['billing'], reports: ['reports'],
  customers: ['customers'], 'loyalty-customers': ['customers'], 'loyalty-ledger': ['customers'],
  'gift-cards': ['gift_cards'], 'gift-card-transactions': ['gift_cards'],
  staff: ['staff'], 'staff-shifts': ['staff'], attendance: ['attendance'], tips: ['tips'],
  'tip-payouts': ['tips'], payroll: ['payroll'], payslips: ['payroll'],
  marketing: ['marketing'], 'marketing-delivery': ['marketing'], 'menu-pricing': ['price_rules'],
  'guest-feedback': ['reports'], inventory: ['inventory'], tables: ['reservations', 'waiter_view'],
  reservations: ['reservations'], kot: ['kitchen_view'], 'kitchen-tickets': ['kitchen_view'],
  qr: ['qr_management'], 'qr-ordering': ['qr_management'], 'table-assistance': ['waiter_view', 'manager_view'],
  'central-kitchen': ['central_kitchen'], businesses: ['settings'], outlets: ['settings'],
  taxes: ['reports'], discounts: ['reports'], expenses: ['reports'], suppliers: ['inventory'],
  'role-permissions': ['staff'], 'audit-security': ['settings'],
};

export function assertExportAccess(resource, effectivePermissions, { bridge = false } = {}) {
  if (bridge) return;
  if (resource === 'privacy-erasures' || !(permissions[resource] || ['settings']).some(key => effectivePermissions.includes(key))) {
    throw createHttpError({ statusCode: 403, code: 'EXPORT_PERMISSION_REQUIRED', message: 'You do not have access to this export' });
  }
}
