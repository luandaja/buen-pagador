import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const DIR = '.vercel/output/static/_astro';
const BUDGET_KB = Number(process.argv[2] ?? 50);
const FACE_DETECTION = /^(face-api|detect\.worker)/;

const chunks = readdirSync(DIR)
  .filter((file) => file.endsWith('.js') && !FACE_DETECTION.test(file))
  .map((file) => ({ file, kb: gzipSync(readFileSync(join(DIR, file))).length / 1024 }))
  .sort((first, second) => second.kb - first.kb);

const total = chunks.reduce((sum, chunk) => sum + chunk.kb, 0);
console.log('| chunk | KB gz |\n|---|---:|');
for (const chunk of chunks) console.log(`| ${chunk.file} | ${chunk.kb.toFixed(1)} |`);
console.log(`| **total (sin face-api)** | **${total.toFixed(1)} / ${BUDGET_KB}** |`);
if (total > BUDGET_KB) {
  console.error(`JS budget exceeded: ${total.toFixed(1)} KB gz > ${BUDGET_KB} KB gz`);
  process.exit(1);
}
