import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import {
  defaultPaymentSettings,
  normalizePaymentSettings,
  type PaymentSettings,
} from "@/lib/collections/payment-links-shared";

/**
 * GET /api/cobranza/configuracion-pagos
 *
 * Datos bancarios y de pago móvil del negocio. Los lee cualquier
 * miembro (el agente necesita saber qué decirle al deudor); solo
 * admin/owner guarda.
 */
export async function GET() {
  try {
    const ctx = await requireRole("agent");
    const { data, error } = await ctx.supabase
      .from("collection_payment_settings")
      .select("*")
      .eq("account_id", ctx.accountId)
      .maybeSingle<PaymentSettings>();

    const migrationPending =
      error?.code === "42P01" || error?.code === "PGRST205";
    if (error && !migrationPending) throw new Error(error.message);

    return NextResponse.json({
      settings: data ?? defaultPaymentSettings(ctx.accountId),
      persisted: Boolean(data),
      migration_pending: migrationPending,
      site_url_configured: Boolean(process.env.NEXT_PUBLIC_SITE_URL?.trim()),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * POST /api/cobranza/configuracion-pagos
 *
 * Guarda los datos para pagar. Si se enciende el enlace público, exige
 * al menos una vía de pago real (cuenta, pago móvil o instrucciones):
 * un enlace que muestra “paga aquí” sin decir cómo es peor que no
 * tener enlace.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole("admin");

    const limited = checkRateLimit(
      `config-pagos:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limited.success) return rateLimitResponse(limited);

    const body = (await request.json().catch(() => null)) as
      | Record<string, unknown>
      | null;
    if (!body) {
      return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 });
    }

    const existing = await ctx.supabase
      .from("collection_payment_settings")
      .select("*")
      .eq("account_id", ctx.accountId)
      .maybeSingle<PaymentSettings>();

    const settings = normalizePaymentSettings(
      { ...body, account_id: ctx.accountId },
      existing.data ?? null,
    );

    if (settings.enabled) {
      const hasBank = Boolean(settings.bank_name && settings.account_number);
      const hasMobile = Boolean(settings.mobile_payment_phone);
      const hasInstructions = Boolean(settings.instructions);
      if (!hasBank && !hasMobile && !hasInstructions) {
        return NextResponse.json(
          {
            error:
              "Antes de activar el enlace, carga una cuenta bancaria, un pago móvil o instrucciones de pago.",
          },
          { status: 400 },
        );
      }
    }

    const { data, error } = await ctx.supabase
      .from("collection_payment_settings")
      .upsert(
        {
          account_id: ctx.accountId,
          enabled: settings.enabled,
          bank_name: settings.bank_name,
          account_number: settings.account_number,
          account_type: settings.account_type,
          account_holder: settings.account_holder,
          holder_document: settings.holder_document,
          mobile_payment_phone: settings.mobile_payment_phone,
          mobile_payment_bank: settings.mobile_payment_bank,
          support_phone: settings.support_phone,
          instructions: settings.instructions,
          link_expiry_days: settings.link_expiry_days,
        },
        { onConflict: "account_id" },
      )
      .select("*")
      .single<PaymentSettings>();

    if (error) {
      if (error.code === "42P01" || error.code === "PGRST205") {
        return NextResponse.json(
          {
            error:
              "Falta aplicar la migración 135. Ejecuta PROD_UPDATE_135.sql en Supabase.",
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
