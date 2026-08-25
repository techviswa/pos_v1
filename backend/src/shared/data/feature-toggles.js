import env from "../../config/env.js";
import { FEATURE_REGISTRY } from "../constants/feature.constants.js";

export const defaultFeatureToggles = new Map([
  [
    env.defaultBusinessId,
    FEATURE_REGISTRY.map((feature) => feature.key),
  ],
]);
