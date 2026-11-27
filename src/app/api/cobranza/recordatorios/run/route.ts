import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import {
  loadReminderConfig,
  localDateInZone,
  runCollectionReminders,
} from "@/lib/collections/reminders";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * POST /api/cobranza/recordatorios/run
 *
 * Ejecuta la escalera para una fecha local:
 *   { date?: "YYYY-MM-DD", dry_run?: boolean, limit?: number }
 *
 * `dry_run` arma los mensajes con datos reales pero no envía ni escribe
 * la bitácora. El botón "Enviar ahora" usa dry_run=false y respeta la
 * idempotencia: lo ya enviado no se repite.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `recordatorios-run:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => ({}))) as {
      date?: unknown;
      dry_run?: unknown;
      limit?: unknown;
    };

    const date =
      typeof body.date === "string" && DATE_RE.test(body.date)
        ? body.date
        : null;
    if (body.date && !date) {
      return NextResponse.json(
        { error: "La fecha debe tener formato YYYY-MM-DD." },
        { status: 400 },
      );
    }

    const config = await loadReminderConfig(ctx.supabase, ctx.accountId);
    if (config.migrationPending) {
      return NextResponse.json(
        {
          error:
            "Falta aplicar la migración 134. Ejecuta PROD_UPDATE_134.sql en Supabase.",
        },
        { status: 409 },
      );
    }
    if (!config.settings.enabled) {
      return NextResponse.json(
        { error: "Los recordatorios están apagados." },
        { status: 409 },
      );
    }

    const runDate = date ?? localDateInZone(config.timezone);
    const dryRun = body.dry_run === true;
    const requestedLimit =
      typeof body.limit === "number" ? body.limit : Number(body.limit);

    const summary = await runCollectionReminders({
      supabase: ctx.supabase,
      accountId: ctx.accountId,
      settings: config.settings,
      date: runDate,
      dryRun,
      limit: Number.isFinite(requestedLimit) ? requestedLimit : undefined,
    });

    if (!dryRun) {
      // Se guarda un resumen compacto: la bitácora ya tiene el detalle
      // por cuota, no hace falta duplicarlo en JSON.
      const stored = {
        date: summary.date,
        candidates: summary.candidates,
        sent: summary.sent,
        failed: summary.failed,
        skipped: summary.skipped,
        reasons: summary.reasons,
        ran_at: summary.ran_at,
      };
      const { error } = await ctx.supabase
        .from("collection_reminder_settings")
        .update({
          last_run_at: summary.ran_at,
          last_run_summary: stored,
        })
        .eq("account_id", ctx.accountId);
      if (error) {
        console.error("[recordatorios/run] last_run update", error.message);
      }
    }

    return NextResponse.json({
      ...summary,
      // La UI no necesita cientos de filas para pintar el resultado.
      items: summary.items.slice(0, 200),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
