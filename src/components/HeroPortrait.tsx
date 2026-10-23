/**
 * Original flat-vector portrait for the marketing hero: a man standing with a
 * laptop, cropped at mid-thigh like a cut-out photograph.
 *
 * Drawn in markup rather than shipped as a raster so it stays crisp at any
 * density, carries no stock licence, and recolours with the brand.
 *
 * The viewBox is cropped tight to the figure so the component's box matches
 * what is actually painted, which keeps positioning in the hero predictable.
 *
 * If a licensed photograph is dropped at public/images/hero-person.png,
 * Landing renders that instead and this becomes the fallback.
 */
export const HeroPortrait = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 420 820"
    className={className}
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    role="presentation"
  >
    <defs>
      <linearGradient id="hp-skin" x1="0.2" y1="0" x2="0.9" y2="1">
        <stop offset="0%" stopColor="#8E5C39" />
        <stop offset="100%" stopColor="#6B4127" />
      </linearGradient>
      <linearGradient id="hp-shirt" x1="0.1" y1="0" x2="0.8" y2="1">
        <stop offset="0%" stopColor="#93B6D8" />
        <stop offset="100%" stopColor="#6B8FB6" />
      </linearGradient>
      <linearGradient id="hp-lid" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#DCE0E5" />
        <stop offset="100%" stopColor="#B2B9C1" />
      </linearGradient>
    </defs>

    {/* ---------------- legs (cropped at the frame edge) ---------------- */}
    <path d="M150 592 h140 l10 228 h-58 l-22 -150 -22 150 h-58 Z" fill="#BE9A63" />
    <path d="M218 592 l3 228 h-6 Z" fill="#A17F4C" opacity="0.55" />

    {/* ---------------- torso ---------------- */}
    <path
      d="M220 214 c46 0 78 22 88 54 l26 150 c5 30 -8 52 -30 57 l-7 121 h-154 l-7 -121 c-22 -5 -35 -27 -30 -57 l26 -150 c10 -32 42 -54 88 -54 Z"
      fill="url(#hp-shirt)"
    />
    {/* open collar over a light tee */}
    <path d="M186 218 l34 50 l34 -50 l-15 -7 l-19 29 l-19 -29 Z" fill="#F5F5F3" />
    <path d="M220 268 l34 -50 l9 5 l-38 56 Z" fill="#5E82A9" opacity="0.45" />
    <rect x="216" y="268" width="8" height="248" rx="4" fill="#5E82A9" opacity="0.4" />
    <rect x="262" y="316" width="44" height="36" rx="7" fill="#5E82A9" opacity="0.3" />

    {/* ---------------- neck + head ---------------- */}
    <path d="M196 176 h48 v48 c0 12 -48 12 -48 0 Z" fill="#6B4127" />
    <ellipse cx="220" cy="120" rx="58" ry="66" fill="url(#hp-skin)" />
    <ellipse cx="164" cy="126" rx="9" ry="14" fill="#784B2B" />
    <ellipse cx="276" cy="126" rx="9" ry="14" fill="#784B2B" />
    {/* short textured hair with a clean hairline */}
    <path
      d="M220 46 c39 0 60 27 60 55 c0 9 -2 16 -4 21 c-3 -23 -9 -35 -19 -40 c-13 -6 -53 -6 -74 2 c-12 4 -18 16 -20 38 c-2 -5 -3 -12 -3 -21 c0 -28 21 -55 60 -55 Z"
      fill="#231B16"
    />
    <path d="M164 113 c2 -17 7 -26 16 -31 c-6 11 -8 19 -8 31 Z" fill="#231B16" />
    {/* brows, eyes, smile */}
    <path d="M186 114 h26" stroke="#231B16" strokeWidth="6" strokeLinecap="round" />
    <path d="M228 114 h26" stroke="#231B16" strokeWidth="6" strokeLinecap="round" />
    <path d="M190 132 q10 7 20 0" stroke="#231B16" strokeWidth="4.5" strokeLinecap="round" fill="none" />
    <path d="M230 132 q10 7 20 0" stroke="#231B16" strokeWidth="4.5" strokeLinecap="round" fill="none" />
    <path d="M204 158 q16 12 32 0" stroke="#3A2417" strokeWidth="4.5" strokeLinecap="round" fill="none" />
    {/* glasses */}
    <rect x="178" y="114" width="40" height="30" rx="9" stroke="#1B1B1E" strokeWidth="4.5" fill="none" />
    <rect x="224" y="114" width="40" height="30" rx="9" stroke="#1B1B1E" strokeWidth="4.5" fill="none" />
    <path d="M218 128 h6" stroke="#1B1B1E" strokeWidth="4.5" />
    <path d="M178 126 l-14 3" stroke="#1B1B1E" strokeWidth="4.5" strokeLinecap="round" />
    <path d="M264 126 l14 3" stroke="#1B1B1E" strokeWidth="4.5" strokeLinecap="round" />

    {/* ---------------- far arm: down the side, forearm forward ---------------- */}
    <path
      d="M142 244 c-24 12 -37 38 -41 72 l-9 74 c-2 13 6 22 18 22 c11 0 17 -8 19 -19 l11 -70 Z"
      fill="url(#hp-shirt)"
    />
    <path
      d="M110 400 c14 -3 28 3 33 15 l6 15 c3 8 -2 15 -11 16 l-24 2 c-11 1 -18 -6 -18 -16 l1 -14 c1 -10 6 -16 13 -18 Z"
      fill="#7B4C2C"
    />

    {/* ---------------- laptop, resting on the forearm ---------------- */}
    {/* lid, seen from the back and slightly angled */}
    <path d="M56 372 l176 -34 l16 96 l-176 34 Z" fill="url(#hp-lid)" />
    <path d="M66 380 l158 -30 l12 78 l-158 30 Z" fill="#C6CCD3" />
    {/* subtle logo mark on the lid */}
    <rect x="136" y="398" width="20" height="20" rx="5" fill="#9AA2AC" opacity="0.75" />
    {/* base */}
    <path
      d="M52 462 l196 -38 l7 21 c2 7 -2 13 -10 15 l-176 34 c-9 2 -16 -3 -17 -11 Z"
      fill="#CFD5DC"
    />
    <path d="M58 470 l190 -37 l3 9 l-190 37 Z" fill="#98A0AA" opacity="0.55" />

    {/* ---------------- near arm: bent, hand resting on the base ---------------- */}
    <path
      d="M298 246 c25 13 36 38 36 71 l-2 62 c0 14 -10 23 -22 21 c-10 -2 -15 -10 -15 -21 l0 -59 Z"
      fill="url(#hp-shirt)"
    />
    <path
      d="M246 396 c19 -9 39 -6 49 6 c7 8 3 18 -8 21 l-45 13 c-12 3 -20 -4 -18 -14 c2 -12 11 -21 22 -26 Z"
      fill="#7B4C2C"
    />
    <rect
      x="292"
      y="382"
      width="38"
      height="14"
      rx="5"
      fill="#2A2A2E"
      transform="rotate(-16 311 389)"
    />
  </svg>
);
