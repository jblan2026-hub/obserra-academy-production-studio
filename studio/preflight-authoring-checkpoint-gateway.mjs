import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  checkpointGatewayConfigured,
  checkpointGatewayRequired,
  preflightCheckpointGateway,
} from "./checkpoint-gateway.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const catalogRoot = path.join(root, "catalog");
const evidencePath = path.join(catalogRoot, "authoring-checkpoint-gateway-preflight.json");
fs.mkdirSync(catalogRoot, { recursive: true });

try {
  if (!checkpointGatewayConfigured()) {
    if (checkpointGatewayRequired()) {
      throw new Error("The protected checkpoint gateway is required but not configured.");
    }
    const skipped = {
      schemaVersion: "1.0",
      checkedAt: new Date().toISOString(),
      ready: false,
      skipped: true,
      reason: "checkpoint-gateway-not-configured",
      claimBoundary: "No protected gateway transport was validated.",
    };
    fs.writeFileSync(evidencePath, `${JSON.stringify(skipped, null, 2)}\n`);
    console.log("[Academy Studio] Protected checkpoint gateway is not configured; direct PostgreSQL remains the selected transport.");
    process.exit(0);
  }

  const result = await preflightCheckpointGateway();
  const evidence = {
    schemaVersion: "1.0",
    checkedAt: new Date().toISOString(),
    ready: true,
    skipped: false,
    transport: result.transport,
    checkpointTable: result.checkpointTable,
    authentication: "github-actions-oidc",
    audience: "obserra-academy-checkpoint",
    claimBoundary: "This preflight proves that the current GitHub-hosted workflow identity was accepted and that the protected checkpoint table is reachable. It does not authorize publication, commerce, or final course claims.",
  };
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`[Academy Studio] Protected checkpoint gateway preflight passed using ${result.transport}.`);
} catch (error) {
  const evidence = {
    schemaVersion: "1.0",
    checkedAt: new Date().toISOString(),
    ready: false,
    skipped: false,
    errorCategory: "checkpoint_gateway_preflight_failed",
    claimBoundary: "No authoring worker may launch until a protected checkpoint transport passes.",
  };
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[Academy Studio] CHECKPOINT_GATEWAY_PREFLIGHT_FAILURE: ${message.replace(/\s+/g, " ").slice(0, 1600)}`);
  process.exit(46);
}
