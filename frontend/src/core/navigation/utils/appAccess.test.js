import { getVisibleNavigationGroups } from './appAccess';

test.each(['Owner', 'Manager', 'Cashier', 'Waiter'])('%s keeps billing access and only drawer-management roles see Cash drawer', role => {
  const groups = getVisibleNavigationGroups({ user: { role, permissions: ['billing', 'bills'] }, isModuleEnabled: () => true, isFeatureEnabled: () => true });
  const paths = Object.values(groups).flat().map(item => item.path);
  expect(paths).toContain('/billing'); expect(paths).toContain('/bills');
  expect(paths.includes('/cash-drawer')).toBe(role !== 'Waiter');
});
