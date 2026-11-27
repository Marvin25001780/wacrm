import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import {
  loadReminderConfig,
  normalizeReminderSettings,
} from "@/lib/collections/reminders";

/**
 * GET /api/cobranza/recordatorios
 *
 * Reglas de recordatorios del negocio + plantillas aprobadas de
 * WhatsApp + si el correo está configurado. Lo puede leer cualquier
 * miembro (la vista previa es útil para el agente); solo admin/owner
 * puede guardar.
 */
export async function GET() {
  try {
    const ctx = await requireRole("agent");
    const config = await loadReminderConfig(ctx.supabase, ctx.accountId);
    const isAdmin = ctx.role === "admin" || ctx.role === "owner";

    const [templatesRes, emailRes] = await Promise.all([
      ctx.supabase
        .from("message_templates")
        .select("id, name, language, body_text, category, status")
        .eq("account_id", ctx.accountId)
        .eq("status", "APPROVED")
        .order("name", { ascending: true }),
      isAdmin
        ? ctx.supabase
            .from("email_config")
            .select("enabled")
            .eq("account_id", ctx.accountId)
            .maybeSingle<{ enabled: boolean }>()
        : Promise.resolve({ data: null, error: null }),
    ]);

    return NextResponse.json({
      settings: config.settings,
      persisted: config.persisted,
      migration_pending: config.migrationPending,
      timezone: config.timezone,
      templates: templatesRes.error ? [] : (templatesRes.data ?? []),
      templates_error: templatesRes.error?.message ?? null,
      /** null = el rol no puede consultarlo; true/false si es admin. */
      email_configured: emailRes.data ? Boolean(emailRes.data.enabled) : null,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * POST /api/cobranza/recordatorios
 *
 * Guarda las reglas. No permite activar un canal sin su configuración
 * mínima (plantilla aprobada / correo habilitado): un interruptor que
 * parece funcionar y no envía nada es peor que un error claro.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(`recordatorios:${ctx.userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as
      | Record<string, unknown>
      | null;
    if (!body) {
      return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 });
    }

    const config = await loadReminderConfig(ctx.supabase, ctx.accountId);
    const settings = normalizeReminderSettings(
      { ...body, account_id: ctx.accountId },
      config.settings,
    );

    if (settings.enabled) {
      if (!settings.whatsapp_enabled && !settings.email_enabled) {
        return NextResponse.json(
          { error: "Activa al menos un canal: WhatsApp o correo." },
          { status: 400 },
        );
      }

      if (settings.whatsapp_enabled) {
        if (!settings.whatsapp_template) {
          return NextResponse.json(
            { error: "Elige la plantilla aprobada de WhatsApp." },
            { status: 400 },
          );
        }
        const { data: template, error } = await ctx.supabase
          .from("message_templates")
          .select("name")
          .eq("account_id", ctx.accountId)
          .eq("name", settings.whatsapp_template)
          .eq("status", "APPROVED")
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!template) {
          return NextResponse.json(
            {
              error:
                "La plantilla elegida no está aprobada. Sincroniza las plantillas en WhatsApp y vuelve a intentar.",
            },
            { status: 400 },
          );
        }
      }

      if (settings.email_enabled) {
        const { data: email } = await ctx.supabase
          .from("email_config")
          .select("enabled")
          .eq("account_id", ctx.accountId)
          .maybeSingle<{ enabled: boolean }>();
        if (!email?.enabled) {
          return NextResponse.json(
            {
              error:
                "El correo no está configurado. Actívalo en Ajustes → Correo antes de encender este canal.",
            },
            { status: 400 },
          );
        }
      }
    }

    const { data, error } = await ctx.supabase
      .from("collection_reminder_settings")
      .upsert(
        {
          account_id: ctx.accountId,
          enabled: settings.enabled,
          whatsapp_enabled: settings.whatsapp_enabled,
          email_enabled: settings.email_enabled,
          whatsapp_template: settings.whatsapp_template,
          email_subject: settings.email_subject,
          email_body: settings.email_body,
          days_before: settings.days_before,
          days_after: settings.days_after,
          send_hour: settings.send_hour,
          max_per_run: settings.max_per_run,
        },
        { onConflict: "account_id" },
      )
      .select("*")
      .single<typeof settings>();

    if (error) {
      if (error.code === "42P01" || error.code === "PGRST205") {
        return NextResponse.json(
          {
            error:
              "Falta aplicar la migración 134. Ejecuta PROD_UPDATE_134.sql en Supabase.",
          },
          { status: 409 },
        );
      }
      throw new Error(error.message);
    }

    return NextResponse.json({ settings: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
