'use client';

// ============================================================
// Detalle de un Espacio de trabajo — módulo 2.1, migration 036.
// Gestiona miembros (usuarios de la cuenta) y registros
// vinculados (contactos / leads / empresas / ofertas).
// ============================================================

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import { toast } from 'sonner';
import {
  SPACE_ENTITY_TYPES,
  type Space,
  type SpaceEntityType,
  type SpaceMember,
  type SpaceRecord,
  type Profile,
} from '@/types';
import { spaceColor } from '@/lib/spaces/colors';
import { SpaceForm } from '@/components/spaces/space-form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  ArrowLeft,
  Users,
  Link2,
  Plus,
  X,
  Loader2,
  Pencil,
  User,
  Target,
  Building2,
  Briefcase,
  Search,
} from 'lucide-react';

const selectClass =
  'h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50';

const RECORD_ICON: Record<SpaceEntityType, typeof User> = {
  contact: User,
  lead: Target,
  organization: Building2,
  deal: Briefcase,
};

const ENTITY_LABEL: Record<SpaceEntityType, string> = {
  contact: 'Contacto',
  lead: 'Lead',
  organization: 'Empresa',
  deal: 'Oferta',
};

interface Option {
  id: string;
  label: string;
}

const ALL_TYPES: SpaceEntityType[] = ['contact', 'lead', 'organization', 'deal'];

export default function SpaceDetailPage() {
  const params = useParams<{ id: string }>();
  const spaceId = params.id;
  const supabase = createClient();
  const { accountId } = useAuth();
  const canEdit = useCan('send-messages');

  const [space, setSpace] = useState<Space | null>(null);
  const [loading, setLoading] = useState(true);

  const [members, setMembers] = useState<SpaceMember[]>([]);
  const [memberOptions, setMemberOptions] = useState<Option[]>([]);

  const [records, setRecords] = useState<SpaceRecord[]>([]);
  const [labelMap, setLabelMap] = useState<Record<string, string>>({});

  const [editOpen, setEditOpen] = useState(false);

  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [memberToAdd, setMemberToAdd] = useState('');

  const [addRecordOpen, setAddRecordOpen] = useState(false);
  const [recordType, setRecordType] = useState<SpaceEntityType>('contact');
  const [recordEntityId, setRecordEntityId] = useState('');
  const [recordOptions, setRecordOptions] = useState<Option[]>([]);
  const [recordOptionsLoading, setRecordOptionsLoading] = useState(false);
  const [recordSearch, setRecordSearch] = useState('');

  const [busy, setBusy] = useState(false);

  // ------------------------------------------------------------
  // Carga de datos
  // ------------------------------------------------------------
  const fetchSpace = useCallback(async () => {
    const { data, error } = await supabase
      .from('spaces')
      .select('*')
      .eq('id', spaceId)
      .maybeSingle();
    setLoading(false);
    if (error) {
      toast.error('Error al cargar el espacio');
      return;
    }
    setSpace((data as Space) ?? null);
  }, [supabase, spaceId]);

  const labelLookup = useCallback(
    async (type: SpaceEntityType, ids: string[]): Promise<Option[]> => {
      if (ids.length === 0) return [];
      let res;
      if (type === 'contact') {
        res = await supabase.from('contacts').select('id, name, phone').in('id', ids);
      } else if (type === 'lead') {
        res = await supabase.from('leads').select('id, name').in('id', ids);
      } else if (type === 'organization') {
        res = await supabase.from('organizations').select('id, name').in('id', ids);
      } else {
        res = await supabase.from('deals').select('id, title').in('id', ids);
      }
      const rows = (res.data ?? []) as unknown as Array<Record<string, unknown>>;
      return rows.map((r) => ({
        id: r.id as string,
        label: (r.name as string) || (r.title as string) || (r.phone as string) || (r.id as string),
      }));
    },
    [supabase],
  );

  const fetchRecords = useCallback(async () => {
    const { data, error } = await supabase
      .from('space_records')
      .select('*')
      .eq('space_id', spaceId)
      .order('created_at', { ascending: false });
    if (error) {
      toast.error('Error al cargar los registros');
      return;
    }
    const rows = (data ?? []) as unknown as SpaceRecord[];
    setRecords(rows);

    const map: Record<string, string> = {};
    await Promise.all(
      ALL_TYPES.map(async (t) => {
        const ids = rows.filter((r) => r.entity_type === t).map((r) => r.entity_id);
        const labels = await labelLookup(t, ids);
        labels.forEach((l) => {
          map[`${t}:${l.id}`] = l.label;
        });
      }),
    );
    setLabelMap(map);
  }, [supabase, spaceId, labelLookup]);

  const fetchMembers = useCallback(async () => {
    const [m, p] = await Promise.all([
      supabase.from('space_members').select('*').eq('space_id', spaceId).order('created_at'),
      supabase.from('profiles').select('*'),
    ]);
    const profiles = (p.data ?? []) as unknown as Profile[];
    const byUser: Record<string, Profile> = {};
    profiles.forEach((pr) => {
      byUser[pr.user_id] = pr;
    });
    const rows = (m.data ?? []) as unknown as SpaceMember[];
    setMembers(rows.map((r) => ({ ...r, profile: byUser[r.user_id] })));
  }, [supabase, spaceId]);

  const loadMemberOptions = useCallback(async () => {
    const [m, p] = await Promise.all([
      supabase.from('space_members').select('user_id').eq('space_id', spaceId),
      supabase.from('profiles').select('*'),
    ]);
    const existing = new Set(
      ((m.data ?? []) as unknown as Array<{ user_id: string }>).map((r) => r.user_id),
    );
    const rows = (p.data ?? []) as unknown as Profile[];
    setMemberOptions(
      rows
        .filter((pr) => !existing.has(pr.user_id))
        .map((pr) => ({ id: pr.user_id, label: `${pr.full_name} · ${pr.email}` })),
    );
  }, [supabase, spaceId]);

  const loadEntities = useCallback(
    async (type: SpaceEntityType) => {
      setRecordOptionsLoading(true);
      let res;
      if (type === 'contact') {
        res = await supabase.from('contacts').select('id, name, phone').order('name').limit(500);
      } else if (type === 'lead') {
        res = await supabase.from('leads').select('id, name').order('name').limit(500);
      } else if (type === 'organization') {
        res = await supabase.from('organizations').select('id, name').order('name').limit(500);
      } else {
        res = await supabase
          .from('deals')
          .select('id, title')
          .order('created_at', { ascending: false })
          .limit(500);
      }
      setRecordOptionsLoading(false);
      const rows = (res.data ?? []) as unknown as Array<Record<string, unknown>>;
      const all = rows.map((r) => ({
        id: r.id as string,
        label: (r.name as string) || (r.title as string) || (r.phone as string) || (r.id as string),
      }));
      const used = new Set(
        records.filter((r) => r.entity_type === type).map((r) => r.entity_id),
      );
      const available = all.filter((o) => !used.has(o.id));
      setRecordOptions(available);
      setRecordEntityId(available[0]?.id ?? '');
    },
    [supabase, records],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void Promise.all([fetchSpace(), fetchRecords(), fetchMembers()]);
  }, [fetchSpace, fetchRecords, fetchMembers]);

  // ------------------------------------------------------------
  // Acciones
  // ------------------------------------------------------------
  async function handleAddMember() {
    if (!memberToAdd || !accountId) return;
    setBusy(true);
    const { error } = await supabase
      .from('space_members')
      .insert({ space_id: spaceId, account_id: accountId, user_id: memberToAdd });
    setBusy(false);
    if (error) {
      toast.error('Error al añadir el miembro');
      return;
    }
    toast.success('Miembro añadido');
    setAddMemberOpen(false);
    setMemberToAdd('');
    fetchMembers();
  }

  async function handleRemoveMember(userId: string) {
    const { error } = await supabase
      .from('space_members')
      .delete()
      .eq('space_id', spaceId)
      .eq('user_id', userId);
    if (error) {
      toast.error('Error al quitar el miembro');
      return;
    }
    setMembers((prev) => prev.filter((m) => m.user_id !== userId));
  }

  async function handleAddRecord() {
    if (!recordEntityId || !accountId) return;
    setBusy(true);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const effectiveAccountId = accountId;
    const { error } = await supabase.from('space_records').insert({
      space_id: spaceId,
      account_id: effectiveAccountId,
      entity_type: recordType,
      entity_id: recordEntityId,
      added_by: session?.user?.id ?? null,
    });
    setBusy(false);
    if (error) {
      toast.error('Error al vincular el registro');
      return;
    }
    toast.success('Registro vinculado');
    setAddRecordOpen(false);
    setRecordSearch('');
    fetchRecords();
  }

  async function handleRemoveRecord(rec: SpaceRecord) {
    const { error } = await supabase.from('space_records').delete().eq('id', rec.id);
    if (error) {
      toast.error('Error al desvincular el registro');
      return;
    }
    setRecords((prev) => prev.filter((r) => r.id !== rec.id));
    setLabelMap((prev) => {
      const next = { ...prev };
      delete next[`${rec.entity_type}:${rec.entity_id}`];
      return next;
    });
  }

  function openAddRecord() {
    setRecordType('contact');
    setRecordEntityId('');
    setRecordSearch('');
    setAddRecordOpen(true);
    loadEntities('contact');
  }

  function changeRecordType(type: SpaceEntityType) {
    setRecordType(type);
    setRecordEntityId('');
    setRecordSearch('');
    loadEntities(type);
  }

  const filteredRecordOptions = useMemo(() => {
    const term = recordSearch.trim().toLowerCase();
    if (!term) return recordOptions;
    return recordOptions.filter((o) => o.label.toLowerCase().includes(term));
  }, [recordOptions, recordSearch]);

  const groupedRecords = useMemo(
    () =>
      ALL_TYPES.map((t) => ({
        type: t,
        items: records.filter((r) => r.entity_type === t),
      })).filter((g) => g.items.length > 0),
    [records],
  );

  const color = spaceColor(space?.color);

  // ------------------------------------------------------------
  // Render
  // ------------------------------------------------------------
  if (loading) {
    return (
      <div className="flex flex-col items-center gap-2 py-24">
        <Loader2 className="size-6 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Cargando espacio...</p>
      </div>
    );
  }

  if (!space) {
    return (
      <div className="flex flex-col items-center gap-3 py-24">
        <p className="text-sm text-muted-foreground">Este espacio no existe o no tienes acceso.</p>
        <Link href="/spaces" className="text-sm text-primary hover:underline">
          Volver a Espacios
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back */}
      <Link
        href="/spaces"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Espacios
      </Link>

      {/* Header */}
      <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <span className={`mt-1.5 size-3 shrink-0 rounded-full ${color.dot}`} />
          <div>
            <h1 className="text-2xl font-bold text-foreground">{space.name}</h1>
            {space.description && (
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{space.description}</p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Users className="size-3.5" />
                {members.length} {members.length === 1 ? 'miembro' : 'miembros'}
              </span>
              <span className="inline-flex items-center gap-1">
                <Link2 className="size-3.5" />
                {records.length} {records.length === 1 ? 'registro' : 'registros'}
              </span>
            </div>
          </div>
        </div>
        {canEdit && (
          <Button
            variant="outline"
            onClick={() => setEditOpen(true)}
            className="shrink-0 border-border text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Pencil className="size-4" />
            Editar
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Members */}
        <section className="rounded-lg border border-border bg-card">
          <header className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
              <Users className="size-4 text-muted-foreground" />
              Miembros
            </h2>
            {canEdit && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  loadMemberOptions();
                  setAddMemberOpen(true);
                }}
                className="text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Plus className="size-4" />
                Añadir
              </Button>
            )}
          </header>
          <div className="p-4">
            {members.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Sin miembros todavía.
              </p>
            ) : (
              <ul className="space-y-2">
                {members.map((m) => (
                  <li
                    key={m.user_id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                        {(m.profile?.full_name ?? '?').charAt(0).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {m.profile?.full_name ?? 'Usuario'}
                        </p>
                        {m.profile?.email && (
                          <p className="truncate text-xs text-muted-foreground">{m.profile.email}</p>
                        )}
                      </div>
                    </div>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => handleRemoveMember(m.user_id)}
                        title="Quitar"
                        className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-rose-400"
                      >
                        <X className="size-4" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Records */}
        <section className="rounded-lg border border-border bg-card">
          <header className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
              <Link2 className="size-4 text-muted-foreground" />
              Registros vinculados
            </h2>
            {canEdit && (
              <Button
                variant="ghost"
                size="sm"
                onClick={openAddRecord}
                className="text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Plus className="size-4" />
                Vincular
              </Button>
            )}
          </header>
          <div className="space-y-4 p-4">
            {groupedRecords.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Sin registros vinculados.
              </p>
            ) : (
              groupedRecords.map((g) => {
                const Icon = RECORD_ICON[g.type];
                return (
                  <div key={g.type}>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {ENTITY_LABEL[g.type]}s
                    </p>
                    <ul className="space-y-2">
                      {g.items.map((r) => (
                        <li
                          key={r.id}
                          className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2"
                        >
                          <div className="flex min-w-0 items-center gap-2.5">
                            <Icon className="size-4 shrink-0 text-muted-foreground" />
                            <span className="truncate text-sm text-foreground">
                              {labelMap[`${r.entity_type}:${r.entity_id}`] ?? r.entity_id}
                            </span>
                          </div>
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => handleRemoveRecord(r)}
                              title="Desvincular"
                              className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-rose-400"
                            >
                              <X className="size-4" />
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>

      {/* Edit */}
      <SpaceForm
        open={editOpen}
        onOpenChange={setEditOpen}
        space={space}
        onSaved={() => {
          fetchSpace();
        }}
      />

      {/* Add member */}
      <Dialog open={addMemberOpen} onOpenChange={setAddMemberOpen}>
        <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">Añadir miembro</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Añade a un usuario de la cuenta a este espacio.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="space-member" className="text-muted-foreground">
              Usuario
            </Label>
            <select
              id="space-member"
              value={memberToAdd}
              onChange={(e) => setMemberToAdd(e.target.value)}
              className={selectClass}
            >
              {memberOptions.length === 0 ? (
                <option value="">No hay usuarios disponibles</option>
              ) : (
                <>
                  <option value="">Selecciona un usuario...</option>
                  {memberOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </>
              )}
            </select>
          </div>
          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => setAddMemberOpen(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleAddMember}
              disabled={!memberToAdd || busy}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              Añadir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add record */}
      <Dialog open={addRecordOpen} onOpenChange={setAddRecordOpen}>
        <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">Vincular registro</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Elige un registro para añadirlo a este espacio.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {SPACE_ENTITY_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => changeRecordType(t.value)}
                  className={
                    'rounded-full border px-3 py-1 text-xs font-medium transition-colors ' +
                    (recordType === t.value
                      ? 'border-primary/50 bg-primary/10 text-primary'
                      : 'border-border bg-muted text-muted-foreground hover:text-foreground')
                  }
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={recordSearch}
                onChange={(e) => setRecordSearch(e.target.value)}
                placeholder="Buscar..."
                className="bg-muted border-border pl-8 text-foreground placeholder:text-muted-foreground"
              />
            </div>

            <select
              value={recordEntityId}
              onChange={(e) => setRecordEntityId(e.target.value)}
              disabled={recordOptionsLoading}
              className={selectClass}
            >
              {recordOptionsLoading ? (
                <option>Cargando...</option>
              ) : filteredRecordOptions.length === 0 ? (
                <option value="">Sin registros disponibles</option>
              ) : (
                filteredRecordOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))
              )}
            </select>
          </div>
          <DialogFooter className="bg-popover border-border">
            <Button
              variant="outline"
              onClick={() => setAddRecordOpen(false)}
              className="border-border text-muted-foreground hover:bg-muted"
            >
              Cancelar
            </Button>
            <Button
              onClick={handleAddRecord}
              disabled={!recordEntityId || busy}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              Vincular
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
