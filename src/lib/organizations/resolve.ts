import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Resuelve el nombre de empresa escrito por el usuario a un
 * `organizations.id`. Si no existe, la crea al vuelo (agent+).
 * Devuelve `null` si el nombre viene vacío o si falla la creación.
 *
 * Compartido por el formulario de contactos, el de leads y el diálogo
 * de conversión Lead → Contacto para que todos resuelvan la empresa
 * de la misma forma.
 */
export async function resolveOrganizationId(
  db: SupabaseClient,
  accountId: string | null | undefined,
  userId: string,
  name: string | null | undefined,
): Promise<string | null> {
  const trimmed = (name ?? '').trim();
  if (!trimmed || !accountId) return null;

  const { data: existing } = await db
    .from('organizations')
    .select('id')
    .ilike('name', trimmed)
    .limit(1)
    .maybeSingle();
  if (existing) return existing.id;

  const { data: created, error } = await db
    .from('organizations')
    .insert({ user_id: userId, account_id: accountId, name: trimmed })
    .select('id')
    .single();
  if (error) return null;
  return created.id;
}
