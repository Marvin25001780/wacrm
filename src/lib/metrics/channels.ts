// ============================================================
// Catálogo de canales de mensajería — módulo de métricas.
//
// Vive separado del agregador para que la UI (y cualquier futuro
// selector de canal) comparta una única fuente de verdad sobre qué
// canales existen, cómo se etiquetan y con qué color se pintan.
// Es código cliente-seguro: no importa nada de servidor.
// ============================================================

import type { LucideIcon } from "lucide-react";
import {
  Camera,
  Globe,
  Mail,
  MessageCircle,
  Music2,
  Send,
  Smartphone,
  ThumbsUp,
} from "lucide-react";
import type { MessageChannel } from "@/types";

export interface ChannelMeta {
  key: MessageChannel;
  label: string;
  /** Icono del canal (lucide). */
  icon: LucideIcon;
  /** Clase Tailwind de color de texto (para el icono). */
  color: string;
  /** Clase Tailwind de fondo tenue (para el contenedor del icono). */
  tint: string;
  /** Cómo se alimenta hoy este canal (se muestra cuando no hay datos). */
  hint: string;
}

/**
 * Orden de presentación del desglose por canal. `whatsapp` primero
 * porque es el único canal productivo hoy; el resto queda listo para
 * cuando se conecten.
 */
export const CHANNEL_CATALOG: ChannelMeta[] = [
  {
    key: "whatsapp",
    label: "WhatsApp",
    icon: MessageCircle,
    color: "text-emerald-400",
    tint: "bg-emerald-400/10",
    hint: "Meta Cloud API y Evolution",
  },
  {
    key: "sms",
    label: "SMS",
    icon: Smartphone,
    color: "text-cyan-400",
    tint: "bg-cyan-400/10",
    hint: "Requiere conectar textbee",
  },
  {
    key: "email",
    label: "Correo",
    icon: Mail,
    color: "text-amber-400",
    tint: "bg-amber-400/10",
    hint: "Bandeja entrante por correo",
  },
  {
    key: "webchat",
    label: "Webchat",
    icon: Globe,
    color: "text-violet-400",
    tint: "bg-violet-400/10",
    hint: "Widget del sitio web",
  },
  {
    key: "instagram",
    label: "Instagram",
    icon: Camera,
    color: "text-pink-400",
    tint: "bg-pink-400/10",
    hint: "Requiere conectar Instagram",
  },
  {
    key: "facebook",
    label: "Facebook",
    icon: ThumbsUp,
    color: "text-blue-400",
    tint: "bg-blue-400/10",
    hint: "Requiere conectar Messenger",
  },
  {
    key: "tiktok",
    label: "TikTok",
    icon: Music2,
    color: "text-fuchsia-400",
    tint: "bg-fuchsia-400/10",
    hint: "Requiere conectar TikTok",
  },
  {
    key: "telegram",
    label: "Telegram",
    icon: Send,
    color: "text-sky-400",
    tint: "bg-sky-400/10",
    hint: "Requiere un bot de Telegram",
  },
];

const BY_KEY = new Map<string, ChannelMeta>(
  CHANNEL_CATALOG.map((c) => [c.key, c])
);

/** Devuelve el meta del canal o, si es desconocido, uno genérico. */
export function channelMeta(key: string): ChannelMeta {
  return (
    BY_KEY.get(key) ?? {
      key: key as MessageChannel,
      label: key,
      icon: Globe,
      color: "text-muted-foreground",
      tint: "bg-muted",
      hint: "",
    }
  );
}
