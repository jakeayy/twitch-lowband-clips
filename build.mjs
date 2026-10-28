import * as esbuild from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const watch = process.argv.includes('--watch');

// Builds the ==UserScript== header from package.json. Keys under "userscript"
// may hold a string or an array (one line per entry).
const header = () => {
  const meta = {
    name: pkg.userscript.name,
    namespace: pkg.userscript.namespace,
    version: pkg.version,
    description: pkg.description,
    license: pkg.license,
    ...Object.fromEntries(Object.entries(pkg.userscript).filter(([k]) => !['name', 'namespace'].includes(k))),
  };
  const width = Math.max(...Object.keys(meta).map((k) => k.length)) + 2;
  const lines = Object.entries(meta).flatMap(([key, value]) =>
    [].concat(value).map((v) => `// @${key.padEnd(width - 1)}${v}`));
  return ['// ==UserScript==', ...lines, '// ==/UserScript=='].join('\n');
};

const banner = header();

// Header-only file for @updateURL, so update checks don't download the script.
mkdirSync('dist', { recursive: true });
writeFileSync('dist/twitch-lowband-clips.meta.js', banner + '\n');

const options = {
  entryPoints: ['src/main.ts'],
  outfile: 'dist/twitch-lowband-clips.user.js',
  bundle: true,
  format: 'iife',
  target: 'es2020',
  charset: 'utf8',
  legalComments: 'none',
  banner: { js: banner + '\n' },
  logLevel: 'info',
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
