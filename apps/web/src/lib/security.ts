/**
 * En-têtes de sécurité du bureau de contrôle. Fonctions pures : appliquées par le proxy (CSP à nonce, par requête)
 * et par next.config.ts (en-têtes fixes, y compris sur les fichiers statiques) ; vérifiées par test/security.test.ts
 * et par le test de bout en bout e2e/security.spec.ts.
 */

/** Origines Supabase autorisées (API, stockage, temps réel) à partir de l’URL du projet. */
export function supabaseOrigins(url: string): { https: string; wss: string } {
  const u = new URL(url);
  return { https: u.origin, wss: `${u.protocol === 'http:' ? 'ws:' : 'wss:'}//${u.host}` };
}

/**
 * CSP stricte : scripts et feuilles de style uniquement avec le nonce de la requête (aucun « unsafe-inline » en
 * production), aucune intégration dans un cadre, aucun objet. Les pièces sont affichées depuis une URL blob:
 * (téléchargées par l’application avec une URL signée), d’où blob: pour les images et les cadres.
 */
export function buildCsp(nonce: string, supabaseUrl: string, dev = false): string {
  const sb = supabaseOrigins(supabaseUrl);
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])],
    // En développement, la superposition d’erreurs de Next injecte des styles en ligne.
    'style-src': ["'self'", dev ? "'unsafe-inline'" : `'nonce-${nonce}'`],
    'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'"],
    'connect-src': ["'self'", sb.https, sb.wss],
    'frame-src': ['blob:'],
    'worker-src': ["'self'", 'blob:'],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
  };
  const csp = Object.entries(directives).map(([k, v]) => `${k} ${v.join(' ')}`);
  if (!dev) csp.push('upgrade-insecure-requests');
  return csp.join('; ');
}

/** En-têtes fixes, posés sur toutes les réponses (next.config.ts). */
export const STATIC_SECURITY_HEADERS: ReadonlyArray<{ key: string; value: string }> = [
  { key: 'X-Frame-Options', value: 'DENY' },
  // Aucune URL (ni URL signée d’une pièce) n’est transmise à un autre site.
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
];

/** Nonce aléatoire (128 bits) en base64. */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
