import { useEffect, useRef, useState } from 'react';
import { formatAmountInput, parseAmountInput } from '@diaspay/domain';
import type { Currency } from '@diaspay/domain';
import { useI18n } from '@/i18n';
import { Field } from '@/ui';
import type { StyleProp, ViewStyle } from 'react-native';

/**
 * Saisie d’un montant : séparateurs de milliers selon la langue (mis en forme à la sortie du champ),
 * lecture et contrôle des décimales par le domaine (parseAmountInput).
 */
export function AmountField({ label, value, currency, onChange, error, containerStyle }: {
  label: string; value?: number; currency: Currency; onChange: (minor: number | undefined) => void;
  error?: string | null; containerStyle?: StyleProp<ViewStyle>;
}) {
  const { t, locale } = useI18n();
  const fmt = (v?: number) => (v ? formatAmountInput(v, currency, locale) : '');
  const [text, setText] = useState(() => fmt(value));
  const [localError, setLocalError] = useState<string | null>(null);
  const last = useRef(value);

  // Valeur modifiée hors du champ (plan recalculé, devise changée) : on resynchronise le texte.
  useEffect(() => {
    if (value !== last.current) { last.current = value; setText(fmt(value)); setLocalError(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function parse(next: string, cur: Currency) {
    if (!next.trim()) { setLocalError(null); last.current = undefined; onChange(undefined); return; }
    try {
      const minor = parseAmountInput(next, cur, locale);
      setLocalError(null);
      last.current = minor;
      onChange(minor);
    } catch (e) {
      const code = (e as { code?: string }).code ?? 'AMOUNT_INVALID';
      setLocalError(t(code === 'AMOUNT_DECIMALS' ? 'need_AMOUNT_DECIMALS' : 'need_AMOUNT_INVALID'));
      last.current = undefined;
      onChange(undefined);
    }
  }

  // Changement de devise : le même texte est relu (les unités mineures diffèrent).
  const prevCurrency = useRef(currency);
  useEffect(() => {
    if (prevCurrency.current !== currency) { prevCurrency.current = currency; parse(text, currency); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currency]);

  return (
    <Field label={label} value={text} keyboardType="decimal-pad" inputMode="decimal" containerStyle={containerStyle}
      onChangeText={(v) => { setText(v); parse(v, currency); }}
      onBlur={() => { if (last.current) setText(fmt(last.current)); }}
      error={localError ?? error} />
  );
}
