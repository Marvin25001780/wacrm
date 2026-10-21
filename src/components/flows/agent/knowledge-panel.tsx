"use client";

// ============================================================
// Panel de Conocimiento del agente (A2).
//   - Fuentes: base COMPARTIDA de la cuenta; cada agente activa las
//     suyas con el toggle (como Callbell: "1 de N fuentes activada").
//     Añadir una fuente la activa para este agente.
//   - Preguntas y respuestas: curadas por la cuenta; el agente las
//     copia tal cual cuando tocan.
// Las escrituras van inmediatas (no dependen de "Guardar agente").
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  BookOpen,
  FileText,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface SourceItem {
  id: string;
  title: string;
  status: string;
  enabled: boolean;
}
interface QaItem {
  id: string;
  question: string;
  answer: string;
}

export function KnowledgePanel({ agentId }: { agentId: string }) {
  const [loading, setLoading] = useState(true);
  const [sources, setSources] = useState<SourceItem[]>([]);
  const [qa, setQa] = useState<QaItem[]>([]);
  const [busySourceId, setBusySourceId] = useState<string | null>(null);

  // Diálogo de fuente nueva
  const [sourceOpen, setSourceOpen] = useState(false);
  const [sourceTitle, setSourceTitle] = useState("");
  const [sourceContent, setSourceContent] = useState("");
  const [sourceSaving, setSourceSaving] = useState(false);

  // Diálogo de Q&A nueva
  const [qaOpen, setQaOpen] = useState(false);
  const [qaQuestion, setQaQuestion] = useState("");
  const [qaAnswer, setQaAnswer] = useState("");
  const [qaSaving, setQaSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/ai-agents/${agentId}/knowledge`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Error al cargar el conocimiento");
      setSources(json.sources ?? []);
      setQa(json.qa ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error al cargar");
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleSource(source: SourceItem, next: boolean) {
    setBusySourceId(source.id);
    try {
      const res = await fetch(`/api/ai-agents/${agentId}/knowledge`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_id: source.id, enabled: next }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error || "No se pudo cambiar la fuente");
        return;
      }
      setSources((prev) =>
        prev.map((s) => (s.id === source.id ? { ...s, enabled: next } : s))
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error de conexión");
    } finally {
      setBusySourceId(null);
    }
  }

  async function saveSource() {
    if (!sourceTitle.trim() || !sourceContent.trim()) return;
    setSourceSaving(true);
    try {
      const res = await fetch(`/api/ai-agents/${agentId}/knowledge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: sourceTitle.trim(),
          content: sourceContent.trim(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error || "No se pudo guardar la fuente");
        return;
      }
      toast.success("Fuente añadida y activada para este agente");
      setSourceOpen(false);
      setSourceTitle("");
      setSourceContent("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error de conexión");
    } finally {
      setSourceSaving(false);
    }
  }

  async function removeSource(source: SourceItem) {
    if (!confirm(`Borrar la fuente "${source.title}"? La pierden TODOS los agentes que la usen.`)) return;
    setBusySourceId(source.id);
    try {
      const res = await fetch(
        `/api/ai-agents/${agentId}/knowledge?source_id=${encodeURIComponent(source.id)}`,
        { method: "DELETE" },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error || "No se pudo borrar la fuente");
        return;
      }
      setSources((prev) => prev.filter((s) => s.id !== source.id));
      toast.success("Fuente borrada");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error de conexión");
    } finally {
      setBusySourceId(null);
    }
  }

  async function saveQa() {
    if (!qaQuestion.trim() || !qaAnswer.trim()) return;
    setQaSaving(true);
    try {
      const res = await fetch("/api/ai-qa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: qaQuestion.trim(), answer: qaAnswer.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error || "No se pudo guardar la pregunta");
        return;
      }
      toast.success("Pregunta y respuesta añadidas");
      setQaOpen(false);
      setQaQuestion("");
      setQaAnswer("");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error de conexión");
    } finally {
      setQaSaving(false);
    }
  }

  async function removeQa(item: QaItem) {
    try {
      const res = await fetch(`/api/ai-qa?id=${encodeURIComponent(item.id)}`, {
        method: "DELETE",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(json.error || "No se pudo borrar");
        return;
      }
      setQa((prev) => prev.filter((q) => q.id !== item.id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error de conexión");
    }
  }

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  const enabledCount = sources.filter((s) => s.enabled).length;

  return (
    <div className="space-y-4">
      {/* ---- Fuentes ---- */}
      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div>
            <p className="text-sm font-medium text-foreground">
              Fuentes del agente
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Todas las fuentes viven en una base compartida. Activa las que
              este agente puede leer.
            </p>
            <p className="mt-1 text-xs text-primary">
              {enabledCount} de {sources.length}{" "}
              {sources.length === 1 ? "fuente activada" : "fuentes activadas"}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setSourceOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            Agregar
          </Button>
        </div>

        {sources.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            Sin fuentes aún. Agrega la primera (texto con precios, servicios,
            horarios...) para que el agente deje de improvisar.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {sources.map((source) => (
              <li key={source.id} className="flex items-center gap-3 px-4 py-3">
                <FileText className={cn("h-4 w-4 shrink-0", source.enabled ? "text-primary" : "text-muted-foreground")} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground" title={source.title}>
                    {source.title}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {source.status === "available" ? "Disponible" : "Error"} · texto
                  </p>
                </div>
                {busySourceId === source.id ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : (
                  <>
                    <Switch
                      checked={source.enabled}
                      aria-label={`Activar ${source.title}`}
                      onCheckedChange={(next) => void toggleSource(source, next)}
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      aria-label={`Borrar ${source.title}`}
                      onClick={() => void removeSource(source)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ---- Preguntas y respuestas ---- */}
      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div>
            <p className="text-sm font-medium text-foreground">
              Preguntas y respuestas
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Crea preguntas con sus respuestas para que tu agente pueda
              usarlas directamente.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setQaOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            Añadir
          </Button>
        </div>

        {qa.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            Aún no hay preguntas guardadas.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {qa.map((item) => (
              <li key={item.id} className="group flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">Q: {item.question}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">A: {item.answer}</p>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  aria-label="Borrar pregunta"
                  onClick={() => void removeQa(item)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ---- Diálogo: fuente nueva ---- */}
      <Dialog open={sourceOpen} onOpenChange={(o) => (o ? setSourceOpen(o) : setSourceOpen(false))}>
        <DialogContent className="border-border bg-popover sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Agregar fuente</DialogTitle>
            <DialogDescription>
              Pega el contenido tal cual (precios, servicios, horarios, políticas). Máximo unos 2.000 palabras.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="source-title">Título</Label>
              <Input
                id="source-title"
                value={sourceTitle}
                onChange={(e) => setSourceTitle(e.target.value)}
                maxLength={120}
                placeholder="Ej. Lista de precios 2026"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="source-content">Contenido</Label>
              <Textarea
                id="source-content"
                value={sourceContent}
                onChange={(e) => setSourceContent(e.target.value)}
                rows={6}
                placeholder="Ej. Consulta control: 30 USD. Odontología general: 25 USD... Horario: lun-vie 8am-5pm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSourceOpen(false)} disabled={sourceSaving}>
              Cancelar
            </Button>
            <Button
              onClick={() => void saveSource()}
              disabled={sourceSaving || !sourceTitle.trim() || !sourceContent.trim()}
            >
              {sourceSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Guardar fuente
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- Diálogo: Q&A nueva ---- */}
      <Dialog open={qaOpen} onOpenChange={(o) => (o ? setQaOpen(o) : setQaOpen(false))}>
        <DialogContent className="border-border bg-popover sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Añadir pregunta y respuesta</DialogTitle>
            <DialogDescription>
              Cuando el cliente pregunte esto, el agente responderá con esta respuesta.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="qa-question">Pregunta</Label>
              <Input
                id="qa-question"
                value={qaQuestion}
                onChange={(e) => setQaQuestion(e.target.value)}
                maxLength={500}
                placeholder="Ej. ¿Cuánto vale una consulta?"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qa-answer">Respuesta</Label>
              <Textarea
                id="qa-answer"
                value={qaAnswer}
                onChange={(e) => setQaAnswer(e.target.value)}
                rows={4}
                maxLength={5000}
                placeholder="Ej. La consulta vale 30 USD y dura 30 minutos. ¿Te agendo?"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQaOpen(false)} disabled={qaSaving}>
              Cancelar
            </Button>
            <Button
              onClick={() => void saveQa()}
              disabled={qaSaving || !qaQuestion.trim() || !qaAnswer.trim()}
            >
              {qaSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
