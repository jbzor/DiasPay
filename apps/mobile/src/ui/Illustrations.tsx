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

/** QR dans un cadre de visée, avec coche. */
export function IllustrationPurpose() {
  return (
    <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} {...hidden}>
      <G fill="none" stroke={palette.yellow} strokeWidth={6} strokeLinecap="round">
        <Path d="M60 52V34h18M162 34h18v18M180 148v18h-18M78 166H60v-18" />
      </G>
      <G fill="none" stroke={palette.green} strokeWidth={5}>
        <Rect x={76} y={50} width={30} height={30} rx={5} />
        <Rect x={134} y={50} width={30} height={30} rx={5} />
        <Rect x={76} y={108} width={30} height={30} rx={5} />
      </G>
      <G fill={palette.green}>
        <Rect x={86} y={60} width={10} height={10} />
        <Rect x={144} y={60} width={10} height={10} />
        <Rect x={86} y={118} width={10} height={10} />
        <Rect x={116} y={56} width={8} height={8} />
        <Rect x={116} y={76} width={8} height={8} />
        <Rect x={116} y={96} width={8} height={8} />
        <Rect x={96} y={92} width={8} height={8} />
        <Rect x={76} y={92} width={8} height={8} />
        <Rect x={136} y={96} width={8} height={8} />
        <Rect x={116} y={116} width={8} height={8} />
      </G>
      <Check cx={150} cy={124} />
    </Svg>
  );
}

/** Cadenas. */
export function IllustrationLock() {
  return (
    <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} {...hidden}>
      <Path d="M88 88V66a32 32 0 0 1 64 0v22" fill="none" stroke={palette.yellow} strokeWidth={10} strokeLinecap="round" />
      <Rect x={68} y={88} width={104} height={84} rx={14} fill="none" stroke={palette.green} strokeWidth={6} />
      <Circle cx={120} cy={122} r={11} fill={palette.red} />
      <Path d="M120 130v18" stroke={palette.red} strokeWidth={8} strokeLinecap="round" />
      <G stroke={palette.green} strokeWidth={4} strokeLinecap="round">
        <Path d="M40 120h14M186 120h14M48 86l10 6M192 86l-10 6" />
      </G>
    </Svg>
  );
}

/** Document avec coche. */
export function IllustrationProof() {
  return (
    <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} {...hidden}>
      <Path d="M76 28h66l28 28v116a6 6 0 0 1-6 6H76a6 6 0 0 1-6-6V34a6 6 0 0 1 6-6z" fill="none" stroke={palette.green} strokeWidth={6} strokeLinejoin="round" />
      <Path d="M142 28v28h28" fill="none" stroke={palette.green} strokeWidth={6} strokeLinejoin="round" />
      <G stroke={palette.yellow} strokeWidth={6} strokeLinecap="round">
        <Path d="M90 76h40M90 98h60M90 120h52M90 142h30" />
      </G>
      <Check cx={168} cy={150} r={24} />
    </Svg>
  );
}
