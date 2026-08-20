import { bootstrapHollywoodCheckpointTable } from "./academy-hollywood-checkpoints.mjs";

const result = await bootstrapHollywoodCheckpointTable();
if (!result.bootstrapped) {
  throw new Error(`Protected Academy cinematic checkpoint bootstrap was skipped: ${result.reason}.`);
}
console.log("[Academy Studio] Protected Academy cinematic checkpoint table is ready.");
