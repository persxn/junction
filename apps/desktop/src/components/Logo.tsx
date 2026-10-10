export interface LogoProps {
  /** Rendered width and height in px. */
  readonly size?: number;
  readonly className?: string;
}

/**
 * The Junction mark: three routes (students, teams, events) meeting at one
 * junction and running on as one. It is artwork, not UI colour, so its fills are
 * the fixed brand values from `resources/brand/junction-logo.svg` rather than
 * theme tokens — the mark looks the same in every flavour, like the window icon.
 * Decorative: the product name always sits next to it as text.
 */
export function Logo({ size = 24, className }: LogoProps): React.JSX.Element {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 1024 1024"
      className={className}
    >
      <rect x="40" y="40" width="944" height="944" rx="220" fill="#1e1e2e" />
      <g fill="none" strokeLinecap="round" strokeWidth="96">
        <path d="M200 280 C 360 280, 400 512, 500 512" stroke="#cba6f7" />
        <path d="M200 744 C 360 744, 400 512, 500 512" stroke="#94e2d5" />
        <path d="M200 512 L 500 512" stroke="#89b4fa" />
        <path d="M520 512 L 824 512" stroke="#f5c2e7" />
      </g>
      <circle cx="520" cy="512" r="108" fill="#f5e0dc" />
      <circle cx="520" cy="512" r="52" fill="#1e1e2e" />
    </svg>
  );
}
