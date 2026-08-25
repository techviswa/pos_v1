import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const backendEntry = path.join(__dirname, "backend", "src", "server.js");

// Verify the entry file exists before attempting to spawn
import { existsSync } from "node:fs";
if (!existsSync(backendEntry)) {
  console.error(
    `[ERROR] Backend entry point not found: ${backendEntry}\n` +
    `Make sure 'backend/src/server.js' exists before running this launcher.`
  );
  process.exit(1);
}

const child = spawn(process.execPath, [backendEntry], {
  cwd: __dirname,
  stdio: "inherit",
  // Pass through environment variables (e.g. from .env loaded by the shell)
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    // Propagate signal to parent process
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on("error", (error) => {
  console.error(`[ERROR] Failed to start backend server: ${error.message}`);
  process.exit(1);
});

// Graceful shutdown on Ctrl+C / SIGTERM
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    child.kill(sig);
  });
}
