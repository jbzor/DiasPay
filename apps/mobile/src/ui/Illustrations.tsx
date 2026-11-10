import Svg, { Circle, G, Path, Rect } from 'react-native-svg';
import { palette } from '@diaspay/ui-tokens';

// Illustrations de la présentation (240 × 200) : traits verts et jaunes, détails rouges. Décoratives.
const W = 240;
const H = 200;
const hidden = { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const };

function Check({ cx, cy, r = 22 }: { cx: number; cy: number; r?: number }) {
  return (
    <G>
      <Circle cx={cx} cy={cy} r={r} fill={palette.red} />
      <Path d={`M${cx - r * 0.45} ${cy}l${r * 0.35} ${r * 0.35} ${r * 0.6}-${r * 0.7}`} fill="none" stroke="#fff" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
    </G>
  );
}

/** Page 1 (maquette A2) : grille dans un cadre vert, trois cases jaunes, coche rouge. */
export function IllustrationPurpose() {
  return (
    <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} {...hidden}>
      <Rect x={60} y={40} width={120} height={120} rx={18} fill="none" stroke={palette.green} strokeWidth={6} />
      <G fill="none" stroke={palette.yellow} strokeWidth={5}>
        <Rect x={80} y={60} width={34} height={34} rx={6} />
        <Rect x={126} y={60} width={34} height={34} rx={6} />
        <Rect x={80} y={106} width={34} height={34} rx={6} />
      </G>
      <Check cx={143} cy={123} r={18} />
    </Svg>
  );
}

/** Page 2 : cadenas plein vert, trou de serrure jaune. */
export function IllustrationLock() {
  return (
    <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} {...hidden}>
      <Path d="M92 92V70a28 28 0 0 1 56 0v22" fill="none" stroke={palette.green} strokeWidth={9} strokeLinecap="round" />
      <Rect x={76} y={90} width={88} height={74} rx={10} fill={palette.green} />
      <Circle cx={120} cy={120} r={9} fill={palette.yellow} />
      <Path d="M120 124v18" stroke={palette.yellow} strokeWidth={7} strokeLinecap="round" />
    </Svg>
  );
}

/** Page 3 : document à coin plié, lignes jaunes, coche rouge. */
export function IllustrationProof() {
  return (
    <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} {...hidden}>
      <Path d="M86 36h50l26 26v96a6 6 0 0 1-6 6H86a6 6 0 0 1-6-6V42a6 6 0 0 1 6-6z" fill="none" stroke={palette.green} strokeWidth={6} strokeLinejoin="round" />
      <Path d="M136 36v26h26" fill="none" stroke={palette.green} strokeWidth={6} strokeLinejoin="round" />
      <G stroke={palette.yellow} strokeWidth={5} strokeLinecap="round">
        <Path d="M98 92h44M98 108h30" />
      </G>
      <Check cx={150} cy={146} r={18} />
    </Svg>
  );
}

/** Cloche avec coche (état vide des alertes). */
export function IllustrationBellCheck({ size = 72 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 72 72" {...hidden}>
      <Path d="M14 52h44l-5-6V30a17 17 0 0 0-34 0v16z" fill="none" stroke={palette.green} strokeWidth={4} strokeLinejoin="round" />
      <Path d="M30 60h12" stroke={palette.green} strokeWidth={4} strokeLinecap="round" />
      <Path d="M27 33l7 7 12-13" fill="none" stroke={palette.red} strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
