"use client";

// ============================================================
// Auditoría empresarial — módulo de seguridad.
//
// Bitácora append-only de todos los cambios en las tablas de negocio
// (ver migración 041 + trigger `audit_row`). Solo admin+ puede leerla
// (RLS). Filtros por tabla, operación, período y autor, con detalle
// del diff y exportación a CSV.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { canEditSettings } from "@/lib/auth/roles";
import { toast } from "sonner";
import {
  Loader2,
  ScrollText,
  Download,
  Search,
  Plus,
  Pencil,
  Trash2,
  ChevronDown,
} from "lucide-react";
import type { AuditLog, AuditOperation } from "@/types";

// ------------------------------------------------------------
// Presentación
// ------------------------------------------------------------

const TABLE_LABEL: Record<string, string> = {
  leads: "Leads",
  deals: "Ofertas",
  contacts: "Contactos",
  organizations: "Empresas",
  activities: "Actividades",
  notes: "Notas",
  attachments: "Adjuntos",
  spaces: "Espacios",
  space_records: "Registros de espacio",
  receivables: "Cobranza",
  receivable_payments: "Pagos de cobranza",
  broadcasts: "Campañas",
  account_invitations: "Invitaciones",
  api_keys: "Claves API",
  webhook_endpoints: "Webhooks",
  ai_configs: "Asistente IA",
  webchat_configs: "Widget webchat",
  sms_config: "SMS",
  integrations: "Integraciones",
  whatsapp_config: "WhatsApp",
  pipelines: "Pipelines",
  tags: "Etiquetas",
  custom_fields: "Campos personalizados",
  message_templates: "Plantillas",
};

const OPERATION_META: Record<
  AuditOperation,
  { label: string; icon: typeof Plus; className: string }
> = {
  INSERT: {
    label: "Creación",
    icon: Plus,
    className: "text-emerald-400 bg-emerald-400/10",
  },
  UPDATE: {
    label: "Edición",
    icon: Pencil,
    className: "text-amber-400 bg-amber-400/10",
  },
  DELETE: {
    label: "Eliminación",
    icon: Trash2,
    className: "text-rose-400 bg-rose-400/10",
  },
};

type PeriodKey = "1" | "7" | "30" | "90" | "all";
const PERIODS: Array<{ key: PeriodKey; label: string }> = [
  { key: "1", label: "24 h" },
  { key: "7", label: "7 días" },
  { key: "30", label: "30 días" },
  { key: "90", label: "90 días" },
  { key: "all", label: "Todo" },
];

const PAGE_SIZE = 50;

function periodSince(key: PeriodKey): string | null {
  if (key === "all") return null;
  const days = Number(key);
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function tableLabel(t: string): string {
  return TABLE_LABEL[t] ?? t;
}

function shortId(id: string | null): string {
  return id ? id.slice(0, 8) : "—";
}

function fmtValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Columnas que cambiaron entre `before` y `after` (o el contenido
 *  completo para altas/bajas). */
function changedFields(log: AuditLog): Array<{ key: string; from: string; to: string }> {
  const before = log.changes?.before ?? {};
  const after = log.changes?.after ?? {};
  if (log.operation === "INSERT") {
    return Object.entries(after).map(([key, v]) => ({
      key,
      from: "—",
      to: fmtValue(v),
    }));
  }
  if (log.operation === "DELETE") {
    return Object.entries(before).map(([key, v]) => ({
      key,
      from: fmtValue(v),
      to: "—",
    }));
  }
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const out: Array<{ key: string; from: string; to: string }> = [];
  keys.forEach((key) => {
    const a = before[key];
    const b = after[key];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      out.push({ key, from: fmtValue(a), to: fmtValue(b) });
    }
  });
  return out;
}

// ------------------------------------------------------------
// Página
// ------------------------------------------------------------

export default function AuditPage() {
  const supabase = createClient();
  const { accountId, accountRole, profileLoading } = useAuth();

  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [table, setTable] = useState<string>("all");
  const [operation, setOperation] = useState<string>("all");
  const [period, setPeriod] = useState<PeriodKey>("30");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const isAdmin = accountRole ? canEditSettings(accountRole) : false;

  const buildQuery = useCallback(
    (from: number) => {
      let req = supabase
        .from("audit_logs")
        .select("*")
        .eq("account_id", accountId)
        .order("created_at", { ascending: false })
        .range(from, from + PAGE_SIZE - 1);

      if (table !== "all") req = req.eq("table_name", table);
      if (operation !== "all") req = req.eq("operation", operation);
      const since = periodSince(period);
      if (since) req = req.gte("created_at", since);
      if (search.trim()) req = req.ilike("actor_email", `%${search.trim()}%`);
      return req;
    },
    [supabase, accountId, table, operation, period, search],
  );

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: qErr } = await buildQuery(0);
      if (qErr) throw qErr;
      const rows = (data ?? []) as unknown as AuditLog[];
      setLogs(rows);
      setHasMore(rows.length === PAGE_SIZE);
    } catch (err) {
      console.error("[audit] load error:", err);
      setError("No se pudo cargar la bitácora.");
    } finally {
      setLoading(false);
    }
  }, [accountId, buildQuery]);

  const loadMore = useCallback(async () => {
    if (!accountId || loadingMore) return;
    setLoadingMore(true);
    try {
      const { data, error: qErr } = await buildQuery(logs.length);
      if (qErr) throw qErr;
      const rows = (data ?? []) as unknown as AuditLog[];
      setLogs((prev) => [...prev, ...rows]);
      setHasMore(rows.length === PAGE_SIZE);
    } catch (err) {
      console.error("[audit] loadMore error:", err);
      toast.error("No se pudieron cargar más registros.");
    } finally {
      setLoadingMore(false);
    }
  }, [accountId, buildQuery, logs.length, loadingMore]);

  useEffect(() => {
    if (!accountId || !isAdmin) return;
    void load();
  }, [accountId, isAdmin, load]);

  const tableOptions = useMemo(
    () => Object.keys(TABLE_LABEL).sort((a, b) => tableLabel(a).localeCompare(tableLabel(b))),
    [],
  );

  const exportCsv = () => {
    const header = ["fecha", "autor", "operacion", "tabla", "registro", "cambios"];
    const lines = logs.map((l) => {
      const fields = changedFields(l)
        .map((f) => `${f.key}: ${f.from} -> ${f.to}`)
        .join(" | ");
      return [
        new Date(l.created_at).toISOString(),
        l.actor_email ?? "",
        l.operation,
        l.table_name,
        l.record_id ?? "",
        fields,
      ]
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
        .join(",");
    });
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `auditoria-${format(new Date(), "yyyyMMdd-HHmm")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (profileLoading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-card py-24 text-muted-foreground">
        <ScrollText className="size-8" />
        <p className="text-sm">Solo administradores y propietarios pueden ver la auditoría.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Auditoría</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Historial de cambios de la cuenta — quién, qué y cuándo.
          </p>
        </div>
        <button
          type="button"
          onClick={exportCsv}
          disabled={logs.length === 0}
          className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
        >
          <Download className="size-4" /> Exportar CSV
        </button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por autor…"
            className="w-52 rounded-lg border border-border bg-card py-2 pl-8 pr-3 text-sm text-foreground outline-none focus-visible:border-ring"
          />
        </div>

        <select
          value={table}
          onChange={(e) => setTable(e.target.value)}
          className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring"
        >
          <option value="all">Todas las tablas</option>
          {tableOptions.map((t) => (
            <option key={t} value={t}>
              {tableLabel(t)}
            </option>
          ))}
        </select>

        <select
          value={operation}
          onChange={(e) => setOperation(e.target.value)}
          className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring"
        >
          <option value="all">Toda operación</option>
          <option value="INSERT">Creación</option>
          <option value="UPDATE">Edición</option>
          <option value="DELETE">Eliminación</option>
        </select>

        <div className="flex rounded-lg border border-border bg-card p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPeriod(p.key)}
              className={
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors " +
                (period === p.key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-24">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-border bg-card py-16 text-center text-sm text-muted-foreground">
          {error}
        </div>
      ) : logs.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-card py-16 text-muted-foreground">
          <ScrollText className="size-8" />
          <p className="text-sm">No hay actividad registrada con estos filtros.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {logs.map((log, i) => {
            const meta = OPERATION_META[log.operation];
            const Icon = meta.icon;
            const isOpen = expanded === log.id;
            const fields = isOpen ? changedFields(log) : [];
            return (
              <div
                key={log.id}
                className={i > 0 ? "border-t border-border" : undefined}
              >
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : log.id)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
                >
                  <span
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${meta.className}`}
                  >
                    <Icon className="size-3" />
                    {meta.label}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {tableLabel(log.table_name)}
                      <span className="ml-2 font-normal text-muted-foreground">
                        {shortId(log.record_id)}
                      </span>
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {log.actor_email ?? "Sistema / servicio"}
                    </span>
                  </span>
                  <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                    {format(new Date(log.created_at), "d MMM yyyy · HH:mm", { locale: es })}
                  </span>
                  <ChevronDown
                    className={`size-4 shrink-0 text-muted-foreground transition-transform ${
                      isOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>

                {isOpen && (
                  <div className="border-t border-border bg-muted/20 px-3 py-3">
                    {fields.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Sin cambios de columnas.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-left text-muted-foreground">
                              <th className="pr-3 pb-1 font-medium">Campo</th>
                              <th className="pr-3 pb-1 font-medium">Antes</th>
                              <th className="pb-1 font-medium">Después</th>
                            </tr>
                          </thead>
                          <tbody>
                            {fields.map((f) => (
                              <tr key={f.key} className="align-top">
                                <td className="pr-3 py-0.5 font-mono text-foreground">{f.key}</td>
                                <td className="pr-3 py-0.5 text-muted-foreground">
                                  <span className="break-all">{f.from}</span>
                                </td>
                                <td className="py-0.5 text-foreground">
                                  <span className="break-all">{f.to}</span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {hasMore && !loading && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
          >
            {loadingMore && <Loader2 className="size-4 animate-spin" />}
            Cargar más
          </button>
        </div>
      )}
    </div>
  );
}
