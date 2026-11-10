import { createElement } from 'react';
import { Pressable, View } from 'react-native';
import { Text } from './text';
import { palette } from '@diaspay/ui-tokens';
import { useI18n } from '../i18n';
import { dateFieldStyles as st } from './DateField.styles';
import type { DateFieldProps } from './DateField.types';

export type { DateFieldProps };

/**
 * Web : @react-native-community/datetimepicker n’a pas d’implémentation web (il ne rend rien).
 * On utilise le sélecteur de date du navigateur (<input type="date">), accessible au clavier.
 */
export function DateField({ label, value, onChange, minimumDate, error, clearable }: DateFieldProps) {
  const { t } = useI18n();
  return (
    <View style={{ gap: 6 }}>
      <Text style={st.label}>{label}</Text>
      <View style={st.row}>
        {createElement('input', {
          type: 'date', value: value ?? '', min: minimumDate, 'aria-label': label,
          onChange: (e: { target: { value: string } }) => onChange(e.target.value || undefined),
          style: {
            flex: 1, height: 48, boxSizing: 'border-box', border: `${error ? 1.5 : 1}px solid ${error ? '#9B1C1C' : palette.line}`,
            borderRadius: 12, padding: '0 14px', fontSize: 16, background: '#fff', color: palette.ink, fontFamily: 'inherit',
          },
        })}
        {clearable && value ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t('clearDate')} onPress={() => onChange(undefined)} style={st.clear}>
            <Text style={st.clearText}>×</Text>
          </Pressable>
        ) : null}
      </View>
      {error ? <Text style={st.error} accessibilityLiveRegion="polite">{error}</Text> : null}
    </View>
  );
}
