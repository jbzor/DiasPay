import { describe, expect, it } from 'vitest';
import { decideAccess, safeNext } from '@/lib/access';
import type { AccessInput } from '@/lib/access';

const staff = (role: 'USER' | 'VALIDATOR' | 'ADMIN', aal: 'aal1' | 'aal2' = 'aal1', nextAal: 'aal1' | 'aal2' = aal) => ({ role, aal, nextAal });
const go = (path: string, user: AccessInput['user'], requireMfa = false) => decideAccess({ path, user, requireMfa });

describe('règles d’accès du bureau de contrôle', () => {
  it('sans session : seules les pages de connexion sont ouvertes', () => {
    expect(go('/connexion', null)).toEqual({ kind: 'allow' });
    expect(go('/mot-de-passe-oublie', null)).toEqual({ kind: 'allow' });
    expect(go('/dossiers', null)).toEqual({ kind: 'redirect', to: '/connexion?suite=%2Fdossiers' });
    expect(go('/connexion/second-facteur', null)).toEqual({ kind: 'redirect', to: '/connexion' });
    expect(go('/journal', null)).toMatchObject({ kind: 'redirect' });
  });

  it('un utilisateur ordinaire n’accède à rien', () => {
    for (const p of ['/dossiers', '/preuves', '/litiges', '/journal', '/connexion/second-facteur', '/connexion']) {
      expect(go(p, staff('USER'))).toEqual({ kind: 'redirect', to: '/acces-refuse' });
    }
    expect(go('/acces-refuse', staff('USER'))).toEqual({ kind: 'allow' });
  });

  it('un validateur accède aux dossiers, preuves et journal, pas aux litiges', () => {
    for (const p of ['/dossiers', '/preuves', '/journal']) expect(go(p, staff('VALIDATOR'))).toEqual({ kind: 'allow' });
    expect(go('/litiges', staff('VALIDATOR'))).toEqual({ kind: 'redirect', to: '/acces-refuse?motif=admin' });
    expect(go('/litiges', staff('ADMIN'))).toEqual({ kind: 'allow' });
  });

  it('second facteur exigé (production) : aal1 renvoyé vers le second facteur, aal2 admis', () => {
    expect(go('/dossiers', staff('VALIDATOR', 'aal1'), true)).toEqual({ kind: 'redirect', to: '/connexion/second-facteur' });
    expect(go('/connexion/second-facteur', staff('ADMIN', 'aal1'), true)).toEqual({ kind: 'allow' });
    expect(go('/dossiers', staff('VALIDATOR', 'aal2'), true)).toEqual({ kind: 'allow' });
    expect(go('/connexion/second-facteur', staff('VALIDATOR', 'aal2'), true)).toEqual({ kind: 'redirect', to: '/dossiers' });
  });

  it('second facteur non exigé : demandé quand même si l’utilisateur en a un', () => {
    expect(go('/dossiers', staff('VALIDATOR', 'aal1', 'aal1'))).toEqual({ kind: 'allow' });
    expect(go('/dossiers', staff('VALIDATOR', 'aal1', 'aal2'))).toEqual({ kind: 'redirect', to: '/connexion/second-facteur' });
  });

  it('connecté : la page de connexion renvoie au bureau', () => {
    expect(go('/connexion', staff('ADMIN'))).toEqual({ kind: 'redirect', to: '/dossiers' });
    expect(go('/', staff('ADMIN'))).toEqual({ kind: 'redirect', to: '/dossiers' });
  });

  it('pas de redirection ouverte après connexion', () => {
    expect(safeNext('/journal')).toBe('/journal');
    for (const bad of ['https://exemple.com', '//exemple.com', '/\\exemple.com', '', null, undefined]) expect(safeNext(bad)).toBe('/dossiers');
  });
});
