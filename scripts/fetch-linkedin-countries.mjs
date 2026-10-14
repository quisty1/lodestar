/**
 * One-shot catalog builder. Queries LinkedIn's public geo typeahead for each
 * ISO 3166 country and keeps the country hit (display name has no comma).
 * Writes src/lib/connect/countries.json. Not used at runtime.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import https from 'node:https';

const agent = new https.Agent({ rejectUnauthorized: false });

const ALIASES = {
  AE: ['United Arab Emirates'],
  BO: ['Bolivia'],
  CD: ['Democratic Republic of the Congo', 'Congo'],
  CG: ['Republic of the Congo', 'Congo'],
  CI: ["Côte d'Ivoire", 'Ivory Coast'],
  CZ: ['Czechia', 'Czech Republic'],
  FK: ['Falkland Islands'],
  BS: ['The Bahamas'],
  CV: ['Cape Verde'],
  CW: ['Curacao'],
  FM: ['Federated States of Micronesia'],
  GM: ['The Gambia'],
  GS: ['South Georgia And South Sandwich Islands'],
  PS: ['Palestinian Authority'],
  RE: ['Reunion'],
  SH: ['Saint Helena, Ascension and Tristan da Cunha'],
  ST: ['São Tomé and Príncipe'],
  TF: ['French Southern and Antarctic Lands'],
  TR: ['Türkiye'],
  VA: ['Vatican City'],
  VG: ['British Virgin Islands'],
  VI: ['US Virgin Islands'],
  GB: ['United Kingdom'],
  IR: ['Iran'],
  KP: ['North Korea'],
  KR: ['South Korea'],
  LA: ['Laos'],
  MD: ['Moldova'],
  MK: ['North Macedonia'],
  RU: ['Russia'],
  SY: ['Syria'],
  TW: ['Taiwan'],
  TZ: ['Tanzania'],
  US: ['United States'],
  VE: ['Venezuela'],
  VN: ['Vietnam'],
  XK: ['Kosovo'],
};

const EXTRA = [{ iso: 'XK', name: 'Kosovo' }];

/** LinkedIn only returns this territory as "Western Sahara, Morocco". */
const FALLBACK = {
  EH: { iso: 'EH', geoUrn: '115461347', name: 'Western Sahara' },
};

const CHECKS = {
  DE: '101282230',
  US: '103644278',
  GE: '106315325',
  CY: '106774002',
  RS: '101855366',
  GB: '101165590',
  IN: '102713980',
  SG: '102454443',
  RU: '101728296',
};

function get(url) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          agent,
          headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () =>
            resolve({
              status: res.statusCode ?? 0,
              body: Buffer.concat(chunks).toString('utf8'),
            }),
          );
        },
      )
      .on('error', reject);
  });
}

function queriesFor(iso, name) {
  const base = [name, name.replace(/\s*\(.*\)/, '').trim(), name.split(',')[0].trim()];
  return [...new Set([...base, ...(ALIASES[iso] ?? [])].filter(Boolean))];
}

function norm(value) {
  return value.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/^the /, '').trim();
}

function pick(hits, queries) {
  const list = (hits ?? []).filter((h) => h.displayName);
  const exact = list.find((h) => queries.some((q) => norm(h.displayName) === norm(q)));
  if (exact) return exact;
  const bare = list.filter((h) => !h.displayName.includes(','));
  const soft = bare.find((h) =>
    queries.some((q) => {
      const a = norm(h.displayName);
      const b = norm(q);
      return a.startsWith(b) || b.startsWith(a);
    }),
  );
  if (soft) return soft;
  return list.find((h) => queries.some((q) => norm(h.displayName).startsWith(norm(q)))) ?? null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function typeahead(query) {
  const url =
    'https://www.linkedin.com/jobs-guest/api/typeaheadHits?typeaheadType=GEO&query=' +
    encodeURIComponent(query);
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const { status, body } = await get(url);
      if (status === 429 || status >= 500) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      return JSON.parse(body);
    } catch {
      await sleep(800 * (attempt + 1));
    }
  }
  return [];
}

async function resolveCountry(iso, name) {
  const queries = queriesFor(iso, name);
  const seen = new Map();
  for (const query of queries) {
    const hits = await typeahead(query);
    for (const hit of hits) seen.set(hit.id, hit);
    const chosen = pick(hits, queries);
    if (chosen) return { iso, geoUrn: String(chosen.id), name: chosen.displayName };
    await sleep(250);
  }
  const chosen = pick([...seen.values()], queries);
  return chosen ? { iso, geoUrn: String(chosen.id), name: chosen.displayName } : null;
}

const isoRes = await get(
  'https://raw.githubusercontent.com/lukes/ISO-3166-Countries-with-Regional-Codes/master/all/all.json',
);
const iso = [
  ...JSON.parse(isoRes.body).map((row) => ({
    iso: row['alpha-2'],
    name: row.name,
  })),
  ...EXTRA,
];
const outPath = new URL('../src/lib/connect/countries.json', import.meta.url);
const already = new Map(JSON.parse(readFileSync(outPath, 'utf8')).map((c) => [c.iso, c]));

const found = [...already.values()];
const missed = [];
const queue = iso.filter((row) => !already.has(row.iso));
const workers = Array.from({ length: 2 }, async () => {
  while (true) {
    const row = queue.shift();
    if (!row) return;
    await sleep(400);
    const country = await resolveCountry(row.iso, row.name);
    if (country) found.push(country);
    else if (FALLBACK[row.iso]) found.push(FALLBACK[row.iso]);
    else missed.push(`${row.iso} ${row.name}`);
    writeFileSync(
      outPath,
      JSON.stringify(
        [...found].sort((a, b) => a.iso.localeCompare(b.iso)),
        null,
        2,
      ) + '\n',
    );
    process.stderr.write(`${found.length + missed.length}/${iso.length} ${row.iso}\n`);
  }
});
await Promise.all(workers);

found.sort((a, b) => a.iso.localeCompare(b.iso));
const dupes = found.filter((c, i) => found.findIndex((x) => x.geoUrn === c.geoUrn) !== i);
const bad = Object.entries(CHECKS).filter(
  ([iso, urn]) => found.find((c) => c.iso === iso)?.geoUrn !== urn,
);

if (missed.length || dupes.length || bad.length) {
  console.error(JSON.stringify({ missed, dupes, bad }, null, 2));
  process.exitCode = 1;
}

writeFileSync(
  new URL('../src/lib/connect/countries.json', import.meta.url),
  JSON.stringify(found, null, 2) + '\n',
);
console.error(`wrote ${found.length} countries, missed ${missed.length}`);
