import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDemoHtml } from '../../scripts/demo-html.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');

function injectBody(html: string): void {
  const body = html.slice(html.indexOf('<body'), html.indexOf('</body>'));
  document.body.innerHTML = body.slice(body.indexOf('>') + 1);
  // jsdom does not implement <dialog>; provide minimal open/close semantics.
  for (const dialog of Array.from(document.querySelectorAll('dialog'))) {
    const el = dialog as HTMLDialogElement & { showModal: () => void; close: () => void };
    el.showModal = function showModal() {
      this.setAttribute('open', '');
    };
    el.close = function close() {
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    };
  }
}

/** Loads the <body> markup of one of the extension's HTML pages into the jsdom document. */
export function loadPageBody(file: 'dashboard.html' | 'blocked.html'): void {
  injectBody(fs.readFileSync(path.join(root, file), 'utf8'));
}

/**
 * Loads the demo site's page, assembled by the same code that writes `dist-demo/index.html`, so
 * these tests fail if the published markup and the demo's wiring drift apart.
 */
export function loadDemoBody(): void {
  injectBody(buildDemoHtml());
}
