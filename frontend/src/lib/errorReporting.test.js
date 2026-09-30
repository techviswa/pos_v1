import { scrubEvent, scrubUrl } from "./errorReporting";

test("removes secrets and personal data before anything is reported", () => {
  expect(scrubUrl("https://pos.example.com/qr/abc123secret?x=1")).toBe("https://pos.example.com/qr/[redacted]");
  expect(scrubUrl("https://pos.example.com/reset-password?token=abc")).toBe("https://pos.example.com/reset-password");
  expect(scrubUrl("/qr/orders/track-secret")).toBe("/qr/orders/[redacted]");
  const event = scrubEvent({
    user: { email: "a@b.com", ip_address: "1.2.3.4" },
    request: { url: "https://pos.example.com/invite/tok123?y=2", headers: { cookie: "sid=1" }, data: "{\"password\":\"x\"}" },
    message: "Failed for 9845012345 and asha@example.com",
    exception: { values: [{ value: "Card 4111 1111 1111 1111 rejected" }] },
    breadcrumbs: [{ category: "console", message: "secret" }, { category: "fetch", data: { url: "/api/public/qr/tok9/menu?a=1", method: "GET" } }],
  });
  expect(event.user).toBeUndefined();
  expect(event.request).toEqual({ url: "https://pos.example.com/invite/[redacted]" });
  expect(event.message).toBe("Failed for [number] and [email]");
  expect(event.exception.values[0].value).toBe("Card [number] rejected");
  expect(event.breadcrumbs).toHaveLength(1);
  expect(event.breadcrumbs[0].data.url).toBe("/api/public/qr/[redacted]/menu");
});
