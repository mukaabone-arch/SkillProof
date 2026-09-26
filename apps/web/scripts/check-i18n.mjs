#!/usr/bin/env node
/**
 * Catalog drift check: fails when messages/ar.json has fallen out of step
 * with messages/en.json. Wired into CI (.github/workflows/ci.yml) ahead of
 * the build. English is the source of truth; every rule below is about Arabic
 * silently rotting as English copy changes.
 *
 * Fails on:
 *  1. MISSING  — a key in en.json with no (or an empty) value in ar.json.
 *  2. ORPHAN   — a key in ar.json that en.json no longer has.
 *  3. UNTOUCHED — ar value identical to the en value and containing real
 *     English words (after removing {placeholders}, <tags> and brand names).
 *     A key that is legitimately identical (an autonym like "English") goes
 *     in messages/untranslated-ok.json.
 *  4. PLACEHOLDERS — ar uses a different set of {vars}/<tags> than en.
 *  5. STALE    — the en value changed since ar was last reviewed. Each key's
 *     en value is fingerprinted in messages/ar.sources.json; editing English
 *     copy without touching that fingerprint fails here, so "changed the
 *     English, forgot Arabic" cannot merge. After updating the Arabic, run
 *     `npm run i18n:sync` to record the new fingerprints (the diff shows
 *     exactly which keys you are vouching for).
 *
 * Usage: node scripts/check-i18n.mjs [--dir <messages dir>] [--update]
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BRAND_TOKENS = ['flAIr future Intelligence', 'Mukaab Technologies Private Limited', 'MyAmbii', 'Google Analytics'];

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') flatten(v, key, out);
    else out[key] = String(v);
  }
  return out;
}

const fingerprint = (s) => createHash('sha1').update(s).digest('hex').slice(0, 10);

function placeholders(s) {
  const vars = [...s.matchAll(/\{\s*([A-Za-z_][\w]*)/g)].map((m) => `{${m[1]}}`);
  const tags = [...s.matchAll(/<\/?([A-Za-z][\w]*)/g)].map((m) => `<${m[1]}>`);
  return [...new Set([...vars, ...tags])].sort().join(' ');
}

function hasEnglishWords(s) {
  let t = s.replace(/\{[^}]*\}/g, ' ').replace(/<\/?[A-Za-z][^>]*>/g, ' ');
  for (const brand of BRAND_TOKENS) t = t.split(brand).join(' ');
  return /[A-Za-z]{2,}/.test(t);
}

export function checkCatalogs({ en, ar, allow = [], sources = {} }) {
  const errors = [];
  const E = flatten(en);
  const A = flatten(ar);
  for (const [key, value] of Object.entries(E)) {
    const a = A[key];
    if (a === undefined || a.trim() === '') {
      errors.push(`MISSING      ${key}`);
      continue;
    }
    if (a === value && hasEnglishWords(value) && !allow.includes(key)) {
      errors.push(`UNTOUCHED    ${key}  (ar is identical to en; translate it, or list it in untranslated-ok.json if it should match)`);
    }
    if (placeholders(a) !== placeholders(value)) {
      errors.push(`PLACEHOLDERS ${key}  (en: ${placeholders(value) || 'none'} | ar: ${placeholders(a) || 'none'})`);
    }
    if (sources[key] !== fingerprint(value)) {
      errors.push(
        sources[key] === undefined
          ? `UNREVIEWED   ${key}  (no fingerprint in ar.sources.json — run npm run i18n:sync once ar is reviewed)`
          : `STALE        ${key}  (en changed since ar was last reviewed — update ar, then npm run i18n:sync)`,
      );
    }
  }
  for (const key of Object.keys(A)) if (!(key in E)) errors.push(`ORPHAN       ${key}  (in ar.json, not in en.json)`);
  for (const key of Object.keys(sources)) if (!(key in E)) errors.push(`ORPHAN       ${key}  (in ar.sources.json, not in en.json)`);
  return errors;
}

export function fingerprints(en) {
  return Object.fromEntries(Object.entries(flatten(en)).map(([k, v]) => [k, fingerprint(v)]));
}

function main() {
  const args = process.argv.slice(2);
  const dirIdx = args.indexOf('--dir');
  const dir = dirIdx >= 0 ? resolve(args[dirIdx + 1]) : join(dirname(fileURLToPath(import.meta.url)), '..', 'messages');
  const read = (name, fallback) => (existsSync(join(dir, name)) ? JSON.parse(readFileSync(join(dir, name), 'utf8')) : fallback);
  const en = read('en.json');
  const ar = read('ar.json');

  if (args.includes('--update')) {
    writeFileSync(join(dir, 'ar.sources.json'), JSON.stringify(fingerprints(en), null, 2) + '\n');
    console.log('i18n: wrote ar.sources.json');
    return;
  }

  const errors = checkCatalogs({ en, ar, allow: read('untranslated-ok.json', []), sources: read('ar.sources.json', {}) });
  if (errors.length) {
    console.error(`i18n: ar.json is out of step with en.json (${errors.length} problem${errors.length === 1 ? '' : 's'}):\n`);
    for (const e of errors) console.error('  ' + e);
    process.exit(1);
  }
  console.log(`i18n: ar.json matches en.json (${Object.keys(flatten(en)).length} keys)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
