"use client";

import { useMemo, useState } from "react";
import {
  Camera,
  MessageCircle,
  MessageSquare,
  Smartphone,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AI_AGENT_CHANNELS,
  AI_AGENT_CHANNEL_META,
  agentChannels,
  type AiAgentChannel,
  type AiChannelStatus,
} from "@/lib/ai/channels";
import { cn } from "@/lib/utils";

const CHANNEL_ICONS: Record<
  AiAgentChannel,
  React.ComponentType<{ className?: string }>
> = {
  whatsapp: MessageCircle,
  sms: Smartphone,
  instagram: Camera,
  facebook: MessageSquare,
};

interface ActivateAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agent: {
    id: string;
    name: string;
    channels?: unknown;
  } | null;
  channelStatus: AiChannelStatus;
  onActivated: (agent: unknown) => void;
}

/**
 * Activación de un agente con selección de canales.
 *
 * Reglas de producto:
 *  - Se puede guardar un canal Meta aunque todavía no esté conectado;
 *    empezará a responder cuando se conecte.
 *  - Para ACTIVAR hace falta al menos un canal conectado.
 *  - Solo responde mensajes nuevos: la copia lo dice explícitamente.
 */
export function ActivateAgentDialog({
  open,
  onOpenChange,
  agent,
  channelStatus,
  onActivated,
}: ActivateAgentDialogProps) {
  // El padre monta este diálogo solo al abrirlo (y lo desmonta al
  // cerrar), así el estado nace de los canales actuales sin un efecto.
  const [selected, setSelected] = useState<AiAgentChannel[]>(() =>
    agent ? agentChannels(agent.channels) : [],
  );
  const [saving, setSaving] = useState(false);

  const connectedSelected = useMemo(
    () => selected.filter((channel) => channelStatus[channel]),
    [selected, channelStatus],
  );

  function toggle(channel: AiAgentChannel, checked: boolean) {
    setSelected((prev) => {
      if (checked) {
        return AI_AGENT_CHANNELS.filter(
          (item) => item === channel || prev.includes(item),
        );
      }
      return prev.filter((item) => item !== channel);
    });
  }

  async function activate() {
    if (!agent) return;
    if (selected.length === 0) {
      toast.error("Selecciona al menos un canal");
      return;
    }
    if (connectedSelected.length === 0) {
      toast.error("Selecciona al menos un canal conectado para activar");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/ai-agents/${agent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "active", channels: selected }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al activar");

      onActivated(json.agent);
      onOpenChange(false);
      toast.success(
        `Agente activo en ${selected
          .map((channel) => AI_AGENT_CHANNEL_META[channel].label)
          .join(", ")}`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al activar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Activar {agent?.name ?? "agente"}</DialogTitle>
          <DialogDescription>
            Elige los canales donde este agente debe responder. Solo
            contestará mensajes nuevos, no los que ya estaban en la bandeja.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-2">
          {AI_AGENT_CHANNELS.map((channel) => {
            const Icon = CHANNEL_ICONS[channel];
            const meta = AI_AGENT_CHANNEL_META[channel];
            const connected = channelStatus[channel];
            const checked = selected.includes(channel);
            return (
              <label
                key={channel}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                  checked
                    ? "border-primary/60 bg-primary/5"
                    : "border-border hover:border-primary/40",
                )}
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={(value) => toggle(channel, value === true)}
                  className="mt-0.5"
                />
                <span className="flex min-w-0 flex-1 items-start gap-2">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{meta.label}</span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                          connected
                            ? "bg-emerald-500/15 text-emerald-600"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {connected ? "Conectado" : "Sin conectar"}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {meta.description}
                    </span>
                    {!connected && (
                      <span className="mt-1 block text-xs text-amber-600">
                        Puedes guardarlo ahora; empezará a responder cuando
                        conectes el canal.
                      </span>
                    )}
                  </span>
                </span>
              </label>
            );
          })}
        </div>

        <p className="text-xs text-muted-foreground">
          {connectedSelected.length > 0
            ? "El agente responderá automáticamente en los canales conectados seleccionados."
            : "Necesitas al menos un canal conectado en la selección para activar."}
        </p>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={activate}
            disabled={saving || selected.length === 0 || connectedSelected.length === 0}
          >
            {saving ? "Activando..." : "Guardar y activar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
