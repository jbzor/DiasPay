import { useSyncExternalStore } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fontSize, palette, radius, spacing } from '@diaspay/ui-tokens';

// Message bref (« Brouillon enregistré »…), affiché au-dessus de la navigation.
let current: { id: number; text: string } | null = null;
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function showToast(text: string, durationMs = 2200): void {
  const id = ++seq;
  current = { id, text };
  emit();
  setTimeout(() => { if (current?.id === id) { current = null; emit(); } }, durationMs);
}

export function ToastHost() {
  const toast = useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => current, () => current);
  const insets = useSafeAreaInsets();
  if (!toast) return null;
  return (
    <View pointerEvents="none" style={[st.wrap, { bottom: insets.bottom + 88 }]}>
      <View style={st.toast} accessibilityRole="alert" accessibilityLiveRegion="polite">
        <Text style={st.text}>{toast.text}</Text>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  toast: { backgroundColor: palette.ink, borderRadius: radius.md, paddingVertical: spacing.sm + 2, paddingHorizontal: spacing.lg, maxWidth: '90%' },
  text: { color: palette.ivory, fontSize: fontSize.small + 1, fontWeight: '600' },
});
