import { readFile } from "node:fs/promises";
import * as YAML from "yaml";
import { parseConfig } from "./config.js";

const file = process.argv[2] ?? ".github/openreview.yml";
const raw = YAML.parse(await readFile(file, "utf8"));
const cfg = parseConfig(raw);
console.log(`OK: ${file} — version ${cfg.version}, ${cfg.reviews.length} review(s): ${cfg.reviews.map((r) => r.id).join(", ")}`);
for (const [name, p] of Object.entries(cfg.providers))
  console.log(`  provider ${name}: kind=${p.kind} model=${p.model}`);
