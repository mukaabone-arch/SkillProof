import '@testing-library/jest-dom';
import { act, render, screen, fireEvent } from '@testing-library/react';
import SignedOutNotice from './SignedOutNotice';

describe('SignedOutNotice', () => {
  afterEach(() => {
    jest.useRealTimers();
    window.history.replaceState(null, '', '/');
  });

  it('shows after a log-out, removes the flag from the URL, and hides itself', () => {
    jest.useFakeTimers();
    window.history.replaceState(null, '', '/?signedOut=1#top');
    render(<SignedOutNotice />);

    expect(screen.getByRole('status')).toHaveTextContent('You’ve signed out.');
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('#top');

    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('can be dismissed', () => {
    window.history.replaceState(null, '', '/?signedOut=1');
    render(<SignedOutNotice />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows nothing on a normal visit', () => {
    window.history.replaceState(null, '', '/');
    render(<SignedOutNotice />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
