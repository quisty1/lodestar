// @vitest-environment node

import path from 'node:path';
import { zipSync } from 'fflate';
import { afterEach, describe, expect, it } from 'vitest';

import {
  packageExtensionArtifact,
  validateExtensionArtifact,
  verifyExtensionArchive,
} from './extension-artifact.mjs';
import { cleanupFixtures, createFixture, write } from './extension-artifact.fixture.mjs';

afterEach(cleanupFixtures);

describe('Chrome extension version', () => {
  it.each(['1', '0.3.7', '1.2.3.4', '65535.65535.65535.65535'])(
    'accepts Chrome version %s',
    async (version) => {
      const fixture = await createFixture();
      fixture.manifest.version = version;
      await write('dist/manifest.json', fixture.manifest, fixture.root);
      await write('package.json', { name: 'fixture', version }, fixture.root);

      await expect(validateExtensionArtifact(fixture)).resolves.toMatchObject({
        manifest: { version },
      });
    },
  );

  it.each(['0', '0.0.0.0', '01.2', '1.02', '1.2.3.4.5', '65536', '1.0.0-beta.1', '../1.2.3'])(
    'rejects invalid Chrome version %s',
    async (version) => {
      const fixture = await createFixture();
      fixture.manifest.version = version;
      await write('dist/manifest.json', fixture.manifest, fixture.root);
      await write('package.json', { name: 'fixture', version }, fixture.root);

      await expect(validateExtensionArtifact(fixture)).rejects.toThrow(
        /Chrome extension version.*1 to 4.*0\.\.65535/i,
      );
    },
  );
});

describe('recursive production references', () => {
  it.each([
    ['quoted CSS import', '@import "./styles/missing.css";'],
    ['CSS import URL', '@import url("./styles/missing.css");'],
  ])('rejects a missing %s', async (_label, source) => {
    const fixture = await createFixture();
    await write('dist/panel.css', source, fixture.root);

    await expect(validateExtensionArtifact(fixture)).rejects.toThrow(
      /panel\.css.*styles\/missing\.css.*missing/i,
    );
  });

  it('validates every HTML srcset candidate', async () => {
    const fixture = await createFixture();
    await write(
      'dist/sidepanel.html',
      '<div id="app"><img srcset="./images/avatar.svg 1x, ./images/missing.svg 2x"></div>',
      fixture.root,
    );

    await expect(validateExtensionArtifact(fixture)).rejects.toThrow(
      /sidepanel\.html.*images\/missing\.svg.*missing/i,
    );
  });

  it('validates a dynamic import with options', async () => {
    const fixture = await createFixture();
    await write(
      'dist/panel.js',
      'import("./chunks/missing.json", { with: { type: "json" } });',
      fixture.root,
    );

    await expect(validateExtensionArtifact(fixture)).rejects.toThrow(
      /panel\.js.*chunks\/missing\.json.*missing/i,
    );
  });

  it('rejects the 0.0.0.0 development host', async () => {
    const fixture = await createFixture();
    await write(
      'dist/sidepanel.html',
      '<div id="app"></div><script src="http://0.0.0.0:5173/src/main.ts"></script>',
      fixture.root,
    );

    await expect(validateExtensionArtifact(fixture)).rejects.toThrow(
      /development artifact.*0\.0\.0\.0/i,
    );
  });
});

describe('sidepanel mount root', () => {
  it.each([
    ['comment', '<!-- <div id="app"></div> --><main></main>'],
    ['template', '<template><div id="app"></div></template>'],
    ['non-mountable element', '<script id="app"></script>'],
  ])('ignores an id=app inside %s', async (_label, html) => {
    const fixture = await createFixture();
    await write('dist/sidepanel.html', html, fixture.root);

    await expect(validateExtensionArtifact(fixture)).rejects.toThrow(
      /sidepanel.*mount root.*#app/i,
    );
  });

  it('accepts a real mountable element', async () => {
    const fixture = await createFixture();
    await write('dist/sidepanel.html', '<main id="app"></main>', fixture.root);

    await expect(validateExtensionArtifact(fixture)).resolves.toBeDefined();
  });
});

describe('Windows-target archive safety', () => {
  it.each([
    ['case', 'assets/Foo.js', 'assets/foo.js'],
    ['Unicode NFC', 'assets/café.js', 'assets/cafe\u0301.js'],
    ['Unicode case', 'assets/Straße.js', 'assets/STRASSE.js'],
    ['Unicode sharp S', 'assets/ß.js', 'assets/ẞ.js'],
  ])('rejects a %s-folded path collision', (_label, firstPath, secondPath) => {
    const first = new Uint8Array([1]);
    const second = new Uint8Array([2]);
    const archive = zipSync({ [firstPath]: first, [secondPath]: second });
    const expected = new Map([
      [firstPath, first],
      [secondPath, second],
    ]);

    expect(() => verifyExtensionArchive(archive, expected)).toThrow(
      /Windows path collision.*assets\//i,
    );
  });

  it('keeps the archive output inside release', async () => {
    const fixture = await createFixture();
    const escapingOutput = path.join(fixture.root, 'release', '..', 'outside.zip');

    await expect(
      packageExtensionArtifact({ ...fixture, outputFile: escapingOutput }),
    ).rejects.toThrow(/archive output.*outside release/i);
  });

  it('does not allow redefining release outside the package root', async () => {
    const fixture = await createFixture();
    const outsideRelease = path.join(fixture.root, 'custom-output');

    await expect(
      packageExtensionArtifact({
        ...fixture,
        releaseDir: outsideRelease,
        outputFile: path.join(outsideRelease, 'lodestar.zip'),
      }),
    ).rejects.toThrow(/archive output.*outside release/i);
  });
});
