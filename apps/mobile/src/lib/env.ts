/** Fonctions de démonstration : en développement, ou build de démonstration (EXPO_PUBLIC_DEMO=1). */
export const SHOW_DEMO = __DEV__ || process.env.EXPO_PUBLIC_DEMO === '1';

/** Actions « Simuler : valider / rejeter » du bureau de contrôle : uniquement avec EXPO_PUBLIC_DEMO=1 (pas en simple développement). */
export const DEMO_REVIEW = process.env.EXPO_PUBLIC_DEMO === '1';

/** Adresses du centre d’aide et des conditions : jamais en dur ; vides → « Bientôt disponible ». */
export const HELP_URL = (process.env.EXPO_PUBLIC_HELP_URL ?? '').trim();
export const TERMS_URL = (process.env.EXPO_PUBLIC_TERMS_URL ?? '').trim();
