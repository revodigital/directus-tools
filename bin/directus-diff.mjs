#!/usr/bin/env node
/**
 * directus-diff
 * Semantic diff of two Directus snapshot YAML files.
 * Ignores: key order, item order in arrays, YAML formatting.
 * Shows only actual value/field differences (e.g. new options set in the GUI).
 *
 * Usage:
 *   directus-diff [repo.yaml] [export.yaml]
 *
 * Defaults (resolved from cwd):
 *   snapshots/snapshot.yaml  vs  snapshots/snapshot-export.yaml
 */

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

// Load yaml — bundled as a dependency
const require = createRequire(import.meta.url);
let yaml;
try {
  yaml = require('yaml');
} catch {
  console.error('Missing dependency: yaml. Run "npm install" in the package directory.');
  process.exit(1);
}

const repoPath   = path.resolve(process.cwd(), process.argv[2] || 'snapshots/snapshot.yaml');
const exportPath = path.resolve(process.cwd(), process.argv[3] || 'snapshots/snapshot-export.yaml');

function sortObjectKeys(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sortObjectKeys);
  return Object.keys(obj)
    .sort()
    .reduce((acc, k) => {
      acc[k] = sortObjectKeys(obj[k]);
      return acc;
    }, {});
}

function identityKey(item, context) {
  if (!item || typeof item !== 'object') return String(item);
  if (context === 'collections') return item.schema?.name ?? item.meta?.collection ?? JSON.stringify(item);
  if (context === 'fields') return `${item.collection ?? ''}\t${item.field ?? ''}`;
  if (context === 'relations') return `${item.collection ?? ''}\t${item.field ?? ''}\t${item.meta?.many_collection ?? ''}\t${item.meta?.many_field ?? ''}`;
  return JSON.stringify(item);
}

function sortTopLevelArrays(doc) {
  const out = { ...doc };
  if (Array.isArray(out.collections)) {
    out.collections = [...out.collections].sort((a, b) =>
      identityKey(a, 'collections').localeCompare(identityKey(b, 'collections'))
    );
  }
  if (Array.isArray(out.fields)) {
    out.fields = [...out.fields].sort((a, b) =>
      identityKey(a, 'fields').localeCompare(identityKey(b, 'fields'))
    );
  }
  if (Array.isArray(out.relations)) {
    out.relations = [...out.relations].sort((a, b) =>
      identityKey(a, 'relations').localeCompare(identityKey(b, 'relations'))
    );
  }
  return out;
}

function normalizeChoicesInPlace(obj) {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    obj.forEach(normalizeChoicesInPlace);
    return;
  }
  for (const key of Object.keys(obj)) {
    if (key === 'choices' && Array.isArray(obj[key])) {
      obj[key].sort((a, b) => String(a?.value ?? a).localeCompare(String(b?.value ?? b)));
    } else {
      normalizeChoicesInPlace(obj[key]);
    }
  }
}

function normalize(doc) {
  const withSortedArrays = sortTopLevelArrays(doc);
  normalizeChoicesInPlace(withSortedArrays);
  return sortObjectKeys(withSortedArrays);
}

function load(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  return yaml.parse(raw);
}

function deepDiff(a, b, path = '') {
  const diffs = [];
  if (a === b) return diffs;
  if (typeof a !== typeof b) {
    diffs.push({ path, repo: a, export: b });
    return diffs;
  }
  if (a === null || b === null || typeof a !== 'object') {
    if (a !== b) diffs.push({ path, repo: a, export: b });
    return diffs;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const arrayContext = path === 'collections' ? 'collections' : path === 'fields' ? 'fields' : path === 'relations' ? 'relations' : null;
    if (arrayContext) {
      const mapA = new Map(a.map((item) => [identityKey(item, arrayContext), item]));
      const mapB = new Map(b.map((item) => [identityKey(item, arrayContext), item]));
      const allKeys = new Set([...mapA.keys(), ...mapB.keys()]);
      for (const id of [...allKeys].sort()) {
        const p = `${path}[${id.replace(/\t/g, '.')}]`;
        if (!mapA.has(id)) diffs.push({ path: p, repo: undefined, export: mapB.get(id) });
        else if (!mapB.has(id)) diffs.push({ path: p, repo: mapA.get(id), export: undefined });
        else diffs.push(...deepDiff(mapA.get(id), mapB.get(id), p));
      }
      return diffs;
    }
    if (a.length !== b.length) {
      diffs.push({ path, repo: `[${a.length} items]`, export: `[${b.length} items]` });
      return diffs;
    }
    for (let i = 0; i < a.length; i++) {
      diffs.push(...deepDiff(a[i], b[i], path ? `${path}[${i}]` : `[${i}]`));
    }
    return diffs;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    const p = path ? `${path}.${k}` : k;
    if (!(k in a)) {
      diffs.push({ path: p, repo: undefined, export: b[k] });
    } else if (!(k in b)) {
      diffs.push({ path: p, repo: a[k], export: undefined });
    } else {
      diffs.push(...deepDiff(a[k], b[k], p));
    }
  }
  return diffs;
}

const repoDoc   = load(repoPath);
const exportDoc = load(exportPath);

const repoNorm   = normalize(repoDoc);
const exportNorm = normalize(exportDoc);

const diffs = deepDiff(repoNorm, exportNorm);

if (diffs.length === 0) {
  console.log('No semantic differences (only ordering/formatting).');
  process.exit(0);
}

console.log('Semantic differences (export vs repo):\n');
for (const d of diffs) {
  if (d.repo === undefined) {
    console.log(`  + ${d.path}`);
    console.log(`      export: ${JSON.stringify(d.export)}`);
  } else if (d.export === undefined) {
    console.log(`  - ${d.path}`);
    console.log(`      repo:   ${JSON.stringify(d.repo)}`);
  } else {
    console.log(`  ~ ${d.path}`);
    console.log(`      repo:   ${JSON.stringify(d.repo)}`);
    console.log(`      export: ${JSON.stringify(d.export)}`);
  }
  console.log('');
}

process.exit(1);
