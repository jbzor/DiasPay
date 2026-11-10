import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';
import { router } from 'expo-router';
import type { NeedStep } from '@diaspay/domain';
import { useI18n } from '@/i18n';
import { dispatch, needContext, useWizard } from '@/state/needWizard';
import { Button, Screen, TopBar } from '@/ui';
import { STEP_COUNT, canContinue, nextStep, prevStep, stepIndex } from './wizard';

/** Cadre commun des six étapes : barre de titre « Étape n sur 6 », contenu défilant, bouton « Continuer ». */
export function WizardFrame({ title, detail, children, footer, extraFooter }: {
  title?: string; detail?: string; children: ReactNode; footer?: ReactNode; extraFooter?: ReactNode;
}) {
  const { t } = useI18n();
  const wiz = useWizard();
  if (!wiz) return null;
  const n = stepIndex(wiz.step);
  const subtitle = detail ? t('stepOfDetail', { n, total: STEP_COUNT, detail }) : t('stepOf', { n, total: STEP_COUNT });
  const ok = canContinue(wiz, needContext());

  function back() {
    const prev = prevStep(wiz!.step);
    if (!prev) { if (router.canGoBack()) router.back(); else router.replace('/home'); return; }
    dispatch({ type: 'back' });
    router.dismissTo(`/need/${prev}`);
  }
  function next() {
    const to: NeedStep = nextStep(wiz!.step);
    dispatch({ type: 'next', ctx: needContext() });
    router.push(`/need/${to}`);
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Screen footer={footer ?? (<>{extraFooter}<Button label={t('continue')} onPress={next} disabled={!ok} /></>)}>
        <TopBar title={title ?? t('newNeedTitle')} subtitle={subtitle} onBack={back} />
        {children}
      </Screen>
    </KeyboardAvoidingView>
  );
}
