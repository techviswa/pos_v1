import { networkInterfaces } from "node:os";
import env from "../../../config/env.js";

export const getQrConnection = ({ mode = env.nodeEnv, configured = env.qrOrdering.publicBaseUrl, interfaces = networkInterfaces() } = {}) => {
  if (mode === "production") return { public_frontend_url: configured, network: "public" };
  const addresses = Object.values(interfaces).flat().filter((entry) => entry && entry.family === "IPv4" && !entry.internal && /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(entry.address));
  addresses.sort((a, b) => Number(b.address.startsWith("192.168.")) - Number(a.address.startsWith("192.168.")));
  return { public_frontend_url: addresses[0] ? `http://${addresses[0].address}:3002` : null, network: "local" };
};
