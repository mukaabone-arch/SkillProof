/**
 * flair future Intelligence mark — inlined (not next/image) since next/image's
 * optimizer doesn't process local SVGs without extra config, and this file
 * has no embedded scripts to worry about. The dark rounded panel is baked
 * into the artwork itself (public/logo.svg) — it's the logo's own chip, not
 * something we wrap it in. Size purely via CSS on the wrapping className
 * (width omitted here on purpose so it scales with height, preserving
 * viewBox aspect ratio).
 */
interface Props {
  className?: string;
}

export default function Logo({ className }: Props) {
  return (
    <svg
      className={className}
      viewBox="150 70 380 60"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="flair future Intelligence"
    >
      <rect x="150" y="70" width="380" height="60" rx="12" fill="#0f1115" />
      <text x="170" y="110" fontFamily="Arial, Helvetica, sans-serif" fontSize="30" fontWeight="700">
        <tspan fill="#ffffff">fl</tspan>
        <tspan fill="var(--brand-purple, #8b5cf6)">AI</tspan>
        <tspan fill="#ffffff">r future </tspan>
        <tspan fill="var(--brand-green, #22c55e)">Intelligence</tspan>
      </text>
    </svg>
  );
}
