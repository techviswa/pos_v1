import { hasPermission } from "../../../lib/pos";

export const getDefaultRouteForUser = (user) => {
  if (!user) return "/login";
  if (user.profile_required) return "/complete-profile";
  if (user.role === "Manager") return "/manager";
  if (user.role === "Waiter") return "/waiter";
  if (user.role === "Chef") return "/chef";
  if (hasPermission(user, "dashboard")) return "/dashboard";
  if (hasPermission(user, "billing")) return "/billing";
  if (hasPermission(user, "bills")) return "/bills";
  return "/login";
};
