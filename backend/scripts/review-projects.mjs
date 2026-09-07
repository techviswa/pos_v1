import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const posRoot = fileURLToPath(new URL("../../", import.meta.url));
const adminRoot = process.argv[2];
if (!adminRoot) throw new Error("Pass the AdminCore project directory as the first argument.");
const excluded = new Set(["node_modules", ".git", "build", "dist", ".venv", "venv", "__pycache__", "data", "logs", "memory", ".vercel", ".emergent"]);
const extensions = new Set([".js", ".jsx", ".py", ".prisma", ".css", ".sql", ".yaml", ".toml"]);
const patterns = [
  ["memory store", /new Map\(/],
  ["filesystem persistence", /writeFile\(|readFile\(/],
  ["placeholder", /TODO|placeholder|not implemented|demo.only/i],
  ["public URL default", /https:\/\/[^\s"']+\.(onrender\.com|vercel\.app)/],
];
async function scan(root, relative = "") {
  const files = [];
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    if (excluded.has(entry.name) || entry.name.startsWith(".env")) continue;
    const name = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await scan(root, name));
    else if (extensions.has(path.extname(entry.name))) {
      const text = await readFile(path.join(root, name), "utf8");
      const lines = text.split(/\r?\n/);
      const findings = [];
      for (const [label, pattern] of patterns) lines.forEach((line, index) => {
        if (pattern.test(line)) findings.push({ label, line: index + 1 });
      });
      files.push({ path: name.replaceAll("\\", "/"), lines: lines.length,
        sha256: createHash("sha256").update(text).digest("hex"), findings });
    }
  }
  return files;
}
const result = { generatedAt: new Date().toISOString(), projects: {} };
for (const [name, root] of [["POS", posRoot], ["AdminCore", adminRoot]]) {
  result.projects[name] = await scan(root);
}
await mkdir(path.join(posRoot, "docs"), { recursive: true });
await writeFile(path.join(posRoot, "docs", "project-review-inventory.json"), JSON.stringify(result, null, 2));
const summary = ["# Project review inventory", "", "Automated inventory of first-party source, configuration and migration files. This records coverage of the scan; it is not a claim that every line has passed human review or runtime testing.", ""];
for (const [name, files] of Object.entries(result.projects)) {
  summary.push(`## ${name}`, "", `${files.length} files; ${files.reduce((n, file) => n + file.lines, 0)} lines.`, "", "| File | Lines | Review leads |", "| --- | ---: | --- |");
  for (const file of files) summary.push(`| ${file.path} | ${file.lines} | ${file.findings.map((finding) => `${finding.label}:${finding.line}`).join(", ")} |`);
  summary.push("");
  console.log(`${name}: inventoried ${files.length} files`);
}
await writeFile(path.join(posRoot, "docs", "PROJECT_INVENTORY.md"), summary.join("\n"));
