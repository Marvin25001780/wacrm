// ============================================================
// Enlaces de pago — servidor (migración 135).
//
// `ensurePaymentLink` reutiliza el enlace activo del deudor o crea uno
// nuevo. La URL se arma con NEXT_PUBLIC_SITE_URL; en rutas con request
// se puede derivar del host para que funcione en cualquier despliegue.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { paymentLinkUrl } from "./payment-links-shared";

export class PaymentLinkError extends Error {
  readonly code: string | undefined;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "PaymentLinkError";
    this.code = code;
  }
}

export function getSiteBaseUrl(request?: Request): string | null {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  if (!request) return null;

  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  if (forwardedHost) {
    return `${forwardedProto || "https"}://${forwardedHost}`;
  }

  const host = request.headers.get("host")?.trim();
  if (host) {
    return `${new URL(request.url).protocol}//${host}`;
  }

  try {
    return new URL(request.url).origin;
  } catch {
    return null;
  }
}

export interface EnsuredPaymentLink {
  linkId: string;
  token: string;
  amount: number | null;
  expiresAt: string;
  created: boolean;
}

export async function ensurePaymentLink(
  supabase: SupabaseClient,
  debtorId: string,
): Promise<EnsuredPaymentLink> {
  const { data, error } = await supabase.rpc(
    "collection_payment_link_for_debtor",
    { p_debtor_id: debtorId },
  );
  if (error) {
    throw new PaymentLinkError(
      `No se pudo crear el enlace de pago: ${error.message}`,
      error.code,
    );
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.token) {
    throw new PaymentLinkError("El enlace de pago no devolvió un token.");
  }
  return {
    linkId: row.link_id as string,
    token: row.token as string,
    amount: row.amount === null ? null : Number(row.amount),
    expiresAt: row.expires_at as string,
    created: Boolean(row.created),
  };
}

export async function paymentLinkForDebtor(
  supabase: SupabaseClient,
  debtorId: string,
  baseUrl: string,
): Promise<{ url: string; token: string; expiresAt: string }> {
  const link = await ensurePaymentLink(supabase, debtorId);
  return {
    url: paymentLinkUrl(baseUrl, link.token),
    token: link.token,
    expiresAt: link.expiresAt,
  };
}

/**
 * Enlace activo ya existente, sin crear nada. Lo usa la vista previa
 * de recordatorios: mostrar un enlace real no debe tener efectos
 * secundarios si todavía no se va a enviar nada.
 */
export async function findActivePaymentLink(
  supabase: SupabaseClient,
  debtorId: string,
): Promise<EnsuredPaymentLink | null> {
  const { data, error } = await supabase
    .from("collection_payment_links")
    .select("id, token, amount, expires_at")
    .eq("debtor_id", debtorId)
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{
      id: string;
      token: string;
      amount: number | string | null;
      expires_at: string;
    }>();

  if (error || !data) return null;
  return {
    linkId: data.id,
    token: data.token,
    amount: data.amount === null ? null : Number(data.amount),
    expiresAt: data.expires_at,
    created: false,
  };
}
