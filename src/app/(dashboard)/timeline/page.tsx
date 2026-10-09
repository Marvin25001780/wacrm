'use client';

// ============================================================
// Timeline (1.6) — historial unificado por registro.
//
// Vista DERIVADA (no requiere migración): mezcla Actividades +
// Notas internas + Adjuntos (+ eventos del propio registro y las
// ofertas de un contacto) en una sola línea de tiempo cronológica.
//
// El usuario elige tipo de registro (Contacto/Lead/Empresa/Oferta)
// y un registro concreto; se consultan las tablas existentes
// filtradas por la FK correspondiente y se funden por fecha.
// ============================================================

import { useState, useEffect, useCallback, useMemo } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import { format, isToday, isYesterday } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  NOTE_ENTITY_TYPES,
  activityTypeLabel,
  activityStatusLabel,
  type NoteEntityType,
  type Profile,
  type Activity,
  type ActivityType,
  type Note,
  type Attachment,
  type Deal,
} from '@/types';
import { formatFileSize } from '@/lib/attachments/file-utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Search,
  Loader2,
  Paperclip,
  StickyNote,
  Briefcase,
  CalendarCheck,
  Phone,
  Users,
  CheckSquare,
  Mail,
  MessageSquare,
  MapPin,
  UserCheck,
  Sparkles,
  Download,
  History,
} from 'lucide-react';

// ============================================================
// Tipos y metadatos de presentación
// ============================================================

type TimelineKind = 'created' | 'conversion' | 'activity' | 'note' | 'attachment' | 'deal';

const ENTITY_NOUN: Record<NoteEntityType, string> = {
  contact: 'Contacto',
  lead: 'Lead',
  organization: 'Empresa',
  deal: 'Oferta',
};

const ENTITY_CREATED: Record<NoteEntityType, string> = {
  contact: 'Contacto creado',
  lead: 'Lead creado',
  organization: 'Empresa creada',
  deal: 'Oferta creada',
};

const TABLE: Record<NoteEntityType, 'contacts' | 'leads' | 'organizations' | 'deals'> = {
  contact: 'contacts',
  lead: 'leads',
  organization: 'organizations',
  deal: 'deals',
};

const ACTIVITY_ICON: Record<ActivityType, typeof Phone> = {
  call: Phone,
  meeting: Users,
  task: CheckSquare,
  email: Mail,
  whatsapp: MessageSquare,
  visit: MapPin,
  other: CalendarCheck,
};

const KIND_COLOR: Record<TimelineKind, string> = {
  created: 'text-muted-foreground',
  conversion: 'text-primary',
  activity: 'text-sky-400',
  note: 'text-amber-400',
  attachment: 'text-violet-400',
  deal: 'text-emerald-400',
};

const BADGE = 'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium';
const BADGE_MUTED = `${BADGE} border-border bg-muted text-muted-foreground`;
const BADGE_AMBER = `${BADGE} border-amber-500/40 bg-amber-500/10 text-amber-300`;
const BADGE_EMERALD = `${BADGE} border-emerald-500/40 bg-emerald-500/10 text-emerald-300`;
const BADGE_ROSE = `${BADGE} border-rose-500/40 bg-rose-500/10 text-rose-300`;
const BADGE_SKY = `${BADGE} border-sky-500/40 bg-sky-500/10 text-sky-300`;

interface TimelineEvent {
  id: string;
  kind: TimelineKind;
  at: string;
  title: string;
  description?: string | null;
  actorName?: string | null;
  badges: { label: string; className: string }[];
  attachment?: Attachment;
  icon: typeof Phone;
  color: string;
}

interface EntityRecord {
  id: string;
  name?: string;
  title?: string;
  phone?: string;
  user_id?: string;
  created_at: string;
  status?: string | null;
  value?: number | null;
  currency?: string | null;
  converted_at?: string | null;
  converted_contact_id?: string | null;
  converted_deal_id?: string | null;
}

interface RecordOption {
  id: string;
  label: string;
}

interface RawTimeline {
  entity: EntityRecord | null;
  activities: Activity[];
  notes: Note[];
  attachments: Attachment[];
  deals: Deal[];
}

const EMPTY_RAW: RawTimeline = {
  entity: null,
  activities: [],
  notes: [],
  attachments: [],
  deals: [],
};

const DEAL_STATUS_BADGE: Record<string, { label: string; className: string }> = {
  open: { label: 'Abierta', className: BADGE_SKY },
  won: { label: 'Ganada', className: BADGE_EMERALD },
  lost: { label: 'Perdida', className: BADGE_ROSE },
};

function entityColumns(type: NoteEntityType): string {
  switch (type) {
    case 'contact':
      return 'id, name, phone, user_id, created_at';
    case 'lead':
      return 'id, name, user_id, created_at, status, converted_at, converted_contact_id, converted_deal_id';
    case 'organization':
      return 'id, name, user_id, created_at';
    case 'deal':
      return 'id, title, user_id, created_at, value, currency, status';
  }
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (isToday(d)) return 'Hoy';
  if (isYesterday(d)) return 'Ayer';
  return format(d, "d 'de' MMMM yyyy", { locale: es });
}

function money(value?: number | null, currency?: string | null): string {
  if (value == null) return '';
  try {
    return new Intl.NumberFormat('es-VE', {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value} ${currency ?? ''}`.trim();
  }
}

// ============================================================
// Página
// ============================================================

export default function TimelinePage() {
  const supabase = createClient();

  const [entityType, setEntityType] = useState<NoteEntityType>('contact');
  const [entityId, setEntityId] = useState('');

  const [records, setRecords] = useState<RecordOption[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordSearch, setRecordSearch] = useState('');

  const [raw, setRaw] = useState<RawTimeline>(EMPTY_RAW);
  const [loading, setLoading] = useState(false);
  const [kindFilter, setKindFilter] = useState<'all' | TimelineKind>('all');

  const [profilesById, setProfilesById] = useState<Record<string, Profile>>({});
  const [profilesByUserId, setProfilesByUserId] = useState<Record<string, Profile>>({});

  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchProfiles = useCallback(async () => {
    const { data } = await supabase.from('profiles').select('*');
    if (!data) return;
    const byId: Record<string, Profile> = {};
    const byUser: Record<string, Profile> = {};
    data.forEach((p) => {
      byId[p.id] = p as Profile;
      byUser[p.user_id] = p as Profile;
    });
    setProfilesById(byId);
    setProfilesByUserId(byUser);
  }, [supabase]);

  const fetchRecords = useCallback(
    async (type: NoteEntityType) => {
      setRecordsLoading(true);
      const cols: string =
        type === 'deal' ? 'id, title, created_at' : 'id, name, phone, created_at';
      const orderCol: string = type === 'deal' ? 'created_at' : 'name';
      const { data, error } = await supabase
        .from(TABLE[type])
        .select(cols)
        .order(orderCol, { ascending: type !== 'deal' })
        .limit(500);
      setRecordsLoading(false);
      if (error) {
        toast.error('Error al cargar los registros');
        return;
      }
      const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
      const opts: RecordOption[] = rows.map((r) => ({
        id: r.id as string,
        label:
          (r.name as string) ||
          (r.title as string) ||
          (r.phone as string) ||
          (r.id as string),
      }));
      setRecords(opts);
      setEntityId((prev) => (prev && opts.some((o) => o.id === prev) ? prev : opts[0]?.id ?? ''));
    },
    [supabase],
  );

  const fetchTimeline = useCallback(
    async (type: NoteEntityType, id: string) => {
      setLoading(true);
      const col = `${type}_id`;
      const empty = Promise.resolve({ data: [] as unknown[], error: null });
      const [ent, acts, nts, atts, dels] = await Promise.all([
        supabase.from(TABLE[type]).select(entityColumns(type)).eq('id', id).maybeSingle(),
        supabase
          .from('activities')
          .select(
            'id, type, subject, description, due_at, status, priority, completed_at, assigned_to, user_id, created_at',
          )
          .eq(col, id)
          .order('created_at', { ascending: false })
          .limit(500),
        supabase
          .from('notes')
          .select('id, body, pinned, user_id, created_at')
          .eq(col, id)
          .order('created_at', { ascending: false })
          .limit(500),
        supabase
          .from('attachments')
          .select('id, file_name, file_path, file_size, mime_type, user_id, created_at')
          .eq(col, id)
          .order('created_at', { ascending: false })
          .limit(500),
        type === 'contact'
          ? supabase
              .from('deals')
              .select('id, title, value, currency, status, user_id, created_at')
              .eq('contact_id', id)
              .order('created_at', { ascending: false })
              .limit(500)
          : empty,
      ]);
      setLoading(false);

      if (ent.error || acts.error || nts.error || atts.error) {
        console.error('[timeline] fetch error', { ent, acts, nts, atts, dels });
        toast.error('Error al cargar el historial');
        return;
      }

      setRaw({
        entity: (ent.data as EntityRecord | null) ?? null,
        activities: (acts.data ?? []) as unknown as Activity[],
        notes: (nts.data ?? []) as unknown as Note[],
        attachments: (atts.data ?? []) as unknown as Attachment[],
        deals: (dels.data ?? []) as unknown as Deal[],
      });
    },
    [supabase],
  );

  useEffect(() => {
    fetchProfiles();
    fetchRecords(entityType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!entityId) {
      setRaw(EMPTY_RAW);
      return;
    }
    fetchTimeline(entityType, entityId);
  }, [entityType, entityId, fetchTimeline]);

  function selectType(type: NoteEntityType) {
    setEntityType(type);
    setEntityId('');
    setRaw(EMPTY_RAW);
    setKindFilter('all');
    setRecordSearch('');
    fetchRecords(type);
  }

  // ------------------------------------------------------------
  // Fusión de fuentes → eventos
  // ------------------------------------------------------------
  const events = useMemo<TimelineEvent[]>(() => {
    const out: TimelineEvent[] = [];
    const ent = raw.entity;

    if (ent) {
      out.push({
        id: `created-${ent.id}`,
        kind: 'created',
        at: ent.created_at,
        title: ENTITY_CREATED[entityType],
        description: ent.title ?? ent.name ?? null,
        actorName: ent.user_id ? profilesByUserId[ent.user_id]?.full_name ?? null : null,
        badges: [],
        icon: Sparkles,
        color: KIND_COLOR.created,
      });

      if (entityType === 'lead' && ent.status === 'converted') {
        out.push({
          id: `conversion-${ent.id}`,
          kind: 'conversion',
          at: ent.converted_at || ent.created_at,
          title: 'Lead convertido',
          description: ent.converted_deal_id
            ? 'Convertido a contacto y oferta'
            : 'Convertido a contacto',
          actorName: null,
          badges: [],
          icon: UserCheck,
          color: KIND_COLOR.conversion,
        });
      }
    }

    raw.activities.forEach((a) => {
      const badges: { label: string; className: string }[] = [
        { label: activityTypeLabel(a.type), className: BADGE_MUTED },
        {
          label: activityStatusLabel(a.status),
          className:
            a.status === 'done'
              ? BADGE_EMERALD
              : a.status === 'cancelled'
                ? BADGE_MUTED
                : BADGE_AMBER,
        },
      ];
      if (a.priority === 'high') badges.push({ label: 'Prioridad alta', className: BADGE_ROSE });
      out.push({
        id: `activity-${a.id}`,
        kind: 'activity',
        at: a.completed_at || a.due_at || a.created_at,
        title: a.subject,
        description: a.outcome || a.description || null,
        actorName:
          (a.assigned_to ? profilesById[a.assigned_to]?.full_name : null) ??
          profilesByUserId[a.user_id]?.full_name ??
          null,
        badges,
        icon: ACTIVITY_ICON[a.type] ?? CalendarCheck,
        color: KIND_COLOR.activity,
      });
    });

    raw.notes.forEach((n) => {
      out.push({
        id: `note-${n.id}`,
        kind: 'note',
        at: n.created_at,
        title: 'Nota interna',
        description: n.body,
        actorName: profilesByUserId[n.user_id]?.full_name ?? null,
        badges: n.pinned ? [{ label: 'Fijada', className: BADGE_AMBER }] : [],
        icon: StickyNote,
        color: KIND_COLOR.note,
      });
    });

    raw.attachments.forEach((f) => {
      out.push({
        id: `attachment-${f.id}`,
        kind: 'attachment',
        at: f.created_at,
        title: f.file_name,
        description: null,
        actorName: profilesByUserId[f.user_id]?.full_name ?? null,
        badges: f.file_size ? [{ label: formatFileSize(f.file_size), className: BADGE_MUTED }] : [],
        attachment: f,
        icon: Paperclip,
        color: KIND_COLOR.attachment,
      });
    });

    raw.deals.forEach((d) => {
      const status = d.status ?? 'open';
      const badges: { label: string; className: string }[] = [];
      const sb = DEAL_STATUS_BADGE[status];
      if (sb) badges.push(sb);
      const m = money(d.value, d.currency);
      if (m) badges.push({ label: m, className: BADGE_MUTED });
      out.push({
        id: `deal-${d.id}`,
        kind: 'deal',
        at: d.created_at,
        title: `Oferta: ${d.title}`,
        description: null,
        actorName: d.user_id ? profilesByUserId[d.user_id]?.full_name ?? null : null,
        badges,
        icon: Briefcase,
        color: KIND_COLOR.deal,
      });
    });

    out.sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime());
    return out;
  }, [raw, entityType, profilesById, profilesByUserId]);

  const visibleEvents = useMemo(
    () => (kindFilter === 'all' ? events : events.filter((e) => e.kind === kindFilter)),
    [events, kindFilter],
  );

  const groups = useMemo(() => {
    const map = new Map<string, { key: string; label: string; events: TimelineEvent[] }>();
    visibleEvents.forEach((ev) => {
      const key = format(new Date(ev.at), 'yyyy-MM-dd');
      let g = map.get(key);
      if (!g) {
        g = { key, label: dayLabel(ev.at), events: [] };
        map.set(key, g);
      }
      g.events.push(ev);
    });
    return [...map.values()];
  }, [visibleEvents]);

  const filteredRecords = useMemo(() => {
    const term = recordSearch.trim().toLowerCase();
    if (!term) return records;
    return records.filter((r) => r.label.toLowerCase().includes(term));
  }, [records, recordSearch]);

  async function handleDownload(att: Attachment) {
    setBusyId(att.id);
    const { data, error } = await supabase.storage
      .from('attachments')
      .createSignedUrl(att.file_path, 60);
    setBusyId(null);
    if (error || !data?.signedUrl) {
      toast.error('No se pudo generar el enlace de descarga');
      return;
    }
    window.open(data.signedUrl, '_blank');
  }

  const selectedRecord = records.find((r) => r.id === entityId);

  const KIND_FILTERS: { value: 'all' | TimelineKind; label: string }[] = [
    { value: 'all', label: 'Todo' },
    { value: 'activity', label: 'Actividades' },
    { value: 'note', label: 'Notas' },
    { value: 'attachment', label: 'Adjuntos' },
    { value: 'deal', label: 'Ofertas' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">Timeline</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Historial unificado de cada registro: actividades, notas, adjuntos y ofertas.
        </p>
      </div>

      {/* Selector de registro */}
      <div className="space-y-4 rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap gap-2">
          {NOTE_ENTITY_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => selectType(t.value)}
              className={
                'rounded-full border px-3 py-1 text-sm font-medium transition-colors ' +
                (entityType === t.value
                  ? 'border-primary/50 bg-primary/10 text-primary'
                  : 'border-border bg-muted text-muted-foreground hover:text-foreground')
              }
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={recordSearch}
              onChange={(e) => setRecordSearch(e.target.value)}
              placeholder={`Buscar ${ENTITY_NOUN[entityType].toLowerCase()}...`}
              className="bg-muted border-border pl-8 text-foreground placeholder:text-muted-foreground"
            />
          </div>
          <select
            value={entityId}
            onChange={(e) => setEntityId(e.target.value)}
            disabled={recordsLoading}
            className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:max-w-md"
          >
            {recordsLoading ? (
              <option>Cargando...</option>
            ) : filteredRecords.length === 0 ? (
              <option value="">Sin resultados</option>
            ) : (
              filteredRecords.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))
            )}
          </select>
        </div>
      </div>

      {/* Filtro por tipo de evento */}
      {entityId && (
        <div className="flex flex-wrap gap-2">
          {KIND_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setKindFilter(f.value)}
              className={
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors ' +
                (kindFilter === f.value
                  ? 'border-primary/50 bg-primary/10 text-primary'
                  : 'border-border bg-card text-muted-foreground hover:text-foreground')
              }
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {/* Timeline */}
      {loading ? (
        <div className="flex flex-col items-center gap-2 py-16">
          <Loader2 className="size-6 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Cargando historial...</p>
        </div>
      ) : !entityId ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-16">
          <History className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Selecciona un registro para ver su línea de tiempo.
          </p>
        </div>
      ) : visibleEvents.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-16">
          <History className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            {selectedRecord?.label
              ? `Sin movimientos para ${selectedRecord.label}.`
              : 'Sin movimientos todavía.'}
          </p>
        </div>
      ) : (
        <div className="relative">
          <div className="absolute bottom-2 left-3 top-2 w-px bg-border" />
          <div className="space-y-8">
            {groups.map((g) => (
              <div key={g.key}>
                <h3 className="mb-3 pl-10 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {g.label}
                </h3>
                <div className="space-y-4">
                  {g.events.map((ev) => {
                    const Icon = ev.icon;
                    return (
                      <div key={ev.id} className="relative pl-10">
                        <span className="absolute left-0 top-1 flex size-6 items-center justify-center rounded-full border border-border bg-card">
                          <Icon className={`size-3 ${ev.color}`} />
                        </span>
                        <div className="rounded-lg border border-border bg-card p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-foreground">{ev.title}</p>
                              {ev.description && (
                                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                                  {ev.description}
                                </p>
                              )}
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                {ev.badges.map((b, i) => (
                                  <span key={i} className={b.className}>
                                    {b.label}
                                  </span>
                                ))}
                                <span className="text-xs text-muted-foreground">
                                  {format(new Date(ev.at), 'HH:mm', { locale: es })}
                                  {ev.actorName ? ` · ${ev.actorName}` : ''}
                                </span>
                              </div>
                            </div>
                            {ev.attachment && (
                              <Button
                                variant="outline"
                                size="icon-sm"
                                onClick={() => handleDownload(ev.attachment!)}
                                disabled={busyId === ev.attachment.id}
                                className="shrink-0 border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                                title="Descargar"
                              >
                                {busyId === ev.attachment.id ? (
                                  <Loader2 className="size-4 animate-spin" />
                                ) : (
                                  <Download className="size-4" />
                                )}
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
