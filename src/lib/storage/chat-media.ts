/**
 * Helpers compartidos para el bucket `chat-media`.
 *
 * A partir de la migración 065 el bucket es **privado**: los objetos ya
 * no se pueden leer sin autorización. La app sigue guardando en
 * `messages.media_url` la URL "lógica" del objeto (la forma pública que
 * devolvía `getPublicUrl`), para no reescribir filas históricas, y la
 * convierte en URL firmada en el momento de usarla:
 *
 *   - en el navegador, `useChatMediaUrl()` (con RLS por cuenta);
 *   - en el servidor, al enviar a Meta (Meta necesita una URL que pueda
 *     descargar sin cookies).
 *
 * Este módulo es puro (sin `'use client'`): lo importan componentes de
 * cliente y rutas de servidor.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export const CHAT_MEDIA_BUCKET = 'chat-media';

/**
 * Formas de URL de Supabase Storage que apuntan a un objeto del bucket:
 *   /storage/v1/object/public/chat-media/<path>
 *   /storage/v1/object/sign/chat-media/<path>?token=…
 *   /storage/v1/object/authenticated/chat-media/<path>
 */
const PATH_MARKERS = [
  `/object/public/${CHAT_MEDIA_BUCKET}/`,
  `/object/sign/${CHAT_MEDIA_BUCKET}/`,
  `/object/authenticated/${CHAT_MEDIA_BUCKET}/`,
] as const;

/**
 * Devuelve la ruta del objeto (p. ej. `account-<uuid>/123-foto.jpg`) o
 * `null` si la URL no pertenece al bucket. Acepta URLs públicas,
 * firmadas y autenticadas, con o sin query string.
 */
export function chatMediaPathFromUrl(
  url: string | null | undefined,
): string | null {
  if (!url) return null;

  const marker = PATH_MARKERS.find((m) => url.includes(m));
  if (!marker) return null;

  const rest = url.slice(url.indexOf(marker) + marker.length).split('?')[0];
  if (!rest) return null;

  try {
    return decodeURIComponent(rest);
  } catch {
    return rest;
  }
}

/** ¿La URL apunta al bucket privado de conversaciones? */
export function isChatMediaUrl(url: string | null | undefined): boolean {
  return chatMediaPathFromUrl(url) !== null;
}

/** TTL por defecto de las URLs firmadas para Meta/Evolution: 1 hora. */
export const CHAT_MEDIA_SIGNED_TTL_SECONDS = 60 * 60;

/**
 * Convierte una URL lógica de `chat-media` en una URL firmada que un
 * tercero (Meta, Evolution) puede descargar sin cookies.
 *
 * - Si la URL no es del bucket (enlace externo, `flow-media`) se devuelve
 *   sin tocar.
 * - Devuelve `null` si el objeto ya no existe o el cliente no tiene
 *   permiso; el llamador decide cómo reportarlo.
 *
 * Con el cliente del usuario funciona gracias a la política SELECT de la
 * migración 065; con service_role (webhook, API) no pasa por RLS.
 */
export async function signChatMediaUrl(
  db: SupabaseClient,
  url: string | null | undefined,
  expiresIn: number = CHAT_MEDIA_SIGNED_TTL_SECONDS,
): Promise<string | null> {
  const path = chatMediaPathFromUrl(url);
  if (!path) return url ?? null;

  const { data, error } = await db.storage
    .from(CHAT_MEDIA_BUCKET)
    .createSignedUrl(path, expiresIn);

  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

/**
 * Firma varias rutas del bucket en una sola llamada. Devuelve un mapa
 * `ruta → URL firmada`; las rutas que fallan se omiten.
 *
 * Lo usa la API pública, que serializa muchos mensajes por página y no
 * puede permitirse una llamada por adjunto.
 */
export async function signChatMediaPaths(
  db: SupabaseClient,
  paths: string[],
  expiresIn: number = CHAT_MEDIA_SIGNED_TTL_SECONDS,
): Promise<Map<string, string>> {
  const unique = [...new Set(paths)];
  if (unique.length === 0) return new Map();

  const { data, error } = await db.storage
    .from(CHAT_MEDIA_BUCKET)
    .createSignedUrls(unique, expiresIn);

  const signed = new Map<string, string>();
  if (error || !data) return signed;

  for (const row of data) {
    if (!row.error && row.path && row.signedUrl) {
      signed.set(row.path, row.signedUrl);
    }
  }
  return signed;
}
