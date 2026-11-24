/**
 * The three home-shortcut illustrations.
 *
 * ORIGINAL ARTWORK, drawn to the approved reference's SUBJECT and palette —
 * an open produce box, a nutrition clipboard with an apple, a delivery van on
 * its way to a house — rather than traced from it. They are inline SVG on
 * purpose:
 *
 *   * nothing to download, so the cards cannot flash, shift or show a broken
 *     image while a file loads, and there is no external host to depend on;
 *   * they scale from the 64px thumbnail a 360px phone shows to the 120px
 *     panel a desktop shows without a second asset;
 *   * `currentColor` is avoided deliberately — these are full-colour marks,
 *     not icons, and each one owns its palette so a card's tint cannot bleed
 *     into the artwork.
 *
 * Every one is `aria-hidden`: the card's own label is the accessible name, so
 * announcing the picture as well would read the shortcut out twice.
 */

interface ArtProps {
  /** Tailwind sizing from the card; the art fills whatever box it is given. */
  className?: string;
}

/** An open carton of groceries with a NEW flag — the New Arrivals shortcut. */
export function ProduceBoxArt({ className }: ArtProps) {
  return (
    <svg viewBox="0 0 128 104" className={className} aria-hidden="true" focusable="false">
      {/* Soft shape behind the subject, the reference's decorative wash. */}
      <ellipse cx="64" cy="92" rx="46" ry="7" fill="#F2994A" opacity="0.16" />

      {/* Sparkle rays */}
      <g stroke="#F2994A" strokeWidth="4" strokeLinecap="round" opacity="0.85">
        <path d="M14 30h8" />
        <path d="M10 44h6" />
        <path d="M18 58h7" />
      </g>
      <ellipse cx="110" cy="33" rx="7" ry="4.5" fill="#FFD83D" transform="rotate(-25 110 33)" />

      {/* Leafy greens behind the rim */}
      <path d="M44 48c-6-9-3-19 5-22 6-2 11 3 11 10 0 6-4 11-9 13Z" fill="#2E9E52" />
      <path d="M52 50c-2-10 3-18 11-18 6 0 9 6 7 13-2 6-7 10-12 11Z" fill="#43B86A" />
      <path d="M86 50c5-8 3-17-4-19-6-2-11 3-11 10 0 5 3 9 7 11Z" fill="#2E9E52" />

      {/* Milk bottle */}
      <rect x="92" y="38" width="15" height="26" rx="4" fill="#EAF4FB" stroke="#B9D9EE" strokeWidth="1.5" />
      <rect x="96" y="31" width="7" height="8" rx="2" fill="#EAF4FB" stroke="#B9D9EE" strokeWidth="1.5" />
      <rect x="94.5" y="28" width="10" height="5" rx="2" fill="#0072E5" />
      <rect x="94" y="48" width="11" height="7" rx="1.5" fill="#FFFFFF" opacity="0.9" />

      {/* Packet */}
      <rect x="60" y="36" width="16" height="22" rx="2.5" fill="#FFD83D" />
      <path d="M60 43h16M60 48h16" stroke="#E0B800" strokeWidth="2" />

      {/* Yellow pepper */}
      <path d="M44 62c-6 0-10-5-10-11s4-9 10-9 10 3 10 9-4 11-10 11Z" fill="#FFC21A" />
      <path d="M44 42v-5" stroke="#2E9E52" strokeWidth="3" strokeLinecap="round" />

      {/* Red tomato */}
      <circle cx="64" cy="55" r="10" fill="#E03B2F" />
      <path d="M64 45c-3-1-5-2-5-4m5 4c3-1 5-2 5-4" stroke="#2E9E52" strokeWidth="2.5" strokeLinecap="round" />

      {/* Box: back flaps, body, front panel */}
      <path d="M30 56l-9-7 7-5 10 7Z" fill="#D8A86A" />
      <path d="M98 56l9-7-7-5-10 7Z" fill="#D8A86A" />
      <path d="M26 58h76l-6 32a4 4 0 0 1-4 3H36a4 4 0 0 1-4-3Z" fill="#C8913F" />
      <path d="M32 58h64l-5 32a4 4 0 0 1-4 3H41a4 4 0 0 1-4-3Z" fill="#E0B075" />

      {/* Cart glyph on the carton */}
      <g stroke="#9A6C27" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M54 70h3l3 11h12l3-8H59" />
        <circle cx="62" cy="86" r="1.6" fill="#9A6C27" stroke="none" />
        <circle cx="72" cy="86" r="1.6" fill="#9A6C27" stroke="none" />
      </g>

      {/* NEW flag */}
      <path d="M36 32v14" stroke="#B02A20" strokeWidth="3" strokeLinecap="round" />
      <rect x="18" y="12" width="48" height="22" rx="6" fill="#E03B2F" />
      <text
        x="42"
        y="28"
        textAnchor="middle"
        fill="#FFFFFF"
        fontSize="14"
        fontWeight="800"
        fontFamily="Inter, system-ui, sans-serif"
        letterSpacing="0.5"
      >
        NEW
      </text>
    </svg>
  );
}

/** A nutrition chart beside an apple — the Nutrition Info shortcut. */
export function NutritionChartArt({ className }: ArtProps) {
  return (
    <svg viewBox="0 0 128 104" className={className} aria-hidden="true" focusable="false">
      <ellipse cx="64" cy="94" rx="44" ry="6" fill="#087A35" opacity="0.14" />

      {/* Spinach leaves behind the board */}
      <path d="M22 40c-8 6-9 17-2 23 7 5 17 1 20-7 2-7-3-15-9-17Z" fill="#43B86A" opacity="0.55" />
      <path d="M30 28c-7 3-10 12-6 18 4 5 12 5 16-1 3-5 1-13-4-16Z" fill="#2E9E52" opacity="0.45" />
      <path d="M104 30c7 4 9 13 4 19-4 5-12 5-16-1-3-5-1-13 4-16Z" fill="#43B86A" opacity="0.5" />

      {/* Clipboard */}
      <rect x="30" y="18" width="52" height="68" rx="7" fill="#1E6B3A" />
      <rect x="34.5" y="23" width="43" height="58" rx="4" fill="#FFFFFF" />
      <rect x="48" y="12" width="16" height="11" rx="3.5" fill="#1E6B3A" />
      <circle cx="56" cy="13" r="3" fill="#1E6B3A" />

      {/* Chart rows: a grey label, then the coloured bars of the reference */}
      <rect x="40" y="31" width="32" height="5" rx="2.5" fill="#CBD5E1" />
      <rect x="40" y="41" width="30" height="5" rx="2.5" fill="#43B86A" />
      <rect x="40" y="50" width="24" height="5" rx="2.5" fill="#E03B2F" />
      <rect x="40" y="59" width="28" height="5" rx="2.5" fill="#F2994A" />
      <rect x="40" y="68" width="20" height="5" rx="2.5" fill="#2E9E52" />

      {/* Leaf badge */}
      <circle cx="94" cy="26" r="13" fill="#2E9E52" />
      <path
        d="M88 30c0-6 5-10 12-10 0 7-5 11-12 10Zm0 0c2-2 5-4 9-5"
        stroke="#FFFFFF"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />

      {/* Apple */}
      <path
        d="M90 52c6 0 11 6 11 14s-6 20-11 20c-2 0-3-1-5-1s-3 1-5 1c-5 0-11-12-11-20s5-14 11-14c2 0 3 1 5 1s3-1 5-1Z"
        fill="#E03B2F"
      />
      <path d="M85 53c0-5 1-8 3-10" stroke="#8A4B2A" strokeWidth="3" strokeLinecap="round" />
      <path d="M88 45c4-5 10-5 13-3-1 5-7 8-13 3Z" fill="#43B86A" />
      <path d="M79 60c-2 2-3 5-3 8" stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round" opacity="0.5" />
    </svg>
  );
}

/** A van on its way to a house — the Home Delivery shortcut. */
export function DeliveryVanArt({ className }: ArtProps) {
  return (
    <svg viewBox="0 0 128 104" className={className} aria-hidden="true" focusable="false">
      <ellipse cx="64" cy="94" rx="46" ry="6" fill="#0072E5" opacity="0.14" />

      {/* Skyline wash */}
      <rect x="92" y="38" width="10" height="34" rx="2" fill="#BFDDF5" opacity="0.75" />
      <rect x="104" y="46" width="8" height="26" rx="2" fill="#BFDDF5" opacity="0.6" />

      {/* Dashed route */}
      <path
        d="M78 34c12-6 24 0 26 10"
        stroke="#7FB8E8"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeDasharray="4 5"
        fill="none"
      />

      {/* Map pin */}
      <path d="M96 10c6 0 11 5 11 11 0 8-11 17-11 17S85 29 85 21c0-6 5-11 11-11Z" fill="#E03B2F" />
      <circle cx="96" cy="21" r="4" fill="#FFFFFF" />

      {/* House */}
      <path d="M100 56l13-10 13 10v16a2 2 0 0 1-2 2h-22a2 2 0 0 1-2-2Z" fill="#FFFFFF" stroke="#9EC9EA" strokeWidth="2" />
      <path d="M97 57l16-12 16 12" stroke="#0072E5" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <rect x="109" y="62" width="8" height="12" fill="#CFE6F8" />

      {/* Speed lines */}
      <g stroke="#0072E5" strokeWidth="5" strokeLinecap="round" opacity="0.55">
        <path d="M6 46h14" />
        <path d="M2 58h18" />
        <path d="M8 70h12" />
      </g>

      {/* Van: cargo body then cab */}
      <rect x="22" y="36" width="40" height="38" rx="6" fill="#1472D6" />
      <path d="M62 46h12l12 12v14a2 2 0 0 1-2 2H62Z" fill="#2B88E8" />
      <path d="M66 50h7l8 8H66Z" fill="#CFE6F8" />
      <rect x="80" y="62" width="6" height="5" rx="1.5" fill="#FFD83D" />

      {/* Cart glyph on the cargo door */}
      <g stroke="#FFFFFF" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M31 48h3l3.4 13h13l3.2-9H36" />
        <circle cx="39" cy="66" r="1.9" fill="#FFFFFF" stroke="none" />
        <circle cx="49" cy="66" r="1.9" fill="#FFFFFF" stroke="none" />
      </g>

      {/* Wheels */}
      <circle cx="37" cy="76" r="9" fill="#17364F" />
      <circle cx="37" cy="76" r="3.6" fill="#CFE6F8" />
      <circle cx="74" cy="76" r="9" fill="#17364F" />
      <circle cx="74" cy="76" r="3.6" fill="#CFE6F8" />
    </svg>
  );
}
