import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const temporaryRoots = [];

export async function write(relativePath, value, root) {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, typeof value === 'string' ? value : JSON.stringify(value, null, 2));
}

export async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'lodestar-artifact-'));
  temporaryRoots.push(root);

  const distDir = path.join(root, 'dist');
  const packageJsonPath = path.join(root, 'package.json');
  const manifest = {
    manifest_version: 3,
    name: 'Lodestar fixture',
    version: '1.2.3',
    background: { service_worker: 'worker.js', type: 'module' },
    side_panel: { default_path: 'sidepanel.html' },
    icons: { 16: 'icons/icon-16.png' },
    content_scripts: [
      {
        matches: ['https://www.linkedin.com/*'],
        js: ['content.js'],
        css: ['content.css'],
      },
    ],
  };

  await write('package.json', { name: 'fixture', version: '1.2.3' }, root);
  await write('dist/manifest.json', manifest, root);
  await write('dist/worker.js', 'import "./chunks/worker.js";', root);
  await write('dist/chunks/worker.js', 'export const ready = true;', root);
  await write(
    'dist/sidepanel.html',
    '<div id="app"></div><script type="module" src="./panel.js"></script><link rel="stylesheet" href="./panel.css">',
    root,
  );
  await write('dist/panel.js', 'import "./chunks/shared.js";', root);
  await write('dist/chunks/shared.js', 'export const shared = true;', root);
  await write('dist/panel.css', '.avatar { background: url("./images/avatar.svg") }', root);
  await write('dist/images/avatar.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>', root);
  await write(
    'dist/content.js',
    'import(/* @vite-ignore */ chrome.runtime.getURL("chunks/content.js"));',
    root,
  );
  await write('dist/chunks/content.js', 'export const run = () => true;', root);
  await write('dist/content.css', '.icon { background: url("./icons/icon-16.png") }', root);
  await write('dist/icons/icon-16.png', new Uint8Array([137, 80, 78, 71]), root);

  return { root, distDir, packageJsonPath, manifest };
}

export async function cleanupFixtures() {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
}
