import { tMaybe } from '@/i18n';

/** Titre d’un dossier, comme la maquette : « Terrain · Parcelle Nkolbisson ». */
export const dossierTitle = (r: { vertical: string; purpose: string }): string => `${tMaybe(`vertical.${r.vertical}`) ?? r.vertical} · ${r.purpose}`;
