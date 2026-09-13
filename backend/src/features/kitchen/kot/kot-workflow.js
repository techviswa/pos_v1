import { createHttpError } from "../../../shared/utils/http-error.js";

const transitions = {
  pending: ["accepted", "rejected"],
  accepted: ["preparing", "rejected"],
  preparing: ["ready", "rejected"],
  ready: ["served", "completed"],
  served: ["completed"],
  completed: [],
  rejected: [],
};

export const validateKitchenTransition = (current, next, { item = false } = {}) => {
  if (!Object.hasOwn(transitions, next) || (item && next === "completed")) {
    throw createHttpError({ statusCode: 400, message: "Invalid kitchen status" });
  }
  if (current !== next && !(transitions[current] || []).includes(next)) {
    throw createHttpError({ statusCode: 409, message: `Cannot move kitchen ${item ? "item" : "ticket"} from ${current} to ${next}` });
  }
};

export const aggregateKitchenStatus = (items) => {
  const active = items.filter((item) => item.status !== "rejected");
  if (!active.length) return items.length ? "rejected" : "pending";
  if (active.every((item) => item.status === "served")) return "completed";
  if (active.every((item) => ["ready", "served"].includes(item.status))) return "ready";
  if (active.some((item) => ["preparing", "ready", "served"].includes(item.status))) return "preparing";
  if (active.some((item) => item.status === "accepted")) return "accepted";
  return "pending";
};
