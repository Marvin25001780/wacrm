"use client";

// ============================================================
// Edición de Agente de IA — layout Callbell (A1).
//
// Tres columnas:
//   izq.  → las 4 secciones como tarjetas de navegación:
//           Personalidad · Conocimiento · Acciones · Avanzada
//   centro → la sección seleccionada (editar / estado vacío)
//   der.  → SIMULADOR SIEMPRE VIVO (no es una pestaña: pruebas la
//           personalidad mientras la escribes)
//
// En pantallas chicas se apilan: nav arriba (chips), panel y luego el
// simulador — el mismo orden del DOM.
//
// Estado real del producto:
//   - Personalidad: COMPLETO (guarda y el motor real la usa — A5).
//   - Conocimiento: fase A2 (fuentes + Q&A con búsqueda semántica).
//   - Acciones:     fase A3 (toCall del modelo: etiquetas, campos,
//                   asignar, cerrar, nota).
//   - Avanzada:     fase A4 (salida, calidad/temperatura, botones,
//                   recordatorios/seguimiento).
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  BookOpen,
  Bot,
  Code2,
  Database,
  Loader2,
  Plus,
  Save,
  Send,
  Sparkles,
  Trash2,
  User,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/lib/ai/types";
import { KnowledgePanel } from "@/components/flows/agent/knowledge-panel";
import {
  ActionsPanel,
  type AgentActionFlags,
} from "@/components/flows/agent/actions-panel";
import {
  AdvancedPanel,
  type AgentAdvanced,
} from "@/components/flows/agent/advanced-panel";

interface AiAgent {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "inactive";
  objective: string | null;
  behavior: string | null;
  tone: string[];
  prohibited_rules: string[];
  // A3
  action_tags?: boolean;
  action_fields?: boolean;
  action_assign?: boolean;
  action_close?: boolean;
  action_notes?: boolean;
  // A4
  exit_message?: string | null;
  response_quality?: "concise" | "balanced" | "detailed" | null;
  max_reply_buttons?: number | null;
  max_reminders?: number | null;
  follow_up_delay_minutes?: number | null;
}

type Section = "personality" | "knowledge" | "actions" | "advanced";

// Navegación izquierda — artículo, icono, línea de apoyo. Las cuatro
// están VIVAS: Personalidad/Knowledge/Actions/Advanced guardan y el
// motor real las usa.
const SECTIONS: {
  id: Section;
  title: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  ready: boolean;
}[] = [
  { id: "personality", title: "Personalidad", hint: "Objetivo, comportamiento, tono y reglas prohibidas", icon: Sparkles, ready: true },
  { id: "knowledge", title: "Conocimiento del agente", hint: "Fuentes, preguntas y respuestas", icon: BookOpen, ready: true },
  { id: "actions", title: "Acciones", hint: "Etiquetas, campos, notas y enrutamiento", icon: Code2, ready: true },
  { id: "advanced", title: "Configuración avanzada", hint: "Botones, recordatorios y salidas", icon: Database, ready: true },
];

export default function AiAgentEditPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [agent, setAgent] = useState<AiAgent | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [section, setSection] = useState<Section>("personality");

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<"active" | "inactive">("inactive");
  const [objective, setObjective] = useState("");
  const [behavior, setBehavior] = useState("");
  const [tone, setTone] = useState<string[]>([]);
  const [toneInput, setToneInput] = useState("");
  const [rules, setRules] = useState<string[]>([]);
  const [ruleInput, setRuleInput] = useState("");

  // A3 — palancas (estado del editor; "Guardar agente" manda todo)
  const [actions, setActions] = useState<AgentActionFlags>({
    action_tags: false,
    action_fields: false,
    action_assign: false,
    action_close: false,
    action_notes: false,
  });

  // A4 — avanzada
  const [advanced, setAdvanced] = useState<AgentAdvanced>({
    exit_message: "",
    response_quality: "balanced",
    max_reply_buttons: 2,
    max_reminders: 2,
    follow_up_delay_minutes: 30,
  });

  // Simulator state (columna derecha; siempre visible salvo en móvil
  // apilado).
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [simInput, setSimInput] = useState("");
  const [simLoading, setSimLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/ai-agents/${id}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al cargar agente");
      const a = json.agent as AiAgent;
      setAgent(a);
      setName(a.name);
      setDescription(a.description ?? "");
      setStatus(a.status);
      setObjective(a.objective ?? "");
      setBehavior(a.behavior ?? "");
      setTone(a.tone ?? []);
      setRules(a.prohibited_rules ?? []);
      // A3 — palancas guardadas
      setActions({
        action_tags: a.action_tags ?? false,
        action_fields: a.action_fields ?? false,
        action_assign: a.action_assign ?? false,
        action_close: a.action_close ?? false,
        action_notes: a.action_notes ?? false,
      });
      // A4 — avanzada guardada
      setAdvanced({
        exit_message: a.exit_message ?? "",
        response_quality: a.response_quality ?? "balanced",
        max_reply_buttons: a.max_reply_buttons ?? 2,
        max_reminders: a.max_reminders ?? 2,
        follow_up_delay_minutes: a.follow_up_delay_minutes ?? 30,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al cargar");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  async function handleSave() {
    if (!name.trim()) {
      toast.error("El nombre es obligatorio");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/ai-agents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          status,
          objective: objective.trim() || null,
          behavior: behavior.trim() || null,
          tone,
          prohibited_rules: rules,
          // A3 — palancas
          ...actions,
          // A4 — avanzada
          exit_message: advanced.exit_message.trim() || null,
          response_quality: advanced.response_quality,
          max_reply_buttons: advanced.max_reply_buttons,
          max_reminders: advanced.max_reminders,
          follow_up_delay_minutes: advanced.follow_up_delay_minutes,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al guardar");
      setAgent(json.agent);
      toast.success(
        status === "active"
          ? "Agente guardado y activo — atenderá conversaciones nuevas"
          : "Agente guardado"
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  function addTone() {
    const v = toneInput.trim();
    if (!v) return;
    if (tone.includes(v)) return;
    setTone([...tone, v]);
    setToneInput("");
  }

  function removeTone(v: string) {
    setTone(tone.filter((t) => t !== v));
  }

  function addRule() {
    const v = ruleInput.trim();
    if (!v) return;
    if (rules.includes(v)) return;
    setRules([...rules, v]);
    setRuleInput("");
  }

  function removeRule(v: string) {
    setRules(rules.filter((r) => r !== v));
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = simInput.trim();
    if (!text || simLoading) return;

    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setSimInput("");
    setSimLoading(true);

    try {
      const res = await fetch(`/api/ai-agents/${id}/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, newMessage: text }),
      });
      const json = await res.json();
      if (!res.ok) {
        const msg = json.error || "Error en el simulador";
        if (json.code === "ai_not_configured" || json.code === "ai_key_unreadable") {
          toast.error(msg, {
            action: {
              label: "Configurar",
              onClick: () => router.push("/settings/ai"),
            },
          });
        } else {
          toast.error(msg);
        }
        return;
      }
      setMessages([...nextMessages, { role: "assistant", content: json.reply }]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error en el simulador");
    } finally {
      setSimLoading(false);
    }
  }

  function handleResetChat() {
    setMessages([]);
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!agent) return null;

  return (
    <div className="space-y-5">
      {/* Cabecera: volver · nombre/estado · Guardar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.push("/flows/agentes-ia")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-lg font-semibold">{name || agent.name}</h1>
            <p className="text-sm text-muted-foreground">
              {description || "Entrena tu propio agente según tus necesidades fácilmente."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch
              id="agent-status"
              checked={status === "active"}
              onCheckedChange={(v) => setStatus(v ? "active" : "inactive")}
            />
            <Label htmlFor="agent-status" className="text-sm">
              {status === "active" ? "Activo" : "Inactivo"}
            </Label>
          </div>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Guardar agente
          </Button>
        </div>
      </div>

      {/* Layout Callbell: nav · panel · simulador. En xl van los 3 de
          frente; por debajo se apilan en el orden del DOM. */}
      <div className="grid gap-4 lg:grid-cols-[240px_1fr] xl:grid-cols-[240px_1fr_360px]">
        {/* ---- Nav de secciones ---- */}
        <nav
          role="tablist"
          aria-label="Secciones del agente"
          className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0"
        >
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            const selected = s.id === section;
            return (
              <button
                key={s.id}
                role="tab"
                aria-selected={selected}
                onClick={() => setSection(s.id)}
                className={cn(
                  "flex w-64 shrink-0 flex-col rounded-xl border px-4 py-3 text-left transition-colors lg:w-full",
                  selected
                    ? "border-primary/60 bg-primary/5"
                    : "border-border bg-card hover:border-primary/40",
                )}
              >
                <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Icon className={cn("h-4 w-4", selected ? "text-primary" : "text-muted-foreground")} />
                  {s.title}
                  {s.ready && (
                    <span className="rounded-full bg-emerald-500/15 px-1.5 text-[10px] font-semibold uppercase text-emerald-500">
                      listo
                    </span>
                  )}
                </span>
                <span className="mt-0.5 pl-6 text-xs leading-snug text-muted-foreground">
                  {s.hint}
                </span>
              </button>
            );
          })}
        </nav>

        {/* ---- Panel de la sección ---- */}
        <div className="min-w-0">
          {section === "personality" && (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="name">Nombre</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ej. Demo Agent"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Descripción</Label>
                  <Input
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Para qué sirve este agente"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="objective">Objetivo del agente</Label>
                <Textarea
                  id="objective"
                  value={objective}
                  onChange={(e) => setObjective(e.target.value)}
                  placeholder="Sé específico sobre los objetivos que el agente debe alcanzar. El objetivo se alcanza cuando el cliente no tiene nada más que preguntar."
                  rows={4}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="behavior">Comportamiento del agente</Label>
                <Textarea
                  id="behavior"
                  value={behavior}
                  onChange={(e) => setBehavior(e.target.value)}
                  placeholder="Dile al agente qué hacer, paso a paso: cómo saluda, qué hace con un saludo suelto, en qué idioma responde..."
                  rows={5}
                />
              </div>

              <div className="space-y-2">
                <Label>Tono del agente</Label>
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2">
                  {tone.map((t) => (
                    <span
                      key={t}
                      className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
                    >
                      {t}
                      <button
                        type="button"
                        onClick={() => removeTone(t)}
                        className="rounded-full hover:bg-primary/20"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                  <div className="flex flex-1 items-center gap-2">
                    <Input
                      value={toneInput}
                      onChange={(e) => setToneInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addTone();
                        }
                      }}
                      placeholder="Añadir tono (Ej. profesional)"
                      className="h-8 border-0 bg-transparent shadow-none focus-visible:ring-0"
                    />
                    <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={addTone}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Reglas prohibidas</Label>
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2">
                  {rules.map((r) => (
                    <span
                      key={r}
                      className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive"
                    >
                      {r}
                      <button
                        type="button"
                        onClick={() => removeRule(r)}
                        className="rounded-full hover:bg-destructive/20"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                  <div className="flex flex-1 items-center gap-2">
                    <Input
                      value={ruleInput}
                      onChange={(e) => setRuleInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addRule();
                        }
                      }}
                      placeholder="Añadir regla prohibida"
                      className="h-8 border-0 bg-transparent shadow-none focus-visible:ring-0"
                    />
                    <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={addRule}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {section === "knowledge" && <KnowledgePanel agentId={id} />}

          {section === "actions" && (
            <ActionsPanel value={actions} onChange={setActions} />
          )}

          {section === "advanced" && (
            <AdvancedPanel value={advanced} onChange={setAdvanced} />
          )}
        </div>

        {/* ---- Simulador (columna viva) ---- */}
        <aside className="xl:sticky xl:top-4">
          <div className="flex h-full flex-col rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <p className="text-sm font-medium">Simulador de agente</p>
              <Button variant="ghost" size="icon" onClick={handleResetChat} title="Reiniciar chat">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            <div
              ref={scrollRef}
              className="flex min-h-64 flex-1 flex-col gap-3 overflow-y-auto p-4 lg:min-h-96 xl:max-h-[520px]"
            >
              {messages.length === 0 && (
                <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-border text-center text-sm text-muted-foreground">
                  <Bot className="mb-2 h-8 w-8 opacity-50" />
                  <p>Iniciar una conversación con el agente</p>
                  <p className="mt-1 text-xs">Escribe como un cliente para probarlo tal y como responderá a tus clientes reales.</p>
                </div>
              )}
              {messages.map((m, idx) => (
                <div
                  key={idx}
                  className={cn(
                    "flex w-fit max-w-[85%] items-start gap-2 rounded-lg px-3 py-2 text-sm",
                    m.role === "user"
                      ? "ml-auto bg-primary text-primary-foreground"
                      : "bg-muted",
                  )}
                >
                  {m.role === "assistant" && (
                    <Bot className="mt-0.5 h-4 w-4 shrink-0" />
                  )}
                  {m.role === "user" && (
                    <User className="mt-0.5 h-4 w-4 shrink-0" />
                  )}
                  <span className="whitespace-pre-wrap">{m.content}</span>
                </div>
              ))}
              {simLoading && (
                <div className="flex w-fit max-w-[85%] items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Pensando...
                </div>
              )}
            </div>

            <form onSubmit={handleSend} className="flex items-center gap-2 border-t border-border p-3">
              <Input
                value={simInput}
                onChange={(e) => setSimInput(e.target.value)}
                placeholder="Escribe un mensaje..."
                disabled={simLoading}
              />
              <Button type="submit" disabled={simLoading || !simInput.trim()}>
                <Send className="h-4 w-4" />
                <span className="sr-only">Enviar</span>
              </Button>
            </form>
          </div>
        </aside>
      </div>
    </div>
  );
}
