'use client';
import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@diaspay/api-client';

let client: SupabaseClient<Database> | null = null;

/** Client Supabase du navigateur (session dans les cookies, partagée avec le serveur). Une seule instance. */
export function browserClient(): SupabaseClient<Database> {
  if (!client) {
    // Lu en ligne : Next remplace les NEXT_PUBLIC_* au moment de la construction.
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
    client = createBrowserClient<Database>(url, key);
  }
  return client;
}
