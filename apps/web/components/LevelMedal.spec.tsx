import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import LevelMedal, { LEVEL_MEDAL_COLORS } from './LevelMedal';
import PortalHeadline from './PortalHeadline';

describe('LevelMedal', () => {
  it('gives each level its own colour and is hidden from screen readers', () => {
    const fills = new Set(Object.values(LEVEL_MEDAL_COLORS).map((c) => c.fill));
    expect(fills.size).toBe(4);
    const { container } = render(<LevelMedal level="L3" />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('data-level', 'L3');
    expect(svg.querySelector('circle')).toHaveAttribute('fill', LEVEL_MEDAL_COLORS.L3.fill);
  });
});

describe('PortalHeadline', () => {
  it('shows the section, the promise and the verified tag', () => {
    render(<PortalHeadline eyebrow="Dashboard" title="Hire verified AI talent" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Hire verified AI talent' })).toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Skills verified through timed assessments and AI discussions')).toBeInTheDocument();
  });
});
