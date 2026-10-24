"use client";

// ============================================================
// Agentes de IA — listado funcional (versión mínima).
//
// Permite crear agentes y navegar a su edición. Cada tarjeta muestra
// nombre, descripción, estado y un simulador en la página de edición.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { Bot, Brain, MoreVertical, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ActivateAgentDialog } from "@/components/flows/agent/activate-agent-dialog";
import type { AiChannelStatus } from "@/lib/ai/channels";
import { cn } from "@/lib/utils";

interface AiAgent {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "inactive";
  channels?: string[];
  objective: string | null;
  created_at: string;
}

const NO_CHANNEL_STATUS: AiChannelStatus = {
  whatsapp: false,
  sms: false,
  instagram: false,
  facebook: false,
};

export default function AiAgentsPage() {
  const router = useRouter();
  const [agents, setAgents] = useState<AiAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [channelStatus, setChannelStatus] =
    useState<AiChannelStatus>(NO_CHANNEL_STATUS);
  const [activateAgent, setActivateAgent] = useState<AiAgent | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formObjective, setFormObjective] = useState("");
  const [saving, setSaving] = useState(false);

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  /** Respuestas IA reales de la cuenta (antes: "Saldo de Crédito IA: $0.00"). */
  const [aiReplies, setAiReplies] = useState(0);

  async function load() {
    try {
      setLoading(true);
      const res = await fetch("/api/ai-agents");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al cargar agentes");
      setAgents(json.agents ?? []);
      setAiReplies(typeof json.aiReplies === "number" ? json.aiReplies : 0);
      setChannelStatus(json.channelStatus ?? NO_CHANNEL_STATUS);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al cargar");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        (a.description ?? "").toLowerCase().includes(q),
    );
  }, [agents, query]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const name = formName.trim();
    if (!name) {
      toast.error("El nombre es obligatorio");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/ai-agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: formDescription.trim() || null,
          objective: formObjective.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al crear");

      toast.success("Agente creado");
      setDialogOpen(false);
      setFormName("");
      setFormDescription("");
      setFormObjective("");
      router.push(`/flows/agentes-ia/${json.agent.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al crear");
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(agent: AiAgent) {
    // Al activar, primero se eligen los canales. Desactivar es directo.
    if (agent.status === "inactive") {
      setActivateAgent(agent);
      return;
    }

    try {
      const res = await fetch(`/api/ai-agents/${agent.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "inactive" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al actualizar");
      setAgents((prev) => prev.map((a) => (a.id === agent.id ? json.agent : a)));
      toast.success("Agente desactivado");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al actualizar");
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/ai-agents/${deleteId}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al eliminar");
      toast.success("Agente eliminado");
      setDeleteId(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al eliminar");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold">Agentes de IA</h1>
        <p className="text-sm text-muted-foreground">
          Entrena y gestiona agentes de IA para atender conversaciones según
          tus necesidades.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Buscar agentes..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-3">
          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground"
            title="Mensajes contestados automáticamente por el asistente de IA (total de la cuenta)"
          >
            <Bot className="h-4 w-4 text-primary" />
            Respuestas IA: {aiReplies.toLocaleString()}
          </span>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Nuevo
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="rounded-xl border border-border bg-card py-16 text-center text-sm text-muted-foreground">
          Cargando agentes...
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-card py-16 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Brain className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="mt-4 text-sm font-medium">
            {query
              ? "No se encontraron agentes."
              : "No hay agentes de IA configurados."}
          </p>
          {!query && (
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              Crea tu primer agente para empezar a automatizar respuestas con IA.
            </p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((agent) => (
            <div
              key={agent.id}
              className="flex flex-col rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/50"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <Brain className="h-5 w-5 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{agent.name}</p>
                    <p
                      className={cn(
                        "text-xs",
                        agent.status === "active"
                          ? "text-emerald-600"
                          : "text-muted-foreground",
                      )}
                    >
                      {agent.status === "active" ? "Activo" : "Inactivo"}
                    </p>
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => router.push(`/flows/agentes-ia/${agent.id}`)}
                    >
                      <Pencil className="mr-2 h-4 w-4" />
                      Editar
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setDeleteId(agent.id)}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Eliminar
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {agent.description && (
                <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">
                  {agent.description}
                </p>
              )}

              <div className="mt-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={agent.status === "active"}
                    onCheckedChange={() => toggleStatus(agent)}
                    aria-label={
                      agent.status === "active" ? "Desactivar" : "Activar"
                    }
                  />
                  <span className="text-xs text-muted-foreground">
                    {agent.status === "active" ? "Activado" : "Desactivado"}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => router.push(`/flows/agentes-ia/${agent.id}`)}
                >
                  Configurar
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {activateAgent && (
        <ActivateAgentDialog
          key={activateAgent.id}
          open
          onOpenChange={(open) => !open && setActivateAgent(null)}
          agent={activateAgent}
          channelStatus={channelStatus}
          onActivated={(updated) => {
            const agent = updated as AiAgent;
            setAgents((prev) =>
              prev.map((item) => {
                if (item.id === agent.id) return agent;
                // El backend apaga los demás agentes al activar uno.
                return item.status === "active"
                  ? { ...item, status: "inactive" }
                  : item;
              }),
            );
          }}
        />
      )}

      {/* Create dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleSave}>
            <DialogHeader>
              <DialogTitle>Nuevo agente de IA</DialogTitle>
              <DialogDescription>
                Crea el agente y luego completa su personalidad y
                comportamiento.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="agent-name">Nombre</Label>
                <Input
                  id="agent-name"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Ej. Demo Agent"
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="agent-desc">Descripción</Label>
                <Textarea
                  id="agent-desc"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  placeholder="Para qué sirve este agente..."
                  rows={2}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="agent-objective">Objetivo</Label>
                <Textarea
                  id="agent-objective"
                  value={formObjective}
                  onChange={(e) => setFormObjective(e.target.value)}
                  placeholder="Qué debe lograr el agente..."
                  rows={3}
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Creando..." : "Crear agente"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={!!deleteId} onOpenChange={(v) => !v && setDeleteId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>¿Eliminar agente?</DialogTitle>
            <DialogDescription>
              Esta acción no se puede deshacer. El agente dejará de estar
              disponible inmediatamente.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "Eliminando..." : "Eliminar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
