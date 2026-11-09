import { useMemo } from 'react';
import type { ComponentRef, Ref } from 'react';
import { View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { QUIET_ZONE, qrMatrix, qrPath } from '@/lib/qr';

/**
 * QR code : fond blanc et modules noirs quel que soit le thème (jamais de couleur de marque),
 * correction d’erreur M, marge de silence de 4 modules comprise dans `size`.
 */
export function QrCode({ value, size = 276, accessibilityLabel, innerRef }: {
  value: string; size?: number; accessibilityLabel: string; innerRef?: Ref<ComponentRef<typeof View>>;
}) {
  const { path, units } = useMemo(() => {
    const m = qrMatrix(value);
    return { path: qrPath(m), units: m.length + 2 * QUIET_ZONE };
  }, [value]);
  return (
    <View ref={innerRef} collapsable={false} style={{ width: size, height: size, backgroundColor: '#FFFFFF' }}
      accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
      <Svg width={size} height={size} viewBox={`0 0 ${units} ${units}`}>
        <Rect x={0} y={0} width={units} height={units} fill="#FFFFFF" />
        <Path d={path} fill="#000000" />
      </Svg>
    </View>
  );
}
