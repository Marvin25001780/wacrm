"use client";

// ============================================================
// Segmentación — segmentos dinámicos de contactos y leads.
//
// Constructor de reglas (AND) con vista previa en vivo, sugerencia por
// IA (usa la configuración BYO-key de la cuenta) y exportación del
// listado. Los segmentos se guardan y se evalúan al consultarlos, así
// que nunca quedan desactualizados.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useAuth } from "@/hooks/use-auth";
import { hasMinRole } from "@/lib/auth/roles";
import { toast } from "sonner";
import {
  Loader2,
  Plus,
  Trash2,
  Pencil,
  Sparkles,
  Users,
  Target,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  fieldsFor,
  fieldDef,
  describeRules,
  OPERATOR_LABEL,
  MAX_RULES,
} from "@/lib/segments/rules";
import type { Segment, SegmentEntity, SegmentRule } from "@/types";

const ENTITY_META: Record<
  SegmentEntity,
  { label: string; icon: typeof Users }
> = {
  contacts: { label: "Contactos", icon: Users },
  leads: { label: "Leads", icon: Target },
};

const selectClass =
  "rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring";

interface Draft {
  name: string;
  description: string;
  entity: SegmentEntity;
  rules: SegmentRule[];
}

const EMPTY: Draft = {
  name: "",
  description: "",
  entity: "leads",
  rules: [],
};

export default function SegmentsPage() {
  const { accountRole, profileLoading } = useAuth();

  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);

  const [preview, setPreview] = useState<{ count: number; sample: Record<string, unknown>[] } | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const [aiPrompt, setAiPrompt] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  const canEdit = accountRole ? hasMinRole(accountRole, "agent") : false;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/segments");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { data: Segment[] };
      setSegments(json.data ?? []);
    } catch (err) {
      console.error("[segments] load error:", err);
      setError("No se pudieron cargar los segmentos.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (profileLoading) return;
    void load();
  }, [profileLoading, load]);

  const openCreate = () => {
    setEditingId(null);
    setDraft(EMPTY);
    setPreview(null);
    setAiPrompt("");
    setOpen(true);
  };

  const openEdit = (seg: Segment) => {
    setEditingId(seg.id);
    setDraft({
      name: seg.name,
      description: seg.description ?? "",
      entity: seg.entity,
      rules: seg.rules?.length ? seg.rules : [],
    });
    setPreview(null);
    setAiPrompt("");
    setOpen(true);
  };

  const setEntity = (entity: SegmentEntity) => {
    setDraft((d) => ({ ...d, entity, rules: [] }));
    setPreview(null);
  };

  const addRule = () => {
    const first = fieldsFor(draft.entity)[0];
    setDraft((d) => {
      if (d.rules.length >= MAX_RULES) return d;
      return {
        ...d,
        rules: [...d.rules, { field: first.key, operator: first.operators[0], value: "" }],
      };
    });
    setPreview(null);
  };

  const updateRule = (index: number, patch: Partial<SegmentRule>) => {
    setDraft((d) => {
      const rules = d.rules.map((r, i) => (i === index ? { ...r, ...patch } : r));
      return { ...d, rules };
    });
    setPreview(null);
  };

  const removeRule = (index: number) => {
    setDraft((d) => ({ ...d, rules: d.rules.filter((_, i) => i !== index) }));
    setPreview(null);
  };

  const runPreview = async () => {
    setPreviewing(true);
    try {
      const res = await fetch("/api/segments/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity: draft.entity, rules: draft.rules }),
      });
      const json = (await res.json()) as {
        count?: number;
        sample?: Record<string, unknown>[];
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? "Error");
      setPreview({ count: json.count ?? 0, sample: json.sample ?? [] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo previsualizar");
    } finally {
      setPreviewing(false);
    }
  };

  const suggestAi = async () => {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    try {
      const res = await fetch("/api/segments/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entity: draft.entity, description: aiPrompt.trim() }),
      });
      const json = (await res.json()) as { rules?: SegmentRule[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Error");
      setDraft((d) => ({ ...d, rules: json.rules ?? [] }));
      setPreview(null);
      toast.success("Segmento sugerido por IA");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "La IA no pudo sugerir reglas");
    } finally {
      setAiLoading(false);
    }
  };

  const save = async () => {
    if (!draft.name.trim()) {
      toast.error("Ponle un nombre al segmento");
      return;
    }
    setSaving(true);
    try {
      const url = editingId ? `/api/segments/${editingId}` : "/api/segments";
      const res = await fetch(url, {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name.trim(),
          description: draft.description.trim() || null,
          entity: draft.entity,
          rules: draft.rules,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Error al guardar");
      toast.success(editingId ? "Segmento actualizado" : "Segmento creado");
      setOpen(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (seg: Segment) => {
    if (!confirm(`¿Eliminar el segmento "${seg.name}"?`)) return;
    try {
      const res = await fetch(`/api/segments/${seg.id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        throw new Error(json.error ?? "Error");
      }
      toast.success("Segmento eliminado");
      setSegments((prev) => prev.filter((s) => s.id !== seg.id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo eliminar");
    }
  };

  const currentFieldDefs = useMemo(() => fieldsFor(draft.entity), [draft.entity]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Segmentos</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Agrupa contactos o leads con reglas dinámicas. Se recalculan solos.
          </p>
        </div>
        {canEdit && (
          <Button onClick={openCreate}>
            <Plus className="size-4" /> Nuevo segmento
          </Button>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-24">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-border bg-card py-16 text-center text-sm text-muted-foreground">
          {error}
        </div>
      ) : segments.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-card py-16 text-muted-foreground">
          <Search className="size-8" />
          <p className="text-sm">Aún no hay segmentos.</p>
          {canEdit && (
            <Button variant="outline" size="sm" onClick={openCreate} className="mt-1">
              Crear el primero
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {segments.map((seg) => {
            const meta = ENTITY_META[seg.entity];
            const Icon = meta.icon;
            return (
              <div
                key={seg.id}
                className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                        <Icon className="size-3" />
                        {meta.label}
                      </span>
                    </div>
                    <h3 className="mt-1.5 truncate text-sm font-semibold text-foreground">
                      {seg.name}
                    </h3>
                  </div>
                  {canEdit && (
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        onClick={() => openEdit(seg)}
                        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        aria-label="Editar"
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(seg)}
                        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-rose-400"
                        aria-label="Eliminar"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  )}
                </div>

                {seg.description && (
                  <p className="line-clamp-2 text-xs text-muted-foreground">{seg.description}</p>
                )}

                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Reglas:</span>{" "}
                  {describeRules(seg.entity, seg.rules ?? [])}
                </p>

                <p className="mt-auto text-[11px] text-muted-foreground">
                  Creado {format(new Date(seg.created_at), "d MMM yyyy", { locale: es })}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/* Diálogo de creación / edición */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar segmento" : "Nuevo segmento"}</DialogTitle>
            <DialogDescription>
              Define las condiciones. Se combinan con Y (todas deben cumplirse).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="seg-name">Nombre</Label>
                <Input
                  id="seg-name"
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  placeholder="p. ej. Leads calificados de octubre"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="seg-entity">Entidad</Label>
                <select
                  id="seg-entity"
                  value={draft.entity}
                  onChange={(e) => setEntity(e.target.value as SegmentEntity)}
                  className={`${selectClass} w-full`}
                >
                  <option value="leads">Leads</option>
                  <option value="contacts">Contactos</option>
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="seg-desc">Descripción (opcional)</Label>
              <Input
                id="seg-desc"
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                placeholder="Para qué sirve este segmento"
              />
            </div>

            {/* Sugerencia por IA */}
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-foreground">
                <Sparkles className="size-4 text-primary" /> Sugerir con IA
              </div>
              <Textarea
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="Describe el segmento en lenguaje natural… p. ej. «leads calificados con valor mayor a 1000»"
                rows={2}
              />
              <div className="mt-2 flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={suggestAi}
                  disabled={aiLoading || !aiPrompt.trim()}
                >
                  {aiLoading ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Sparkles className="size-4" />
                  )}
                  Generar reglas
                </Button>
              </div>
            </div>

            {/* Constructor de reglas */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Condiciones</Label>
                <span className="text-xs text-muted-foreground">
                  {draft.rules.length}/{MAX_RULES}
                </span>
              </div>

              {draft.rules.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border py-4 text-center text-xs text-muted-foreground">
                  Sin condiciones: el segmento incluye todos los registros.
                </p>
              ) : (
                <div className="space-y-2">
                  {draft.rules.map((rule, i) => {
                    const def = fieldDef(draft.entity, rule.field);
                    const ops = def?.operators ?? [];
                    const needsValue = rule.operator !== "is_set" && rule.operator !== "is_not_set";
                    return (
                      <div key={i} className="flex items-center gap-2">
                        <select
                          value={rule.field}
                          onChange={(e) => {
                            const next = fieldDef(draft.entity, e.target.value);
                            updateRule(i, {
                              field: e.target.value,
                              operator: next?.operators[0] ?? "equals",
                              value: "",
                            });
                          }}
                          className={`${selectClass} flex-1`}
                        >
                          {currentFieldDefs.map((f) => (
                            <option key={f.key} value={f.key}>
                              {f.label}
                            </option>
                          ))}
                        </select>
                        <select
                          value={rule.operator}
                          onChange={(e) =>
                            updateRule(i, { operator: e.target.value as SegmentRule["operator"] })
                          }
                          className={`${selectClass} flex-1`}
                        >
                          {ops.map((op) => (
                            <option key={op} value={op}>
                              {OPERATOR_LABEL[op]}
                            </option>
                          ))}
                        </select>
                        {needsValue && (
                          <Input
                            value={rule.value ?? ""}
                            onChange={(e) => updateRule(i, { value: e.target.value })}
                            list={def?.options ? `seg-opts-${i}` : undefined}
                            placeholder="Valor"
                            className="flex-1"
                          />
                        )}
                        {def?.options && (
                          <datalist id={`seg-opts-${i}`}>
                            {def.options.map((o) => (
                              <option key={o} value={o} />
                            ))}
                          </datalist>
                        )}
                        <button
                          type="button"
                          onClick={() => removeRule(i)}
                          className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-rose-400"
                          aria-label="Quitar condición"
                        >
                          <X className="size-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              <Button
                variant="outline"
                size="sm"
                onClick={addRule}
                disabled={draft.rules.length >= MAX_RULES}
              >
                <Plus className="size-4" /> Añadir condición
              </Button>
            </div>

            {/* Vista previa */}
            <div className="rounded-lg border border-border bg-muted/20 p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">
                  {preview ? (
                    <>
                      <span className="font-semibold text-foreground">{preview.count}</span>{" "}
                      coincidencias
                    </>
                  ) : (
                    "Comprueba cuántos registros coinciden"
                  )}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={runPreview}
                  disabled={previewing}
                >
                  {previewing ? <Loader2 className="size-4 animate-spin" /> : null}
                  Previsualizar
                </Button>
              </div>
              {preview && preview.sample.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {preview.sample.map((row, i) => (
                    <li key={i} className="truncate">
                      • {String(row.name ?? row.id ?? "—")}{" "}
                      {row.email ? `· ${String(row.email)}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              {editingId ? "Guardar cambios" : "Crear segmento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
