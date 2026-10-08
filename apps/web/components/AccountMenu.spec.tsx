/**
 * The shared account control itself — item rendering, open/close via
 * outside click and Escape, and that selecting an item closes the menu
 * too. Real React rendering (jsdom + RTL); nothing to mock here, the
 * component has no external dependencies.
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import AccountMenu from './AccountMenu';

function renderMenu() {
  return render(
    <AccountMenu
      label="Jordan Lee"
      initials="JL"
      items={[
        { label: 'Profile', href: '/profile' },
        { label: 'Account', href: '/profile/account' },
        { label: 'Log out', onClick: jest.fn() },
      ]}
    />,
  );
}

describe('AccountMenu', () => {
  it('is closed until the trigger is clicked, then shows the items', () => {
    renderMenu();

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Jordan Lee menu' }));

    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Profile' })).toHaveAttribute('href', '/profile');
    expect(screen.getByRole('menuitem', { name: 'Account' })).toHaveAttribute('href', '/profile/account');
    expect(screen.getByRole('menuitem', { name: 'Log out' })).toBeInTheDocument();
  });

  it('shows the initials on the trigger when given', () => {
    renderMenu();
    expect(screen.getByRole('button', { name: 'Jordan Lee menu' })).toHaveTextContent('JL');
  });

  it('closes on an outside click', () => {
    render(
      <div>
        <AccountMenu label="Account" items={[{ label: 'Log out', onClick: jest.fn() }]} />
        <button>elsewhere</button>
      </div>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole('button', { name: 'elsewhere' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes on Escape', () => {
    renderMenu();

    fireEvent.click(screen.getByRole('button', { name: 'Jordan Lee menu' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes after an item is activated, and runs its action', () => {
    const onLogout = jest.fn();
    render(<AccountMenu label="Account" items={[{ label: 'Log out', onClick: onLogout }]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Account menu' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Log out' }));

    expect(onLogout).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('falls back to a generic glyph when no initials are given', () => {
    render(<AccountMenu label="Account" items={[{ label: 'Log out', onClick: jest.fn() }]} />);
    const trigger = screen.getByRole('button', { name: 'Account menu' });
    expect(trigger).not.toHaveTextContent(/[A-Za-z]/);
    expect(trigger.querySelector('svg')).toBeInTheDocument();
  });
});
