import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

/**
 * Locale-aware Link / usePathname / useRouter. Only components on localised
 * surfaces use these (usePathname strips the locale prefix). Everything
 * else keeps next/link and next/navigation, whose unprefixed hrefs are
 * exactly the English URLs.
 */
export const { Link, usePathname, useRouter } = createNavigation(routing);

/*
 * Why usePathname must come from here even on English-only pages: middleware
 * rewrites the unprefixed English URL (`/employer`) to `/en/employer`, and
 * next/navigation's usePathname reports the REWRITTEN path during server
 * rendering but the browser's path (`/employer`) on the client. Any
 * component that branches on it (route allow-lists, exempt prefixes) then
 * renders differently on the server than on hydration. next-intl's version
 * strips the locale prefix in both places, so both sides agree. Import
 * usePathname from '@/i18n/navigation', never from 'next/navigation'.
 */
