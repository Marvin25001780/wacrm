import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Cliente anónimo para páginas públicas con token (enlaces de pago).
// No lee cookies ni persiste sesión: cada llamada depende solo de la
// RPC `SECURITY DEFINER` y de los permisos que la migración conceda a
// `anon`. Nunca se usa para datos de la cuenta fuera de esas RPC.
let _anonClient: SupabaseClient | null = null;

export function publicAnonClient(): SupabaseClient {
  if (!_anonClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) {
      throw new Error("Supabase público no está configurado.");
    }
    _anonClient = createClient(url, key, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  }
  return _anonClient;
}
