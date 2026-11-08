// Construit www/app.js (toutes les sources de src/ en un seul fichier) et la liste des fichiers hors ligne.
import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const watch = process.argv.includes('--watch');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
const opts = {
  entryPoints: ['src/app.js'],
  bundle: true,
  format: 'iife',
  target: ['es2020', 'chrome100', 'safari15'],
  outfile: 'www/app.js',
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  define: { __VERSION__: JSON.stringify(pkg.version) },
  legalComments: 'none',
  loader: { '.luau': 'text' },
  logLevel: 'info',
};

function writeSw() {
  const files = [];
  const walk = d => readdirSync(d).forEach(f => { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : files.push(relative('www', p).replace(/\\/g, '/')); });
  walk('www');
  const list = files.filter(f => !/^sw\.js$|\.map$/.test(f));
  const sw = readFileSync('scripts/sw.template.js', 'utf8').replace('__FILES__', JSON.stringify(['./', ...list])).replace('__VERSION__', pkg.version + '-' + Date.now().toString(36));
  writeFileSync('www/sw.js', sw);
}

if (watch) {
  const ctx = await esbuild.context(opts);
  await ctx.watch();
  console.log('Surveillance de src/…');
} else {
  await esbuild.build(opts);
  writeSw();
}
