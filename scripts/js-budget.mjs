import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';

const STATIC = '.vercel/output/static';
const ASSETS = join(STATIC, '_astro');
const BUDGET_KB = Number(process.argv[2] ?? 40);
const STATIC_IMPORT = /(?:\bfrom|\bimport)\s*["']\.\/([^"']+\.js)["']/g;
const SCRIPT_SRC = /<script[^>]+src="\/_astro\/([^"]+\.js)"/g;

const htmlFiles = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '_astro' ? [] : htmlFiles(path);
    return name.endsWith('.html') ? [path] : [];
  });

const kb = (file) => gzipSync(readFileSync(join(ASSETS, file))).length / 1024;

function closure(entries) {
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const [, imported] of readFileSync(join(ASSETS, file), 'utf8').matchAll(STATIC_IMPORT)) visit(imported);
  };
  entries.forEach(visit);
  return seen;
}

const pages = htmlFiles(STATIC).map((html) => {
  const entries = [...readFileSync(html, 'utf8').matchAll(SCRIPT_SRC)].map(([, file]) => file);
  const total = [...closure(entries)].reduce((sum, file) => sum + kb(file), 0);
  return { page: '/' + relative(STATIC, html).replace(/index\.html$/, '').replace(/\.html$/, ''), total };
});

console.log('| página | KB gz (carga inicial) |\n|---|---:|');
for (const { page, total } of pages) console.log(`| ${page} | ${total.toFixed(1)} / ${BUDGET_KB} |`);
const over = pages.filter(({ total }) => total > BUDGET_KB);
if (over.length) {
  console.error(`JS budget exceeded on ${over.map(({ page }) => page).join(', ')} (${BUDGET_KB} KB gz per page)`);
  process.exit(1);
}
