import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const manifestPath = path.join(repoRoot, "policy", "academy-command-center-control-manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const registerPath = path.join(repoRoot, manifest.documentation);
const checkOnly = process.argv.includes("--check");

const START = "<!-- AUTO-CONTROL-TABLE:START -->";
const END = "<!-- AUTO-CONTROL-TABLE:END -->";

function normalizeText(value) {
  return String(value ?? "").replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

function cell(value) {
  return normalizeText(value)
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ")
    .trim();
}

function paths(values = []) {
  return values.length ? values.map((value) => `\`${value}\``).join(", ") : "External/governed dependency";
}

function status(control) {
  return control.status || control.state || (control.required ? "Required / gated" : "Tracked");
}

function renderTable() {
  const rows = [
    "| ID | Control / Capability | Implementation | Verification / Evidence | Status |",
    "|---|---|---|---|---|",
  ];
  for (const control of manifest.controls) {
    const implementation = [
      paths(control.implementation || []),
      control.externalImplementation ? `External: \`${control.externalImplementation}\`` : null,
    ].filter(Boolean).join("; ");
    const verification = paths(control.verification || []);
    rows.push(`| ${cell(control.id)} | ${cell(control.name)} | ${cell(implementation)} | ${cell(verification)} | ${cell(status(control))} |`);
  }
  return rows.join("\n");
}

if (!fs.existsSync(registerPath)) throw new Error(`Audit register is missing: ${manifest.documentation}`);
const originalRaw = fs.readFileSync(registerPath, "utf8");
const original = normalizeText(originalRaw);
const start = original.indexOf(START);
const end = original.indexOf(END);
if (start < 0 || end < 0 || end <= start) {
  throw new Error(`Audit register must contain ${START} and ${END} markers.`);
}

const generated = `${START}\n${renderTable()}\n${END}`;
const next = `${original.slice(0, start)}${generated}${original.slice(end + END.length)}`;

if (checkOnly) {
  if (next !== original) {
    throw new Error("Control documentation drift detected. Run: npm run docs:sync");
  }
  console.log(`Control documentation is synchronized for ${manifest.controls.length} Academy controls.`);
} else {
  if (next !== original) fs.writeFileSync(registerPath, next, "utf8");
  console.log(`Synchronized ${manifest.controls.length} Academy controls into ${manifest.documentation}.`);
}
