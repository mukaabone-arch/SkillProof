import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import '../globals.css';
import Providers from '@/components/Providers';
import { isRtl, routing } from '@/i18n/routing';
import { SITE_ORIGIN } from '@/lib/localeMetadata';

/**
 * CookieYes banner, per deployment: each regional site registers its own
 * domain with CookieYes, so the client ID is a setting. Defaults to the
 * India site's ID; set NEXT_PUBLIC_COOKIEYES_ID to an empty string to turn
 * the banner off (e.g. local/staging builds).
 */
const COOKIEYES_ID = process.env.NEXT_PUBLIC_COOKIEYES_ID ?? 'fb4b1396aab9594ab00e0947661663fa';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: 'MyAmbii — Verified AI talent',
  description: 'Take rigorous AI-skill assessments, earn verified badges, get matched.',
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params: { locale },
}: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  if (!routing.locales.includes(locale as (typeof routing.locales)[number])) notFound();
  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <html lang={locale} dir={isRtl(locale) ? 'rtl' : 'ltr'}>
      <head>
        {/* Start cookieyes banner — first in <head> so it loads before anything that sets cookies */}
        {COOKIEYES_ID && (
          // eslint-disable-next-line @next/next/no-sync-scripts
          <script id="cookieyes" type="text/javascript" src={`https://cdn-cookieyes.com/client_data/${COOKIEYES_ID}/script.js`} />
        )}
        {/* End cookieyes banner */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* One font set per locale, never both: Arabic visitors don't pay for
            Space Grotesk/Inter (no Arabic glyphs anyway), English visitors
            don't pay for Plex Arabic. IBM Plex Sans Arabic carries Latin
            glyphs of its own, so Latin terms inside Arabic sentences (skill
            names, org codes) render in a face that pairs with the Arabic.
            globals.css binds it behind --font-display/--font-body under
            :root[lang='ar']. */}
        <link
          href={
            locale === 'ar'
              ? 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap'
              : 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap'
          }
          rel="stylesheet"
        />
      </head>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
