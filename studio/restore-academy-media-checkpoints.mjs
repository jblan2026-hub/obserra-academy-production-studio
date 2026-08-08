import { restoreMediaJobCheckpoints } from "./academy-media-checkpoints.mjs";

const result = await restoreMediaJobCheckpoints();
console.log(`[Academy Studio] Restored ${result.restoredJobs} protected cinematic media job checkpoint(s) across ${result.evaluatedCourses} course(s).`);
