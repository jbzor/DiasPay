import { useState } from 'react';
import { Modal, Platform, Pressable, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import type { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { palette } from '@diaspay/ui-tokens';
import { dateFieldStyles as st } from './DateField.styles';
import type { DateFieldProps } from './DateField.types';
import { useI18n } from '../i18n';

export type { DateFieldProps };

const toDate = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1); };
const toIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Sélecteur de date natif : boîte de dialogue sur Android, roue dans une feuille sur iOS. */
export function DateField({ label, value, onChange, minimumDate, error, placeholder, clearable }: DateFieldProps) {
  const { t, locale, date } = useI18n();
  const [open, setOpen] = useState(false);
  const [temp, setTemp] = useState<Date>(() => toDate(value ?? minimumDate ?? toIso(new Date())));
  const min = minimumDate ? toDate(minimumDate) : undefined;
  const shown = value ? date(value) : placeholder ?? t('chooseDate');

  function onPicked(e: DateTimePickerEvent, d?: Date) {
    if (Platform.OS === 'android') {
      setOpen(false);
      if (e.type === 'set' && d) onChange(toIso(d));
    } else if (d) {
      setTemp(d);
    }
  }

  return (
    <View style={{ gap: 6 }}>
      <Text style={st.label}>{label}</Text>
      <View style={st.row}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${label}, ${shown}`} style={[st.field, error ? st.fieldError : null]}
          onPress={() => { setTemp(toDate(value ?? minimumDate ?? toIso(new Date()))); setOpen(true); }}>
          <Text style={[st.text, !value ? { color: palette.muted } : null]}>{shown}</Text>
        </Pressable>
        {clearable && value ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t('clearDate')} onPress={() => onChange(undefined)} style={st.clear}>
            <Text style={st.clearText}>×</Text>
          </Pressable>
        ) : null}
      </View>
      {error ? <Text style={st.error} accessibilityLiveRegion="polite">{error}</Text> : null}
      {open && Platform.OS === 'android'
        ? <DateTimePicker mode="date" value={temp} minimumDate={min} onChange={onPicked} />
        : null}
      {Platform.OS === 'ios' ? (
        <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
          <View style={st.backdrop}>
            <View style={st.sheet}>
              <DateTimePicker mode="date" display="inline" value={temp} minimumDate={min} onChange={onPicked} locale={locale === 'fr' ? 'fr-FR' : 'en-GB'} accentColor={palette.green} />
              <Pressable accessibilityRole="button" style={st.done} onPress={() => { onChange(toIso(temp)); setOpen(false); }}>
                <Text style={st.doneText}>{t('ok')}</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

