import { hasPermission } from "../../../lib/pos";
import { APP_NAV_ITEMS } from "../config/appNavigation";
import { getDefaultRouteForUser } from "./defaultRoute";

export const getVisibleNavigationGroups = ({ user, isModuleEnabled, isFeatureEnabled }) => {
  const visible = APP_NAV_ITEMS.filter((item) => {
    if (item.module && !isModuleEnabled(item.module)) {
      return false;
    }
    if (item.feature && !isFeatureEnabled(item.feature)) {
      return false;
    }
    if (item.roles) {
      return item.roles.includes(user?.role);
    }
    return hasPermission(user, item.permission);
  });

  return visible.reduce((groups, item) => {
    if (!groups[item.group]) groups[item.group] = [];
    groups[item.group].push(item);
    return groups;
  }, {});
};

export const getNavigationItemLabel = ({ item, user }) => {
  if (user?.role === "Waiter" && item.path === "/waiter") {
    return "Service";
  }
  if (user?.role === "Chef" && item.path === "/chef") {
    return "Kitchen";
  }
  if (user?.role === "Manager" && item.path === "/manager") {
    return "Overview";
  }
  return item.label;
};

export { getDefaultRouteForUser };
