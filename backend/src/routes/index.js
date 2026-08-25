import { Router } from "express";

import legacyRoutes from "./legacy.routes.js";
import { routeModules } from "./module-registry.js";

const routes = Router();

routes.use("/", legacyRoutes);

routeModules.forEach(({ path, router }) => {
  routes.use(path, router);
});

export default routes;
