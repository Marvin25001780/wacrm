// ============================================================
// WhatsApp config resolution — la única forma correcta de responder
// "¿qué línea de WhatsApp uso para esta cuenta / este hilo?"
//
// Antes de 067 `whatsapp_config` tenía como máximo una fila por
// cuenta, así que el código hacía `.eq('account_id', x).maybeSingle()`
// por todas partes. Con varias líneas eso ya no es válido: PostgREST
// devuelve PGRST116 (más de una fila) y el envío/ajustes revientan. Y
// "la primera que salga" es peor que fallar: responde desde el número
// equivocado, que es justo lo que este producto no puede hacer.
//
// Regla (diseño B, §3.1 del doc de diseño):
//   1. Si el hilo dice de qué línea es (`conversations.whatsapp_config_id`),
//      ESA manda.
//   2. Si no, la marcada `is_default` de la cuenta.
//   3. Si no hay ninguna marcada (solo posible con datos viejos o un
//      borrado manual), la más antigua: determinista, nunca arbitraria.
//
// Todos los lectores de `whatsapp_config` pasan por aquí.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

export interface WhatsappConfigRow {
  id: string;
  account_id: string;
  /** Puede ser NULL desde 067: si se borra el usuario que conectó la
   *  línea, el número sobrevive (la FK es ON DELETE SET NULL). */
  user_id: string | null;
  phone_number_id: string;
  waba_id: string | null;
  access_token: string;
  verify_token: string | null;
  status: string;
  label: string | null;
  is_default: boolean;
  connected_at: string | null;
  registered_at: string | null;
  subscribed_apps_at: string | null;
  last_registration_error: string | null;
  mirror_inbound_media: boolean;
  created_at: string | null;
  updated_at: string | null;
}

interface ResolveResult {
  data: WhatsappConfigRow | null;
  error: string | null;
}

/**
 * Resuelve la línea de WhatsApp de una cuenta.
 *
 * @param preferredId `conversations.whatsapp_config_id` cuando se está
 *   respondiendo a un hilo concreto. Si apunta a una fila que ya no
 *   existe (la línea se desconectó y la FK lo dejó en NULL, o se borró
 *   la fila), se ignora y se cae a la de por defecto: preferimos
 *   responder por la línea por defecto antes que no responder.
 */
export async function resolveWhatsappConfig(
  db: SupabaseClient,
  accountId: string,
  preferredId?: string | null
): Promise<ResolveResult> {
  const { data, error } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId);

  if (error) {
    return { data: null, error: error.message };
  }

  const rows = (data ?? []) as WhatsappConfigRow[];
  if (rows.length === 0) return { data: null, error: null };

  if (preferredId) {
    const preferred = rows.find((r) => r.id === preferredId);
    if (preferred) return { data: preferred, error: null };
  }

  // `find` sobre el array: el índice parcial garantiza que a lo sumo
  // una fila tiene `is_default`, así que no depende del orden.
  const fallback =
    rows.find((r) => r.is_default) ??
    [...rows].sort((a, b) =>
      String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''))
    )[0];

  return { data: fallback ?? null, error: null };
}

/**
 * Línea con la que se responde en un hilo concreto: la suya, o la por
 * defecto si el hilo no la tiene (hilos anteriores a 067 sin backfill,
 * o su línea se desconectó). Para motores (flujos, automatizaciones)
 * que tienen el `conversationId` pero no la fila.
 */
export async function resolveWhatsappConfigForConversation(
  db: SupabaseClient,
  accountId: string,
  conversationId: string
): Promise<ResolveResult> {
  const { data: conv } = await db
    .from('conversations')
    .select('whatsapp_config_id')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .maybeSingle();
  return resolveWhatsappConfig(
    db,
    accountId,
    (conv?.whatsapp_config_id as string | null | undefined) ?? null
  );
}

/**
 * Línea para operar sobre plantillas, que son de la WABA y no del número.
 * Si se conoce la WABA de la plantilla se usa una línea de esa WABA (la
 * por defecto si es de ella); si no, la por defecto de la cuenta.
 */
export async function resolveWhatsappConfigForWaba(
  db: SupabaseClient,
  accountId: string,
  wabaId?: string | null
): Promise<ResolveResult> {
  const { data, error } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId);
  if (error) return { data: null, error: error.message };

  const rows = (data ?? []) as WhatsappConfigRow[];
  if (wabaId) {
    const sameWaba = rows.filter((r) => r.waba_id === wabaId);
    const hit = sameWaba.find((r) => r.is_default) ?? sameWaba[0];
    if (hit) return { data: hit, error: null };
  }
  return resolveWhatsappConfig(db, accountId);
}

/**
 * Todas las WABA distintas de la cuenta, cada una con la línea que se
 * usará para hablar con Meta (la por defecto primero). Lo usa la
 * sincronización de plantillas, que recorre cada WABA.
 */
export async function listAccountWabas(
  db: SupabaseClient,
  accountId: string
): Promise<{ data: WhatsappConfigRow[]; error: string | null }> {
  const { data, error } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId);
  if (error) return { data: [], error: error.message };

  const rows = [...((data ?? []) as WhatsappConfigRow[])].sort(
    (a, b) =>
      Number(b.is_default) - Number(a.is_default) ||
      String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''))
  );
  const seen = new Set<string>();
  const out: WhatsappConfigRow[] = [];
  for (const r of rows) {
    if (!r.waba_id || seen.has(r.waba_id)) continue;
    seen.add(r.waba_id);
    out.push(r);
  }
  return { data: out, error: null };
}

/**
 * Atajo para los llamadores que solo necesitan saber "¿hay una línea
 * conectada?" (y su id) sin cargar el access_token.
 */
export async function resolveWhatsappConfigId(
  db: SupabaseClient,
  accountId: string
): Promise<string | null> {
  const { data } = await resolveWhatsappConfig(db, accountId);
  return data?.id ?? null;
}
