import { Platform } from 'react-native';
import type { SvgProps } from 'react-native-svg';

/**
 * Accessibilité d’un dessin SVG (logo, icônes, illustrations). Sur le web, react-native-svg transmet ses propriétés
 * telles quelles au <svg> du navigateur : les propriétés de React Native (accessible, accessibilityElementsHidden,
 * importantForAccessibility) y sont inconnues et React les signale. On y passe donc les attributs ARIA.
 * Avec un libellé : image nommée. Sans libellé : décoratif, masqué aux lecteurs d’écran.
 */
export function svgA11y(label?: string): SvgProps {
  if (Platform.OS === 'web') return (label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true }) as SvgProps;
  return label
    ? { accessible: true, accessibilityLabel: label, accessibilityRole: 'image' }
    : { accessible: false, accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' };
}
