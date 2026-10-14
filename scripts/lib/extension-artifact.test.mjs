// @vitest-environment node

import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { unzipSync, zipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  packageExtensionArtifact,
  validateExtensionArtifact,
  verifyExtensionArchive,
} from './extension-artifact.mjs';
import { cleanupFixtures, createFixture, write } from './extension-artifact.fixture.mjs';

afterEach(async () => {
  vi.useRealTimers();
  await cleanupFixtures();
});

describe('validateExtensionArtifact', () => {
  it('accepts a complete MV3 bundle and recursively follows local references', async () => {
    const fixture = await createFixture();

    const result = await validateExtensionArtifact(fixture);

    expect(result.manifest.version).toBe('1.2.3');
    expect([...result.files.keys()]).toEqual([...result.files.keys()].sort());
    expect(result.files.has('chunks/shared.js')).toBe(true);
    expect(result.files.has('images/avatar.svg')).toBe(true);
  });

  it('rejects a missing background worker', async () => {
    const fixture = await createFixture();
    await rm(path.join(fixture.distDir, 'worker.js'));

    await expect(validateExtensionArtifact(fixture)).rejects.toThrow(
      /background service worker.*worker\.js.*missing/i,
    );
  });

  it('rejects a missing asset referenced from HTML', async () => {
    const fixture = await createFixture();
    await rm(path.join(fixture.distDir, 'panel.js'));

    await expect(validateExtensionArtifact(fixture)).rejects.toThrow(
      /sidepanel\.html.*panel\.js.*missing/i,
    );
  });

  it.each([
    ['JavaScript', 'content.js'],
    ['CSS', 'content.css'],
  ])('rejects missing content-script %s', async (_kind, file) => {
    const fixture = await createFixture();
    await rm(path.join(fixture.distDir, file));

    await expect(validateExtensionArtifact(fixture)).rejects.toThrow(
      new RegExp(`content script.*${file.replace('.', '\\.')}.*missing`, 'i'),
    );
  });

  it('accepts a JS-only content script when no content CSS is declared', async () => {
    const fixture = await createFixture();
    delete fixture.manifest.content_scripts[0].css;
    await write('dist/manifest.json', fixture.manifest, fixture.root);
    await rm(path.join(fixture.distDir, 'content.css'));

    await expect(validateExtensionArtifact(fixture)).resolves.toMatchObject({
      manifest: { version: '1.2.3' },
    });
  });

  it('rejects a non-MV3 manifest', async () => {
    const fixture = await createFixture();
    fixture.manifest.manifest_version = 2;
    await write('dist/manifest.json', fixture.manifest, fixture.root);

    await expect(validateExtensionArtifact(fixture)).rejects.toThrow(
      /manifest_version must be 3.*received 2/i,
    );
  });

  it('rejects an exact-case mismatch even on case-insensitive filesystems', async () => {
    const fixture = await createFixture();
    fixture.manifest.icons['16'] = 'icons/Icon-16.png';
    await write('dist/manifest.json', fixture.manifest, fixture.root);

    await expect(validateExtensionArtifact(fixture)).rejects.toThrow(
      /exact-case mismatch.*Icon-16\.png.*icon-16\.png/i,
    );
  });

  it.each([
    '/@vite/client',
    'http://localhost:5173/src/main.ts',
    '//localhost:5173/src/main.ts',
    '//127.0.0.1:5173/src/main.ts',
    'node_modules/vue/dist/vue.esm-browser.js',
  ])('rejects development reference %s', async (reference) => {
    const fixture = await createFixture();
    await write(
      'dist/sidepanel.html',
      `<div id="app"></div><script type="module" src="${reference}"></script>`,
      fixture.root,
    );

    await expect(validateExtensionArtifact(fixture)).rejects.toThrow(
      /development artifact.*(?:@vite\/client|localhost|127\.0\.0\.1|node_modules)/i,
    );
  });

  it.each(['C:\\Users\\developer\\src\\main.js', 'file:///home/developer/src/main.js'])(
    'rejects absolute filesystem reference %s',
    async (reference) => {
      const fixture = await createFixture();
      await write(
        'dist/sidepanel.html',
        `<div id="app"></div><script src="${reference}"></script>`,
        fixture.root,
      );

      await expect(validateExtensionArtifact(fixture)).rejects.toThrow(
        /absolute filesystem reference/i,
      );
    },
  );

  it('rejects a manifest/package version mismatch', async () => {
    const fixture = await createFixture();
    fixture.manifest.version = '1.2.2';
    await write('dist/manifest.json', fixture.manifest, fixture.root);

    await expect(validateExtensionArtifact(fixture)).rejects.toThrow(
      /manifest version 1\.2\.2.*package version 1\.2\.3/i,
    );
  });

  it('rejects a reference that escapes dist', async () => {
    const fixture = await createFixture();
    await write(
      'dist/sidepanel.html',
      '<div id="app"></div><script type="module" src="../outside.js"></script>',
      fixture.root,
    );
    await write('outside.js', 'export default true;', fixture.root);

    await expect(validateExtensionArtifact(fixture)).rejects.toThrow(
      /sidepanel\.html.*\.\.\/outside\.js.*escapes dist/i,
    );
  });

  it('reports a missing import reached through a nested module', async () => {
    const fixture = await createFixture();
    await write('dist/chunks/shared.js', 'export{value}from"./missing.js";', fixture.root);

    await expect(validateExtensionArtifact(fixture)).rejects.toThrow(
      /chunks\/shared\.js.*chunks\/missing\.js.*missing/i,
    );
  });

  it('requires the sidepanel mount root', async () => {
    const fixture = await createFixture();
    await write('dist/sidepanel.html', '<main>loading</main>', fixture.root);

    await expect(validateExtensionArtifact(fixture)).rejects.toThrow(
      /sidepanel.*mount root.*#app/i,
    );
  });
});

describe('packageExtensionArtifact', () => {
  it('produces deterministic, sorted archives and verifies unpacked bytes', async () => {
    const fixture = await createFixture();
    const firstPath = path.join(fixture.root, 'release', 'first.zip');
    const secondPath = path.join(fixture.root, 'release', 'second.zip');

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2020-01-01T00:00:00.000Z'));
    const first = await packageExtensionArtifact({ ...fixture, outputFile: firstPath });
    vi.setSystemTime(new Date('2035-01-01T00:00:00.000Z'));
    const second = await packageExtensionArtifact({ ...fixture, outputFile: secondPath });

    const firstBytes = await readFile(firstPath);
    const secondBytes = await readFile(secondPath);
    expect(first.sha256).toBe(second.sha256);
    expect(firstBytes.equals(secondBytes)).toBe(true);

    const unpacked = unzipSync(firstBytes);
    expect(Object.keys(unpacked)).toEqual(Object.keys(unpacked).sort());
    expect(Object.keys(unpacked)[0]).not.toMatch(/^\/|^[A-Za-z]:|\\|(?:^|\/)\.\.(?:\/|$)/);
    expect(Buffer.from(unpacked['manifest.json'])).toEqual(
      await readFile(path.join(fixture.distDir, 'manifest.json')),
    );
  });

  it.each(['../escape.js', '..\\escape.js', '/absolute.js', 'C:\\absolute.js'])(
    'rejects unsafe unpacked entry %s',
    async (entry) => {
      const archive = zipSync({ [entry]: new Uint8Array([1]) });

      expect(() => verifyExtensionArchive(archive, new Map())).toThrow(/unsafe archive entry/i);
    },
  );
});
