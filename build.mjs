import * as esbuild from 'esbuild';
import fs from 'node:fs';

const watch = process.argv.includes('--watch');
const outdir = 'dist';

fs.rmSync(outdir, { recursive: true, force: true });
fs.cpSync('public', outdir, { recursive: true });

const ctx = await esbuild.context({
  entryPoints: {
    background: 'src/background/index.ts',
    dashboard: 'src/dashboard/index.ts',
    blocked: 'src/blocked/index.ts',
  },
  bundle: true,
  format: 'esm',
  target: 'chrome116',
  outdir,
  sourcemap: watch,
  logLevel: 'info',
});

if (watch) {
  await ctx.watch();
  console.log('Watching for changes...');
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
