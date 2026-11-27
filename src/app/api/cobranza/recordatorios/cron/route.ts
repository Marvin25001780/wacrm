import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/flows/admin-client";
import {
  localDateInZone,
  localHourInZone,
  runCollectionReminders,
  type ReminderSettings,
} from "@/lib/collections/reminders";
import { getSiteBaseUrl } from "@/lib/collections/payment-links";

/**
 * GET /api/cobranza/recordatorios/cron
 *
 * Punto de entrada para el programador externo (Hostinger cron, Vercel
 * Cron, cron-job.org…). Debe llamarse **cada hora** con el encabezado
 * `x-cron-secret: <COLLECTION_REMINDER_CRON_SECRET>`.
 *
 * Por cada negocio con recordatorios activos:
 *   - respeta su hora local (`send_hour`),
 *   - no repite la corrida del mismo día (`last_run_at`),
 *   - envía solo las cuotas que caen en los tres peldaños,
 *   - registra el resumen en `last_run_summary`.
 *
 * La idempotencia real vive en `collection_reminder_claim`: aunque dos
 * instancias se solapen, una cuota no recibe el mismo aviso dos veces.
 */
export async function GET(request: Request) {
  const expected = process.env.COLLECTION_REMINDER_CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "cron not configured" },
      { status: 503 },
    );
  }
  if (request.headers.get("x-cron-secret") !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = supabaseAdmin();
  // Sin request no hay host: el cron depende de NEXT_PUBLIC_SITE_URL.
  // Si falta y algún mensaje pide el enlace, esa fila se omite con
  // motivo en vez de enviar una plantilla incompleta.
  const siteBaseUrl = getSiteBaseUrl();

  const { data: rows, error } = await db
    .from("collection_reminder_settings")
    .select("*")
    .eq("enabled", true);

  if (error) {
    console.error("[recordatorios/cron] settings", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data: zones } = await db
    .from("collection_settings")
    .select("account_id, timezone");
  const timezoneByAccount = new Map<string, string>();
  for (const row of zones ?? []) {
    if (row.account_id && row.timezone) {
      timezoneByAccount.set(row.account_id, row.timezone);
    }
  }

  const results: Array<{
    account_id: string;
    status: "sent" | "failed" | "skipped";
    reason?: string;
    sent?: number;
    failed?: number;
    skipped?: number;
    candidates?: number;
  }> = [];

  for (const row of (rows ?? []) as ReminderSettings[]) {
    const timezone = timezoneByAccount.get(row.account_id) ?? "America/Caracas";
    const today = localDateInZone(timezone);
    const hour = localHourInZone(timezone);

    if (hour < row.send_hour) {
      results.push({
        account_id: row.account_id,
        status: "skipped",
        reason: `Antes de la hora configurada (${row.send_hour}:00 ${timezone}).`,
      });
      continue;
    }

    if (row.last_run_at) {
      const lastDate = localDateInZone(timezone, new Date(row.last_run_at));
      if (lastDate === today) {
        results.push({
          account_id: row.account_id,
          status: "skipped",
          reason: "Ya se ejecutó hoy.",
        });
        continue;
      }
    }

    try {
      const summary = await runCollectionReminders({
        supabase: db,
        accountId: row.account_id,
        settings: row,
        date: today,
        siteBaseUrl,
      });

      await db
        .from("collection_reminder_settings")
        .update({
          last_run_at: summary.ran_at,
          last_run_summary: {
            date: summary.date,
            candidates: summary.candidates,
            sent: summary.sent,
            failed: summary.failed,
            skipped: summary.skipped,
            reasons: summary.reasons,
            ran_at: summary.ran_at,
          },
        })
        .eq("account_id", row.account_id);

      results.push({
        account_id: row.account_id,
        status: "sent",
        candidates: summary.candidates,
        sent: summary.sent,
        failed: summary.failed,
        skipped: summary.skipped,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[recordatorios/cron]", row.account_id, message);
      results.push({
        account_id: row.account_id,
        status: "failed",
        reason: message,
      });
    }
  }

  return NextResponse.json({
    ok: results.every((result) => result.status !== "failed"),
    ran_at: new Date().toISOString(),
    accounts: results,
  });
}
