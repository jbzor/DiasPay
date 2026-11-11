import { describe, expect, it } from 'vitest';
import { STATIC_SECURITY_HEADERS, buildCsp, newNonce, supabaseOrigins } from '@/lib/security';

const header = (k: string) => STATIC_SECURITY_HEADERS.find((h) => h.key === k)?.value;

describe('en-têtes de sécurité', () => {
  const csp = buildCsp('abc123', 'https://ref.supabase.co');
  const dir = (name: string) => csp.split('; ').find((d) => d.startsWith(`${name} `)) ?? '';

  it('CSP stricte en production : nonce, aucun unsafe-inline ni unsafe-eval', () => {
    expect(dir('script-src')).toContain("'nonce-abc123'");
    expect(dir('script-src')).toContain("'strict-dynamic'");
    expect(dir('style-src')).toBe("style-src 'self' 'nonce-abc123'");
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
    expect(dir('frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(dir('object-src')).toBe("object-src 'none'");
    expect(dir('default-src')).toBe("default-src 'self'");
    expect(csp).toContain('upgrade-insecure-requests');
  });

  it('seul le projet Supabase est joignable (API et temps réel)', () => {
    expect(dir('connect-src')).toBe("connect-src 'self' https://ref.supabase.co wss://ref.supabase.co");
    expect(supabaseOrigins('http://127.0.0.1:54321').wss).toBe('ws://127.0.0.1:54321');
  });

  it('en-têtes fixes : cadre interdit, pas de référent, pas de détection de type', () => {
    expect(header('X-Frame-Options')).toBe('DENY');
    expect(header('Referrer-Policy')).toBe('no-referrer');
    expect(header('X-Content-Type-Options')).toBe('nosniff');
    expect(header('Strict-Transport-Security')).toMatch(/max-age=\d+/);
  });

  it('nonce aléatoire de 128 bits', () => {
    const a = newNonce(); const b = newNonce();
    expect(a).not.toBe(b);
    expect(Buffer.from(a, 'base64')).toHaveLength(16);
  });
});
