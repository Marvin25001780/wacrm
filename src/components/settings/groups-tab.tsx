'use client';

// ============================================================
// GroupsTab — Configuración → Gestión de equipos → Grupos de usuarios.
//
// Un «grupo de usuarios» es una lista guardada de miembros de la cuenta
// (tablas `user_groups` + `user_group_members`, migración 055). Se
// distingue de «Equipos»: los equipos existen para agrupar el
// rendimiento en Métricas; los grupos son listas informales que pueden
// usarse como destino de las reglas de asignación.
//
// CRUD directo contra Supabase; las políticas RLS exigen rol `agent`
// o superior para mutar.
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
  Users,
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

const GROUP_COLORS = [
  { name: 'Rojo', value: '#ef4444' },
  { name: 'Naranja', value: '#f97316' },
  { name: 'Ámbar', value: '#f59e0b' },
  { name: 'Esmeralda', value: '#10b981' },
  { name: 'Cian', value: '#06b6d4' },
  { name: 'Azul', value: '#3b82f6' },
  { name: 'Violeta', value: '#8b5cf6' },
  { name: 'Rosa', value: '#ec4899' },
];

interface Group {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
}

interface GroupMember {
  id: string;
  group_id: string;
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
  color: GROUP_COLORS[5].value,
};

function displayName(p: AgentProfile): string {
  return (p.full_name && p.full_name.trim()) || p.email || 'Sin nombre';
}

function fallbackAccent(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return GROUP_COLORS[Math.abs(hash) % GROUP_COLORS.length].value;
}

export function GroupsTab() {
  const supabase = createClient();
  const { accountId, profileLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<Group[]>([]);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [agents, setAgents] = useState<AgentProfile[]>([]);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Group | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [groupToDelete, setGroupToDelete] = useState<Group | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busyGroup, setBusyGroup] = useState<string | null>(null);

  const load = useCallback(
    async (account: string) => {
      setLoading(true);
      try {
        const [groupRes, memberRes, agentRes] = await Promise.all([
          supabase
            .from('user_groups')
            .select('id, name, description, color')
            .eq('account_id', account)
            .order('name', { ascending: true }),
          supabase
            .from('user_group_members')
            .select('id, group_id, profile_id')
            .eq('account_id', account),
          supabase
            .from('profiles')
            .select('id, full_name, email, avatar_url')
            .eq('account_id', account),
        ]);

        if (groupRes.error) throw groupRes.error;
        if (memberRes.error) throw memberRes.error;
        if (agentRes.error) throw agentRes.error;

        setGroups((groupRes.data ?? []) as Group[]);
        setMembers((memberRes.data ?? []) as GroupMember[]);
        setAgents((agentRes.data ?? []) as AgentProfile[]);
      } catch (err) {
        console.error('[GroupsTab] load error:', err);
        toast.error('Error al cargar los grupos');
      } finally {
        setLoading(false);
      }
    },
    [supabase],
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

  const membersByGroup = useMemo(() => {
    const map = new Map<string, GroupMember[]>();
    for (const m of members) {
      const list = map.get(m.group_id);
      if (list) list.push(m);
      else map.set(m.group_id, [m]);
    }
    return map;
  }, [members]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  }

  function openEdit(group: Group) {
    setEditing(group);
    setForm({
      name: group.name,
      description: group.description ?? '',
      color: group.color ?? fallbackAccent(group.id),
    });
    setFormOpen(true);
  }

  async function handleSave() {
    const name = form.name.trim();
    if (!name) {
      toast.error('El nombre del grupo es obligatorio');
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
          .from('user_groups')
          .update(payload)
          .eq('id', editing.id);
        if (error) throw error;
        toast.success('Grupo actualizado');
      } else {
        const { error } = await supabase.from('user_groups').insert(payload);
        if (error) throw error;
        toast.success('Grupo creado');
      }

      setFormOpen(false);
      setEditing(null);
      await load(accountId);
    } catch (err) {
      console.error('[GroupsTab] save error:', err);
      toast.error(
        editing ? 'Error al actualizar el grupo' : 'Error al crear el grupo',
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!groupToDelete || !accountId) return;
    setDeleting(true);
    try {
      const { error } = await supabase
        .from('user_groups')
        .delete()
        .eq('id', groupToDelete.id);
      if (error) throw error;
      toast.success('Grupo eliminado');
      setGroupToDelete(null);
      await load(accountId);
    } catch (err) {
      console.error('[GroupsTab] delete error:', err);
      toast.error('Error al eliminar el grupo');
    } finally {
      setDeleting(false);
    }
  }

  async function handleAddMember(groupId: string, profileId: string) {
    if (!accountId) return;
    setBusyGroup(groupId);
    try {
      const { error } = await supabase
        .from('user_group_members')
        .insert({ group_id: groupId, account_id: accountId, profile_id: profileId });
      if (error) throw error;
      await load(accountId);
    } catch (err) {
      console.error('[GroupsTab] add member error:', err);
      toast.error('Error al añadir el miembro');
    } finally {
      setBusyGroup(null);
    }
  }

  async function handleRemoveMember(memberId: string, groupId: string) {
    setBusyGroup(groupId);
    try {
      const { error } = await supabase
        .from('user_group_members')
        .delete()
        .eq('id', memberId);
      if (error) throw error;
      await load(accountId!);
    } catch (err) {
      console.error('[GroupsTab] remove member error:', err);
      toast.error('Error al quitar el miembro');
    } finally {
      setBusyGroup(null);
    }
  }

  return (
    <section className="animate-in fade-in-50 space-y-6 duration-200">
      <SettingsPanelHead
        title="Grupos de usuarios"
        description="Listas guardadas de miembros. Úsalas para organizar a las personas y como destino de las reglas de asignación."
        action={
          <RequireRole min="agent">
            <Button onClick={openCreate}>
              <Plus className="size-4" />
              Nuevo grupo
            </Button>
          </RequireRole>
        }
      />

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : groups.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-10 text-center">
            <Users className="size-6 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">
              Aún no hay grupos de usuarios.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Crea el primero con{' '}
              <span className="text-muted-foreground">Nuevo grupo</span> y añade
              miembros.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => {
            const rows = membersByGroup.get(group.id) ?? [];
            const memberIds = new Set(rows.map((m) => m.profile_id));
            const available = agents.filter((a) => !memberIds.has(a.id));
            const isBusy = busyGroup === group.id;
            const accent = group.color ?? fallbackAccent(group.id);

            return (
              <Card key={group.id}>
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
                            {group.name}
                          </h3>
                          <Badge className="border-border bg-muted text-muted-foreground">
                            {rows.length}{' '}
                            {rows.length === 1 ? 'miembro' : 'miembros'}
                          </Badge>
                        </div>
                        {group.description ? (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {group.description}
                          </p>
                        ) : null}
                      </div>
                    </div>

                    <RequireRole min="agent">
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEdit(group)}
                          disabled={isBusy}
                        >
                          <Pencil className="size-4" />
                          Editar
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setGroupToDelete(group)}
                          disabled={isBusy}
                          className="border-red-500/40 bg-red-500/10 text-red-300 hover:border-red-500/60 hover:bg-red-500/20 hover:text-red-200"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </RequireRole>
                  </div>

                  {rows.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Este grupo todavía no tiene miembros.
                    </p>
                  ) : (
                    <ul className="flex flex-wrap gap-2">
                      {rows.map((row) => {
                        const agent = agentById.get(row.profile_id);
                        return (
                          <li
                            key={row.id}
                            className="group inline-flex items-center gap-2 rounded-full border border-border bg-muted/50 py-1 pr-2 pl-1 text-sm"
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
                                onClick={() => handleRemoveMember(row.id, group.id)}
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

                  <RequireRole min="agent">
                    {available.length === 0 ? (
                      <p className="text-xs text-muted-foreground/70">
                        Todos los miembros ya están en este grupo.
                      </p>
                    ) : (
                      <div className="flex items-center gap-2">
                        <UserPlus className="size-4 text-muted-foreground" />
                        <Select
                          value=""
                          onValueChange={(value) => {
                            if (value) void handleAddMember(group.id, value);
                          }}
                        >
                          <SelectTrigger
                            className="w-full max-w-[280px]"
                            disabled={isBusy}
                          >
                            <SelectValue placeholder="Añadir miembro…" />
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
        <DialogContent className="border-border bg-popover sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              {editing ? 'Editar grupo' : 'Nuevo grupo'}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Ponle un nombre y, si quieres, un color para identificarlo.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="group-name">Nombre</Label>
              <Input
                id="group-name"
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
                placeholder="p.ej. Turno de mañana"
                maxLength={60}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleSave();
                }}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="group-desc">Descripción (opcional)</Label>
              <Textarea
                id="group-desc"
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
                placeholder="¿Para qué sirve este grupo?"
                maxLength={200}
                rows={2}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Color</Label>
              <div className="flex gap-1.5">
                {GROUP_COLORS.map((color) => (
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
                        'outline outline-2 outline-offset-2 outline-primary',
                    )}
                    style={{ backgroundColor: color.value }}
                    title={color.name}
                  />
                ))}
              </div>
            </div>
          </div>

          <DialogFooter className="border-border bg-popover">
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
                'Crear grupo'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Eliminar */}
      <Dialog
        open={groupToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setGroupToDelete(null);
        }}
      >
        <DialogContent className="border-border bg-popover sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-popover-foreground">
              <AlertTriangle className="size-4 text-amber-400" />
              Eliminar grupo
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              ¿Eliminar el grupo{' '}
              <span className="font-medium text-muted-foreground">
                {groupToDelete?.name}
              </span>
              ? Se quitarán sus miembros. Las conversaciones no se ven afectadas.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="border-border bg-popover">
            <Button
              variant="ghost"
              onClick={() => setGroupToDelete(null)}
              disabled={deleting}
            >
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Eliminando…
                </>
              ) : (
                'Eliminar grupo'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
