import { NextResponse } from "next/server";

import {
  ForbiddenError,
  UnauthorizedError,
  toErrorResponse,
} from "@/lib/auth/account";

import { MailflareError } from "./mailflare";

/** Mapea los errores del cliente de correo a respuestas JSON coherentes. */
export function mailflareErrorResponse(err: unknown): NextResponse {
  if (err instanceof MailflareError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
    return toErrorResponse(err);
  }
  console.error("[email] unexpected error:", err);
  return NextResponse.json(
    { error: "No se pudo completar la operación de correo." },
    { status: 500 },
  );
}

/** Un correo válido, del lado del servidor (no confiamos en el navegador). */
export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** Acepta `a@b.com, c@d.com` o un arreglo y devuelve direcciones limpias. */
export function parseAddressList(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : typeof value === "string"
      ? value.split(/[,;\n]/)
      : [];
  return raw.map((item) => item.trim()).filter((item) => item.length > 0);
}
