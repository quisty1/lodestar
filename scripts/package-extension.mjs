#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { packageExtensionArtifact } from './lib/extension-artifact.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [distArgument, packageArgument] = process.argv.slice(2);

try {
  const result = await packageExtensionArtifact({
    distDir: distArgument ? path.resolve(distArgument) : path.join(repositoryRoot, 'dist'),
    packageJsonPath: packageArgument
      ? path.resolve(packageArgument)
      : path.join(repositoryRoot, 'package.json'),
  });
  console.log(`Packaged ${result.entries} files: ${result.archivePath}`);
  console.log(`SHA-256 ${result.sha256}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
