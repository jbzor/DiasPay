import type { ReactNode } from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { Text } from './text';
import { fontSize, palette, radius, semantic, spacing } from '@diaspay/ui-tokens';
import { Button } from './index';

/** Boîte de dialogue (Alert.alert n’a pas de boutons sur le web) : titre, message, contenu, action principale. */
export function Dialog({ visible, title, message, confirmLabel, cancelLabel, onConfirm, onCancel, danger, confirmDisabled, children }: {
  visible: boolean; title: string; message?: string; confirmLabel: string; cancelLabel: string;
  onConfirm: () => void; onCancel: () => void; danger?: boolean; confirmDisabled?: boolean; children?: ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={st.backdrop}>
        <View style={st.box} accessibilityViewIsModal>
          <Text style={st.title} accessibilityRole="header">{title}</Text>
          {message ? <Text style={st.message}>{message}</Text> : null}
          {children}
          <Button tone={danger ? 'danger' : 'primary'} label={confirmLabel} onPress={onConfirm} disabled={confirmDisabled} />
          <Button tone="text" label={cancelLabel} onPress={onCancel} />
        </View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(20,35,26,0.4)', alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  box: { width: '100%', maxWidth: 420, backgroundColor: semantic.background, borderRadius: radius.xl, padding: spacing.xl, gap: spacing.md },
  title: { fontSize: fontSize.title, fontWeight: '700', color: palette.ink },
  message: { fontSize: fontSize.body, lineHeight: 22, color: palette.muted },
});
