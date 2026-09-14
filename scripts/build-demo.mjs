/**
 * Builds the static site published to GitHub Pages.
 *
 *   npm run demo         # build into dist-demo/
 *   npm run demo:serve   # build, then serve it locally
 *
 * The page itself is assembled by scripts/demo-html.mjs, which lifts the dashboard and the
 * blocked page straight out of `public/`. This step only writes that page out, copies the assets
 * beside it, and bundles the demo entry point.
 */
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDemoHtml } from './demo-html.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outdir = path.join(root, 'dist-demo');

fs.rmSync(outdir, { recursive: true, force: true });
fs.mkdirSync(outdir, { recursive: true });

fs.writeFileSync(path.join(outdir, 'index.html'), buildDemoHtml());
fs.copyFileSync(path.join(root, 'public/styles.css'), path.join(outdir, 'styles.css'));
fs.copyFileSync(path.join(root, 'src/demo/demo.css'), path.join(outdir, 'demo.css'));
fs.copyFileSync(path.join(root, 'src/demo/avatar.jpg'), path.join(outdir, 'avatar.jpg'));
fs.cpSync(path.join(root, 'public/icons'), path.join(outdir, 'icons'), { recursive: true });

// Pages would otherwise hand the whole directory to Jekyll, which ignores nothing here but
// costs a build step and can swallow files beginning with an underscore.
fs.writeFileSync(path.join(outdir, '.nojekyll'), '');

await esbuild.build({
  entryPoints: { demo: path.join(root, 'src/demo/index.ts') },
  bundle: true,
  format: 'esm',
  target: 'chrome116',
  minify: true,
  outdir,
  logLevel: 'info',
});

console.log(`Demo built into ${path.relative(root, outdir)}/`);
