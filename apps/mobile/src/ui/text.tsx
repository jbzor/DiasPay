import { Text as RNText, TextInput as RNTextInput } from 'react-native';
import type { Ref } from 'react';
import type { TextInputInstance, TextInputProps, TextProps } from 'react-native';

/**
 * Police de l’application : Inter (SIL Open Font License 1.1), chargée avec expo-font en quatre graisses
 * (400, 500, 600, 700) dans une seule famille. Le `fontWeight` du style choisit la graisse
 * (iOS : métadonnées du fichier ; Android 10+ et web : poids déclaré).
 * Tous les écrans importent Text et TextInput d’ici, jamais de react-native.
 */
export const FONT_FAMILY = 'Inter';
const base = { fontFamily: FONT_FAMILY } as const;

export function Text({ style, ...props }: TextProps) {
  return <RNText {...props} style={[base, style]} />;
}

/** React 19 : `ref` est une prop ordinaire, transmise au champ natif. */
export function TextInput({ style, ...props }: TextInputProps & { ref?: Ref<TextInputInstance> }) {
  return <RNTextInput {...props} style={[base, style]} />;
}
