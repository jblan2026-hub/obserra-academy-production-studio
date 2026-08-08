import { restoreHollywoodCheckpoints } from "./academy-hollywood-checkpoints.mjs";

const summary = await restoreHollywoodCheckpoints();
console.log(`[Academy Studio] Cinematic checkpoint restore evaluated ${summary.evaluated} course(s) and restored ${summary.restored}.`);
