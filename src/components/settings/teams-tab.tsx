'use client';

// ============================================================
// TeamsTab — Settings → Equipos
//
// Gestión de equipos (agrupar agentes). Los reportes de Métricas
// agrupan por equipo usando `teams` + `team_members` (migración 051).
//
// Un agente (perfil) puede pertenecer a varios equipos. La UI es un
// CRUD directo contra Supabase; las políticas RLS exigen rol
// `agent` o superior para mutar, así que las acciones van envueltas
// en `<RequireRole min="agent">`.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  UserPlus,
  UsersRound,
  X,
} from 'lucide-react';

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { RequireRole } from '@/components/auth/require-role';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { SettingsPanelHead } from './settings-panel-head';

const TEAM_COLORS = [
  { name: 'Rojo', value: '#ef4444' },
  { name: 'Naranja', value: '#f97316' },
  { name: 'Ámbar', value: '#f59e0b' },
  { name: 'Esmeralda', value: '#10b981' },
  { name: 'Cian', value: '#06b6d4' },
  { name: 'Azul', value: '#3b82f6' },
  { name: 'Violeta', value: '#8b5cf6' },
  { name: 'Rosa', value: '#ec4899' },
];

// Paleta de reserva: si un equipo se creó sin color (o con color
// nulo) derivamos uno estable a partir del id para que la UI siempre
// tenga un acento consistente.

interface Team {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
}

interface TeamMember {
  id: string;
  team_id: string;
  profile_id: string;
}

interface AgentProfile {
  id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
}

interface FormState {
  name: string;
  description: string;
  color: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  description: '',
  color: TEAM_COLORS[5].value,
};

function displayName(p: AgentProfile): string {
  return (p.full_name && p.full_name.trim()) || p.email || 'Sin nombre';
}

function fallbackAccent(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return TEAM_COLORS[Math.abs(hash) % TEAM_COLORS.length].value;
}

export function TeamsTab() {
  const supabase = createClient();
  const { accountId, profileLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [teams, setTeams] = useState<Team[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [agents, setAgents] = useState<AgentProfile[]>([]);

  // Diálogo de crear/editar.
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Team | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Diálogo de borrado.
  const [teamToDelete, setTeamToDelete] = useState<Team | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Operación de miembro en curso (team_id).
  const [busyTeam, setBusyTeam] = useState<string | null>(null);

  const load = useCallback(
    async (account: string) => {
      setLoading(true);
      try {
        const [teamRes, memberRes, agentRes] = await Promise.all([
          supabase
            .from('teams')
            .select('id, name, description, color')
            .eq('account_id', account)
            .order('name', { ascending: true }),
          supabase
            .from('team_members')
            .select('id, team_id, profile_id')
            .eq('account_id', account),
          supabase
            .from('profiles')
            .select('id, full_name, email, avatar_url')
            .eq('account_id', account),
        ]);

        if (teamRes.error) throw teamRes.error;
        if (memberRes.error) throw memberRes.error;
        if (agentRes.error) throw agentRes.error;

        setTeams((teamRes.data ?? []) as Team[]);
        setMembers((memberRes.data ?? []) as TeamMember[]);
        setAgents((agentRes.data ?? []) as AgentProfile[]);
      } catch (err) {
        console.error('[TeamsTab] load error:', err);
        toast.error('Error al cargar los equipos');
      } finally {
        setLoading(false);
      }
    },
    [supabase]
  );

  useEffect(() => {
    if (profileLoading) return;
    if (!accountId) {
      setLoading(false);
      return;
    }
    void load(accountId);
  }, [profileLoading, accountId, load]);

  const agentById = useMemo(() => {
    const map = new Map<string, AgentProfile>();
    for (const a of agents) map.set(a.id, a);
    return map;
  }, [agents]);

  const membersByTeam = useMemo(() => {
    const map = new Map<string, TeamMember[]>();
    for (const m of members) {
      const list = map.get(m.team_id);
      if (list) list.push(m);
      else map.set(m.team_id, [m]);
    }
    return map;
  }, [members]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  }

  function openEdit(team: Team) {
    setEditing(team);
    setForm({
      name: team.name,
      description: team.description ?? '',
      color: team.color ?? fallbackAccent(team.id),
    });
    setFormOpen(true);
  }

  async function handleSave() {
    const name = form.name.trim();
    if (!name) {
      toast.error('El nombre del equipo es obligatorio');
      return;
    }
    if (!accountId) {
      toast.error('No autenticado');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        account_id: accountId,
        name,
        description: form.description.trim() || null,
        color: form.color,
      };

      if (editing) {
        const { error } = await supabase
          .from('teams')
          .update(payload)
          .eq('id', editing.id);
        if (error) throw error;
        toast.success('Equipo actualizado');
      } else {
        const { error } = await supabase.from('teams').insert(payload);
        if (error) throw error;
        toast.success('Equipo creado');
      }

      setFormOpen(false);
      setEditing(null);
      await load(accountId);
    } catch (err) {
      console.error('[TeamsTab] save error:', err);
      toast.error(
        editing ? 'Error al actualizar el equipo' : 'Error al crear el equipo'
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!teamToDelete || !accountId) return;
    setDeleting(true);
    try {
      const { error } = await supabase
        .from('teams')
        .delete()
        .eq('id', teamToDelete.id);
      if (error) throw error;
      toast.success('Equipo eliminado');
      setTeamToDelete(null);
      await load(accountId);
    } catch (err) {
      console.error('[TeamsTab] delete error:', err);
      toast.error('Error al eliminar el equipo');
    } finally {
      setDeleting(false);
    }
  }

  async function handleAddMember(teamId: string, profileId: string) {
    if (!accountId) return;
    setBusyTeam(teamId);
    try {
      const { error } = await supabase.from('team_members').insert({
        team_id: teamId,
        account_id: accountId,
        profile_id: profileId,
      });
      if (error) throw error;
      await load(accountId);
    } catch (err) {
      console.error('[TeamsTab] add member error:', err);
      toast.error('Error al agregar el miembro');
    } finally {
      setBusyTeam(null);
    }
  }

  async function handleRemoveMember(memberId: string, teamId: string) {
    if (!accountId) return;
    setBusyTeam(teamId);
    try {
      const { error } = await supabase
        .from('team_members')
        .delete()
        .eq('id', memberId);
      if (error) throw error;
      await load(accountId);
    } catch (err) {
      console.error('[TeamsTab] remove member error:', err);
      toast.error('Error al quitar el miembro');
    } finally {
      setBusyTeam(null);
    }
  }

  return (
    <section className="animate-in fade-in-50 space-y-6 duration-200">
      <SettingsPanelHead
        title="Equipos"
        description="Agrupa a los agentes en equipos. Los reportes de Métricas usan los equipos para agrupar el rendimiento."
        action={
          <RequireRole min="agent">
            <Button onClick={openCreate}>
              <Plus className="size-4" />
              Nuevo equipo
            </Button>
          </RequireRole>
        }
      />

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : teams.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-10 text-center">
            <UsersRound className="size-6 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">
              Aún no hay equipos.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Crea el primero con{' '}
              <span className="text-muted-foreground">Nuevo equipo</span> y
              asigna agentes para ver reportes por equipo.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {teams.map((team) => {
            const rows = membersByTeam.get(team.id) ?? [];
            const memberIds = new Set(rows.map((m) => m.profile_id));
            const available = agents.filter((a) => !memberIds.has(a.id));
            const isBusy = busyTeam === team.id;
            const accent = team.color ?? fallbackAccent(team.id);

            return (
              <Card key={team.id}>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span
                        className="mt-1 size-3 shrink-0 rounded-full"
                        style={{ backgroundColor: accent }}
                      />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-semibold text-foreground">
                            {team.name}
                          </h3>
                          <Badge className="bg-muted text-muted-foreground border-border">
                            {rows.length}{' '}
                            {rows.length === 1 ? 'miembro' : 'miembros'}
                          </Badge>
                        </div>
                        {team.description ? (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {team.description}
                          </p>
                        ) : null}
                      </div>
                    </div>

                    <RequireRole min="agent">
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEdit(team)}
                          disabled={isBusy}
                        >
                          <Pencil className="size-4" />
                          Editar
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setTeamToDelete(team)}
                          disabled={isBusy}
                          className="border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20 hover:border-red-500/60 hover:text-red-200"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </RequireRole>
                  </div>

                  {/* Miembros */}
                  {rows.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Este equipo todavía no tiene agentes asignados.
                    </p>
                  ) : (
                    <ul className="flex flex-wrap gap-2">
                      {rows.map((row) => {
                        const agent = agentById.get(row.profile_id);
                        return (
                          <li
                            key={row.id}
                            className="group inline-flex items-center gap-2 rounded-full border border-border bg-muted/50 py-1 pl-1 pr-2 text-sm"
                          >
                            <Avatar className="size-6">
                              {agent?.avatar_url ? (
                                <AvatarImage
                                  src={agent.avatar_url}
                                  alt={agent ? displayName(agent) : ''}
                                />
                              ) : null}
                              <AvatarFallback className="bg-primary/10 text-[10px] font-medium text-primary">
                                {(agent ? displayName(agent) : 'U')
                                  .charAt(0)
                                  .toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <span className="max-w-[160px] truncate text-foreground">
                              {agent ? displayName(agent) : 'Miembro'}
                            </span>
                            <RequireRole min="agent">
                              <button
                                type="button"
                                onClick={() => handleRemoveMember(row.id, team.id)}
                                disabled={isBusy}
                                aria-label={`Quitar a ${
                                  agent ? displayName(agent) : 'miembro'
                                }`}
                                className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                              >
                                <X className="size-3.5" />
                              </button>
                            </RequireRole>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {/* Agregar miembro */}
                  <RequireRole min="agent">
                    {available.length === 0 ? (
                      <p className="text-xs text-muted-foreground/70">
                        Todos los agentes ya están en este equipo.
                      </p>
                    ) : (
                      <div className="flex items-center gap-2">
                        <UserPlus className="size-4 text-muted-foreground" />
                        <Select
                          value=""
                          onValueChange={(value) => {
                            if (value) void handleAddMember(team.id, value);
                          }}
                        >
                          <SelectTrigger
                            className="w-full max-w-[280px]"
                            disabled={isBusy}
                          >
                            <SelectValue placeholder="Agregar agente…" />
                          </SelectTrigger>
                          <SelectContent>
                            {available.map((agent) => (
                              <SelectItem key={agent.id} value={agent.id}>
                                {displayName(agent)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {isBusy ? (
                          <Loader2 className="size-4 animate-spin text-muted-foreground" />
                        ) : null}
                      </div>
                    )}
                  </RequireRole>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Crear / editar */}
      <Dialog
        open={formOpen}
        onOpenChange={(open) => {
          if (!open) {
            setFormOpen(false);
            setEditing(null);
          }
        }}
      >
        <DialogContent className="bg-popover border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              {editing ? 'Editar equipo' : 'Nuevo equipo'}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Ponle un nombre y, si quieres, un color para identificarlo.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="team-name">Nombre</Label>
              <Input
                id="team-name"
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
                placeholder="p.ej. Soporte"
                maxLength={60}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleSave();
                }}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="team-desc">Descripción (opcional)</Label>
              <Textarea
                id="team-desc"
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
                placeholder="¿De qué se encarga este equipo?"
                maxLength={200}
                rows={2}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Color</Label>
              <div className="flex gap-1.5">
                {TEAM_COLORS.map((color) => (
                  <button
                    key={color.value}
                    type="button"
                    onClick={() =>
                      setForm((f) => ({ ...f, color: color.value }))
                    }
                    aria-label={`Usar ${color.name}`}
                    aria-pressed={form.color === color.value}
                    className={cn(
                      'size-6 rounded-md transition-transform hover:scale-110',
                      form.color === color.value &&
                        'outline outline-2 outline-offset-2 outline-primary'
                    )}
                    style={{ backgroundColor: color.value }}
                    title={color.name}
                  />
                ))}
              </div>
            </div>
          </div>

          <DialogFooter className="bg-popover border-border">
            <Button
              variant="ghost"
              onClick={() => {
                setFormOpen(false);
                setEditing(null);
              }}
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving || !form.name.trim()}>
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Guardando…
                </>
              ) : editing ? (
                'Guardar cambios'
              ) : (
                'Crear equipo'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Eliminar */}
      <Dialog
        open={teamToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setTeamToDelete(null);
        }}
      >
        <DialogContent className="bg-popover border-border sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-popover-foreground">
              <AlertTriangle className="size-4 text-amber-400" />
              Eliminar equipo
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              ¿Eliminar el equipo{' '}
              <span className="font-medium text-muted-foreground">
                {teamToDelete?.name}
              </span>
              ? Se quitará la asignación de sus miembros. Las conversaciones no
              se borran.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="bg-popover border-border">
            <Button
              variant="ghost"
              onClick={() => setTeamToDelete(null)}
              disabled={deleting}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Eliminando…
                </>
              ) : (
                'Eliminar equipo'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
