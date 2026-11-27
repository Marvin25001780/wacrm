"use client";

// ============================================================
// Panel de recordatorios por cuota (migración 134).
//
// Se apoya en dos rutas:
//   GET  /api/cobranza/recordatorios          → reglas + plantillas
//   GET  /api/cobranza/recordatorios/preview  → a quién le toca
//   POST /api/cobranza/recordatorios/run      → envío real
//
// El botón de vista previa usa datos reales de la cartera; no inventa
// montos ni fechas. El envío es idempotente en la base.
// ============================================================

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  BellRing,
  CalendarClock,
  Loader2,
  Mail,
  MessageCircle,
  Play,
  Save,
  Send,
} from "lucide-react";

import { Panel } from "@/components/metrics/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import { formatDate, formatUsd } from "@/lib/collections/format";
import {
  EMAIL_PLACEHOLDERS,
  WHATSAPP_VARIABLE_HELP,
  reminderKindLabel,
  type ReminderCandidate,
  type ReminderRunSummary,
  type ReminderSettings,
} from "@/lib/collections/reminders-shared";

interface TemplateOption {
  id: string;
  name: string;
  language: string | null;
  body_text: string;
}

interface ApiPayload {
  settings: ReminderSettings;
  persisted: boolean;
  migration_pending: boolean;
  timezone: string;
  templates: TemplateOption[];
  templates_error: string | null;
  email_configured: boolean | null;
}

interface PreviewCounts {
  total: number;
  before_due: number;
  on_due: number;
  after_due: number;
  whatsapp_sent: number;
  email_sent: number;
}

interface PreviewSample {
  kind: "before_due" | "on_due" | "after_due";
  label: string;
  debtor_name: string;
  whatsapp: string | null;
  whatsapp_error: string | null;
  email_subject: string;
  email_body: string;
}

interface PreviewPayload {
  enabled: boolean;
  migration_pending: boolean;
  date: string;
  timezone: string;
  counts: PreviewCounts;
  candidates: ReminderCandidate[];
  samples: PreviewSample[];
  template_error?: string | null;
  message?: string;
}

const selectClass =
  "h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export function ReminderSettingsPanel() {
  const { accountId } = useAuth();
  const canEdit = useCan("edit-settings");

  const [data, setData] = useState<ApiPayload | null>(null);
  const [draft, setDraft] = useState<ReminderSettings | null>(null);
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [summary, setSummary] = useState<ReminderRunSummary | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [running, setRunning] = useState(false);
  const [date, setDate] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/cobranza/recordatorios", {
        cache: "no-store",
      });
      const json = (await res.json()) as ApiPayload & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "No se pudo cargar.");
      setData(json);
      setDraft(json.settings);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo cargar.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load, accountId]);

  function update(patch: Partial<ReminderSettings>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await fetch("/api/cobranza/recordatorios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const json = (await res.json()) as {
        settings?: ReminderSettings;
        error?: string;
      };
      if (!res.ok || !json.settings) {
        toast.error(json.error ?? "No se pudieron guardar las reglas.");
        return;
      }
      setDraft(json.settings);
      setData((current) =>
        current
          ? { ...current, settings: json.settings!, persisted: true }
          : current,
      );
      toast.success("Recordatorios guardados.");
    } finally {
      setSaving(false);
    }
  }

  async function loadPreview() {
    setPreviewing(true);
    try {
      const query = date ? `?date=${encodeURIComponent(date)}` : "";
      const res = await fetch(`/api/cobranza/recordatorios/preview${query}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as PreviewPayload & { error?: string };
      if (!res.ok) {
        toast.error(json.error ?? "No se pudo calcular la vista previa.");
        return;
      }
      setPreview(json);
      setSummary(null);
    } finally {
      setPreviewing(false);
    }
  }

  async function sendNow() {
    if (!draft) return;
    const when = date
      ? `la fecha ${formatDate(date)}`
      : "hoy según la zona del negocio";
    const confirmed = window.confirm(
      `Se enviarán los recordatorios de ${when}. Lo ya enviado no se repite. ¿Continuar?`,
    );
    if (!confirmed) return;

    setRunning(true);
    try {
      const res = await fetch("/api/cobranza/recordatorios/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: date || undefined }),
      });
      const json = (await res.json()) as ReminderRunSummary & {
        error?: string;
      };
      if (!res.ok) {
        toast.error(json.error ?? "No se pudo ejecutar.");
        return;
      }
      setSummary(json);
      setPreview(null);
      toast.success(
        `Enviados ${json.sent}. Fallidos ${json.failed}. Omitidos ${json.skipped}.`,
      );
      await load();
    } finally {
      setRunning(false);
    }
  }

  function insertPlaceholder(token: string) {
    if (!draft) return;
    update({ email_body: `${draft.email_body}${draft.email_body.endsWith("\n") ? "" : " "}${token}` });
  }

  if (loading) {
    return (
      <Panel title="Recordatorios de pago" subtitle="Cargando reglas…">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Cargando…
        </div>
      </Panel>
    );
  }

  if (!draft || !data) {
    return (
      <Panel title="Recordatorios de pago">
        <p className="text-sm text-muted-foreground">
          No se pudo cargar la configuración de recordatorios.
        </p>
      </Panel>
    );
  }

  const activeTemplate = data.templates.find(
    (template) => template.name === draft.whatsapp_template,
  );

  return (
    <Panel
      title={
        <span className="inline-flex items-center gap-2">
          <BellRing className="h-4 w-4 text-primary" />
          Recordatorios de pago
        </span>
      }
      subtitle="Avisos automáticos por cuota: antes, el día y después del vencimiento"
      actions={
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {draft.enabled ? "Activos" : "Apagados"}
            </span>
            <Switch
              checked={draft.enabled}
              onCheckedChange={(checked) => update({ enabled: Boolean(checked) })}
              disabled={!canEdit}
              aria-label="Activar recordatorios"
            />
          </div>
          {canEdit ? (
            <Button type="button" onClick={save} disabled={saving} size="sm">
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Guardar
            </Button>
          ) : null}
        </div>
      }
    >
      {data.migration_pending ? (
        <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          Falta aplicar la migración 134. Ejecuta{" "}
          <span className="font-mono">PROD_UPDATE_134.sql</span> en Supabase y
          recarga esta página.
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="space-y-2">
          <Label className="text-muted-foreground">Días antes</Label>
          <Input
            type="number"
            min={0}
            max={30}
            value={draft.days_before}
            onChange={(event) =>
              update({ days_before: Number(event.target.value) })
            }
            disabled={!canEdit}
          />
        </div>
        <div className="space-y-2">
          <Label className="text-muted-foreground">Día del vencimiento</Label>
          <div className="flex h-9 items-center rounded-lg border border-border bg-muted px-2.5 text-sm text-muted-foreground">
            Siempre incluido
          </div>
        </div>
        <div className="space-y-2">
          <Label className="text-muted-foreground">Días de mora</Label>
          <Input
            type="number"
            min={1}
            max={60}
            value={draft.days_after}
            onChange={(event) =>
              update({ days_after: Number(event.target.value) })
            }
            disabled={!canEdit}
          />
        </div>
        <div className="space-y-2">
          <Label className="text-muted-foreground">Hora local de envío</Label>
          <Input
            type="number"
            min={0}
            max={23}
            value={draft.send_hour}
            onChange={(event) =>
              update({ send_hour: Number(event.target.value) })
            }
            disabled={!canEdit}
          />
          <p className="text-[11px] text-muted-foreground">
            {data.timezone} · 0–23
          </p>
        </div>
        <div className="space-y-2">
          <Label className="text-muted-foreground">Tope por corrida</Label>
          <Input
            type="number"
            min={1}
            max={2000}
            value={draft.max_per_run}
            onChange={(event) =>
              update({ max_per_run: Number(event.target.value) })
            }
            disabled={!canEdit}
          />
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-muted/40 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
                <MessageCircle className="h-4 w-4 text-emerald-400" />
                WhatsApp
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Siempre como plantilla aprobada.
              </p>
            </div>
            <Switch
              checked={draft.whatsapp_enabled}
              onCheckedChange={(checked) =>
                update({ whatsapp_enabled: Boolean(checked) })
              }
              disabled={!canEdit}
              aria-label="Canal WhatsApp"
            />
          </div>

          <div className="mt-3 space-y-2">
            <Label className="text-muted-foreground">Plantilla</Label>
            <select
              className={selectClass}
              value={draft.whatsapp_template ?? ""}
              onChange={(event) =>
                update({ whatsapp_template: event.target.value || null })
              }
              disabled={!canEdit}
            >
              <option value="">Selecciona una plantilla…</option>
              {data.templates.map((template) => (
                <option key={template.id} value={template.name}>
                  {template.name}
                  {template.language ? ` (${template.language})` : ""}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground">
              Variables en orden: {WHATSAPP_VARIABLE_HELP}
            </p>
            {activeTemplate ? (
              <p className="max-h-24 overflow-y-auto rounded-md border border-border bg-card px-2.5 py-2 text-xs text-muted-foreground">
                {activeTemplate.body_text}
              </p>
            ) : null}
            {data.templates.length === 0 ? (
              <p className="text-xs text-amber-300">
                No hay plantillas aprobadas. Créalas y sincronízalas en
                WhatsApp antes de activar este canal.
              </p>
            ) : null}
            {data.templates_error ? (
              <p className="text-xs text-red-300">{data.templates_error}</p>
            ) : null}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-muted/40 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
                <Mail className="h-4 w-4 text-sky-400" />
                Correo
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Sale por el correo configurado en Ajustes.
              </p>
            </div>
            <Switch
              checked={draft.email_enabled}
              onCheckedChange={(checked) =>
                update({ email_enabled: Boolean(checked) })
              }
              disabled={!canEdit}
              aria-label="Canal correo"
            />
          </div>

          <div className="mt-3 space-y-2">
            <Label className="text-muted-foreground">Asunto</Label>
            <Input
              value={draft.email_subject}
              onChange={(event) => update({ email_subject: event.target.value })}
              disabled={!canEdit}
            />
            <Label className="text-muted-foreground">Cuerpo</Label>
            <Textarea
              rows={6}
              value={draft.email_body}
              onChange={(event) => update({ email_body: event.target.value })}
              disabled={!canEdit}
            />
            <div className="flex flex-wrap gap-1.5">
              {EMAIL_PLACEHOLDERS.map((placeholder) => (
                <button
                  key={placeholder.token}
                  type="button"
                  onClick={() => insertPlaceholder(placeholder.token)}
                  disabled={!canEdit}
                  className="rounded-md border border-border bg-card px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:opacity-50"
                  title={placeholder.label}
                >
                  {placeholder.token}
                </button>
              ))}
            </div>
            {data.email_configured === false ? (
              <p className="text-xs text-amber-300">
                El correo todavía no está habilitado en Ajustes → Correo.
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-end gap-3 border-t border-border pt-5">
        <div className="space-y-2">
          <Label className="text-muted-foreground">
            Fecha a revisar (opcional)
          </Label>
          <Input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className="w-44"
          />
          <p className="text-[11px] text-muted-foreground">
            Vacío = hoy en {data.timezone}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={loadPreview}
          disabled={previewing || data.migration_pending}
        >
          {previewing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <CalendarClock className="mr-2 h-4 w-4" />
          )}
          Ver a quién le toca
        </Button>
        {canEdit ? (
          <Button
            type="button"
            onClick={sendNow}
            disabled={running || !draft.enabled || data.migration_pending}
          >
            {running ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            Enviar ahora
          </Button>
        ) : null}
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        El envío respeta la bitácora: una cuota no recibe dos veces el mismo
        aviso por el mismo canal. El cron externo ejecuta esto solo todos los
        días a la hora configurada.
      </p>

      {preview ? (
        <div className="mt-5 space-y-4 rounded-lg border border-border bg-muted/30 p-4">
          {preview.migration_pending ? (
            <p className="text-sm text-amber-300">
              Aplica la migración 134 para ver los candidatos.
            </p>
          ) : !preview.enabled ? (
            <p className="text-sm text-muted-foreground">
              {preview.message ?? "Los recordatorios están apagados."}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="font-medium text-foreground">
                  {formatDate(preview.date)}
                </span>
                <span className="rounded-md bg-card px-2 py-1 text-xs text-muted-foreground">
                  {preview.counts.total} cuota
                  {preview.counts.total === 1 ? "" : "s"}
                </span>
                <span className="rounded-md bg-card px-2 py-1 text-xs text-muted-foreground">
                  Antes: {preview.counts.before_due}
                </span>
                <span className="rounded-md bg-card px-2 py-1 text-xs text-muted-foreground">
                  Vence hoy: {preview.counts.on_due}
                </span>
                <span className="rounded-md bg-card px-2 py-1 text-xs text-muted-foreground">
                  Mora: {preview.counts.after_due}
                </span>
              </div>

              {preview.counts.total === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Ninguna cuota cae en la escalera para esa fecha.
                </p>
              ) : (
                <div className="max-h-72 overflow-y-auto rounded-md border border-border">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-card text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium">Deudor</th>
                        <th className="px-3 py-2 text-left font-medium">Cuota</th>
                        <th className="px-3 py-2 text-left font-medium">Vence</th>
                        <th className="px-3 py-2 text-right font-medium">Saldo</th>
                        <th className="px-3 py-2 text-left font-medium">Aviso</th>
                        <th className="px-3 py-2 text-left font-medium">Canales</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.candidates.slice(0, 50).map((candidate) => (
                        <tr
                          key={`${candidate.installment_id}-${candidate.kind}`}
                          className="border-t border-border"
                        >
                          <td className="px-3 py-2 text-foreground">
                            {candidate.debtor_name}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            #{candidate.installment_number}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {formatDate(candidate.due_date)}
                          </td>
                          <td className="px-3 py-2 text-right text-foreground">
                            {formatUsd(Number(candidate.balance) || 0)}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {reminderKindLabel(candidate.kind, draft)}
                          </td>
                          <td className="px-3 py-2">
                            <span className="flex flex-wrap gap-1">
                              {candidate.phone ? (
                                <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300">
                                  WhatsApp{candidate.whatsapp_sent ? " ✓" : ""}
                                </span>
                              ) : null}
                              {candidate.email ? (
                                <span className="rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-300">
                                  Correo{candidate.email_sent ? " ✓" : ""}
                                </span>
                              ) : null}
                              {!candidate.phone && !candidate.email ? (
                                <span className="text-[10px] text-amber-300">
                                  Sin contacto
                                </span>
                              ) : null}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {preview.samples.length > 0 ? (
                <div className="grid gap-3 lg:grid-cols-3">
                  {preview.samples.map((sample) => (
                    <div
                      key={sample.kind}
                      className="rounded-md border border-border bg-card p-3"
                    >
                      <p className="text-xs font-medium text-foreground">
                        {sample.label}
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {sample.debtor_name}
                      </p>
                      <p className="mt-2 text-[11px] font-medium text-emerald-300">
                        WhatsApp
                      </p>
                      <pre className="mt-1 max-h-28 overflow-y-auto whitespace-pre-wrap break-words text-[11px] text-muted-foreground">
                        {sample.whatsapp ??
                          sample.whatsapp_error ??
                          "Sin plantilla."}
                      </pre>
                      <p className="mt-2 text-[11px] font-medium text-sky-300">
                        Correo
                      </p>
                      <p className="mt-1 text-[11px] text-foreground">
                        {sample.email_subject}
                      </p>
                      <pre className="mt-1 max-h-28 overflow-y-auto whitespace-pre-wrap break-words text-[11px] text-muted-foreground">
                        {sample.email_body}
                      </pre>
                    </div>
                  ))}
                </div>
              ) : null}

              {preview.template_error ? (
                <p className="text-xs text-amber-300">
                  {preview.template_error}
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {summary ? (
        <div className="mt-4 rounded-lg border border-border bg-muted/30 p-4">
          <p className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
            <Play className="h-4 w-4 text-primary" />
            Resultado de la corrida · {formatDate(summary.date)}
          </p>
          <div className="mt-2 flex flex-wrap gap-3 text-xs">
            <span className="rounded bg-emerald-500/10 px-2 py-1 text-emerald-300">
              Enviados: {summary.sent}
            </span>
            <span className="rounded bg-red-500/10 px-2 py-1 text-red-300">
              Fallidos: {summary.failed}
            </span>
            <span className="rounded bg-muted px-2 py-1 text-muted-foreground">
              Omitidos: {summary.skipped}
            </span>
            <span className="text-muted-foreground">
              Candidatos: {summary.candidates}
            </span>
          </div>
          {Object.keys(summary.reasons).length > 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {Object.entries(summary.reasons)
                .map(([reason, count]) => `${reason} (${count})`)
                .join(" · ")}
            </p>
          ) : null}
          {summary.failed > 0 ? (
            <div className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs">
              {summary.items
                .filter((item) => item.status === "failed")
                .map((item) => (
                  <p key={`${item.installment_id}-${item.channel}`} className="text-red-300">
                    {item.debtor_name} · {item.channel}: {item.reason}
                  </p>
                ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {draft.last_run_summary ? (
        <p className="mt-4 text-xs text-muted-foreground">
          Última corrida: {draft.last_run_summary.date} · enviados{" "}
          {draft.last_run_summary.sent} · fallidos {draft.last_run_summary.failed}{" "}
          · omitidos {draft.last_run_summary.skipped}
        </p>
      ) : null}
    </Panel>
  );
}

export default ReminderSettingsPanel;
