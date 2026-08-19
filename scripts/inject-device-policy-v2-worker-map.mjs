import fs from "node:fs";
import path from "node:path";

const root = "/home/ubuntu/cocktail-r-build";
const workerPath = path.join(root, "workers/cocktail-ai/worker-v4.js");
const generatedPath = path.join(root, "workers/cocktail-ai/device-policy-v2.generated.js");
const start = "// V2_STORAGE_CAPABILITY_GENERATED";
const end = "// V2_STORAGE_CAPABILITY_GENERATED_END";
const generated = fs.readFileSync(generatedPath, "utf8").trim();
const worker = fs.readFileSync(workerPath, "utf8");
const startAt = worker.indexOf(start);
const endAt = worker.indexOf(end);
if (startAt < 0 || endAt < 0 || endAt <= startAt) throw new Error("Worker policy markers missing or invalid");
const next = `${worker.slice(0, startAt + start.length)}\n${generated}\n${worker.slice(endAt)}`;
fs.writeFileSync(workerPath, next);
console.log("Updated generated device policy map in worker-v4.js.");
