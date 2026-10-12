// ============================================================
// Fotografías de perfil de los contactos.
//
// Cuando el cliente nos escribe por WhatsApp (Evolution/Baileys) o por
// Instagram/Facebook (Graph API), intentamos traer su foto de perfil y
// guardarla en el bucket público `contact-avatars`, rellenando
// `contacts.avatar_url` para que la Bandeja la muestre con un <img>
// plano (sin URLs firmadas en memoria).
//
//  - Instagram / Facebook: `GET /{sender_id}/picture` con el token de
//    la página (Microsoft/Meta Graph). Best-effort: algunos scoped IDs
//    no exponen foto y entonces se salta en silencio.
//  - WhatsApp (Evolution): `GET /chat/findContacts/{instance}/{jid}`
//    devuelve la foto real de perfil de contacto.
//  - Meta Cloud API (whatsapp_config) no publica la foto de contacto →
//    se omite (no hay endpoint).
//
// El mismo módulo alimenta el botón manual "Capturar foto de perfil"
// de la Bandeja: POST /api/inbox/avatar vuelve a correr esta función.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { META_GRAPH_BASE } from '@/lib/channels/meta';
import {
  evolutionContactPicture,
  type EvolutionCreds,
} from '@/lib/channels/evolution';
import { decrypt } from '@/lib/whatsapp/encryption';

export const CONTACT_AVATAR_BUCKET = 'contact-avatars';
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

export interface AvatarSyncResult {
  updated: boolean;
  url?: string;
}

async function downloadImage(
  url: string,
  timeoutMs = 12000,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'nexusbpo-crm/1.0' },
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.startsWith('image/')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_AVATAR_BYTES) return null;
    return { bytes: new Uint8Array(buf), contentType };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function extFor(contentType: string): string {
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('gif')) return 'gif';
  return 'jpg';
}

async function storeAvatar(
  admin: SupabaseClient,
  accountId: string,
  contactId: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<string | null> {
  const path = `account-${accountId}/${Date.now()}-${contactId.slice(0, 8)}.${extFor(contentType)}`;
  const { error } = await admin.storage
    .from(CONTACT_AVATAR_BUCKET)
    .upload(path, bytes, { contentType, cacheControl: '31536000', upsert: true });
  if (error) {
    console.warn('[avatar] storage upload failed', error.message);
    return null;
  }
  const { data } = admin.storage
    .from(CONTACT_AVATAR_BUCKET)
    .getPublicUrl(path);
  return data.publicUrl;
}

/** Descifra un secreto plan de channel_configs (evita re-criptar). */
function decryptIfNeeded(value: unknown): string {
  if (typeof value !== 'string' || !value) return '';
  try {
    return decrypt(value);
  } catch {
    return value;
  }
}

export async function syncContactAvatar(
  admin: SupabaseClient,
  accountId: string,
  contact: {
    id: string;
    avatar_url?: string | null;
    phone?: string | null;
  },
): Promise<AvatarSyncResult> {
  if (contact.avatar_url) return { updated: false };

  const { data: convs, error } = await admin
    .from('conversations')
    .select('channel, external_contact_id')
    .eq('account_id', accountId)
    .eq('contact_id', contact.id)
    .limit(10);

  if (error || !convs || convs.length === 0) return { updated: false };

  for (const conv of convs as { channel?: string | null; external_contact_id?: string | null }[]) {
    const channel = conv.channel ?? 'whatsapp';
    const extId = conv.external_contact_id || null;

    try {
      if ((channel === 'instagram' || channel === 'facebook') && extId) {
        const { data: cfgRow } = await admin
          .from('channel_configs')
          .select('config, is_active')
          .eq('account_id', accountId)
          .eq('channel', channel)
          .maybeSingle();
        if (!cfgRow?.is_active) continue;
        const config = (cfgRow.config ?? {}) as Record<string, unknown>;
        const accessToken = decryptIfNeeded(config.access_token);
        if (!accessToken) continue;

        const url = `${META_GRAPH_BASE}/${encodeURIComponent(extId)}/picture?type=large&access_token=${encodeURIComponent(accessToken)}`;
        const img = await downloadImage(url);
        if (!img) continue;

        const stored = await storeAvatar(admin, accountId, contact.id, img.bytes, img.contentType);
        if (stored) {
          await admin.from('contacts').update({ avatar_url: stored }).eq('id', contact.id);
          return { updated: true, url: stored };
        }
      }

      if (channel === 'whatsapp' && contact.phone) {
        const { data: cfgRow } = await admin
          .from('channel_configs')
          .select('config, is_active')
          .eq('account_id', accountId)
          .eq('channel', 'evolution')
          .maybeSingle();
        if (!cfgRow?.is_active) continue;
        const config = (cfgRow.config ?? {}) as Record<string, unknown>;
        const baseUrl = typeof config.base_url === 'string' ? config.base_url : '';
        const apiKey = decryptIfNeeded(config.api_key);
        const instance =
          (typeof config.instance === 'string' && config.instance) ||
          (typeof config.instance_name === 'string' ? config.instance_name : '') ||
          '';
        if (!baseUrl || !apiKey || !instance) continue;

        const digits = contact.phone.replace(/\D/g, '');
        const jid = `${digits}@s.whatsapp.net`;
        const creds: EvolutionCreds = { baseUrl, apiKey };
        const res = await evolutionContactPicture(creds, instance, jid);
        if (!res.ok || !res.data.picUrl) continue;

        const img = await downloadImage(res.data.picUrl);
        if (!img) continue;

        const stored = await storeAvatar(admin, accountId, contact.id, img.bytes, img.contentType);
        if (stored) {
          await admin.from('contacts').update({ avatar_url: stored }).eq('id', contact.id);
          return { updated: true, url: stored };
        }
      }
    } catch (err) {
      console.warn('[avatar] source failed', channel, err);
    }
  }

  return { updated: false };
}