import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  loadReminderConfig,
  localDateInZone,
  reminderKindLabel,
  renderReminderText,
  renderWhatsappPreview,
  whatsappParamsFor,
  type ReminderCandidate,
  type ReminderKind,
  type ReminderSettings,
} from "@/lib/collections/reminders";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/cobranza/recordatorios/preview?date=YYYY-MM-DD
 *
 * Qué se enviaría hoy (o en la fecha indicada): cuotas reales que
 * caen en los tres peldaños, con saldo, contacto y el texto ya
 * renderizado. No envía nada ni escribe en la bitácora.
 *
 * La fecha es local del negocio. Sirve para ensayar la escalera antes
 * de encenderla: el admin elige una fecha y ve exactamente quiénes
 * entrarían.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireRole("agent");
    const url = new URL(request.url);
    const requested = url.searchParams.get("date");
    if (requested && !DATE_RE.test(requested)) {
      return NextResponse.json(
        { error: "La fecha debe tener formato YYYY-MM-DD." },
        { status: 400 },
      );
    }

    const config = await loadReminderConfig(ctx.supabase, ctx.accountId);
    const date = requested ?? localDateInZone(config.timezone);

    if (config.migrationPending) {
      return NextResponse.json({
        enabled: false,
        migration_pending: true,
        date,
        timezone: config.timezone,
        candidates: [],
        counts: emptyCounts(),
        samples: [],
      });
    }

    if (!config.settings.enabled) {
      return NextResponse.json({
        enabled: false,
        migration_pending: false,
        date,
        timezone: config.timezone,
        candidates: [],
        counts: emptyCounts(),
        samples: [],
        message: "Los recordatorios están apagados.",
      });
    }

    const { data, error } = await ctx.supabase.rpc(
      "collection_reminder_candidates",
      {
        p_account_id: ctx.accountId,
        p_date: date,
        p_limit: Math.min(config.settings.max_per_run, 500),
      },
    );
    if (error) throw new Error(error.message);

    const candidates = ((data ?? []) as ReminderCandidate[]).map((row) => ({
      ...row,
      balance: Number(row.balance) || 0,
      days_delta: Number(row.days_delta) || 0,
      installment_number: Number(row.installment_number) || 0,
    }));

    // Plantilla aprobada para renderizar la vista previa real.
    let templateBody: string | null = null;
    let templateError: string | null = null;
    if (config.settings.whatsapp_enabled && config.settings.whatsapp_template) {
      const result = await ctx.supabase
        .from("message_templates")
        .select("body_text")
        .eq("account_id", ctx.accountId)
        .eq("name", config.settings.whatsapp_template)
        .eq("status", "APPROVED")
        .maybeSingle<{ body_text: string }>();
      if (result.error) templateError = result.error.message;
      else if (!result.data) {
        templateError = "La plantilla seleccionada no está aprobada.";
      } else {
        templateBody = result.data.body_text;
      }
    } else if (config.settings.whatsapp_enabled) {
      templateError = "No hay plantilla seleccionada.";
    }

    const counts = emptyCounts();
    for (const candidate of candidates) {
      counts.total += 1;
      counts[candidate.kind] += 1;
      if (candidate.whatsapp_sent) counts.whatsapp_sent += 1;
      if (candidate.email_sent) counts.email_sent += 1;
    }

    const samples = buildSamples(
      candidates,
      config.settings,
      templateBody,
      templateError,
    );

    return NextResponse.json({
      enabled: true,
      migration_pending: false,
      date,
      timezone: config.timezone,
      counts,
      candidates: candidates.slice(0, 200),
      samples,
      template_error: templateError,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

function emptyCounts() {
  return {
    total: 0,
    before_due: 0,
    on_due: 0,
    after_due: 0,
    whatsapp_sent: 0,
    email_sent: 0,
  };
}

function buildSamples(
  candidates: ReminderCandidate[],
  settings: ReminderSettings,
  templateBody: string | null,
  templateError: string | null,
) {
  const kinds: ReminderKind[] = ["before_due", "on_due", "after_due"];
  const samples: Array<{
    kind: ReminderKind;
    label: string;
    debtor_name: string;
    whatsapp: string | null;
    whatsapp_error: string | null;
    email_subject: string;
    email_body: string;
  }> = [];

  for (const kind of kinds) {
    const candidate = candidates.find((row) => row.kind === kind);
    if (!candidate) continue;

    let whatsapp: string | null = null;
    let whatsappError: string | null = templateError;
    if (templateBody) {
      const parsed = whatsappParamsFor(templateBody, candidate);
      if (parsed.ok) {
        whatsapp = renderWhatsappPreview(templateBody, parsed.params);
        whatsappError = null;
      } else {
        whatsappError = parsed.error;
      }
    }

    samples.push({
      kind,
      label: reminderKindLabel(kind, settings),
      debtor_name: candidate.debtor_name,
      whatsapp,
      whatsapp_error: whatsappError,
      email_subject: renderReminderText(settings.email_subject, candidate),
      email_body: renderReminderText(settings.email_body, candidate),
    });
  }

  return samples;
}
