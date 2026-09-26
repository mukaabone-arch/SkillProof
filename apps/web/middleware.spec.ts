/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import middleware from './middleware';

const req = (path: string, headers: Record<string, string> = {}) =>
  new NextRequest(`https://www.myambii.com${path}`, { headers });

const location = (res: Response) => res.headers.get('location');
const rewrittenTo = (res: Response) => res.headers.get('x-middleware-rewrite');

describe('middleware (locale routing only)', () => {
  it('serves English unprefixed by rewrite — no redirect', () => {
    for (const path of ['/', '/employer', '/help/candidate']) {
      const res = middleware(req(path));
      expect(res.status).toBe(200);
      expect(location(res)).toBeNull();
      expect(rewrittenTo(res)).toContain(`/en${path === '/' ? '' : path}`);
    }
  });

  it('serves /ar without redirecting', () => {
    const res = middleware(req('/ar'));
    expect(location(res)).toBeNull();
    expect(rewrittenTo(res)).toContain('/ar');
  });

  it('does not act on Accept-Language (no automatic redirect on first visit)', () => {
    const res = middleware(req('/', { 'accept-language': 'ar-SA,ar;q=0.9' }));
    expect(location(res)).toBeNull();
    expect(rewrittenTo(res)).toContain('/en');
  });

  it('honours an explicit Arabic choice (NEXT_LOCALE cookie) on / ', () => {
    const res = middleware(req('/', { cookie: 'NEXT_LOCALE=ar' }));
    expect(res.status).toBe(307);
    expect(new URL(location(res)!).pathname).toBe('/ar');
  });

  it('leaves an English choice on /', () => {
    const res = middleware(req('/', { cookie: 'NEXT_LOCALE=en' }));
    expect(location(res)).toBeNull();
  });

  it('sends untranslated /ar/<path> to the English URL instead of English-in-RTL', () => {
    const res = middleware(req('/ar/employer/dashboard'));
    expect(res.status).toBe(307);
    expect(new URL(location(res)!).pathname).toBe('/employer/dashboard');
  });
});
