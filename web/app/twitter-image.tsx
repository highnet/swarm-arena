import { ImageResponse } from 'next/og';
import { SITE_NAME } from '@/lib/site';

export const alt = 'Swarm Arena: four engines, built from nothing, ranked only by games';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const TRACKS = [
  { name: 'Chess', color: '#3987e5', climb: [0.08, 0.22, 0.31, 0.47, 0.55, 0.66] },
  { name: 'Go 9×9', color: '#d95926', climb: [0.05, 0.14, 0.19, 0.3, 0.36, 0.42] },
  { name: 'Othello', color: '#199e70', climb: [0.06, 0.2, 0.33, 0.4, 0.52, 0.6] },
  { name: 'Hex', color: '#c98500', climb: [0.1, 0.25, 0.4, 0.51, 0.62, 0.71] },
];

/** Shared progress, stylised: four step lines climbing, no numbers (the real ones live on the site). */
const TwitterImage = () => {
  const w = 1040;
  const h = 250;
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: '#101116',
        color: '#f4f4f6',
        padding: '64px 80px',
        fontFamily: 'sans-serif',
      }}
    >
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 30, color: '#c7c8d0' }}
      >
        <svg width="40" height="40" viewBox="0 0 32 32">
          <path
            d="M6 24 11.5 15.5l4.5 4.5 4.5-9 5.5 13"
            fill="none"
            stroke="#f4f4f6"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="25.5" cy="24" r="2.4" fill="#3987e5" />
        </svg>
        {SITE_NAME}
      </div>
      <div
        style={{
          display: 'flex',
          fontSize: 64,
          fontWeight: 700,
          lineHeight: 1.08,
          letterSpacing: -1.5,
          maxWidth: 980,
        }}
      >
        Four engines, built from nothing, ranked only by games.
      </div>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        {TRACKS.map((t) => {
          let d = `M0 ${h}`;
          t.climb.forEach((v, i) => {
            const x = ((i + 1) / t.climb.length) * w;
            d += ` H${x - w / t.climb.length / 2} V${h - v * h}`;
          });
          d += ` H${w}`;
          return <path key={t.name} d={d} fill="none" stroke={t.color} strokeWidth="5" />;
        })}
      </svg>
    </div>,
    size,
  );
};

export default TwitterImage;
