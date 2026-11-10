import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { bioKind } from '@/lib/biometry';
import type { BioKind } from '@/lib/biometry';

/** Moyen biométrique de l’appareil (Face ID, empreinte…) et disponibilité. */
export function useBioKind(): { kind: BioKind; available: boolean | null } {
  const [state, setState] = useState<{ kind: BioKind; available: boolean | null }>({ kind: bioKind(Platform.OS, []), available: null });
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [hw, enrolled, types] = await Promise.all([
          LocalAuthentication.hasHardwareAsync(), LocalAuthentication.isEnrolledAsync(), LocalAuthentication.supportedAuthenticationTypesAsync(),
        ]);
        if (alive) setState({ kind: bioKind(Platform.OS, types), available: hw && enrolled });
      } catch {
        if (alive) setState((s) => ({ ...s, available: false }));
      }
    })();
    return () => { alive = false; };
  }, []);
  return state;
}
