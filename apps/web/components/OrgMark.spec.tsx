import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import OrgMark from './OrgMark';

describe('OrgMark', () => {
  it('renders the logo image when one is given', () => {
    render(<OrgMark name="Acme Robotics" logoUrl="blob:fake-logo" />);

    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', 'blob:fake-logo');
  });

  it('renders initials, not a broken image, when there is no logo', () => {
    render(<OrgMark name="Acme Robotics" logoUrl={null} />);

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('AR')).toBeInTheDocument();
  });

  it('falls back to "?" for a name with nothing usable', () => {
    render(<OrgMark name="   " logoUrl={null} />);
    expect(screen.getByText('?')).toBeInTheDocument();
  });
});
