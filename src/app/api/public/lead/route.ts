import { NextResponse } from "next/server";

import { channelsAdmin } from "@/lib/channels/admin-client";
import { ensureLeadForContactRow } from "@/lib/leads/ensure-lead";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * POST /api/public/lead
 *
 * Formulario de contacto de la landing. Crea (o reutiliza) el contacto
 * y su lead en la cuenta configurada y guarda el mensaje como interés.
 *
 * Cuenta destino: `LANDING_LEADS_ACCOUNT_ID`. Si no está definida se
 * usa la cuenta más antigua, que en esta instalación es la del dueño
 * del CRM.
 *
 * Protecciones: límite por IP, honeypot y validación de tamaños.
 */
const LIMITS = {
  name: 120,
  email: 200,
  phone: 40,
  company: 160,
  message: 2000,
};

function clean(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function isEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(value);
}

function phoneDigits(value: string): string {
  return value.replace(/[^\d]/g, "");
}

export async function POST(request: Request) {
  try {
    const forwarded = request.headers.get("x-forwarded-for") ?? "";
    const ip = forwarded.split(",")[0]?.trim() || "unknown";

    const limited = checkRateLimit(
      `public-lead:${ip}`,
      RATE_LIMITS.invitationPeek,
    );
    if (!limited.success) return rateLimitResponse(limited);

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body) {
      return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
    }

    // Honeypot: los bots rellenan este campo oculto.
    if (clean(body.website, 200)) {
      return NextResponse.json({ ok: true });
    }

    const name = clean(body.name, LIMITS.name);
    const email = clean(body.email, LIMITS.email).toLowerCase();
    const phone = clean(body.phone, LIMITS.phone);
    const company = clean(body.company, LIMITS.company);
    const message = clean(body.message, LIMITS.message);

    if (name.length < 2) {
      return NextResponse.json(
        { error: "Escribe tu nombre." },
        { status: 400 },
      );
    }
    if (phoneDigits(phone).length < 7) {
      return NextResponse.json(
        { error: "Escribe un teléfono válido." },
        { status: 400 },
      );
    }
    if (email && !isEmail(email)) {
      return NextResponse.json(
        { error: "El correo no es válido." },
        { status: 400 },
      );
    }

    const admin = channelsAdmin();

    let accountId = (process.env.LANDING_LEADS_ACCOUNT_ID ?? "").trim();
    if (!accountId) {
      const { data: first } = await admin
        .from("accounts")
        .select("id")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      accountId = (first?.id as string | undefined) ?? "";
    }
    if (!accountId) {
      console.error("[public-lead] no account available");
      return NextResponse.json(
        { error: "El formulario no está configurado." },
        { status: 503 },
      );
    }

    const { data: owner } = await admin
      .from("profiles")
      .select("user_id")
      .eq("account_id", accountId)
      .eq("account_role", "owner")
      .limit(1)
      .maybeSingle();

    let ownerId = (owner?.user_id as string | undefined) ?? "";
    if (!ownerId) {
      const { data: anyProfile } = await admin
        .from("profiles")
        .select("user_id")
        .eq("account_id", accountId)
        .limit(1)
        .maybeSingle();
      ownerId = (anyProfile?.user_id as string | undefined) ?? "";
    }
    if (!ownerId) {
      console.error("[public-lead] no owner for account", accountId);
      return NextResponse.json(
        { error: "El formulario no está configurado." },
        { status: 503 },
      );
    }

    // Reutiliza el contacto si ya existe por correo o teléfono.
    let contactId = "";
    if (email) {
      const { data } = await admin
        .from("contacts")
        .select("id")
        .eq("account_id", accountId)
        .ilike("email", email)
        .limit(1)
        .maybeSingle();
      contactId = (data?.id as string | undefined) ?? "";
    }
    if (!contactId) {
      const { data } = await admin
        .from("contacts")
        .select("id")
        .eq("account_id", accountId)
        .eq("phone", phone)
        .limit(1)
        .maybeSingle();
      contactId = (data?.id as string | undefined) ?? "";
    }

    if (contactId) {
      await admin
        .from("contacts")
        .update({
          name,
          ...(company ? { company } : {}),
          ...(email ? { email } : {}),
        })
        .eq("id", contactId);
    } else {
      const { data: created, error } = await admin
        .from("contacts")
        .insert({
          account_id: accountId,
          user_id: ownerId,
          phone,
          name,
          email: email || null,
          company: company || null,
          source: "landing",
        })
        .select("id")
        .single();
      if (error || !created) {
        console.error("[public-lead] contact insert failed:", error);
        return NextResponse.json(
          { error: "No se pudo registrar el contacto." },
          { status: 500 },
        );
      }
      contactId = created.id as string;
    }

    // Un lead por persona: el helper deduplica por teléfono, correo o
    // documento y sincroniza los datos del contacto.
    const lead = await ensureLeadForContactRow(
      admin,
      accountId,
      ownerId,
      contactId,
      "landing",
    );

    if (lead?.id && message) {
      await admin
        .from("leads")
        .update({
          interest: message.slice(0, 200),
          notes: [
            `Formulario de la web (${new Date().toISOString().slice(0, 10)})`,
            company ? `Empresa: ${company}` : null,
            message,
          ]
            .filter(Boolean)
            .join("\n"),
        })
        .eq("id", lead.id);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[public-lead] unexpected error:", err);
    return NextResponse.json(
      { error: "No se pudo enviar. Inténtalo de nuevo." },
      { status: 500 },
    );
  }
}
