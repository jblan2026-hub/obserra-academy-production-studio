import { bootstrapMediaCheckpointTable } from "./academy-media-checkpoints.mjs";

const result = await bootstrapMediaCheckpointTable();
if (!result.ready) throw new Error("Protected Academy media checkpoint table is not ready.");
console.log(`[Academy Studio] Protected Academy media checkpoint table ${result.table} is ready.`);
