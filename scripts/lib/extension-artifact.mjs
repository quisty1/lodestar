import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { unzipSync, zipSync } from 'fflate';

import { inspectHtml } from './extension-html.mjs';
import {
  compareArchivePaths,
  findWindowsPathCollision,
  resolveLocalReference,
  unsafeArchiveEntry,
  validateFileReferences,
} from './extension-references.mjs';
import { isChromeExtensionVersion } from './extension-version.mjs';

const ZIP_MTIME = new Date(1980, 0, 1, 0, 0, 0);

export class ExtensionArtifactError extends Error {
  constructor(errors) {
    super(`Extension artifact is invalid:\n- ${errors.join('\n- ')}`);
    this.name = 'ExtensionArtifactError';
    this.errors = errors;
  }
}

function toArchivePath(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function isOutside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

async function collectFiles(distDir) {
  const absoluteRoot = path.resolve(distDir);
  const canonicalRoot = await realpath(absoluteRoot);
  const files = new Map();

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));

    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = toArchivePath(path.relative(absoluteRoot, absolutePath));

      if (entry.isSymbolicLink()) {
        throw new ExtensionArtifactError([
          `${relativePath} is a symbolic link; packaged files must stay inside dist`,
        ]);
      }
      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;

      const canonicalPath = await realpath(absolutePath);
      if (isOutside(canonicalRoot, canonicalPath)) {
        throw new ExtensionArtifactError([`${relativePath} resolves outside dist`]);
      }
      if (!relativePath || relativePath.includes('\\') || unsafeArchiveEntry(relativePath)) {
        throw new ExtensionArtifactError([
          `${relativePath || '<empty>'} is not a safe extension path`,
        ]);
      }
      files.set(relativePath, await readFile(absolutePath));
    }
  }

  await visit(absoluteRoot);
  const sortedFiles = new Map(
    [...files].sort(([left], [right]) => compareArchivePaths(left, right)),
  );
  const collision = findWindowsPathCollision(sortedFiles.keys());
  if (collision) {
    throw new ExtensionArtifactError([
      `Windows path collision: ${collision[0]} conflicts with ${collision[1]}`,
    ]);
  }
  return sortedFiles;
}

function manifestPath(files, errors, value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(`${label} is missing from manifest.json`);
    return null;
  }
  return resolveLocalReference(
    'manifest.json',
    `/${value.replace(/^\/+/, '')}`,
    label,
    files,
    errors,
  );
}

function parseJson(bytes, label, errors) {
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch (error) {
    errors.push(
      `${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

function validateManifest(manifest, packageJson, files, errors) {
  if (!manifest || !packageJson) return;

  if (manifest.manifest_version !== 3) {
    errors.push(
      `manifest_version must be 3, received ${JSON.stringify(manifest.manifest_version)}`,
    );
  }
  for (const [label, version] of [
    ['manifest', manifest.version],
    ['package', packageJson.version],
  ]) {
    if (!isChromeExtensionVersion(version)) {
      errors.push(
        `Chrome extension version in ${label} must contain 1 to 4 integers in 0..65535, without leading zeros, and not be all zero; received ${JSON.stringify(version)}`,
      );
    }
  }
  if (typeof packageJson.version !== 'string' || packageJson.version.trim() === '') {
    errors.push('package version is missing');
  } else if (manifest.version !== packageJson.version) {
    errors.push(
      `manifest version ${String(manifest.version)} does not match package version ${packageJson.version}`,
    );
  }

  manifestPath(files, errors, manifest.background?.service_worker, 'background service worker');

  const sidepanelPath = manifestPath(
    files,
    errors,
    manifest.side_panel?.default_path,
    'sidepanel HTML',
  );
  if (sidepanelPath) {
    const sidepanel = Buffer.from(files.get(sidepanelPath)).toString('utf8');
    if (!inspectHtml(sidepanel).hasMountRoot) {
      errors.push(`sidepanel HTML ${sidepanelPath} is missing mount root #app`);
    }
  }

  const icons = manifest.icons;
  if (
    !icons ||
    typeof icons !== 'object' ||
    Array.isArray(icons) ||
    Object.keys(icons).length === 0
  ) {
    errors.push('manifest icons are missing');
  } else {
    for (const [size, iconPath] of Object.entries(icons)) {
      manifestPath(files, errors, iconPath, `icon ${size}`);
    }
  }

  if (!Array.isArray(manifest.content_scripts) || manifest.content_scripts.length === 0) {
    errors.push('manifest content scripts are missing');
  } else {
    manifest.content_scripts.forEach((contentScript, index) => {
      if (!Array.isArray(contentScript.js) || contentScript.js.length === 0) {
        errors.push(`content script ${index + 1} JavaScript is missing from manifest.json`);
      } else {
        contentScript.js.forEach((scriptPath) =>
          manifestPath(files, errors, scriptPath, `content script ${index + 1} JavaScript`),
        );
      }
      if (contentScript.css !== undefined && !Array.isArray(contentScript.css)) {
        errors.push(`content script ${index + 1} CSS must be an array`);
      } else {
        contentScript.css?.forEach((stylePath) =>
          manifestPath(files, errors, stylePath, `content script ${index + 1} CSS`),
        );
      }
    });
  }

  for (const [index, resourceGroup] of (manifest.web_accessible_resources ?? []).entries()) {
    if (!Array.isArray(resourceGroup.resources)) continue;
    resourceGroup.resources.forEach((resourcePath) =>
      manifestPath(files, errors, resourcePath, `web accessible resource group ${index + 1}`),
    );
  }
}

export async function validateExtensionArtifact({ distDir, packageJsonPath }) {
  if (!distDir || !packageJsonPath) {
    throw new TypeError('distDir and packageJsonPath are required');
  }

  let files;
  try {
    files = await collectFiles(distDir);
  } catch (error) {
    if (error instanceof ExtensionArtifactError) throw error;
    throw new ExtensionArtifactError([
      `cannot read dist directory ${path.resolve(distDir)}: ${error instanceof Error ? error.message : String(error)}`,
    ]);
  }

  const errors = [];
  const manifestBytes = files.get('manifest.json');
  if (!manifestBytes) errors.push('manifest.json is missing at archive root');

  let packageBytes;
  try {
    packageBytes = await readFile(packageJsonPath);
  } catch (error) {
    errors.push(
      `cannot read package.json: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const manifest = manifestBytes ? parseJson(manifestBytes, 'manifest.json', errors) : null;
  const packageJson = packageBytes ? parseJson(packageBytes, 'package.json', errors) : null;
  validateManifest(manifest, packageJson, files, errors);
  validateFileReferences(files, errors);

  if (errors.length > 0) throw new ExtensionArtifactError([...new Set(errors)]);
  return { distDir: path.resolve(distDir), files, manifest, packageJson };
}

export function verifyExtensionArchive(archiveBytes, expectedFiles) {
  const unpacked = unzipSync(archiveBytes);
  const archiveEntries = Object.keys(unpacked);

  const collision = findWindowsPathCollision(archiveEntries);
  if (collision) {
    throw new ExtensionArtifactError([
      `Windows path collision: ${collision[0]} conflicts with ${collision[1]}`,
    ]);
  }

  for (const entryPath of archiveEntries) {
    if (unsafeArchiveEntry(entryPath)) {
      throw new ExtensionArtifactError([`unsafe archive entry ${entryPath}`]);
    }
  }

  const expectedEntries = [...expectedFiles.keys()].sort(compareArchivePaths);
  if (archiveEntries.length !== expectedEntries.length) {
    throw new ExtensionArtifactError([
      `archive entry count ${archiveEntries.length} does not match dist file count ${expectedEntries.length}`,
    ]);
  }

  archiveEntries.forEach((entryPath, index) => {
    if (entryPath !== expectedEntries[index]) {
      throw new ExtensionArtifactError([
        `archive order/content mismatch at ${entryPath}; expected ${expectedEntries[index]}`,
      ]);
    }
    const expected = expectedFiles.get(entryPath);
    if (!expected || !Buffer.from(unpacked[entryPath]).equals(Buffer.from(expected))) {
      throw new ExtensionArtifactError([`archive bytes differ for ${entryPath}`]);
    }
  });

  if (!Object.prototype.hasOwnProperty.call(unpacked, 'manifest.json')) {
    throw new ExtensionArtifactError(['manifest.json is missing at archive root']);
  }
  return unpacked;
}

export async function packageExtensionArtifact(options) {
  const validated = await validateExtensionArtifact(options);
  const version = validated.packageJson.version;
  const releaseDir = path.resolve(path.dirname(path.resolve(options.packageJsonPath)), 'release');
  const outputFile = path.resolve(
    options.outputFile ?? path.join(releaseDir, `lodestar-v${version}.zip`),
  );
  if (outputFile === releaseDir || isOutside(releaseDir, outputFile)) {
    throw new ExtensionArtifactError([
      `archive output ${outputFile} resolves outside release directory ${releaseDir}`,
    ]);
  }
  const zippable = Object.fromEntries(
    [...validated.files].map(([entryPath, bytes]) => [
      entryPath,
      [bytes, { level: 9, mtime: ZIP_MTIME, os: 3, attrs: 0o644 << 16 }],
    ]),
  );
  const archiveBytes = zipSync(zippable, { level: 9, mtime: ZIP_MTIME });

  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, archiveBytes);
  const persistedBytes = await readFile(outputFile);
  verifyExtensionArchive(persistedBytes, validated.files);

  return {
    archivePath: outputFile,
    sha256: createHash('sha256').update(persistedBytes).digest('hex'),
    size: persistedBytes.byteLength,
    entries: validated.files.size,
    version,
  };
}
