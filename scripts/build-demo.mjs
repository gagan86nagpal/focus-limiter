/**
 * Builds the static demo published to GitHub Pages.
 *
 *   npm run demo         # build into dist-demo/
 *   npm run demo:serve   # build, then serve it locally
 *
 * The page is derived from `public/dashboard.html` rather than copied, so the demo cannot
 * drift from the dashboard the extension ships. Only three things change: the stylesheet gains
 * the demo-only rules, the script points at the demo entry point, and a banner is inserted
 * explaining that the data is invented.
 */
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outdir = path.join(root, 'dist-demo');

/** Replaces exactly one occurrence, failing loudly if the markup it relies on has moved. */
function replaceOnce(source, find, replacement, what) {
  const parts = source.split(find);
  if (parts.length !== 2) {
    throw new Error(
      `build-demo: expected exactly one ${what} in public/dashboard.html, found ${String(parts.length - 1)}. ` +
        'The demo builds from that file, so update this script to match it.',
    );
  }
  return parts.join(replacement);
}

fs.rmSync(outdir, { recursive: true, force: true });
fs.mkdirSync(outdir, { recursive: true });

const banner = fs.readFileSync(path.join(root, 'src/demo/banner.html'), 'utf8').trimEnd();
let html = fs.readFileSync(path.join(root, 'public/dashboard.html'), 'utf8');

html = replaceOnce(
  html,
  '<link rel="stylesheet" href="styles.css" />',
  '<link rel="stylesheet" href="styles.css" />\n    <link rel="stylesheet" href="demo.css" />',
  'stylesheet link',
);
html = replaceOnce(
  html,
  '<script type="module" src="dashboard.js"></script>',
  '<script type="module" src="demo.js"></script>',
  'dashboard script tag',
);
html = replaceOnce(html, '<title>Focus Limiter</title>', '<title>Focus Limiter — live demo</title>', 'title');
html = replaceOnce(
  html,
  '      <header class="page-header">',
  `${banner
    .split('\n')
    .map((line) => (line === '' ? line : `      ${line}`))
    .join('\n')}\n\n      <header class="page-header">`,
  'page header',
);

// A description helps the link previews that a shared demo URL tends to produce, and the icon
// spares the browser a 404 on every visit.
html = replaceOnce(
  html,
  '<meta name="viewport"',
  '<meta name="description" content="Focus Limiter — see where your day went, then put a daily limit on it. Live, interactive demo." />\n' +
    '    <link rel="icon" href="icons/icon-128.png" />\n' +
    '    <meta name="viewport"',
  'viewport meta',
);

fs.writeFileSync(path.join(outdir, 'index.html'), html);
fs.copyFileSync(path.join(root, 'public/styles.css'), path.join(outdir, 'styles.css'));
fs.copyFileSync(path.join(root, 'src/demo/demo.css'), path.join(outdir, 'demo.css'));
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
