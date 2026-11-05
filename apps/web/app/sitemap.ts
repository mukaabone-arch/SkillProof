import type { MetadataRoute } from 'next';
import { SITE_ORIGIN } from '@/lib/localeMetadata';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = SITE_ORIGIN;
  return ['', '/candidate', '/employer', '/staffing', '/faq', '/contact', '/privacy', '/terms', '/refunds']
    .map((path) => ({ url: `${base}${path}`, lastModified: new Date() }));
}