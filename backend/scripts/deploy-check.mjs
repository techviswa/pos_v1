import { spawn } from "child_process";
import { fileURLToPath } from "url";
import "../src/config/env.js";

const backendDirectory = fileURLToPath(new URL("../", import.meta.url));

const commands = [
  "node --check src/server.js",
  "node --check src/app.js",
  "node --check src/shared/utils/error-monitor.js",
  "node --check src/services/jobs/job-queue.js",
  "node --check src/services/printer/printer.service.js",
  "node --check src/core/printer/printer.routes.js",
  "node --check src/core/sync/sync.routes.js",
  "npm run prisma:validate",
  "node scripts/permission-revocation-tests.mjs",
  "node scripts/bridge-context-tests.mjs",
  ...(process.env.TENANT_DATABASE_URL ? ["node scripts/rls-database-tests.mjs"] : []),
  "node scripts/tenant-boundary-tests.mjs",
  "node scripts/tenant-integrity-audit.mjs",
  "node scripts/central-kitchen-repair-tests.mjs",
  "node scripts/report-consistency-tests.mjs",
  "node scripts/sales-charts-tests.mjs",
  "node src/core/dashboard/outlet-report-policy.test.mjs",
  "node scripts/dashboard-quality-tests.mjs",
  "node scripts/dashboard-profit-tests.mjs",
  "node scripts/bill-serialization-tests.mjs",
  "node scripts/fulfillment-policy-tests.mjs",
  "node scripts/qr-connection-tests.mjs",
  "node scripts/qr-media-tests.mjs",
  "node scripts/table-assistance-tests.mjs",
    "node scripts/qr-progress-tests.mjs",
    "node scripts/qr-menu-details-tests.mjs",
    "node scripts/qr-checkout-tests.mjs",
    "node scripts/qr-table-outlet-tests.mjs",
    "node scripts/qr-experience-tests.mjs",
  "node scripts/customer-qr-sync-tests.mjs",
  "node scripts/database-error-tests.mjs",
  "node scripts/auth-token-security-tests.mjs",
  "node scripts/auth-mail-tests.mjs",
  "node scripts/invite-security-tests.mjs",
  "node scripts/startup-recovery-tests.mjs",
  "node scripts/security-hardening-tests.mjs",
  "node scripts/tenant-lifecycle-tests.mjs",
  "node scripts/user-admin-policy-tests.mjs",
  "node scripts/billing-integrity-tests.mjs",
  "node scripts/menu-depth-tests.mjs",
  "node scripts/staff-features-tests.mjs",
  "node scripts/customers-payroll-tests.mjs",
  "node scripts/marketing-tests.mjs",
  "node scripts/razorpay-payments-tests.mjs",
  "node scripts/error-reporting-tests.mjs",
  "node scripts/saas-billing-tests.mjs",
  "node scripts/access-control-tests.mjs",
  "node scripts/production-flow-tests.mjs",
  "node scripts/admincore-reliability-tests.mjs",
  "node --test scripts/operational-export-tests.mjs",
  "node --test scripts/export-cursor-tests.mjs",
  "node scripts/export-cursor-database-tests.mjs",
  "node scripts/sync-reconciliation-tests.mjs",
  "node scripts/payment-isolation-tests.mjs",
  "node scripts/submitted-payment-tests.mjs",
  "node scripts/report-export-security-tests.mjs",
  "node scripts/frontend-recovery-tests.mjs",
  "node scripts/change-notification-tests.mjs",
  "npm run test:smoke",
];

const runCommand = (command) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd: backendDirectory,
      shell: true,
      stdio: "inherit",
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} failed with code ${code}`));
    });
  });

for (const command of commands) {
  await runCommand(command);
}

console.log("Deploy check passed");
