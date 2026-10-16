"use client";

// ============================================================
// Edición de Agente de IA — versión mínima funcional.
//
// Permite configurar la personalidad del agente (objetivo,
// comportamiento, tono, reglas prohibidas) y probarlo en un
// simulador de conversación.
// ============================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  Bot,
  Loader2,
  Plus,
  Save,
  Send,
  Trash2,
  User,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/lib/ai/types";

interface AiAgent {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "inactive";
  objective: string | null;
  behavior: string | null;
  tone: string[];
  prohibited_rules: string[];
}

export default function AiAgentEditPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [agent, setAgent] = useState<AiAgent | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<"active" | "inactive">("inactive");
  const [objective, setObjective] = useState("");
  const [behavior, setBehavior] = useState("");
  const [tone, setTone] = useState<string[]>([]);
  const [toneInput, setToneInput] = useState("");
  const [rules, setRules] = useState<string[]>([]);
  const [ruleInput, setRuleInput] = useState("");

  // Simulator state
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
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al guardar");
      setAgent(json.agent);
      toast.success("Agente guardado");
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
        if (json.code === "ai_not_configured") {
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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-lg font-semibold">{agent.name}</h1>
            <p className="text-sm text-muted-foreground">
              {agent.description || "Agente de IA"}
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
            Guardar
          </Button>
        </div>
      </div>

      <Tabs defaultValue="personality" className="w-full">
        <TabsList>
          <TabsTrigger value="personality">Personalidad</TabsTrigger>
          <TabsTrigger value="simulator">Simulador</TabsTrigger>
        </TabsList>

        <TabsContent value="personality" className="space-y-4">
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
            <Label htmlFor="objective">Objetivo</Label>
            <Textarea
              id="objective"
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              placeholder="Qué debe lograr el agente..."
              rows={4}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="behavior">Comportamiento</Label>
            <Textarea
              id="behavior"
              value={behavior}
              onChange={(e) => setBehavior(e.target.value)}
              placeholder="Cómo debe actuar el agente ante diferentes situaciones..."
              rows={4}
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
        </TabsContent>

        <TabsContent value="simulator" className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Escribe como un cliente para probar las respuestas del agente.
            </p>
            <Button variant="outline" size="sm" onClick={handleResetChat}>
              <Trash2 className="mr-2 h-4 w-4" />
              Reiniciar chat
            </Button>
          </div>

          <div
            ref={scrollRef}
            className="flex h-[400px] flex-col gap-3 overflow-y-auto rounded-xl border border-border bg-card p-4"
          >
            {messages.length === 0 && (
              <div className="flex flex-1 flex-col items-center justify-center text-center text-sm text-muted-foreground">
                <Bot className="mb-2 h-8 w-8 opacity-50" />
                <p>Envía un mensaje para empezar la simulación.</p>
              </div>
            )}
            {messages.map((m, idx) => (
              <div
                key={idx}
                className={cn(
                  "flex w-fit max-w-[80%] items-start gap-2 rounded-lg px-3 py-2 text-sm",
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
              <div className="flex w-fit max-w-[80%] items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Pensando...
              </div>
            )}
          </div>

          <form onSubmit={handleSend} className="flex items-center gap-2">
            <Input
              value={simInput}
              onChange={(e) => setSimInput(e.target.value)}
              placeholder="Escribe un mensaje de prueba..."
              disabled={simLoading}
            />
            <Button type="submit" disabled={simLoading || !simInput.trim()}>
              <Send className="h-4 w-4" />
              <span className="sr-only">Enviar</span>
            </Button>
          </form>
        </TabsContent>
      </Tabs>
    </div>
  );
}
