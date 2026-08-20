import fs from "node:fs";
import path from "node:path";

import { academySurgePortfolio } from "./academy-course-portfolio.mjs";
import { persistMediaJobCheckpoint } from "./academy-media-checkpoints.mjs";

const portfolio = academySurgePortfolio();
const results = [];
for (const item of portfolio.selectedCourses) {
  const directory = path.join(item.courseDir, "generated", "video-jobs");
  if (!fs.existsSync(directory)) continue;
  const sidecars = fs.readdirSync(directory)
    .filter((name) => name.endsWith(".academy-media-job.json"))
    .sort();
  for (const name of sidecars) {
    const job = JSON.parse(fs.readFileSync(path.join(directory, name), "utf8"));
    results.push(await persistMediaJobCheckpoint(job));
  }
}

console.log(`[Academy Studio] Persisted ${results.length} cinematic media job checkpoint(s) in protected PostgreSQL.`);
if (results.length === 0) process.exit(2);
