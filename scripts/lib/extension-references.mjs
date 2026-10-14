import path from 'node:path';
import { caseFold } from 'unicode-case-folding';

import { inspectHtml } from './extension-html.mjs';

const TEXT_EXTENSIONS = new Set(['.css', '.html', '.htm', '.js', '.json', '.mjs']);
const EXTERNAL_PROTOCOL = /^(?:data|https?|mailto|tel|chrome-extension):/i;
const WINDOWS_ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|\\\\)/;
const POSIX_FILESYSTEM_PATH = /^\/(?:Users|home|mnt|private|root|tmp|var|etc|opt)(?:\/|$)/i;
const DEVELOPMENT_ARTIFACT =
  /(?:\/@vite\/client|@vite\/client|\/@react-refresh|react-refresh\/runtime|__vite__injectQuery|(?:(?:https?|wss?):)?\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?|(?:^|["'`()\s\\/])node_modules[\\/])/i;
const ABSOLUTE_FILESYSTEM_REFERENCE =
  /(?:file:\/\/|(?:^|["'`()\s])[A-Za-z]:[\\/]|\/(?:Users|home|mnt|private|root|tmp|var|etc|opt)\/)/i;

export function compareArchivePaths(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function windowsPathKey(filePath) {
  return caseFold(filePath.normalize('NFC'));
}

export function findWindowsPathCollision(filePaths) {
  const seen = new Map();
  for (const filePath of filePaths) {
    const key = windowsPathKey(filePath);
    const existing = seen.get(key);
    if (existing !== undefined && existing !== filePath) return [existing, filePath];
    seen.set(key, filePath);
  }
  return null;
}

function exactFile(files, requestedPath, label, errors) {
  if (files.has(requestedPath)) return requestedPath;

  const requestedComparable = windowsPathKey(requestedPath);
  const actual = [...files.keys()].find(
    (filePath) => windowsPathKey(filePath) === requestedComparable,
  );
  if (actual) {
    errors.push(`${label}: exact-case mismatch, requested ${requestedPath}, actual ${actual}`);
  } else {
    errors.push(`${label}: ${requestedPath} is missing`);
  }
  return null;
}

function withoutQueryOrHash(reference) {
  return reference.split('#', 1)[0].split('?', 1)[0];
}

export function resolveLocalReference(owner, rawReference, label, files, errors) {
  const reference = rawReference.trim();
  if (
    !reference ||
    reference.startsWith('#') ||
    EXTERNAL_PROTOCOL.test(reference) ||
    reference.startsWith('//')
  ) {
    return null;
  }

  if (
    WINDOWS_ABSOLUTE_PATH.test(reference) ||
    POSIX_FILESYSTEM_PATH.test(reference) ||
    reference.startsWith('file:')
  ) {
    errors.push(`${label} in ${owner}: absolute filesystem reference ${reference}`);
    return null;
  }

  const cleanReference = withoutQueryOrHash(reference).replaceAll('\\', '/');
  const fromRoot = cleanReference.startsWith('/');
  const candidate = path.posix.normalize(
    fromRoot ? cleanReference.slice(1) : path.posix.join(path.posix.dirname(owner), cleanReference),
  );

  if (
    !candidate ||
    candidate === '..' ||
    candidate.startsWith('../') ||
    path.posix.isAbsolute(candidate)
  ) {
    errors.push(`${label} in ${owner}: ${reference} escapes dist`);
    return null;
  }

  return exactFile(files, candidate, `${label} referenced by ${owner}`, errors);
}

function javascriptReferences(source) {
  const references = [];
  const patterns = [
    /(?:^|[;\n}])\s*(?:import|export)\s*(?:[^"'();\n]*?\bfrom\s*)?["']([^"']+)["']/gm,
    /\bimport\s*\(\s*(?:\/\*[\s\S]*?\*\/\s*)?["']([^"']+)["']/g,
    /\bnew\s+URL\s*\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source))) references.push(match[1]);
  }

  const extensionUrl = /\bchrome\.runtime\.getURL\s*\(\s*["']([^"']+)["']\s*\)/g;
  let match;
  while ((match = extensionUrl.exec(source))) {
    references.push(`/${match[1].replace(/^\/+/, '')}`);
  }
  return references;
}

function cssReferences(source) {
  const references = new Set();
  const url = /\burl\(\s*(?:"([^"]*)"|'([^']*)'|([^)'"\s][^)]*?))\s*\)/gi;
  let match;
  while ((match = url.exec(source))) references.add((match[1] ?? match[2] ?? match[3]).trim());

  const quotedImport = /@import\s+(?:"([^"]+)"|'([^']+)')/gi;
  while ((match = quotedImport.exec(source))) references.add(match[1] ?? match[2]);
  return [...references];
}

export function validateFileReferences(files, errors) {
  for (const [filePath, bytes] of files) {
    const extension = path.posix.extname(filePath).toLowerCase();
    if (!TEXT_EXTENSIONS.has(extension)) continue;

    const source = Buffer.from(bytes).toString('utf8');
    const forbidden =
      source.match(DEVELOPMENT_ARTIFACT) ?? source.match(ABSOLUTE_FILESYSTEM_REFERENCE);
    if (forbidden) {
      errors.push(
        `${filePath}: development artifact or absolute filesystem reference ${forbidden[0]}`,
      );
    }

    let references = [];
    let label = 'asset';
    if (extension === '.html' || extension === '.htm') {
      references = inspectHtml(source).references;
      label = 'HTML asset';
    } else if (extension === '.js' || extension === '.mjs') {
      references = javascriptReferences(source);
      label = 'JavaScript import';
    } else if (extension === '.css') {
      references = cssReferences(source);
      label = 'CSS URL';
    }

    for (const reference of references) {
      if (
        (extension === '.js' || extension === '.mjs') &&
        !reference.startsWith('.') &&
        !reference.startsWith('/')
      ) {
        if (!EXTERNAL_PROTOCOL.test(reference)) {
          errors.push(`${label} in ${filePath}: bare module ${reference} is not packaged`);
        }
        continue;
      }
      resolveLocalReference(filePath, reference, label, files, errors);
    }
  }
}

export function unsafeArchiveEntry(entryPath) {
  const normalized = entryPath.replaceAll('\\', '/');
  return (
    !entryPath ||
    entryPath.includes('\\') ||
    entryPath.startsWith('/') ||
    /^[A-Za-z]:/.test(entryPath) ||
    normalized.split('/').includes('..')
  );
}
