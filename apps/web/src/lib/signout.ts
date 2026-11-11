'use client';
/** Déconnexion volontaire en cours : la fin de session n’est pas alors une « session expirée ». */
let signingOut = false;
export const markSigningOut = (): void => { signingOut = true; };
export const isSigningOut = (): boolean => signingOut;
