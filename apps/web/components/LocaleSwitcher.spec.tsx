import '@testing-library/jest-dom';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithIntl } from '../test-utils/renderWithIntl';
import ar from '../messages/ar.json';
import LocaleSwitcher from './LocaleSwitcher';

let pathname = '/';
jest.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useParams: () => ({}),
}));

beforeEach(() => {
  pathname = '/';
  document.cookie = 'NEXT_LOCALE=; path=/; max-age=0';
});

describe('LocaleSwitcher', () => {
  it('on English, links to the Arabic prefix, labelled in Arabic', () => {
    renderWithIntl(<LocaleSwitcher />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/ar');
    expect(link).toHaveAttribute('hreflang', 'ar');
    expect(link).toHaveTextContent('العربية');
  });

  it('on Arabic, links back to the unprefixed English URL and preserves the path', () => {
    pathname = '/ar/faq';
    renderWithIntl(<LocaleSwitcher />, { locale: 'ar', messages: ar });
    expect(screen.getByRole('link')).toHaveAttribute('href', '/faq');
  });

  it('remembers the choice in the NEXT_LOCALE cookie when clicked', () => {
    renderWithIntl(<LocaleSwitcher />);
    fireEvent.click(screen.getByRole('link'));
    expect(document.cookie).toContain('NEXT_LOCALE=ar');
  });
});
