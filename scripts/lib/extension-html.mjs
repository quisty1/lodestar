import { JSDOM } from 'jsdom';

const NON_MOUNTABLE_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'script',
  'source',
  'style',
  'template',
  'track',
  'wbr',
]);

function srcsetReferences(value) {
  const references = [];
  let cursor = 0;

  while (cursor < value.length) {
    while (/[\s,]/.test(value[cursor] ?? '')) cursor += 1;
    if (cursor >= value.length) break;

    const start = cursor;
    const isDataUrl = value.slice(cursor, cursor + 5).toLowerCase() === 'data:';
    while (
      cursor < value.length &&
      !/\s/.test(value[cursor]) &&
      (isDataUrl || value[cursor] !== ',')
    ) {
      cursor += 1;
    }

    const reference = value.slice(start, cursor).replace(/,+$/, '');
    if (reference) references.push(reference);

    while (cursor < value.length && value[cursor] !== ',') cursor += 1;
    if (value[cursor] === ',') cursor += 1;
  }

  return references;
}

function collectReferences(root, references) {
  for (const element of root.querySelectorAll('[src], [href], [poster]')) {
    for (const attribute of ['src', 'href', 'poster']) {
      if (element.hasAttribute(attribute)) references.add(element.getAttribute(attribute));
    }
  }
  for (const element of root.querySelectorAll('[srcset]')) {
    for (const reference of srcsetReferences(element.getAttribute('srcset') ?? '')) {
      references.add(reference);
    }
  }
  for (const template of root.querySelectorAll('template')) {
    collectReferences(template.content, references);
  }
}

export function inspectHtml(source) {
  const dom = new JSDOM(source);
  try {
    const { document } = dom.window;
    const references = new Set();
    collectReferences(document, references);

    const mountRoot = [...document.body.querySelectorAll('[id]')].find(
      (element) =>
        element.getAttribute('id') === 'app' &&
        !element.closest('template') &&
        !NON_MOUNTABLE_ELEMENTS.has(element.localName),
    );

    return { hasMountRoot: Boolean(mountRoot), references: [...references] };
  } finally {
    dom.window.close();
  }
}
