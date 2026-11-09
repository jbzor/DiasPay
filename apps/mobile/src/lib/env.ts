/** Fonctions de démonstration : en développement, ou build de démonstration (EXPO_PUBLIC_DEMO=1). */
export const SHOW_DEMO = __DEV__ || process.env.EXPO_PUBLIC_DEMO === '1';

/**
 * Hôte des DiasPay Links (`https://<hôte>/t/<référence>`). Aucun domaine n’est figé dans le code :
 * `EXPO_PUBLIC_LINK_BASE` (hôte ou URL de base) l’impose au build. La valeur par défaut est un domaine
 * réservé (`.example`) qui ne désigne aucun site réel ; voir le README.
 */
export const LINK_BASE: string = process.env.EXPO_PUBLIC_LINK_BASE || 'links.diaspay.example';
