/**
 * Repackage the Vite build as a Claude Artifact page.
 *
 * An artifact page is wrapped in its own document skeleton at publish time, so
 * it must not carry <!doctype>, <html>, <head> or <body> tags of its own. This
 * lifts the title and stylesheet out of the built <head>, drops the metas the
 * skeleton supplies itself, and emits content-only HTML that references the
 * built JS and CSS as files published alongside it.
 *
 * Usage: npm run build:artifact   (runs the Vite build first)
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const DIST = 'dist';

const html = await readFile(join(DIST, 'index.html'), 'utf8');

const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? 'Fingerboard Studio';
const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/)?.[1];
if (!body) throw new Error('No <body> found in the built index.html');

const assets = await readdir(join(DIST, 'assets'));
const script = assets.find((name) => name.endsWith('.js'));
const style = assets.find((name) => name.endsWith('.css'));
if (!script || !style) throw new Error('Expected a built .js and .css in dist/assets');

// <noscript> is pointless here: the skeleton always runs scripts.
const markup = body.replace(/\s*<noscript>[\s\S]*?<\/noscript>/g, '').trim();

const page = `<title>${title}</title>
<link rel="stylesheet" href="assets/${style}" />

${markup}

<script type="module" src="assets/${script}"></script>
`;

await writeFile(join(DIST, 'artifact.html'), page, 'utf8');

console.log(`dist/artifact.html  (${(page.length / 1024).toFixed(1)} kB)`);
console.log(`  assets/${style}`);
console.log(`  assets/${script}`);
