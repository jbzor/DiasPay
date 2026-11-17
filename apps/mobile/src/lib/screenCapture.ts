import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as ScreenCapture from 'expo-screen-capture';

/**
 * Lot X (X1.3) : interdit captures et enregistrements d’écran tant que l’écran est affiché (iOS, Android).
 * Sans effet sur le web, où l’API n’existe pas (le crochet du module y journalise une erreur à chaque montage).
 */
export function useNoScreenCapture(key: string): void {
  useEffect(() => {
    if (Platform.OS === 'web') return undefined;
    ScreenCapture.preventScreenCaptureAsync(key).catch(() => undefined);
    return () => { ScreenCapture.allowScreenCaptureAsync(key).catch(() => undefined); };
  }, [key]);
}
