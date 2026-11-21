import { getPublicQrUrl, resolveQrApiBaseUrl, setQrConnection } from "./qrUrls";
afterEach(() => setQrConnection(null));

test("phones use the POS network address instead of their own localhost", () => {
  expect(resolveQrApiBaseUrl("http://localhost:4001", "http://192.168.0.14:3002")).toBe("");
  expect(resolveQrApiBaseUrl("http://localhost:4001", "http://localhost:3002")).toBe("http://localhost:4001");
});
test("runtime connection replaces a stale compiled address even when staff use localhost", () => {
  setQrConnection({ public_frontend_url: "http://192.168.0.14:3002", network: "local" });
  expect(getPublicQrUrl("existing-token", "http://192.168.1.67:3002", "http://localhost:3002")).toBe("http://192.168.0.14:3002/qr/existing-token");
});
test("public deployments retain their configured API", () => {
  expect(resolveQrApiBaseUrl("https://api.example.com", "https://pos.example.com")).toBe("https://api.example.com");
});

test("an unconfigured public deployment never contacts a hardcoded service", () => {
  expect(resolveQrApiBaseUrl("", "https://new-customer.example.com")).toBe("");
});
test("QR links follow the currently opened LAN address and preserve tokens", () => {
  expect(getPublicQrUrl("token", "http://192.168.1.67:3002", "http://192.168.0.14:3002")).toBe("http://192.168.0.14:3002/qr/token");
  expect(getPublicQrUrl("token", "https://menu.example.com", "http://localhost:3002")).toBe("https://menu.example.com/qr/token");
});
