// ============================================================
// Recordatorios preventivos por cuota (migración 134) — servidor.
//
// La parte pura (reglas, textos, normalización) vive en
// `reminders-shared.ts` para poder usarla también en el navegador.
// Aquí está lo que habla con Supabase, WhatsApp y Mailflare.
//
// Reglas que no se negocian:
//   * WhatsApp siempre sale como plantilla aprobada (el recordatorio
//     es el primer mensaje y suele estar fuera de la ventana de 24 h).
//   * El correo sale con el asunto y cuerpo del negocio, con datos
//     reales de la cuota; nunca con montos o fechas inventados.
//   * La reserva (`collection_reminder_claim`) es atómica: un mismo
//     recordatorio no se manda dos veces aunque el cron se solape.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  defaultReminderSettings,
  emailHtml,
  renderReminderText,
  renderWhatsappPreview,
  safeTimezone,
  whatsappParamsFor,
  type ReminderCandidate,
  type ReminderChannel,
  type ReminderRunItem,
  type ReminderRunSummary,
  type ReminderSettings,
} from "./reminders-shared";
import { resolveConversationByPhone } from "@/lib/whatsapp/resolve-conversation";
import { sendMessageToConversation } from "@/lib/whatsapp/send-message";
import { loadMailflareConfig, sendEmail } from "@/lib/email/mailflare";

// Los tipos y helpers puros se reexportan para que las rutas tengan un
// único punto de importación (`@/lib/collections/reminders`).
export * from "./reminders-shared";

// ------------------------------------------------------------
// 1. Carga de la configuración
// ------------------------------------------------------------

export interface ReminderConfig {
  settings: ReminderSettings;
  /** false = el negocio todavía no guardó reglas (se usan los valores por defecto). */
  persisted: boolean;
  /** true = la migración 134 todavía no está aplicada en esta base. */
  migrationPending: boolean;
  timezone: string;
}

export async function loadReminderConfig(
  supabase: SupabaseClient,
  accountId: string,
): Promise<ReminderConfig> {
  const [settingsRes, timezoneRes] = await Promise.all([
    supabase
      .from("collection_reminder_settings")
      .select("*")
      .eq("account_id", accountId)
      .maybeSingle<ReminderSettings>(),
    supabase
      .from("collection_settings")
      .select("timezone")
      .eq("account_id", accountId)
      .maybeSingle<{ timezone: string | null }>(),
  ]);

  const migrationPending =
    settingsRes.error?.code === "42P01" ||
    settingsRes.error?.code === "PGRST205";

  if (settingsRes.error && !migrationPending) {
    throw new Error(
      `No se pudo leer la configuración de recordatorios: ${settingsRes.error.message}`,
    );
  }

  return {
    settings: settingsRes.data ?? defaultReminderSettings(accountId),
    persisted: Boolean(settingsRes.data),
    migrationPending,
    timezone: safeTimezone(timezoneRes.data?.timezone),
  };
}

// ------------------------------------------------------------
// 2. Ejecución
// ------------------------------------------------------------

export interface RunRemindersOptions {
  supabase: SupabaseClient;
  accountId: string;
  settings: ReminderSettings;
  /** Fecha local YYYY-MM-DD de la corrida. */
  date: string;
  dryRun?: boolean;
  limit?: number;
}

interface TemplateRow {
  name: string;
  language: string | null;
  body_text: string;
  status: string;
}

function clampLimit(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.round(parsed), 1), 1000);
}

export async function runCollectionReminders(
  options: RunRemindersOptions,
): Promise<ReminderRunSummary> {
  const { supabase, accountId, settings, date, dryRun = false } = options;
  const limit = clampLimit(options.limit ?? settings.max_per_run, 200);
  const now = new Date();
  const items: ReminderRunItem[] = [];
  const reasons: Record<string, number> = {};

  const note = (reason: string) => {
    reasons[reason] = (reasons[reason] ?? 0) + 1;
  };

  const { data, error } = await supabase.rpc("collection_reminder_candidates", {
    p_account_id: accountId,
    p_date: date,
    p_limit: limit,
  });
  if (error) {
    throw new Error(`No se pudieron leer las cuotas: ${error.message}`);
  }

  const candidates = ((data ?? []) as ReminderCandidate[]).map((row) => ({
    ...row,
    balance: Number(row.balance) || 0,
    days_delta: Number(row.days_delta) || 0,
    installment_number: Number(row.installment_number) || 0,
  }));

  // Plantilla aprobada (una sola lectura para toda la corrida).
  let template: TemplateRow | null = null;
  let templateError: string | null = null;
  if (settings.whatsapp_enabled && settings.whatsapp_template) {
    const result = await supabase
      .from("message_templates")
      .select("name, language, body_text, status")
      .eq("account_id", accountId)
      .eq("name", settings.whatsapp_template)
      .eq("status", "APPROVED")
      .maybeSingle<TemplateRow>();
    if (result.error) {
      templateError = result.error.message;
    } else if (!result.data) {
      templateError = `La plantilla "${settings.whatsapp_template}" no está aprobada.`;
    } else {
      template = result.data;
    }
  } else if (settings.whatsapp_enabled) {
    templateError = "No hay plantilla de WhatsApp seleccionada.";
  }

  // Correo (solo si el canal está activo y Mailflare está configurado).
  const mailflare = settings.email_enabled
    ? await loadMailflareConfig(supabase, accountId).catch(() => null)
    : null;

  interface Task {
    candidate: ReminderCandidate;
    channel: ReminderChannel;
  }

  const tasks: Task[] = [];
  for (const candidate of candidates) {
    const wantsWhatsapp =
      settings.whatsapp_enabled && !candidate.whatsapp_sent;
    const wantsEmail = settings.email_enabled && !candidate.email_sent;

    if (!wantsWhatsapp && !wantsEmail) {
      items.push({
        installment_id: candidate.installment_id,
        debtor_name: candidate.debtor_name,
        kind: candidate.kind,
        channel: "whatsapp",
        status: "skipped",
        reason: "Ya se envió por los canales activos.",
      });
      note("ya enviado");
      continue;
    }

    if (wantsWhatsapp) {
      if (!candidate.phone) {
        items.push({
          installment_id: candidate.installment_id,
          debtor_name: candidate.debtor_name,
          kind: candidate.kind,
          channel: "whatsapp",
          status: "skipped",
          reason: "El deudor no tiene teléfono.",
        });
        note("whatsapp: sin teléfono");
      } else if (!template) {
        items.push({
          installment_id: candidate.installment_id,
          debtor_name: candidate.debtor_name,
          kind: candidate.kind,
          channel: "whatsapp",
          status: "skipped",
          reason: templateError ?? "Plantilla no disponible.",
        });
        note("whatsapp: plantilla no disponible");
      } else {
        tasks.push({ candidate, channel: "whatsapp" });
      }
    }

    if (wantsEmail) {
      if (!candidate.email) {
        items.push({
          installment_id: candidate.installment_id,
          debtor_name: candidate.debtor_name,
          kind: candidate.kind,
          channel: "email",
          status: "skipped",
          reason: "El deudor no tiene correo.",
        });
        note("correo: sin dirección");
      } else if (!mailflare) {
        items.push({
          installment_id: candidate.installment_id,
          debtor_name: candidate.debtor_name,
          kind: candidate.kind,
          channel: "email",
          status: "skipped",
          reason: "El correo no está configurado en Ajustes → Correo.",
        });
        note("correo: no configurado");
      } else {
        tasks.push({ candidate, channel: "email" });
      }
    }
  }

  if (dryRun) {
    for (const task of tasks) {
      items.push(previewItem(task.candidate, task.channel, settings, template));
    }
    return buildSummary(date, true, candidates.length, items, reasons, now);
  }

  // Envío con concurrencia limitada: suficiente para no eternizar la
  // corrida y conservador con la API de Meta.
  await mapWithConcurrency(tasks, 4, async (task) => {
    const { candidate, channel } = task;
    const claimed = await claim(supabase, accountId, candidate, channel);
    if (!claimed) {
      items.push({
        installment_id: candidate.installment_id,
        debtor_name: candidate.debtor_name,
        kind: candidate.kind,
        channel,
        status: "skipped",
        reason: "Otro proceso ya lo está enviando.",
      });
      note("envío en curso");
      return;
    }

    try {
      if (channel === "whatsapp") {
        const parsed = whatsappParamsFor(template!.body_text, candidate);
        if (!parsed.ok) throw new Error(parsed.error);

        const resolved = await resolveConversationByPhone(
          supabase,
          accountId,
          candidate.phone!,
          candidate.debtor_name,
        );
        const sent = await sendMessageToConversation(supabase, accountId, {
          conversationId: resolved.conversationId,
          messageType: "template",
          templateName: template!.name,
          templateLanguage: template!.language,
          templateParams: parsed.params,
          senderType: "bot",
        });

        await finish(supabase, accountId, candidate, "whatsapp", {
          status: "sent",
          externalId: sent.whatsappMessageId,
        });
        items.push({
          installment_id: candidate.installment_id,
          debtor_name: candidate.debtor_name,
          kind: candidate.kind,
          channel,
          status: "sent",
          external_id: sent.whatsappMessageId,
        });
      } else {
        const subject = renderReminderText(settings.email_subject, candidate);
        const body = renderReminderText(settings.email_body, candidate);
        const sent = await sendEmail(mailflare!, {
          to: [candidate.email!],
          subject,
          text: body,
          html: emailHtml(body),
        });
        if (!sent.success) {
          throw new Error("Mailflare rechazó el envío.");
        }

        await finish(supabase, accountId, candidate, "email", {
          status: "sent",
          externalId: sent.id ?? null,
        });
        items.push({
          installment_id: candidate.installment_id,
          debtor_name: candidate.debtor_name,
          kind: candidate.kind,
          channel,
          status: "sent",
          external_id: sent.id ?? null,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await finish(supabase, accountId, candidate, channel, {
        status: "failed",
        error: message,
      }).catch(() => undefined);
      items.push({
        installment_id: candidate.installment_id,
        debtor_name: candidate.debtor_name,
        kind: candidate.kind,
        channel,
        status: "failed",
        reason: message,
      });
      note(`${channel}: error`);
    }
  });

  return buildSummary(date, false, candidates.length, items, reasons, now);
}

function previewItem(
  candidate: ReminderCandidate,
  channel: ReminderChannel,
  settings: ReminderSettings,
  template: TemplateRow | null,
): ReminderRunItem {
  let preview: string | null = null;
  if (channel === "whatsapp" && template) {
    const parsed = whatsappParamsFor(template.body_text, candidate);
    preview = parsed.ok
      ? renderWhatsappPreview(template.body_text, parsed.params)
      : parsed.error;
  } else if (channel === "email") {
    preview = renderReminderText(settings.email_body, candidate);
  }
  return {
    installment_id: candidate.installment_id,
    debtor_name: candidate.debtor_name,
    kind: candidate.kind,
    channel,
    status: "preview",
    preview,
  };
}

async function claim(
  supabase: SupabaseClient,
  accountId: string,
  candidate: ReminderCandidate,
  channel: ReminderChannel,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("collection_reminder_claim", {
    p_account_id: accountId,
    p_installment_id: candidate.installment_id,
    p_kind: candidate.kind,
    p_channel: channel,
    p_amount: Number(candidate.balance) || 0,
    p_due_date: candidate.due_date,
  });
  if (error) {
    throw new Error(`No se pudo reservar el envío: ${error.message}`);
  }
  return Boolean(data);
}

async function finish(
  supabase: SupabaseClient,
  accountId: string,
  candidate: ReminderCandidate,
  channel: ReminderChannel,
  input: {
    status: "sent" | "failed" | "skipped";
    externalId?: string | null;
    error?: string | null;
  },
): Promise<void> {
  const { error } = await supabase.rpc("collection_reminder_finish", {
    p_account_id: accountId,
    p_installment_id: candidate.installment_id,
    p_kind: candidate.kind,
    p_channel: channel,
    p_status: input.status,
    p_external_id: input.externalId ?? null,
    p_error: input.error ?? null,
  });
  if (error) {
    throw new Error(`No se pudo registrar el envío: ${error.message}`);
  }
}

function buildSummary(
  date: string,
  dryRun: boolean,
  candidateCount: number,
  items: ReminderRunItem[],
  reasons: Record<string, number>,
  now: Date,
): ReminderRunSummary {
  return {
    date,
    dry_run: dryRun,
    candidates: candidateCount,
    sent: items.filter((item) => item.status === "sent").length,
    failed: items.filter((item) => item.status === "failed").length,
    skipped: items.filter((item) => item.status === "skipped").length,
    items,
    reasons,
    ran_at: now.toISOString(),
  };
}

async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (index < items.length) {
        const current = items[index];
        index += 1;
        await worker(current);
      }
    },
  );
  await Promise.all(runners);
}
