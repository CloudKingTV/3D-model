/**
 * Repackage the Vite build as Claude Artifact pages.
 *
 * An artifact page is wrapped in its own document skeleton at publish time, so
 * it must not carry <!doctype>, <html>, <head> or <body> tags of its own. This
 * lifts the title, stylesheets and scripts out of each built page's <head>,
 * drops the metas the skeleton supplies itself, and emits content-only HTML
 * that references the built JS and CSS as files published alongside it.
 *
 *   dist/index.html    -> dist/artifact.html          (Fingerboard Studio)
 *   dist/marbles.html  -> dist/artifact-marbles.html  (Marble Mayhem)
 *
 * Usage: npm run build:artifact   (runs the Vite build first)
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const DIST = 'dist';
const PAGES = [['index.html', 'artifact.html'], ['marbles.html', 'artifact-marbles.html']];

for (const [source, target] of PAGES) {
  const html = await readFile(join(DIST, source), 'utf8');
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? 'Fingerboard Studio';
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1];
  if (!body) throw new Error(`No <body> found in the built ${source}`);
  const head = html.match(/<head>([\s\S]*?)<\/head>/)?.[1] ?? '';

  // Built references look like ./assets/x.js or /assets/x.js; artifacts want
  // them relative, without the leading ./ or /.
  const rel = (href) => href.replace(/^\.?\//, '');
  const styles = [...head.matchAll(/<link rel="stylesheet"[^>]*href="([^"]+)"/g)].map((m) => rel(m[1]));
  const scripts = [...head.matchAll(/<script type="module"[^>]*src="([^"]+)"/g)].map((m) => rel(m[1]));
  const preloads = [...head.matchAll(/<link rel="modulepreload"[^>]*href="([^"]+)"/g)].map((m) => rel(m[1]));
  if (!scripts.length) throw new Error(`No module script in the built ${source}`);

  // <noscript> is pointless here: the skeleton always runs scripts.
  const markup = body.replace(/\s*<noscript>[\s\S]*?<\/noscript>/g, '').trim();

  const page = `<title>${title}</title>
${styles.map((href) => `<link rel="stylesheet" href="${href}" />`).join('\n')}
${preloads.map((href) => `<link rel="modulepreload" href="${href}" />`).join('\n')}

${markup}

${scripts.map((src) => `<script type="module" src="${src}"></script>`).join('\n')}
`;
  await writeFile(join(DIST, target), page, 'utf8');
  console.log(`dist/${target}  (${(page.length / 1024).toFixed(1)} kB)`);
  for (const file of [...styles, ...preloads, ...scripts]) console.log(`  ${file}`);
}

const assets = await readdir(join(DIST, 'assets'));
console.log(`\n${assets.length} files in dist/assets`);
