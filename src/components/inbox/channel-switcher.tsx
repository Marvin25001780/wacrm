"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, Columns2, X } from "lucide-react";
import { format } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChannelIcon, channelName } from "./channel-icon";
import { PRIMARY_CHANNELS } from "@/lib/inbox/channels";
import type { MessageChannel } from "@/types";

// ============================================================
// Selector de canal del encabezado del hilo.
//
// Muestra las 5 vías que pediste (WhatsApp, Facebook, Instagram, SMS
// y Correo) + cualquier otro canal que ya tenga hilo (TikTok, etc.),
// con la fecha (dd/MM/yyyy) del último mensaje de cada medio o
// "Sin comunicación" cuando el contacto nunca lo usó.
//
// Al elegir un canal con hilo, notifica al padre con
// `onOpenChannel(channel, conversationId)`:
//   - escritorio → abre la conversación en la vista dividida (al lado
//     del hilo actual),
//   - celular → cambia el hilo activo.
// Elegir el canal ya en pantalla cierra la vista dividida (null).
// ============================================================

export interface ChannelSwitcherProps {
  contactId?: string | null;
  /** Canal del hilo actualmente abierto (el trigger lo muestra). */
  activeChannel?: MessageChannel | string | null;
  /** Canal abierto en la vista dividida secundaria (si hay). */
  secondaryChannel?: MessageChannel | string | null;
  /**
   * Clic normal en un canal: el padre redirige el hilo principal a esa
   * conversación (`handleOpenChannel`).
   */
  onOpenChannel: (
    channel: MessageChannel,
    conversationId: string | null,
  ) => void;
  /**
   * Acción del icono "Abrir al lado" de cada canal: el padre abre esa
   * conversación en la vista dividida (escritorio) o conmuta el hilo
   * activo (celular). Opcional — sin él, el icono no se muestra.
   */
  onOpenChannelInSplit?: (
    channel: MessageChannel,
    conversationId: string | null,
  ) => void;
  /** Refetch forcing — el padre lo sube para refrescar fechas. */
  resyncToken?: number;
}

interface ChannelEntry {
  channel: MessageChannel;
  conversationId: string | null;
  lastMessageAt: string | null;
  hasUnread: boolean;
}

export function ChannelSwitcher({
  contactId,
  activeChannel,
  secondaryChannel,
  onOpenChannel,
  onOpenChannelInSplit,
  resyncToken = 0,
}: ChannelSwitcherProps) {
  const [conversations, setConversations] = useState<
    { id: string; channel: string; last_message_at: string | null; unread_count: number }[]
  >([]);
  // Menú controlado: el icono "abrir al lado" corta la propagación para
  // no redirigir el hilo principal, pero Base UI cierra el menú en el
  // `onClick` del propio item — así que al detener el evento el menú se
  // quedaría abierto. Cerrándolo aquí queda como un clic normal.
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!contactId) return;
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from("conversations")
      .select("id, channel, last_message_at, unread_count")
      .eq("contact_id", contactId)
      .order("last_message_at", { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.warn("[channel-switcher] conversations fetch failed:", error.message);
          return;
        }
        setConversations((data as typeof conversations) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [contactId, resyncToken]);

  const entries = useMemo<ChannelEntry[]>(() => {
    if (!contactId) return [];
    const byChannel = new Map<string, ChannelEntry>();
    for (const conv of conversations) {
      const channel = conv.channel as MessageChannel;
      byChannel.set(channel, {
        channel,
        conversationId: conv.id,
        lastMessageAt: conv.last_message_at ?? null,
        hasUnread: (conv.unread_count ?? 0) > 0,
      });
    }
    // Orden: las 5 vías fijas primero; después canales extra que ya
    // tengan hilo.
    const ordered: ChannelEntry[] = [];
    for (const c of PRIMARY_CHANNELS) {
      const entry = byChannel.get(c);
      ordered.push(
        entry ?? { channel: c, conversationId: null, lastMessageAt: null, hasUnread: false },
      );
    }
    for (const key of byChannel.keys()) {
      if (!PRIMARY_CHANNELS.includes(key as MessageChannel)) {
        ordered.push(byChannel.get(key)!);
      }
    }
    return ordered;
  }, [conversations, contactId]);

  const activeKey = (activeChannel ?? "whatsapp") as MessageChannel;

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        title="Cambiar de canal"
        aria-label="Cambiar de canal"
      >
        <ChannelIcon channel={activeKey} className="h-3.5 w-3.5" imgClassName="h-3.5 w-3.5" />
        <span className="hidden min-w-0 max-w-[80px] truncate sm:inline">
          {channelName(activeKey)}
        </span>
        <ChevronDown className="h-3 w-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64 border-border bg-popover">
        {/* Base UI exige que el GroupLabel viva dentro de un Group. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            Canales del contacto
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {entries.map((entry) => {
            const isActive = entry.channel === activeKey;
            const isSecondary = entry.channel === secondaryChannel;
            const disabled = !entry.conversationId;
            // Icono por fila: "abrir al lado" para un canal que aún no
            // está abierto, o "cerrar" para el que ya vive en la
            // columna secundaria.
            const canOpenSplit =
              !!onOpenChannelInSplit && !disabled && !isActive && !isSecondary;
            const canCloseSplit =
              !!onOpenChannelInSplit && !disabled && isSecondary && !isActive;
            return (
              <DropdownMenuItem
                key={entry.channel}
                disabled={disabled}
                // Base UI usa onClick (no onSelect, que es de Radix): con
                // onSelect el clic nunca llegaba a disparar la acción.
                onClick={() => onOpenChannel(entry.channel, entry.conversationId)}
                className="flex items-center justify-between gap-2 text-sm"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <ChannelIcon channel={entry.channel} className="h-4 w-4" imgClassName="h-4 w-4" />
                  <span className="truncate">
                    {channelName(entry.channel)}
                    {isSecondary &&
                      (isActive ? " · pantalla" : " · a la par")}
                  </span>
                  {entry.hasUnread && (
                    <span className="ml-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                  {entry.lastMessageAt
                    ? format(new Date(entry.lastMessageAt), "dd/MM/yyyy")
                    : "Sin comunicación"}
                  {isActive && <Check className="h-3.5 w-3.5 text-primary" />}
                  {(canOpenSplit || canCloseSplit) && (
                    <button
                      type="button"
                      title={
                        canCloseSplit
                          ? "Cerrar vista dividida"
                          : "Abrir al lado (vista dividida)"
                      }
                      aria-label={
                        canCloseSplit
                          ? `Cerrar la vista dividida de ${channelName(entry.channel)}`
                          : `Abrir ${channelName(entry.channel)} al lado`
                      }
                      onClick={(event) => {
                        // Sin stopPropagation el clic burbujearía hasta el
                        // item y además redirigiría el hilo principal.
                        event.preventDefault();
                        event.stopPropagation();
                        setMenuOpen(false);
                        onOpenChannelInSplit?.(entry.channel, entry.conversationId);
                      }}
                      className="-mr-0.5 ml-0.5 rounded-sm p-0.5 text-muted-foreground/70 transition-colors hover:text-foreground"
                    >
                      {canCloseSplit ? (
                        <X className="h-3.5 w-3.5" />
                      ) : (
                        <Columns2 className="h-3.5 w-3.5" />
                      )}
                    </button>
                  )}
                </span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}