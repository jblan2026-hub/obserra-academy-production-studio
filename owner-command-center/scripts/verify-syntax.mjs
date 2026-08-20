import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ownerRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function collectSourceFiles(directory, extensions) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(absolutePath, extensions));
      continue;
    }
    if (entry.isFile() && extensions.has(path.extname(entry.name))) files.push(absolutePath);
  }
  return files;
}

const sourceFiles = [
  ...collectSourceFiles(path.join(ownerRoot, "electron"), new Set([".cjs"])),
  ...collectSourceFiles(path.join(ownerRoot, "src"), new Set([".js"])),
].sort();

if (sourceFiles.length === 0) throw new Error("No Command Center JavaScript sources were discovered for syntax validation");

for (const filePath of sourceFiles) {
  execFileSync(process.execPath, ["--check", filePath], { stdio: "inherit" });
}

for (const relativePath of ["package.json", "policy/connector-catalog.json"]) {
  const filePath = path.join(ownerRoot, relativePath);
  JSON.parse(fs.readFileSync(filePath, "utf8"));
}

console.log(`[Owner Command Center] Syntax and JSON policy validation passed for ${sourceFiles.length} JavaScript source file(s).`);
