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
let reportsStarted = false;
let reportsStopped = false;
let rollupWarmupStarted = false;
let backupStarted = false;
let backupStopped = false;
let maintenanceStarted = false;
const signals = {};
const context = vm.createContext({
  app: { listen: (_port, ready) => { queueMicrotask(ready); return { on() {}, close(done) { done(); } }; } },
  env: { port: 4001, appName: "test" }, getProductionConfigIssues: () => [],
  connectDatabase: async () => { calls += 1; if (calls === 1) throw new Error("Database temporarily unavailable"); return {}; },
  prisma: { $disconnect: async () => {} },
  jobQueue: { start() {}, stop() { stopped = true; } },
  startMarketingWorker: () => { marketingStarted = true; },
  stopMarketingWorker: () => { marketingStopped = true; },
  startReportScheduler: () => { reportsStarted = true; },
  stopReportScheduler: () => { reportsStopped = true; },
  reportSchedules: {},
  startSalesRollupWarmup: () => { rollupWarmupStarted = true; },
  startBackupScheduler: () => { backupStarted = true; },
  stopBackupScheduler: () => { backupStopped = true; },
  startMaintenance: () => { maintenanceStarted = true; },
  stopMaintenance: () => {},
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
assert.equal(reportsStarted, true, "the scheduled-report sender starts with the server");
assert.equal(rollupWarmupStarted, true, "saved sales totals are refreshed in the background after start-up");
assert.equal(backupStarted, true, "the nightly backup scheduler starts with the server");
assert.equal(maintenanceStarted, true, "hourly maintenance starts with the server");
assert.equal(typeof retry, "function", "A failed startup must schedule recovery");
retry();
await new Promise(setImmediate);
assert.equal(calls, 2);
signals.SIGTERM();
await new Promise(setImmediate);
assert.equal(stopped, true);
assert.equal(marketingStopped, true, "the marketing sender stops during shutdown");
assert.equal(reportsStopped, true, "the scheduled-report sender stops during shutdown");
assert.equal(backupStopped, true, "the backup scheduler stops during shutdown");
console.log("Startup retries a temporary database failure and stops jobs and the marketing sender during shutdown");
let listened = false, startedWorkers = false, exitCode;
const rejected = vm.createContext({
  ...context,
  env: { port: 4001, appName: "test", nodeEnv: "production" },
  app: { listen() { listened = true; return { on() {} }; } },
  connectDatabase: async () => { throw new Error("Unsafe RLS database role"); },
  jobQueue: { start() { startedWorkers = true; }, stop() {} },
  startMarketingWorker: () => { startedWorkers = true; },
  process: { on() {}, exit(code) { exitCode = code; } },
});
vm.runInContext(source, rejected);
await new Promise(setImmediate);
assert.equal(exitCode, 1);
assert.equal(listened, false, "unsafe production database must not open the HTTP listener");
assert.equal(startedWorkers, false, "unsafe production database must not start workers");
console.log("Production fails closed before HTTP or workers when database security preflight fails");
