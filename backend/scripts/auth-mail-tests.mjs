import assert from "node:assert/strict";
import { createAuthMailer } from "../src/core/auth/auth-mail.js";

const sent = [];
const config = { NODE_ENV: "production", SMTP_HOST: "smtp.invalid", SMTP_FROM: "POS <pos@example.invalid>", AUTH_PUBLIC_URL: "https://pos.example.invalid" };
const mailer = createAuthMailer({ config, transport: { sendMail: async (message) => { sent.push(message); return { accepted: [message.to] }; } } });
await mailer.send({ email: "user@example.invalid", token: "test-token", type: "password_reset" });
await mailer.send({ email: "user@example.invalid", token: "test-token", type: "invite" });
assert.match(sent[0].text, /https:\/\/pos\.example\.invalid\/reset-password\?token=test-token/);
assert.match(sent[1].text, /https:\/\/pos\.example\.invalid\/invite\/test-token/);
assert.throws(() => createAuthMailer({ config: {} }).requireConfigured(), /not configured/);
assert.throws(() => createAuthMailer({ config: { ...config, AUTH_PUBLIC_URL: "http://pos.example.invalid" } }).requireConfigured(), /secure/);
await assert.rejects(createAuthMailer({ config, transport: { sendMail: async () => ({ accepted: [] }) } }).send({ email: "user@example.invalid", token: "test", type: "invite" }), /not accepted/);
console.log("Account email links, missing configuration, TLS URL and delivery rejection checks passed; no email sent");
