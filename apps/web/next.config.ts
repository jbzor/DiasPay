import type { NextConfig } from 'next';
import { STATIC_SECURITY_HEADERS } from './src/lib/security';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Paquets du monorepo publiés en TypeScript.
  transpilePackages: ['@diaspay/domain', '@diaspay/ui-tokens', '@diaspay/api-client'],
  // En-têtes fixes sur toutes les réponses ; la CSP à nonce est posée par le proxy (src/proxy.ts).
  async headers() {
    return [{ source: '/:path*', headers: [...STATIC_SECURITY_HEADERS] }];
  },
};

export default config;
