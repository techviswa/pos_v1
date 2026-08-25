import { spawn } from "child_process";
import { fileURLToPath } from "url";

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
