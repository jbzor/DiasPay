import { useEffect, useRef } from 'react';
import { Redirect, Stack } from 'expo-router';
import { useI18n } from '@/i18n';
import { closeWizard, getWizard, useWizard } from '@/state/needWizard';
import { showToast } from '@/ui/Toast';

/** Assistant « Nouveau besoin » : porte l’état du brouillon pour les six étapes. */
export default function NeedLayout() {
  const { t } = useI18n();
  useWizard();
  // État présent à l’ouverture ? (absent après un rechargement du web au milieu de l’assistant)
  const openedWithState = useRef(getWizard() !== null).current;
  useEffect(() => () => {
    // Sortie de l’assistant (retour, geste, bouton système) : le brouillon est enregistré.
    if (getWizard()) { void closeWizard().then(() => showToast(t('draftSaved'))); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Rechargement du web au milieu de l’assistant : l’état en mémoire est perdu, le brouillon est dans la liste.
  if (!openedWithState) return <Redirect href="/transactions" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
