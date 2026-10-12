import { CHANNEL_CATALOG } from "@/lib/metrics/channels";
import { cn } from "@/lib/utils";
import type { MessageChannel } from "@/types";

// ============================================================
// Ícono chico de canal para la Bandeja (badges de la lista,
// encabezado del hilo y switcher).
//
// Reutiliza CHANNEL_CATALOG (src/lib/metrics/channels.ts): los
// canales con logo oficial (WhatsApp/Instagram/Facebook/TikTok) se
// pintan con un <img> plano; los demás caen a su icono de lucide con
// su color de marca. Los tamaños los controla el `className` del
// llamador.
// ============================================================

export function ChannelIcon({
  channel,
  className,
  imgClassName,
}: {
  channel: MessageChannel | string | null | undefined;
  className?: string;
  imgClassName?: string;
}) {
  const key = channel ?? "whatsapp";
  const meta =
    CHANNEL_CATALOG.find((c) => c.key === key) ?? CHANNEL_CATALOG[0];

  if (meta.logoSrc) {
    return (
      <img
        src={meta.logoSrc}
        alt={meta.label}
        className={cn("object-contain", imgClassName ?? "h-4 w-4")}
      />
    );
  }

  const Icon = meta.icon;
  return <Icon className={cn(meta.color, className ?? "h-4 w-4")} />;
}

/** Etiqueta legible del canal (para title/aria). */
export function channelName(channel: MessageChannel | string | null | undefined): string {
  if (!channel) return "WhatsApp";
  return (
    CHANNEL_CATALOG.find((c) => c.key === channel)?.label ??
    channel
  );
}