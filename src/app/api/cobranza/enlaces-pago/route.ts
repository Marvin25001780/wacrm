import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";
import {
  PaymentLinkError,
  ensurePaymentLink,
  getSiteBaseUrl,
} from "@/lib/collections/payment-links";
import { paymentLinkUrl } from "@/lib/collections/payment-links-shared";

interface LinkRow {
  id: string;
  debtor_id: string;
  token: string;
  amount: number | string | null;
  status: string;
  expires_at: string;
  created_at: string;
}

/**
 * GET /api/cobranza/enlaces-pago?debtor_id=…
 *
 * Historial de enlaces de pago del negocio (o de un deudor). Los
 * enlaces activos traen su URL completa; los vencidos no.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireRole("agent");
    const url = new URL(request.url);
    const debtorId = url.searchParams.get("debtor_id")?.trim();

    let query = ctx.supabase
      .from("collection_payment_links")
      .select("id, debtor_id, token, amount, status, expires_at, created_at")
      .eq("account_id", ctx.accountId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (debtorId) query = query.eq("debtor_id", debtorId);

    const { data, error } = await query;
    if (error) {
      if (error.code === "42P01" || error.code === "PGRST205") {
        return NextResponse.json({
          links: [],
          migration_pending: true,
        });
      }
      throw new Error(error.message);
    }

    const rows = (data ?? []) as LinkRow[];
    const debtorIds = [...new Set(rows.map((row) => row.debtor_id))];
    const names = new Map<string, string>();
    if (debtorIds.length > 0) {
      const { data: debtors } = await ctx.supabase
        .from("collection_debtors")
        .select("id, name")
        .in("id", debtorIds);
      for (const debtor of debtors ?? []) {
        names.set(debtor.id as string, (debtor.name as string) ?? "Deudor");
      }
    }

    const base = getSiteBaseUrl(request);
    const now = Date.now();

    return NextResponse.json({
      links: rows.map((row) => {
        const active =
          row.status === "active" && new Date(row.expires_at).getTime() > now;
        return {
          ...row,
          debtor_name: names.get(row.debtor_id) ?? "Deudor",
          active,
          url: active && base ? paymentLinkUrl(base, row.token) : null,
        };
      }),
      migration_pending: false,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * POST /api/cobranza/enlaces-pago
 *
 * Crea (o reutiliza) el enlace del deudor. Se niega si el deudor no
 * tiene saldo abierto: un enlace que solo muestra “USD 0,00” confunde
 * y hace perder la llamada.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent");

    const limited = checkRateLimit(
      `enlaces-pago:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limited.success) return rateLimitResponse(limited);

    const body = (await request.json().catch(() => ({}))) as {
      debtor_id?: unknown;
    };
    const debtorId =
      typeof body.debtor_id === "string" ? body.debtor_id.trim() : "";
    if (!debtorId) {
      return NextResponse.json(
        { error: "Elige un deudor." },
        { status: 400 },
      );
    }

    const { data: debtor, error: debtorError } = await ctx.supabase
      .from("collection_debtors")
      .select("id, name, status")
      .eq("id", debtorId)
      .eq("account_id", ctx.accountId)
      .maybeSingle<{ id: string; name: string; status: string }>();
    if (debtorError) throw new Error(debtorError.message);
    if (!debtor) {
      return NextResponse.json(
        { error: "El deudor no existe en este negocio." },
        { status: 404 },
      );
    }

    const { data: installments, error: installmentError } = await ctx.supabase
      .from("collection_installments")
      .select("total, paid_amount")
      .eq("account_id", ctx.accountId)
      .eq("debtor_id", debtorId)
      .in("status", ["pending", "partial"]);
    if (installmentError) throw new Error(installmentError.message);

    const balance = (installments ?? []).reduce(
      (sum, row) =>
        sum +
        Math.max(0, Number(row.total ?? 0) - Number(row.paid_amount ?? 0)),
      0,
    );
    if (balance <= 0.005) {
      return NextResponse.json(
        { error: "Este deudor no tiene saldo pendiente." },
        { status: 409 },
      );
    }

    const base = getSiteBaseUrl(request);
    if (!base) {
      return NextResponse.json(
        {
          error:
            "No se pudo determinar la URL pública. Configura NEXT_PUBLIC_SITE_URL en el servidor.",
        },
        { status: 503 },
      );
    }

    try {
      const link = await ensurePaymentLink(ctx.supabase, debtorId);
      return NextResponse.json({
        link: {
          token: link.token,
          url: paymentLinkUrl(base, link.token),
          amount: link.amount,
          expires_at: link.expiresAt,
          created: link.created,
        },
        debtor: { id: debtor.id, name: debtor.name, balance },
      });
    } catch (err) {
      if (err instanceof PaymentLinkError) {
        if (err.code === "42P01" || err.code === "PGRST205") {
          return NextResponse.json(
            {
              error:
                "Falta aplicar la migración 135. Ejecuta PROD_UPDATE_135.sql en Supabase.",
            },
            { status: 409 },
          );
        }
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }
  } catch (err) {
    return toErrorResponse(err);
  }
}
