import { SUPABASE_KEY, SUPABASE_URL, STAFF_PASSWORD } from './env';

export default async function globalSetup(): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('apps/web/.env.local : NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY requis.');
  if (!STAFF_PASSWORD) throw new Error('.env.local (racine) : E2E_STAFF_PASSWORD requis (puis scripts/db.sh seed-staff).');
}
