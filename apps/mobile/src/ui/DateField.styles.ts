import { StyleSheet } from 'react-native';
import { fontSize, palette, radius, semantic, spacing, touchTarget } from '@diaspay/ui-tokens';

export const dateFieldStyles = StyleSheet.create({
  label: { fontSize: fontSize.small, fontWeight: '700', color: semantic.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  field: { flex: 1, height: 48, borderWidth: 1, borderColor: palette.line, borderRadius: radius.md, paddingHorizontal: 14, backgroundColor: semantic.surface, justifyContent: 'center' },
  fieldError: { borderColor: semantic.error, borderWidth: 1.5 },
  text: { fontSize: 16, color: semantic.text },
  clear: { width: touchTarget, height: touchTarget, alignItems: 'center', justifyContent: 'center' },
  clearText: { fontSize: 22, color: palette.muted },
  error: { fontSize: fontSize.caption, color: semantic.error },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(20,35,26,0.4)' },
  sheet: { backgroundColor: semantic.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, paddingBottom: spacing.xxl },
  done: { height: 48, borderRadius: radius.md, backgroundColor: palette.green, alignItems: 'center', justifyContent: 'center', marginTop: spacing.md },
  doneText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
