import Svg, { Circle, G, Path, Rect } from 'react-native-svg';
import { palette } from '@diaspay/ui-tokens';

/**
 * Logo DiasPayQR, repris de assets/logo.svg (et logo-inverse.svg avec `inverse`).
 * Normal : fond vert, repères jaunes. Inversé : fond ivoire, repères verts (pour fond vert).
 */
export function Logo({ size = 72, inverse = false, accessibilityLabel }: { size?: number; inverse?: boolean; accessibilityLabel?: string }) {
  const bg = inverse ? palette.ivory : palette.green;
  const stroke = inverse ? palette.green : palette.yellow;
  const fill = inverse ? palette.green : '#FFFFFF';
  return (
    <Svg width={size} height={size} viewBox="0 0 160 160"
      accessible={!!accessibilityLabel} accessibilityLabel={accessibilityLabel} accessibilityRole={accessibilityLabel ? 'image' : undefined}>
      <Rect width={160} height={160} rx={36} fill={bg} />
      <G fill="none" stroke={stroke} strokeWidth={7}>
        <Rect x={24} y={24} width={36} height={36} rx={6} />
        <Rect x={100} y={24} width={36} height={36} rx={6} />
        <Rect x={24} y={100} width={36} height={36} rx={6} />
      </G>
      <G fill={fill}>
        <Rect x={36} y={36} width={12} height={12} />
        <Rect x={112} y={36} width={12} height={12} />
        <Rect x={36} y={112} width={12} height={12} />
      </G>
      <Circle cx={118} cy={118} r={24} fill={palette.red} />
      <Path d="M106 118l9 9 16-18" fill="none" stroke="#FFFFFF" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
