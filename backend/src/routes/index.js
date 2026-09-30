import { Router } from "express";

import legacyRoutes from "./legacy.routes.js";
import eventsRoutes from "./events.routes.js";
import priceRulesRoutes from "../core/menu/price-rules.routes.js";
import { attendanceRouter, payrollRouter, tipsRouter } from "../core/staff/staff.routes.js";
import { marketingRouter, marketingWebhookRouter } from "../core/marketing/marketing.routes.js";
import { razorpayWebhookRouter } from "../core/payments/razorpay-webhook.routes.js";
import { routeModules } from "./module-registry.js";

const routes = Router();

routes.use("/events", eventsRoutes);
routes.use("/price-rules", priceRulesRoutes);
routes.use("/attendance", attendanceRouter);
routes.use("/tips", tipsRouter);
routes.use("/payroll", payrollRouter);
routes.use("/marketing", marketingRouter);
routes.use("/public/marketing", marketingWebhookRouter);
routes.use("/public/payments/razorpay", razorpayWebhookRouter);
routes.use("/", legacyRoutes);

routeModules.forEach(({ path, router }) => {
  routes.use(path, router);
});

export default routes;
