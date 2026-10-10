// ============================================================
// Webchat — validación del envío público  ·  módulo 2.6
//
// Puro, sin dependencias. Lo usan la API pública de captura y (por
// simetría) el formulario del widget. Normaliza y acota los campos
// para que un sitio embebido no pueda inyectar basura/scroll enorme
// en la tabla `leads`.
// ============================================================

export interface WebchatSubmission {
  name: string;
  phone: string | null;
  email: string | null;
  message: string | null;
}

export type ValidationResult =
  | { ok: true; value: WebchatSubmission }
  | { ok: false; error: string };

const NAME_MAX = 120;
const PHONE_MAX = 40;
const EMAIL_MAX = 160;
const MESSAGE_MAX = 2000;

/** Email laxo — mismo criterio permisivo que el resto del CRM. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Valida y normaliza un envío del widget. `name` es obligatorio;
 * el resto es opcional. Requiere al menos un dato de contacto
 * (teléfono o email) para que el lead sea accionable.
 */
export function validateWebchatSubmission(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Datos inválidos.' };
  }
  const body = raw as Record<string, unknown>;

  const name = str(body.name).slice(0, NAME_MAX);
  if (!name) return { ok: false, error: 'El nombre es obligatorio.' };

  const phone = str(body.phone).slice(0, PHONE_MAX) || null;
  const emailRaw = str(body.email).slice(0, EMAIL_MAX);
  if (emailRaw && !EMAIL_RE.test(emailRaw)) {
    return { ok: false, error: 'El correo no es válido.' };
  }
  const email = emailRaw || null;

  if (!phone && !email) {
    return { ok: false, error: 'Deja un teléfono o un correo para contactarte.' };
  }

  const message = str(body.message).slice(0, MESSAGE_MAX) || null;

  return { ok: true, value: { name, phone, email, message } };
}
