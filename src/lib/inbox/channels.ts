import type { MessageChannel } from "@/types";

// ============================================================
// Metadatos de canales para la Bandeja multicanal.
//
// El select de la Bandeja muestra, por defecto, las 5 vías que
// pediste en el orden fijo: WhatsApp, Facebook, Instagram, SMS y
// Correo. TikTok se pinta solo si el contacto ya tiene un hilo por
// ahí (es lectura nada más). El resto de canales del sistema
// (telegram/webchat) caen al mismo caso: visibles si hay hilo.
// ============================================================

/** Canales que el switcher de la Bandeja ofrece siempre. */
export const PRIMARY_CHANNELS: MessageChannel[] = [
  "whatsapp",
  "facebook",
  "instagram",
  "sms",
  "email",
];

export const CHANNEL_LABEL: Record<MessageChannel, string> = {
  whatsapp: "WhatsApp",
  sms: "SMS",
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  telegram: "Telegram",
  email: "Correo",
  webchat: "Webchat",
};

export function channelLabel(channel: string | null | undefined): string {
  if (channel && channel in CHANNEL_LABEL) {
    return CHANNEL_LABEL[channel as MessageChannel];
  }
  return channel ?? "WhatsApp";
}