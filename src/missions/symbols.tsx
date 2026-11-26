/** Abstract panel symbols drawn as SVG (no emoji / no image assets). Shared by POWER and ACCESS. */

export type SymbolId =
  | 'circle'
  | 'triangle'
  | 'square'
  | 'diamond'
  | 'cross'
  | 'plus'
  | 'ring'
  | 'bar'
  | 'hexagon'
  | 'chevron';

export const SYMBOL_IDS: readonly SymbolId[] = [
  'circle',
  'triangle',
  'square',
  'diamond',
  'cross',
  'plus',
  'ring',
  'bar',
  'hexagon',
  'chevron',
];

export const SYMBOL_NAME_KO: Record<SymbolId, string> = {
  circle: '원',
  triangle: '삼각',
  square: '사각',
  diamond: '마름모',
  cross: '엑스',
  plus: '십자',
  ring: '이중원',
  bar: '막대',
  hexagon: '육각',
  chevron: '꺾쇠',
};

export function SymbolGlyph({ id, size = 22 }: { id: SymbolId; size?: number }) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinejoin: 'round' as const,
    strokeLinecap: 'round' as const,
  };
  let shape;
  switch (id) {
    case 'circle':
      shape = <circle cx="12" cy="12" r="7" fill="currentColor" stroke="none" />;
      break;
    case 'triangle':
      shape = <path d="M12 4 L20 19 L4 19 Z" {...common} />;
      break;
    case 'square':
      shape = <rect x="5" y="5" width="14" height="14" {...common} />;
      break;
    case 'diamond':
      shape = <path d="M12 3 L20 12 L12 21 L4 12 Z" fill="currentColor" stroke="none" />;
      break;
    case 'cross':
      shape = <path d="M6 6 L18 18 M18 6 L6 18" {...common} strokeWidth={2.6} />;
      break;
    case 'plus':
      shape = <path d="M12 4 V20 M4 12 H20" {...common} strokeWidth={2.6} />;
      break;
    case 'ring':
      shape = (
        <g {...common}>
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="3.5" />
        </g>
      );
      break;
    case 'bar':
      shape = <rect x="4" y="9" width="16" height="6" fill="currentColor" stroke="none" />;
      break;
    case 'hexagon':
      shape = <path d="M8 4 H16 L20 12 L16 20 H8 L4 12 Z" {...common} />;
      break;
    case 'chevron':
      shape = <path d="M5 8 L12 15 L19 8" {...common} strokeWidth={2.6} />;
      break;
  }
  return (
    <svg
      className="m-glyph"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {shape}
    </svg>
  );
}
