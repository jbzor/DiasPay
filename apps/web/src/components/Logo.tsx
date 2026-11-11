/** Logo du bureau de contrôle (maquette) : carré vert, modules de QR jaunes et coche rouge. Décoratif. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true" focusable="false" className="logo">
      <rect width="28" height="28" rx="7" className="logo-bg" />
      <rect x="5.5" y="5.5" width="6" height="6" rx="1.2" className="logo-mod" />
      <rect x="16.5" y="5.5" width="6" height="6" rx="1.2" className="logo-mod" />
      <rect x="5.5" y="16.5" width="6" height="6" rx="1.2" className="logo-mod" />
      <circle cx="19.5" cy="19.5" r="4" className="logo-check-bg" />
      <path d="M17.6 19.6l1.3 1.3 2.4-2.6" className="logo-check" />
    </svg>
  );
}
