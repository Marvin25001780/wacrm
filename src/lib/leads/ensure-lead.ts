// ============================================================
// Leads automáticos — "un lead por persona".
//
// Cada vez que entra un mensaje (WhatsApp/Evolution, SMS, IG, FB,
// TikTok) se asegura de que la persona tenga exactamente UN lead en
// la cuenta, siguiendo las reglas que pediste:
//
//   1. Si el contacto ya tiene un lead vinculado (leads.contact_id),
//      se usa ESE y se sincronizan sus datos (nombre/tel/email/cédula).
//   2. Si no, se busca por teléfono, cédula o correo (los tres
//      identificadores) y se asocia al match; los duplicados que
//      coincidan se fusionan en uno solo (las actividades, notas,
//      adjuntos y registros de espacio se re-asignan y el resto se
//      borra).
//   3. Si no hay match, se crea un lead nuevo con source = canal.
//
// Insert/carreras: el índice único (account_id, contact_id) de la
// migración 049 hace el upsert a prueba de concurrencia (dos webhooks
// simultáneos de la misma persona no pueden crear dos leads).
//
// Todas las llamadas son best-effort desde los webhooks: un fallo
// aquí NUNCA rompe la ingesta del mensaje, solo se loguea.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import type { MessageChannel } from '@/types';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';

export interface LeadContactSeed {
  id: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  document?: string | null;
  company?: string | null;
}

interface LeadRow {
  id: string;
  contact_id?: string | null;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  document?: string | null;
  company?: string | null;
  status?: string | null;
  created_at?: string | null;
}

export interface EnsureLeadResult {
  /** Lead canónico de la persona. */
  id: string;
  /** Cuántos leads duplicados se fusionaron (>= 0). */
  merged: number;
  /** True cuando se creó un lead nuevo. */
  created: boolean;
  /** True cuando se reutilizó/actualizó un lead existente. */
  reused: boolean;
}

/** Mapea canal → slug de origen para contacts.source / leads.source. */
export function channelToSource(channel: MessageChannel | string): string {
  return channel;
}

function phoneKey(phone?: string | null): string {
  return phone ? normalizePhone(phone) : '';
}

function emailKey(email?: string | null): string {
  return email ? email.trim().toLowerCase() : '';
}

function docKey(document?: string | null): string {
  return document ? document.trim().replace(/\s+/g, '') : '';
}

function leadMatches(lead: LeadRow, seed: LeadContactSeed): boolean {
  const lp = phoneKey(lead.phone ?? null);
  const le = emailKey(lead.email ?? null);
  const ld = docKey(lead.document ?? null);
  const sp = phoneKey(seed.phone ?? null);
  const se = emailKey(seed.email ?? null);
  const sd = docKey(seed.document ?? null);
  return (
    (lp !== '' && sp !== '' && lp === sp) ||
    (le !== '' && se !== '' && le === se) ||
    (ld !== '' && sd !== '' && ld === sd)
  );
}

/** Re-apunta las referencias de los leads duplicados al canónico. */
async function repointLeadRefs(
  db: SupabaseClient,
  keepId: string,
  dropIds: string[],
): Promise<void> {
  if (dropIds.length === 0) return;

  // Actividades (033) / notas (034) / adjuntos (035) / espacios (036).
  await Promise.allSettled([
    db
      .from('activities')
      .update({ lead_id: keepId })
      .in('lead_id', dropIds),
    db
      .from('notes')
      .update({ lead_id: keepId })
      .in('lead_id', dropIds),
    db
      .from('attachments')
      .update({ lead_id: keepId })
      .in('lead_id', dropIds),
    db
      .from('space_records')
      .update({ entity_id: keepId })
      .eq('entity_type', 'lead')
      .in('entity_id', dropIds),
  ]);

  // Ahora sí, fuera los duplicados.
  await db.from('leads').delete().in('id', dropIds);
}

/**
 * Asegura que la persona del contacto tenga exactamente un lead.
 *
 * Llamar tras resolver/crear el contacto, best-effort desde la ingesta.
 */
export async function ensureLeadForContact(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  seed: LeadContactSeed,
  channel: MessageChannel | string,
): Promise<EnsureLeadResult | null> {
  try {
    const linked = await db
      .from('leads')
      .select('id, contact_id, name, phone, email, document, company, status, created_at')
      .eq('account_id', accountId)
      .eq('contact_id', seed.id)
      .maybeSingle();

    if (linked.data) {
      // El contacto ya tiene lead: solo sincronizar datos que faltan.
      const row = linked.data as LeadRow;
      const patch: Record<string, unknown> = {};
      if (!row.name && seed.name) patch.name = seed.name;
      if (!row.phone && seed.phone) patch.phone = seed.phone;
      if (!row.email && seed.email) patch.email = seed.email;
      if (docKey(row.document ?? null) === '' && docKey(seed.document ?? null) !== '') {
        patch.document = seed.document;
      }
      if (!row.company && seed.company) patch.company = seed.company;
      if (Object.keys(patch).length > 0) {
        const { error } = await db
          .from('leads')
          .update({ ...patch, updated_at: new Date().toISOString() })
          .eq('id', row.id);
        if (error) console.warn('[ensureLead] sync update failed', error);
      }
      return { id: row.id, merged: 0, created: false, reused: true };
    }
  } catch (err) {
    console.warn('[ensureLead] linked lookup failed', err);
  }

  // --- Sin lead vinculado: buscar por teléfono / cédula / correo ---
  const candidates: LeadRow[] = [];
  try {
    const ors: string[] = [];
    const sp = phoneKey(seed.phone ?? null);
    const se = emailKey(seed.email ?? null);
    const sd = docKey(seed.document ?? null);
    if (sp) ors.push(`phone.eq.${seed.phone}`);
    if (se) ors.push(`email.eq.${seed.email?.trim()}`);
    if (sd) ors.push(`document.eq.${seed.document?.trim()}`);

    if (ors.length > 0) {
      const { data, error } = await db
        .from('leads')
        .select('id, contact_id, name, phone, email, document, company, status, created_at')
        .eq('account_id', accountId)
        .or(ors.join(','))
        .limit(25);
      if (!error && data) {
        // Los valores pueden diferir en formato (espacios/mayúsculas) —
        // validar con los mismos normalizadores que usa la fusión.
        for (const row of data as LeadRow[]) {
          if (row.contact_id && row.contact_id !== seed.id) {
            if (leadMatches(row, seed)) candidates.push(row);
          } else if (leadMatches(row, seed)) {
            candidates.push(row);
          }
        }
      }
    }
  } catch (err) {
    console.warn('[ensureLead] search failed', err);
  }

  if (candidates.length > 0) {
    // Canónico = el más viejo; el resto se fusionan en él.
    const sorted = [...candidates].sort((a, b) =>
      (a.created_at ?? '').localeCompare(b.created_at ?? ''),
    );
    const keep = sorted[0];
    const drops = sorted.slice(1).filter((d) => d.id !== keep.id);

    try {
      await repointLeadRefs(db, keep.id, drops.map((d) => d.id));
    } catch (err) {
      console.warn('[ensureLead] merge failed', err);
    }

    // Vincular el lead al contacto y coalescer datos que falten.
    const patch: Record<string, unknown> = {
      contact_id: seed.id,
      updated_at: new Date().toISOString(),
    };
    if (!keep.name && seed.name) patch.name = seed.name;
    if (docKey(keep.document ?? null) === '' && docKey(seed.document ?? null) !== '') {
      patch.document = seed.document;
    }
    if (!keep.phone && seed.phone) patch.phone = seed.phone;
    if (!keep.email && seed.email) patch.email = seed.email;
    try {
      await db.from('leads').update(patch).eq('id', keep.id);
    } catch (err) {
      console.warn('[ensureLead] link update failed', err);
    }
    return { id: keep.id, merged: drops.length, created: false, reused: true };
  }

  // --- No hay match: crear el lead del canal ---
  const name = seed.name?.trim() || seed.phone || 'Nuevo lead';
  const insert: Record<string, unknown> = {
    account_id: accountId,
    user_id: userId,
    contact_id: seed.id,
    name,
    source: channelToSource(channel),
    status: 'new',
  };
  if (seed.phone) insert.phone = seed.phone;
  if (seed.email) insert.email = seed.email;
  if (seed.document) insert.document = seed.document;
  if (seed.company) insert.company = seed.company;

  const { data, error } = await db
    .from('leads')
    .upsert(insert, { onConflict: 'account_id,contact_id', ignoreDuplicates: true })
    .select('id, contact_id, name, phone, email, document, company, status, created_at')
    .maybeSingle();

  // Concurrencia: otro webhook pudo crear el mismo lead (conflicto).
  if (!data) {
    const { data: existing } = await db
      .from('leads')
      .select('id, contact_id, name, phone, email, document, company, status, created_at')
      .eq('account_id', accountId)
      .eq('contact_id', seed.id)
      .maybeSingle();
    if (existing) {
      return { id: (existing as LeadRow).id, merged: 0, created: false, reused: true };
    }
  }

  if (error) {
    console.warn('[ensureLead] insert failed', error);
    return null;
  }

  return {
    id: (data as LeadRow | null)?.id ?? '',
    merged: 0,
    created: true,
    reused: false,
  };
}

/**
 * Variante cómoda: dado el id del contacto (recién creado o existente),
 * carga su fila y asegura el lead. Best-effort desde los webhooks.
 */
export async function ensureLeadForContactRow(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  contactId: string,
  channel: MessageChannel | string,
): Promise<EnsureLeadResult | null> {
  try {
    const { data: contact } = await db
      .from('contacts')
      .select('id, name, phone, email, document, company')
      .eq('account_id', accountId)
      .eq('id', contactId)
      .maybeSingle();
    if (!contact) return null;
    return ensureLeadForContact(db, accountId, userId, contact as LeadContactSeed, channel);
  } catch (err) {
    console.warn('[ensureLead] row lookup failed', err);
    return null;
  }
}