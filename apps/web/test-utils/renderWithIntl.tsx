import type { ReactElement } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl';
import en from '../messages/en.json';
import { MESSAGE_FORMATS } from '../lib/formatLocale';

/** RTL render wrapped in the next-intl provider, English catalog by default. */
export function renderWithIntl(ui: ReactElement, options?: Omit<RenderOptions, 'wrapper'> & { locale?: string; messages?: AbstractIntlMessages }) {
  const { locale = 'en', messages = en, ...rest } = options ?? {};
  return render(ui, {
    wrapper: ({ children }) => (
      <NextIntlClientProvider locale={locale} messages={messages} formats={MESSAGE_FORMATS}>
        {children}
      </NextIntlClientProvider>
    ),
    ...rest,
  });
}
