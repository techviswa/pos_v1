import assert from "node:assert/strict";
import { getQrConnection } from "../src/features/sales-extensions/qr-ordering/qr-connection.js";
const interfaces = { wifi: [{ family: "IPv4", address: "192.168.0.14", internal: false }], loopback: [{ family: "IPv4", address: "127.0.0.1", internal: true }] };
assert.equal(getQrConnection({ mode: "development", configured: "http://192.168.1.67:3002", interfaces }).public_frontend_url, "http://192.168.0.14:3002");
assert.equal(getQrConnection({ mode: "development", interfaces: {} }).public_frontend_url, null);
assert.equal(getQrConnection({ mode: "production", configured: "https://menu.example.com", interfaces }).public_frontend_url, "https://menu.example.com");
console.log("QR runtime address: current Wi-Fi, disconnected network and public deployment passed");
