/**
 * Assembles the demo site's single page.
 *
 * The dashboard and the blocked page are lifted out of `public/` rather than restated in a
 * template, so the demo cannot drift from the pages the extension ships. Every lift asserts the
 * markup it depends on, so moving that markup fails the build instead of quietly publishing a
 * page with a hole in it.
 *
 * This lives apart from the build step so the unit tests can assemble the same DOM the site
 * serves, instead of guessing at it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

/** Replaces exactly one occurrence, failing loudly if the markup it relies on has moved. */
function replaceOnce(source, find, replacement, where) {
  const parts = source.split(find);
  if (parts.length !== 2) {
    throw new Error(
      `demo-html: expected exactly one ${JSON.stringify(find)} in ${where}, found ` +
        `${String(parts.length - 1)}. The demo is assembled from that file, so update ` +
        'scripts/demo-html.mjs to match it.',
    );
  }
  return parts.join(replacement);
}

/** The markup inside a page's <body>. */
function bodyOf(file) {
  const html = read(file);
  const start = html.indexOf('<body');
  const end = html.indexOf('</body>');
  if (start === -1 || end === -1) throw new Error(`demo-html: no <body> in ${file}`);
  const body = html.slice(start, end);
  return body.slice(body.indexOf('>') + 1);
}

/** The markup inside one element, located by its opening and closing tags. */
function innerOf(file, openTag, closeTag) {
  const html = read(file);
  const start = html.indexOf(openTag);
  if (start === -1) throw new Error(`demo-html: no ${openTag} in ${file}`);
  const end = html.indexOf(closeTag, start);
  if (end === -1) throw new Error(`demo-html: no ${closeTag} after ${openTag} in ${file}`);
  return html.slice(start + openTag.length, end);
}

function indentBy(markup, pad) {
  return markup
    .split('\n')
    .map((line) => (line.trim() === '' ? '' : pad + line))
    .join('\n');
}

/** Drops a fragment into one of the shell's `<!--demo:name-->` slots, keeping its indentation. */
function fill(shell, name, markup) {
  const token = `<!--demo:${name}-->`;
  const host = shell.split('\n').find((line) => line.includes(token)) ?? '';
  const pad = ' '.repeat(host.length - host.trimStart().length);
  const block = indentBy(markup.trim(), pad).trimStart();
  return replaceOnce(shell, token, block, 'src/demo/shell.html');
}

export function buildDemoHtml() {
  const dashboardFile = 'public/dashboard.html';
  let dashboard = bodyOf(dashboardFile);
  // The demo bundles its own entry point, and the shell owns the page's single <main>, so the
  // dashboard's script goes and its <main> becomes a plain container.
  dashboard = replaceOnce(
    dashboard,
    '\n    <script type="module" src="dashboard.js"></script>',
    '',
    dashboardFile,
  );
  dashboard = replaceOnce(dashboard, '<main class="container">', '<div class="container">', dashboardFile);
  dashboard = replaceOnce(dashboard, '</main>', '</div>', dashboardFile);

  const blockedFile = 'public/blocked.html';
  let blocked = innerOf(blockedFile, '<main class="blocked">', '</main>');
  // On the demo the dashboard is the section directly above, not another page.
  blocked = replaceOnce(blocked, 'href="dashboard.html"', 'href="#demo-dashboard-title"', blockedFile);
  blocked = `<div class="blocked demo-blocked">\n${blocked.trimEnd()}\n</div>`;

  let shell = read('src/demo/shell.html');
  shell = fill(shell, 'banner', read('src/demo/banner.html'));
  shell = fill(shell, 'dashboard', dashboard);
  shell = fill(shell, 'blocked', blocked);
  shell = fill(shell, 'install', read('src/demo/install.html'));
  shell = fill(shell, 'about', read('src/demo/about.html'));
  return shell;
}
