import { hasPermission } from "../../../lib/pos";

export const getDefaultRouteForUser = (user) => {
  if (!user) return "/login";
  if (user.profile_required) return "/complete-profile";
  // Each role lands on its own screen when it still holds that screen; otherwise on the first screen it may open.
  const preferred = { Manager: ["manager_view", "/manager"], Waiter: ["waiter_view", "/waiter"], Chef: ["kitchen_view", "/chef"] }[user.role];
  if (preferred && hasPermission(user, preferred[0])) return preferred[1];
  const order = [
    ["dashboard", "/dashboard"], ["billing", "/billing"], ["bills", "/bills"], ["manager_view", "/manager"],
    ["waiter_view", "/waiter"], ["kitchen_view", "/chef"], ["reservations", "/reservations"], ["qr_management", "/qr-management"],
    ["inventory", "/inventory"], ["reports", "/reports"], ["products", "/products"], ["staff", "/staff"],
    ["attendance", "/attendance"], ["tips", "/tips"], ["customers", "/customers"], ["gift_cards", "/gift-cards"],
    ["payroll", "/payroll"], ["marketing", "/marketing"], ["settings", "/settings"],
  ];
  const match = order.find(([permission]) => hasPermission(user, permission));
  // Everyone can at least use the time clock.
  return match ? match[1] : "/time-clock";
};
