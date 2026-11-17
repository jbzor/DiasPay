import type { NeedIssue, PlanType } from '@diaspay/domain';
import { useI18n } from '@/i18n';
import { getModules } from '@/state/modules';
import type { Key } from '@/i18n';
import { en } from '@/i18n/messages';
import type { PlanLabels } from './wizard';

/** Textes de l’assistant : messages d’erreur par code, libellés de plan, taille de fichier. */
export function useNeedText() {
  const { t, money, locale } = useI18n();
  const has = (k: string): k is Key => k in en;
  // Pièces connues : textes de l’application ; pièce déclarée par un module (lot X, X6) : libellés du module.
  const docLabel = (kind: string) => (has(`doc_${kind}`) ? t(`doc_${kind}` as Key)
    : getModules().flatMap((m) => m.requiredDocuments).find((d) => d.kind === kind)?.labels[locale] ?? kind);
  const issueText = (i: NeedIssue | undefined): string | null => {
    if (!i) return null;
    const k = `need_${i.code}`;
    const params: Record<string, string | number> = { ...(i.params ?? {}) };
    if (typeof params.kind === 'string') params.doc = docLabel(params.kind);
    return has(k) ? t(k, params) : t('err_generic');
  };
  const planLabels: PlanLabels = {
    single: t('labelSingle'), deposit: t('labelDeposit'), balance: t('labelBalance'),
    installment: t('labelInstallment'), recurring: t('labelRecurring'), extra: t('labelInstallment'),
  };
  const planName = (p: PlanType) => t(`plan_${p}`);
  const fileSize = (bytes: number) =>
    bytes >= 1024 * 1024
      ? t('sizeMb', { n: new Intl.NumberFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', { maximumFractionDigits: 1 }).format(bytes / (1024 * 1024)) })
      : t('sizeKb', { n: Math.max(1, Math.round(bytes / 1024)) });
  return { issueText, docLabel, planLabels, planName, fileSize, money };
}
