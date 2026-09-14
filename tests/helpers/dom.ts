import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');

/** Loads the <body> markup of one of the extension's HTML pages into the jsdom document. */
export function loadPageBody(file: 'dashboard.html' | 'blocked.html'): void {
  const html = fs.readFileSync(path.join(root, file), 'utf8');
  const body = html.slice(html.indexOf('<body'), html.indexOf('</body>'));
  const inner = body.slice(body.indexOf('>') + 1);
  document.body.innerHTML = inner;
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
