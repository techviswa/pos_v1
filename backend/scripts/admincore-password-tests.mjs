import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { verifyPassword } from "../src/core/auth/passwords.js";

const backendPath = process.argv[2];
assert.ok(backendPath, "Pass the AdminCore backend directory");
const result = spawnSync("python", ["-B", "-c", `
import sys
sys.path.insert(0, sys.argv[1])
from pos_passwords import hash_pos_password
hashed = hash_pos_password("Test-only-Password-123")
assert hashed == hash_pos_password(hashed)
assert hash_pos_password("") == ""
try:
    hash_pos_password("short")
except ValueError:
    pass
else:
    raise AssertionError("Weak password accepted")
print(hashed)
`, backendPath], { encoding: "utf8" });
assert.equal(result.status, 0, result.stderr);
const hashed = result.stdout.trim();
assert.equal(verifyPassword("Test-only-Password-123", hashed), true);
assert.equal(verifyPassword("incorrect-password", hashed), false);
console.log("AdminCore queued password hash is compatible with POS authentication");
