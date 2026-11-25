/** Authored geometric piece set, drawn on a 45×45 grid. Upper case = white. */
const BASE =
  'M11 34.5h23a1.5 1.5 0 0 1 1.5 1.5v2a1.5 1.5 0 0 1-1.5 1.5H11A1.5 1.5 0 0 1 9.5 38v-2a1.5 1.5 0 0 1 1.5-1.5Z';

const SHAPES: Record<string, string[]> = {
  p: [BASE, 'M16 34.5 18.5 23h8L29 34.5Z', 'M22.5 9.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11Z'],
  r: [BASE, 'M15 34.5V19h15v15.5Z', 'M12.5 10.5h4.5v3.5h3v-3.5h5v3.5h3v-3.5h4.5V19h-20Z'],
  n: [
    BASE,
    'M14 34.5c0-6 3-8.5 5.5-11-2 .5-5 1.5-6.5 3.5-1.5-1-2-3-.5-5.5 2.5-4.5 6-8.5 8-12.5l1.5 3c6.5.5 10.5 6.5 10 14.5l-.5 8Z',
  ],
  b: [
    BASE,
    'M22.5 9.5c5.5 4.5 8 10.5 6 17.5l-1.5 7.5h-9l-1.5-7.5c-2-7 .5-13 6-17.5Z',
    'M22.5 4a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Z',
  ],
  q: [
    BASE,
    'M14.5 34.5 16 22h13l1.5 12.5Z',
    'M11 12.5 16 22h13l5-9.5-5.5 4.5-6-8.5-6 8.5Z',
    'M11 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4ZM22.5 6.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4ZM34 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z',
  ],
  k: [
    BASE,
    'M14.5 34.5 16 21h13l1.5 13.5Z',
    'M15 21c-2-4-1-8 3-8.5 2.5-.3 4 1 4.5 3.5.5-2.5 2-3.8 4.5-3.5 4 .5 5 4.5 3 8.5Z',
    'M21.25 3.5h2.5v3h3v2.5h-3V13h-2.5V9h-3V6.5h3Z',
  ],
};

type ChessPieceProps = {
  piece: string;
  x: number;
  y: number;
  size: number;
};

const ChessPiece = ({ piece, x, y, size }: ChessPieceProps) => {
  const white = piece === piece.toUpperCase();
  const paths = SHAPES[piece.toLowerCase()];
  if (!paths) return null;
  return (
    <g transform={`translate(${x} ${y}) scale(${size / 45})`}>
      {paths.map((d) => (
        <path
          key={d}
          d={d}
          fill={white ? 'var(--stone-white)' : 'var(--stone-black)'}
          stroke={white ? 'var(--stone-rim)' : 'var(--stone-white)'}
          strokeWidth={white ? 1.6 : 1}
          strokeLinejoin="round"
        />
      ))}
    </g>
  );
};

export { ChessPiece };
