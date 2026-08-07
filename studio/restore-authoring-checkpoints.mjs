import { restoreAuthoringCheckpoints } from "./authoring-checkpoints.mjs";

const summary = await restoreAuthoringCheckpoints();
console.log(
  `[Academy Studio] Protected authoring checkpoint restore completed. evaluated=${summary.evaluated} restored=${summary.restored} skipped=${summary.skipped}.`,
);
