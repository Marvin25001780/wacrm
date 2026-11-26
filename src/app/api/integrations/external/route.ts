import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  isMissingIntegrationsTable,
  loadExternalIntegrations,
  normalizeIntegrationUrl,
  normalizeProjectKey,
  resolveSecret,
  toClientView,
  type ExternalIntegrationsRow,
} from '@/lib/integrations/external';

export const runtime = 'nodejs';

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

const MIGRATION_MESSAGE =
  'Falta aplicar la migración 132 (integraciones externas) en Supabase.';

type Section = Record<string, unknown> | undefined;

function section(value: unknown): Section {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function enabled(value: unknown): boolean {
  return value === true;
}

/**
 * GET /api/integrations/external
 *
 * Solo admin/owner. Devuelve la configuración sin secretos: los tokens
 * se representan con `has_token`.
 */
export async function GET() {
  try {
    const ctx = await requireRole('admin');
    return NextResponse.json(await readView(ctx));
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * POST /api/integrations/external
 *
 * Guarda una o varias secciones (cada tarjeta envía la suya). Los
 * tokens vacíos borran el guardado; si el campo no viene, se conserva.
 * Las URLs se normalizan y se exige `http(s)://`.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const { data: existing, error: existingError } = await ctx.supabase
      .from('external_integrations')
      .select('*')
      .eq('account_id', ctx.accountId)
      .maybeSingle<ExternalIntegrationsRow>();

    if (existingError && !isMissingIntegrationsTable(existingError)) {
      throw existingError;
    }
    if (existingError) return bad(MIGRATION_MESSAGE, 409);

    const update: Record<string, unknown> = {
      account_id: ctx.accountId,
      created_by: ctx.userId,
    };

    const openreplay = section(body.openreplay);
    if (openreplay) {
      const url = normalizeIntegrationUrl(openreplay.url);
      const projectKey = normalizeProjectKey(openreplay.projectKey);
      const on = enabled(openreplay.enabled);

      if (on && !url) return bad('La URL de OpenReplay no es válida (usa http:// o https://).');
      if (on && !projectKey) return bad('Falta la project key de OpenReplay.');

      update.openreplay_enabled = on;
      update.openreplay_url = url;
      update.openreplay_project_key = projectKey;
    }

    const listmonk = section(body.listmonk);
    if (listmonk) {
      const url = normalizeIntegrationUrl(listmonk.url);
      const user = text(listmonk.user);
      const listIdRaw = listmonk.listId;
      const listId =
        listIdRaw === null || listIdRaw === undefined || listIdRaw === ''
          ? null
          : Number(listIdRaw);
      const on = enabled(listmonk.enabled);

      if (on && !url) return bad('La URL de Listmonk no es válida (usa http:// o https://).');
      if (on && !user) return bad('Falta el usuario de API de Listmonk.');
      if (on && (!Number.isInteger(listId) || (listId ?? 0) <= 0)) {
        return bad('Elige la lista de Listmonk a la que se suscribirán los contactos.');
      }

      const token = await resolveSecret(
        ctx.supabase,
        ctx.accountId,
        'listmonk_token',
        listmonk.token,
      );
      const hasToken =
        token !== undefined ? Boolean(token) : Boolean(existing?.listmonk_token);
      if (on && !hasToken) return bad('Falta el token de API de Listmonk.');

      update.listmonk_enabled = on;
      update.listmonk_url = url;
      update.listmonk_user = user || null;
      update.listmonk_list_id = Number.isInteger(listId) ? listId : null;
      if (token !== undefined) update.listmonk_token = token;
    }

    const voicesummary = section(body.voicesummary);
    if (voicesummary) {
      const url = normalizeIntegrationUrl(voicesummary.url);
      const on = enabled(voicesummary.enabled);

      if (on && !url) {
        return bad('La URL de VoiceSummary no es válida (usa http:// o https://).');
      }

      const token = await resolveSecret(
        ctx.supabase,
        ctx.accountId,
        'voicesummary_token',
        voicesummary.token,
      );

      update.voicesummary_enabled = on;
      update.voicesummary_url = url;
      if (token !== undefined) update.voicesummary_token = token;
    }

    if (Object.keys(update).length === 2) {
      return bad('No hay nada que guardar.');
    }

    const { error } = await ctx.supabase
      .from('external_integrations')
      .upsert(update, { onConflict: 'account_id' });

    if (error) {
      if (isMissingIntegrationsTable(error)) return bad(MIGRATION_MESSAGE, 409);
      throw error;
    }

    return NextResponse.json(await readView(ctx));
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** DELETE /api/integrations/external — desconecta las tres integraciones. */
export async function DELETE() {
  try {
    const ctx = await requireRole('admin');
    const { error } = await ctx.supabase
      .from('external_integrations')
      .delete()
      .eq('account_id', ctx.accountId);

    if (error) {
      if (isMissingIntegrationsTable(error)) return bad(MIGRATION_MESSAGE, 409);
      throw error;
    }

    return NextResponse.json(await readView(ctx));
  } catch (error) {
    return toErrorResponse(error);
  }
}

async function readView(ctx: Awaited<ReturnType<typeof requireRole>>) {
  const { data: row, error } = await ctx.supabase
    .from('external_integrations')
    .select('*')
    .eq('account_id', ctx.accountId)
    .maybeSingle<ExternalIntegrationsRow>();

  if (error) {
    if (isMissingIntegrationsTable(error)) {
      return {
        migration_missing: true,
        view: toClientView(null, null),
      };
    }
    throw error;
  }

  const config = await loadExternalIntegrations(ctx.supabase, ctx.accountId);
  return {
    migration_missing: false,
    view: toClientView(config, row),
  };
}
