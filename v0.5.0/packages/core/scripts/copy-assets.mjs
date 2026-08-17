import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const dist = resolve(root, "dist");

mkdirSync(dist, { recursive: true });
copyFileSync(resolve(root, "src", "routing-rules.json"), resolve(dist, "routing-rules.json"));
console.log("Copied routing-rules.json to dist");
