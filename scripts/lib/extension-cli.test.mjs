// @vitest-environment node

import { spawnSync } from 'node:child_process';
import { access, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { cleanupFixtures, createFixture, write } from './extension-artifact.fixture.mjs';

const packageCli = fileURLToPath(new URL('../package-extension.mjs', import.meta.url));
const verifyCli = fileURLToPath(new URL('../verify-extension.mjs', import.meta.url));

afterEach(cleanupFixtures);

async function runCli(scriptPath, fixture) {
  const unrelatedCwd = path.join(fixture.root, 'unrelated-cwd');
  await mkdir(unrelatedCwd);
  return spawnSync(process.execPath, [scriptPath, fixture.distDir, fixture.packageJsonPath], {
    cwd: unrelatedCwd,
    encoding: 'utf8',
  });
}

describe('verify-extension CLI', () => {
  it('verifies injected fixture paths without relying on cwd', async () => {
    const fixture = await createFixture();

    const result = await runCli(verifyCli, fixture);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toMatch(/Verified MV3 extension v1\.2\.3/i);
  });

  it('returns nonzero and a clear stderr for an invalid fixture', async () => {
    const fixture = await createFixture();
    await rm(path.join(fixture.distDir, 'worker.js'));

    const result = await runCli(verifyCli, fixture);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/background service worker.*worker\.js.*missing/i);
  });
});

describe('package-extension CLI', () => {
  it('packages injected fixture paths inside its release directory', async () => {
    const fixture = await createFixture();

    const result = await runCli(packageCli, fixture);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toMatch(/release[\\/]lodestar-v1\.2\.3\.zip[\s\S]*SHA-256/i);
    await expect(
      access(path.join(fixture.root, 'release', 'lodestar-v1.2.3.zip')),
    ).resolves.toBeUndefined();
  });

  it('returns nonzero, stderr, and no archive for an invalid fixture', async () => {
    const fixture = await createFixture();
    fixture.manifest.version = '1.2.2';
    await write('dist/manifest.json', fixture.manifest, fixture.root);

    const result = await runCli(packageCli, fixture);

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/manifest version 1\.2\.2.*package version 1\.2\.3/i);
    await expect(access(path.join(fixture.root, 'release'))).rejects.toThrow();
  });
});
