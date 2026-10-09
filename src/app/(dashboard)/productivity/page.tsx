"use client";

// ============================================================
// Auditoría de productividad de agentes — módulo 2.4.
//
// Reporte derivado (sin migración) que atribuye la actividad de la
// cuenta a cada miembro del equipo, con ranking por período y un
// feed de auditoría de las últimas acciones.
// ============================================================

import { useState, useEffect, useCallback, useMemo } from "react";
import { format, formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/currency";
import {
  aggregateProductivity,
  totalWonValue,
  periodStartIso,
  PERIODS,
  SCORE_WEIGHTS,
  type PeriodKey,
  type ProductivityResult,
  type FeedItem,
  type FeedKind,
} from "@/lib/productivity/utils";
import type { Profile } from "@/types";
import {
  UserPlus,
  Briefcase,
  Trophy,
  CalendarCheck,
  CheckCircle2,
  StickyNote,
  Paperclip,
  HandCoins,
  MessagesSquare,
  MessageSquare,
  Hash,
  Users,
  Gauge,
  Loader2,
  ArrowUpDown,
} from "lucide-react";

// ------------------------------------------------------------
// Presentación
// ------------------------------------------------------------
const FEED_ICON: Record<FeedKind, typeof Gauge> = {
  lead: UserPlus,
  deal: Briefcase,
  deal_won: Trophy,
  activity: CalendarCheck,
  activity_done: CheckCircle2,
  note: StickyNote,
  contact_note: StickyNote,
  attachment: Paperclip,
  payment: HandCoins,
  receivable: HandCoins,
  chat: MessagesSquare,
  channel: Hash,
  conversation: MessageSquare,
};

const FEED_COLOR: Record<FeedKind, string> = {
  lead: "text-sky-400 bg-sky-400/10",
  deal: "text-indigo-400 bg-indigo-400/10",
  deal_won: "text-emerald-400 bg-emerald-400/10",
  activity: "text-amber-400 bg-amber-400/10",
  activity_done: "text-emerald-400 bg-emerald-400/10",
  note: "text-violet-400 bg-violet-400/10",
  contact_note: "text-violet-400 bg-violet-400/10",
  attachment: "text-orange-400 bg-orange-400/10",
  payment: "text-teal-400 bg-teal-400/10",
  receivable: "text-teal-400 bg-teal-400/10",
  chat: "text-cyan-400 bg-cyan-400/10",
  channel: "text-cyan-400 bg-cyan-400/10",
  conversation: "text-blue-400 bg-blue-400/10",
};

type SortKey = "score" | "dealsWon" | "monto" | "recent" | "name";

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: "score", label: "Índice" },
  { key: "dealsWon", label: "Ofertas ganadas" },
  { key: "monto", label: "Monto ganado" },
  { key: "recent", label: "Más reciente" },
  { key: "name", label: "Nombre" },
];

export default function ProductivityPage() {
  const supabase = createClient();
  const { accountId } = useAuth();

  const [period, setPeriod] = useState<PeriodKey>("30");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [data, setData] = useState<ProductivityResult | null>(null);
  const [profilesById, setProfilesById] = useState<Record<string, Profile>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (key: PeriodKey) => {
      setLoading(true);
      setError(null);
      const since = periodStartIso(key);

      // Helper: consulta una tabla, filtrando por período si aplica.
      const q = (table: string, select: string) => {
        let req = supabase.from(table).select(select).order("created_at", { ascending: false }).limit(2000);
        if (since) req = req.gte("created_at", since);
        return req;
      };

      const [
        profilesRes,
        leadsRes,
        dealsRes,
        activitiesRes,
        notesRes,
        contactNotesRes,
        attachmentsRes,
        paymentsRes,
        receivablesRes,
        chatRes,
        channelsRes,
        conversationsRes,
      ] = await Promise.all([
        supabase.from("profiles").select("*"),
        q("leads", "id, created_at, user_id, assigned_to, status, converted_at, name"),
        q("deals", "id, created_at, user_id, assigned_to, status, value, currency, title"),
        q("activities", "id, created_at, user_id, assigned_to, status, subject"),
        q("notes", "id, created_at, user_id"),
        q("contact_notes", "id, created_at, user_id"),
        q("attachments", "id, created_at, user_id, file_name"),
        q("receivable_payments", "id, created_at, created_by, amount"),
        q("receivables", "id, created_at, created_by"),
        q("chat_messages", "id, created_at, sender_id, body"),
        q("chat_channels", "id, created_at, created_by, name"),
        q("conversations", "id, created_at, assigned_agent_id, status"),
      ]);

      const firstError =
        profilesRes.error ||
        leadsRes.error ||
        dealsRes.error ||
        activitiesRes.error ||
        notesRes.error ||
        contactNotesRes.error ||
        attachmentsRes.error ||
        paymentsRes.error ||
        receivablesRes.error ||
        chatRes.error ||
        channelsRes.error ||
        conversationsRes.error;

      if (firstError) {
        console.error("[productivity] fetch error:", firstError);
        setError("No se pudieron cargar las métricas.");
        toast.error("Error al cargar la productividad");
        setLoading(false);
        return;
      }

      const profiles = (profilesRes.data ?? []) as unknown as Profile[];
      const map: Record<string, Profile> = {};
      profiles.forEach((p) => {
        map[p.user_id] = p;
      });
      setProfilesById(map);

      const result = aggregateProductivity({
        profiles,
        leads: (leadsRes.data ?? []) as never,
        deals: (dealsRes.data ?? []) as never,
        activities: (activitiesRes.data ?? []) as never,
        notes: (notesRes.data ?? []) as never,
        contactNotes: (contactNotesRes.data ?? []) as never,
        attachments: (attachmentsRes.data ?? []) as never,
        payments: (paymentsRes.data ?? []) as never,
        receivables: (receivablesRes.data ?? []) as never,
        chatMessages: (chatRes.data ?? []) as never,
        channels: (channelsRes.data ?? []) as never,
        conversations: (conversationsRes.data ?? []) as never,
      });

      setData(result);
      setLoading(false);
    },
    [supabase],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(period);
  }, [load, period, accountId]);

  const agents = useMemo(() => {
    if (!data) return [];
    const list = [...data.agents];
    list.sort((a, b) => {
      switch (sortKey) {
        case "dealsWon":
          return b.dealsWon - a.dealsWon || b.score - a.score;
        case "monto":
          return totalWonValue(b) - totalWonValue(a) || b.score - a.score;
        case "recent":
          return (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? "");
        case "name":
          return a.fullName.localeCompare(b.fullName);
        case "score":
        default:
          return b.score - a.score || a.fullName.localeCompare(b.fullName);
      }
    });
    return list;
  }, [data, sortKey]);

  const wonTotalText = data
    ? Object.entries(data.totals.wonByCurrency)
        .map(([cur, amt]) => formatCurrency(amt, cur))
        .join(" · ")
    : "";

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Productividad de agentes</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Auditoría de la actividad del equipo, atribuida por autor y asignación.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
      </div>

      {loading ? (
        <div className="flex justify-center py-24">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-border bg-card py-16 text-center text-sm text-muted-foreground">
          {error}
        </div>
      ) : data && data.agents.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-card py-16 text-muted-foreground">
          <Users className="size-8" />
          <p className="text-sm">No hay agentes en esta cuenta.</p>
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <SummaryCard label="Agentes activos" value={String(data?.totals.agentsActive ?? 0)} />
            <SummaryCard label="Ofertas ganadas" value={String(data?.totals.dealsWon ?? 0)} />
            <SummaryCard
              label="Monto ganado"
              value={wonTotalText || formatCurrency(0)}
              hint="Ofertas ganadas en el período"
            />
            <SummaryCard
              label="Actividades completadas"
              value={String(data?.totals.activitiesDone ?? 0)}
            />
          </div>

          {/* Ranking */}
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-foreground">Ranking del período</h2>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ArrowUpDown className="size-3.5" />
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                className="rounded-md border border-border bg-muted px-2 py-1 text-xs text-foreground outline-none focus-visible:border-ring"
              >
                {SORTS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full min-w-[980px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Agente</th>
                  <th className="px-3 py-3 text-center font-medium">Leads</th>
                  <th className="px-3 py-3 text-center font-medium">Ofertas</th>
                  <th className="px-3 py-3 text-right font-medium">Monto ganado</th>
                  <th className="px-3 py-3 text-center font-medium">Actividades</th>
                  <th className="px-3 py-3 text-center font-medium">Notas</th>
                  <th className="px-3 py-3 text-center font-medium">Adj.</th>
                  <th className="px-3 py-3 text-center font-medium">Abonos</th>
                  <th className="px-3 py-3 text-center font-medium">Chat</th>
                  <th className="px-3 py-3 text-center font-medium">Índice</th>
                  <th className="px-4 py-3 text-right font-medium">Última act.</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((m) => (
                  <tr key={m.profileId} className="border-b border-border last:border-0 hover:bg-muted/40">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                          {m.fullName.charAt(0).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">{m.fullName}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {m.email}
                            {m.role ? ` · ${roleLabel(m.role)}` : ""}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <Pair main={m.leadsCreated} sub={m.leadsConverted} subTitle="convertidos" />
                    </td>
                    <td className="px-3 py-3 text-center">
                      <Pair main={m.dealsCreated} sub={m.dealsWon} subTitle="ganadas" good />
                    </td>
                    <td className="px-3 py-3 text-right">
                      <CurrencyList wonByCurrency={m.wonByCurrency} />
                    </td>
                    <td className="px-3 py-3 text-center">
                      <Pair main={m.activitiesDone} sub={m.activitiesAssigned} subTitle="asignadas" good />
                    </td>
                    <td className="px-3 py-3 text-center text-foreground">
                      {m.notesCreated + m.contactNotesCreated}
                    </td>
                    <td className="px-3 py-3 text-center text-foreground">{m.attachmentsUploaded}</td>
                    <td className="px-3 py-3 text-center">
                      <span className="text-foreground">{m.paymentsRegistered}</span>
                      {m.paymentsAmount > 0 && (
                        <span className="block text-xs text-muted-foreground">
                          {formatCurrency(m.paymentsAmount)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className="text-foreground">{m.chatMessagesSent}</span>
                      {m.channelsCreated > 0 && (
                        <span className="block text-xs text-muted-foreground">
                          +{m.channelsCreated} canal{m.channelsCreated === 1 ? "" : "es"}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className="inline-flex min-w-9 items-center justify-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                        {Math.round(m.score)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                      {m.lastActivityAt
                        ? formatDistanceToNow(new Date(m.lastActivityAt), { addSuffix: true, locale: es })
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Feed + leyenda */}
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <h2 className="mb-2 text-sm font-semibold text-foreground">Últimas acciones</h2>
              <div className="rounded-lg border border-border bg-card">
                {data && data.feed.length > 0 ? (
                  <ul className="divide-y divide-border">
                    {data.feed.map((item) => (
                      <FeedRow key={item.id} item={item} profilesById={profilesById} />
                    ))}
                  </ul>
                ) : (
                  <p className="py-10 text-center text-sm text-muted-foreground">
                    Sin actividad registrada en el período.
                  </p>
                )}
              </div>
            </div>

            <div>
              <h2 className="mb-2 text-sm font-semibold text-foreground">Cómo se calcula el índice</h2>
              <div className="rounded-lg border border-border bg-card p-4">
                <p className="mb-3 text-xs text-muted-foreground">
                  Cada acción suma puntos según su peso:
                </p>
                <ul className="space-y-1.5">
                  {SCORE_WEIGHTS.map((w) => (
                    <li key={w.key} className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{w.label}</span>
                      <span className="font-medium text-foreground">×{w.weight}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------
// Subcomponentes
// ------------------------------------------------------------
function SummaryCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-xl font-bold text-foreground">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Pair({ main, sub, subTitle, good }: { main: number; sub: number; subTitle: string; good?: boolean }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="font-medium text-foreground">{main}</span>
      <span className={"text-xs " + (good && sub > 0 ? "text-emerald-400" : "text-muted-foreground")}>
        /{sub} {subTitle}
      </span>
    </span>
  );
}

function CurrencyList({ wonByCurrency }: { wonByCurrency: Record<string, number> }) {
  const entries = Object.entries(wonByCurrency);
  if (entries.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="space-y-0.5">
      {entries.map(([cur, amt]) => (
        <div key={cur} className="font-medium text-foreground">
          {formatCurrency(amt, cur)}
        </div>
      ))}
    </div>
  );
}

function FeedRow({ item, profilesById }: { item: FeedItem; profilesById: Record<string, Profile> }) {
  const Icon = FEED_ICON[item.kind];
  const color = FEED_COLOR[item.kind];
  const profile = Object.values(profilesById).find((p) => p.id === item.actorId);
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className={"flex size-8 shrink-0 items-center justify-center rounded-full " + color}>
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-foreground">
          <span className="font-medium">{profile?.full_name ?? "Alguien"}</span> · {item.title}
        </p>
        {item.detail && <p className="truncate text-xs text-muted-foreground">{item.detail}</p>}
      </div>
      <span
        className="shrink-0 text-xs text-muted-foreground"
        title={format(new Date(item.createdAt), "PPpp", { locale: es })}
      >
        {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true, locale: es })}
      </span>
    </li>
  );
}

function roleLabel(role: string): string {
  switch (role) {
    case "owner":
      return "Propietario";
    case "admin":
      return "Administrador";
    case "agent":
      return "Agente";
    case "viewer":
      return "Lector";
    default:
      return role;
  }
}
