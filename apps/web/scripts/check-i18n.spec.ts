/**
 * @jest-environment node
 *
 * Runs the real CLI (what CI runs) against throwaway catalog directories.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, 'check-i18n.mjs');

function run(dir: string, ...extra: string[]) {
  const r = spawnSync('node', [SCRIPT, '--dir', dir, ...extra], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

function setup(en: object, ar: object, allow: string[] = []) {
  const dir = mkdtempSync(join(tmpdir(), 'i18n-'));
  writeFileSync(join(dir, 'en.json'), JSON.stringify(en));
  writeFileSync(join(dir, 'ar.json'), JSON.stringify(ar));
  writeFileSync(join(dir, 'untranslated-ok.json'), JSON.stringify(allow));
  execFileSync('node', [SCRIPT, '--dir', dir, '--update']);
  return dir;
}

const EN = { a: { title: 'Hello world', body: 'Hi {name}, <b>welcome</b>' }, brand: 'MyAmbii', lang: 'English' };
const AR = { a: { title: 'مرحبا بالعالم', body: 'أهلا {name}، <b>مرحبا</b>' }, brand: 'MyAmbii', lang: 'English' };

describe('i18n drift check', () => {
  const dirs: string[] = [];
  const make = (...a: Parameters<typeof setup>) => {
    const d = setup(...a);
    dirs.push(d);
    return d;
  };
  afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

  it('passes when the catalogs are in step (brand-only and allow-listed values may be identical)', () => {
    expect(run(make(EN, AR, ['lang'])).code).toBe(0);
  });

  it('fails when a key is added to en.json alone', () => {
    const dir = make(EN, AR, ['lang']);
    writeFileSync(join(dir, 'en.json'), JSON.stringify({ ...EN, added: 'A new string' }));
    const r = run(dir);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/MISSING\s+added/);
  });

  it('fails when the ar value is just the English copied over', () => {
    const r = run(make(EN, { ...AR, a: { ...AR.a, title: 'Hello world' } }, ['lang']));
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/UNTOUCHED\s+a\.title/);
  });

  it('fails when English copy changes but the Arabic was not reviewed', () => {
    const dir = make(EN, AR, ['lang']);
    writeFileSync(join(dir, 'en.json'), JSON.stringify({ ...EN, a: { ...EN.a, title: 'Hello there world' } }));
    const r = run(dir);
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/STALE\s+a\.title/);
    // ...and passes again once the fingerprints are re-recorded after review.
    execFileSync('node', [SCRIPT, '--dir', dir, '--update']);
    expect(run(dir).code).toBe(0);
  });

  it('fails on placeholder/tag mismatches and orphan keys', () => {
    const r = run(make(EN, { ...AR, a: { ...AR.a, body: 'أهلا، مرحبا' }, extra: 'زائد' }, ['lang']));
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/PLACEHOLDERS\s+a\.body/);
    expect(r.out).toMatch(/ORPHAN\s+extra/);
  });

  it('passes for the real catalogs', () => {
    expect(run(join(__dirname, '..', 'messages')).code).toBe(0);
  });
});
