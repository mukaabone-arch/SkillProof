import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = 'https://www.myambii.com';
  return ['', '/candidate', '/employer', '/faq', '/contact', '/privacy', '/terms', '/refunds']
    .map((path) => ({ url: `${base}${path}`, lastModified: new Date() }));
}