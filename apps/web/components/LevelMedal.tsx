/**
 * Medal icon for a verified skill level, shown before the skill name on
 * employer and recruiter screens so the level reads at a glance. One colour
 * per level (brand teal, purple, amber, indigo); the level is always also
 * written out beside it, so colour is never the only signal. Decorative:
 * hidden from screen readers, which read the text next to it.
 */
import { skillLevelName } from '@/lib/skillLevels';

export const LEVEL_MEDAL_COLORS: Record<string, { ring: string; fill: string; ribbon: string }> = {
  L1: { ring: '#1f8a7c', fill: '#4fc2b0', ribbon: '#2a9d8f' }, // Foundational: teal
  L2: { ring: '#5847c2', fill: '#8b7cf0', ribbon: '#6a5ad8' }, // Practitioner: purple
  L3: { ring: '#b0711f', fill: '#e2a54f', ribbon: '#c98a35' }, // Advanced: amber
  L4: { ring: '#2d2a6e', fill: '#5146b8', ribbon: '#3b358f' }, // Expert: deep indigo
};

export default function LevelMedal({ level, size = '1.45em' }: { level: string; size?: string }) {
  const c = LEVEL_MEDAL_COLORS[level] ?? LEVEL_MEDAL_COLORS.L1;
  const expert = level === 'L4';
  return (
    <svg
      className="level-medal"
      data-level={level}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <title>{skillLevelName(level)}</title>
      {/* ribbon tails */}
      <path d="M7 13 L4.5 22 L8.5 20 L10.5 23 L12 15 Z" fill={c.ribbon} />
      <path d="M17 13 L19.5 22 L15.5 20 L13.5 23 L12 15 Z" fill={c.ribbon} />
      {/* medal */}
      <circle cx="12" cy="9.5" r="7.5" fill={c.fill} stroke={c.ring} strokeWidth="1.6" />
      {expert ? (
        <path d="M12 5.2 L13.3 8.1 L16.4 8.4 L14.1 10.5 L14.8 13.6 L12 12 L9.2 13.6 L9.9 10.5 L7.6 8.4 L10.7 8.1 Z" fill="#fff" />
      ) : (
        <path d="M8.6 9.7 L11 12 L15.6 7.4" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}
