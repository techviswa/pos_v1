import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// Execute the actual startup lifecycle with controlled dependencies and timers.
const source = readFileSync(new URL("../src/server.js", import.meta.url), "utf8")
  .replace(/^import .*;\r?\n/gm, "");
let calls = 0;
let retry;
let stopped = false;
let marketingStarted = false;
let marketingStopped = false;
const signals = {};
const context = vm.createContext({
  app: { listen: (_port, ready) => { queueMicrotask(ready); return { on() {}, close(done) { done(); } }; } },
  env: { port: 4001, appName: "test" }, getProductionConfigIssues: () => [],
  connectDatabase: async () => { calls += 1; if (calls === 1) throw new Error("Database temporarily unavailable"); return {}; },
  prisma: { $disconnect: async () => {} },
  jobQueue: { start() {}, stop() { stopped = true; } },
  startMarketingWorker: () => { marketingStarted = true; },
  stopMarketingWorker: () => { marketingStopped = true; },
  initErrorReporting: () => false,
  flushErrorReporting: async () => {},
  errorMonitor: { captureException() {} }, logger: { info() {}, error() {} },
  process: { on: (name, fn) => { signals[name] = fn; }, exit() {} },
  setTimeout: (fn, delay) => { assert.equal(delay, 5000); retry = fn; return { unref() {} }; },
  clearTimeout() {},
});
vm.runInContext(source, context);
await new Promise(setImmediate);
assert.equal(calls, 1);
assert.equal(marketingStarted, true, "the marketing sender starts with the server");
assert.equal(typeof retry, "function", "A failed startup must schedule recovery");
retry();
await new Promise(setImmediate);
assert.equal(calls, 2);
signals.SIGTERM();
await new Promise(setImmediate);
assert.equal(stopped, true);
assert.equal(marketingStopped, true, "the marketing sender stops during shutdown");
console.log("Startup retries a temporary database failure and stops jobs and the marketing sender during shutdown");
