'use client';

// ============================================================
// AssignmentRulesTab — Configuración → Gestión de equipos →
// Reglas de asignación.
//
// CRUD de las reglas que reparten conversaciones (tabla
// `assignment_rules`, migración 055). Cada regla puede acotar por
// canal y por equipo o grupo, y elegir la estrategia:
//   • Round-robin  — reparte por turnos equitativos.
//   • Menos ocupado — elige a quien tiene menos conversaciones abiertas.
//   • Usuario específico — siempre la misma persona.
//
// El motor de automatizaciones (paso «Asignar conversación» en modo
// round-robin) resuelve el agente con la primera regla activa que
// coincide por canal; si no hay reglas, usa el comportamiento anterior.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Loader2,
  Pencil,
  Plus,
  Shuffle,
  Trash2,
} from 'lucide-react';

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
import { RequireRole } from '@/components/auth/require-role';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import { SettingsPanelHead } from './settings-panel-head';

const STRATEGY_META: Record<
  string,
  { label: string; hint: string }
> = {
  round_robin: {
    label: 'Round-robin',
    hint: 'Reparte por turnos entre el equipo o grupo.',
  },
  least_busy: {
    label: 'Menos ocupado',
    hint: 'Elige a quien tiene menos conversaciones abiertas.',
  },
  specific_user: {
    label: 'Usuario específico',
    hint: 'Siempre la misma persona.',
  },
};

const CHANNEL_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'Todos los canales' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'webchat', label: 'Widget webchat' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'sms', label: 'SMS' },
  { value: 'email', label: 'Correo' },
];

interface Rule {
  id: string;
  name: string;
  channel: string | null;
  team_id: string | null;
  group_id: string | null;
  strategy: 'round_robin' | 'least_busy' | 'specific_user';
  target_profile_id: string | null;
  priority: number;
  is_active: boolean;
}

interface Team {
  id: string;
  name: string;
}

interface Group {
  id: string;
  name: string;
}

interface AgentProfile {
  id: string;
  full_name: string | null;
  email: string | null;
}

interface FormState {
  name: string;
  channel: string;
  team_id: string;
  group_id: string;
  strategy: 'round_robin' | 'least_busy' | 'specific_user';
  target_profile_id: string;
  priority: string;
  is_active: boolean;
}

const EMPTY_FORM: FormState = {
  name: '',
  channel: 'all',
  team_id: '',
  group_id: '',
  strategy: 'round_robin',
  target_profile_id: '',
  priority: '0',
  is_active: true,
};

const NONE = '__none__';

function displayName(p: AgentProfile): string {
  return (p.full_name && p.full_name.trim()) || p.email || 'Sin nombre';
}

export function AssignmentRulesTab() {
  const supabase = createClient();
  const { accountId, profileLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [rules, setRules] = useState<Rule[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [agents, setAgents] = useState<AgentProfile[]>([]);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Rule | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [ruleToDelete, setRuleToDelete] = useState<Rule | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(
    async (account: string) => {
      setLoading(true);
      try {
        const [ruleRes, teamRes, groupRes, agentRes] = await Promise.all([
          supabase
            .from('assignment_rules')
            .select(
              'id, name, channel, team_id, group_id, strategy, target_profile_id, priority, is_active',
            )
            .eq('account_id', account)
            .order('priority', { ascending: false })
            .order('created_at', { ascending: true }),
          supabase
            .from('teams')
            .select('id, name')
            .eq('account_id', account)
            .order('name', { ascending: true }),
          supabase
            .from('user_groups')
            .select('id, name')
            .eq('account_id', account)
            .order('name', { ascending: true }),
          supabase
            .from('profiles')
            .select('id, full_name, email')
            .eq('account_id', account),
        ]);

        if (ruleRes.error) throw ruleRes.error;
        if (teamRes.error) throw teamRes.error;
        if (groupRes.error) throw groupRes.error;
        if (agentRes.error) throw agentRes.error;

        setRules((ruleRes.data ?? []) as Rule[]);
        setTeams((teamRes.data ?? []) as Team[]);
        setGroups((groupRes.data ?? []) as Group[]);
        setAgents((agentRes.data ?? []) as AgentProfile[]);
      } catch (err) {
        console.error('[AssignmentRulesTab] load error:', err);
        toast.error('Error al cargar las reglas');
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

  const teamName = useMemo(() => {
    const m = new Map(teams.map((t) => [t.id, t.name]));
    return (id: string | null) => (id ? m.get(id) ?? '—' : null);
  }, [teams]);

  const groupName = useMemo(() => {
    const m = new Map(groups.map((g) => [g.id, g.name]));
    return (id: string | null) => (id ? m.get(id) ?? '—' : null);
  }, [groups]);

  const agentName = useMemo(() => {
    const m = new Map(agents.map((a) => [a.id, displayName(a)]));
    return (id: string | null) => (id ? m.get(id) ?? '—' : null);
  }, [agents]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  }

  function openEdit(rule: Rule) {
    setEditing(rule);
    setForm({
      name: rule.name,
      channel: rule.channel ?? 'all',
      team_id: rule.team_id ?? '',
      group_id: rule.group_id ?? '',
      strategy: rule.strategy,
      target_profile_id: rule.target_profile_id ?? '',
      priority: String(rule.priority ?? 0),
      is_active: rule.is_active,
    });
    setFormOpen(true);
  }

  async function handleSave() {
    const name = form.name.trim();
    if (!name) {
      toast.error('El nombre de la regla es obligatorio');
      return;
    }
    if (form.strategy === 'specific_user' && !form.target_profile_id) {
      toast.error('Elige el usuario de destino');
      return;
    }
    if (!accountId) {
      toast.error('No autenticado');
      return;
    }

    const priority = Number.parseInt(form.priority, 10);

    setSaving(true);
    try {
      const payload = {
        account_id: accountId,
        name,
        channel: form.channel === 'all' ? null : form.channel,
        team_id: form.team_id || null,
        group_id: form.group_id || null,
        strategy: form.strategy,
        target_profile_id:
          form.strategy === 'specific_user' ? form.target_profile_id : null,
        priority: Number.isFinite(priority) ? priority : 0,
        is_active: form.is_active,
      };

      if (editing) {
        const { error } = await supabase
          .from('assignment_rules')
          .update(payload)
          .eq('id', editing.id);
        if (error) throw error;
        toast.success('Regla actualizada');
      } else {
        const { error } = await supabase.from('assignment_rules').insert(payload);
        if (error) throw error;
        toast.success('Regla creada');
      }

      setFormOpen(false);
      setEditing(null);
      await load(accountId);
    } catch (err) {
      console.error('[AssignmentRulesTab] save error:', err);
      toast.error(
        editing ? 'Error al actualizar la regla' : 'Error al crear la regla',
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(rule: Rule) {
    setBusyId(rule.id);
    try {
      const { error } = await supabase
        .from('assignment_rules')
        .update({ is_active: !rule.is_active })
        .eq('id', rule.id);
      if (error) throw error;
      setRules((prev) =>
        prev.map((r) =>
          r.id === rule.id ? { ...r, is_active: !r.is_active } : r,
        ),
      );
    } catch (err) {
      console.error('[AssignmentRulesTab] toggle error:', err);
      toast.error('Error al cambiar el estado');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete() {
    if (!ruleToDelete || !accountId) return;
    setDeleting(true);
    try {
      const { error } = await supabase
        .from('assignment_rules')
        .delete()
        .eq('id', ruleToDelete.id);
      if (error) throw error;
      toast.success('Regla eliminada');
      setRuleToDelete(null);
      await load(accountId);
    } catch (err) {
      console.error('[AssignmentRulesTab] delete error:', err);
      toast.error('Error al eliminar la regla');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="animate-in fade-in-50 space-y-6 duration-200">
      <SettingsPanelHead
        title="Reglas de asignación"
        description="Define cómo se reparten las conversaciones. Se evalúan por prioridad; la primera regla activa que coincide por canal gana. Sin reglas, se usa el reparto por defecto."
        action={
          <RequireRole min="admin">
            <Button onClick={openCreate}>
              <Plus className="size-4" />
              Nueva regla
            </Button>
          </RequireRole>
        }
      />

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : rules.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-10 text-center">
            <Shuffle className="size-6 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">
              Aún no hay reglas de asignación.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Crea la primera con{' '}
              <span className="text-muted-foreground">Nueva regla</span> para
              repartir automáticamente las conversaciones.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {rules.map((rule) => {
                const isBusy = busyId === rule.id;
                return (
                  <li
                    key={rule.id}
                    className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:gap-4"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">
                          {rule.name}
                        </span>
                        <Badge className="border-border bg-muted text-muted-foreground">
                          Prioridad {rule.priority}
                        </Badge>
                        {rule.is_active ? (
                          <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                            Activa
                          </Badge>
                        ) : (
                          <Badge className="border-border bg-muted text-muted-foreground">
                            Inactiva
                          </Badge>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>{CHANNEL_OPTIONS.find((c) => c.value === (rule.channel ?? 'all'))?.label}</span>
                        <span>·</span>
                        <span>{STRATEGY_META[rule.strategy].label}</span>
                        {teamName(rule.team_id) ? (
                          <>
                            <span>·</span>
                            <span>Equipo: {teamName(rule.team_id)}</span>
                          </>
                        ) : null}
                        {groupName(rule.group_id) ? (
                          <>
                            <span>·</span>
                            <span>Grupo: {groupName(rule.group_id)}</span>
                          </>
                        ) : null}
                        {rule.strategy === 'specific_user' && agentName(rule.target_profile_id) ? (
                          <>
                            <span>·</span>
                            <span>Agente: {agentName(rule.target_profile_id)}</span>
                          </>
                        ) : null}
                        {!rule.team_id && !rule.group_id && rule.strategy !== 'specific_user' ? (
                          <>
                            <span>·</span>
                            <span>Toda la cuenta</span>
                          </>
                        ) : null}
                      </div>
                    </div>

                    <RequireRole min="admin">
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleToggle(rule)}
                          disabled={isBusy}
                        >
                          {rule.is_active ? 'Desactivar' : 'Activar'}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEdit(rule)}
                          disabled={isBusy}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setRuleToDelete(rule)}
                          disabled={isBusy}
                          className="border-red-500/40 bg-red-500/10 text-red-300 hover:border-red-500/60 hover:bg-red-500/20 hover:text-red-200"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </RequireRole>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
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
        <DialogContent className="border-border bg-popover sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-popover-foreground">
              {editing ? 'Editar regla' : 'Nueva regla'}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Cuanto mayor sea la prioridad, antes se evalúa la regla.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="rule-name">Nombre</Label>
              <Input
                id="rule-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="p.ej. Soporte — WhatsApp"
                maxLength={60}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Canal</Label>
                <Select
                  value={form.channel}
                  onValueChange={(v) => v && setForm((f) => ({ ...f, channel: v }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CHANNEL_OPTIONS.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="rule-priority">Prioridad</Label>
                <Input
                  id="rule-priority"
                  type="number"
                  value={form.priority}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, priority: e.target.value }))
                  }
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Estrategia</Label>
              <Select
                value={form.strategy}
                onValueChange={(v) =>
                  v &&
                  setForm((f) => ({
                    ...f,
                    strategy: v as FormState['strategy'],
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="round_robin">Round-robin</SelectItem>
                  <SelectItem value="least_busy">Menos ocupado</SelectItem>
                  <SelectItem value="specific_user">Usuario específico</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {STRATEGY_META[form.strategy].hint}
              </p>
            </div>

            {form.strategy === 'specific_user' ? (
              <div className="space-y-1.5">
                <Label>Usuario</Label>
                <Select
                  value={form.target_profile_id || NONE}
                  onValueChange={(v) =>
                    setForm((f) => ({
                      ...f,
                      target_profile_id: v === NONE ? '' : v ?? '',
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Elige un miembro" />
                  </SelectTrigger>
                  <SelectContent>
                    {agents.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {displayName(a)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Equipo (opcional)</Label>
                  <Select
                    value={form.team_id || NONE}
                    onValueChange={(v) =>
                      setForm((f) => ({ ...f, team_id: v === NONE ? '' : v ?? '' }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Toda la cuenta" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Toda la cuenta</SelectItem>
                      {teams.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label>Grupo (opcional)</Label>
                  <Select
                    value={form.group_id || NONE}
                    onValueChange={(v) =>
                      setForm((f) => ({ ...f, group_id: v === NONE ? '' : v ?? '' }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Sin grupo" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>Sin grupo</SelectItem>
                      {groups.map((g) => (
                        <SelectItem key={g.id} value={g.id}>
                          {g.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            <label className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) =>
                  setForm((f) => ({ ...f, is_active: e.target.checked }))
                }
                className="size-4 rounded border-border"
              />
              Regla activa
            </label>
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
                'Crear regla'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Eliminar */}
      <Dialog
        open={ruleToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setRuleToDelete(null);
        }}
      >
        <DialogContent className="border-border bg-popover sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-popover-foreground">
              <AlertTriangle className="size-4 text-amber-400" />
              Eliminar regla
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              ¿Eliminar la regla{' '}
              <span className="font-medium text-muted-foreground">
                {ruleToDelete?.name}
              </span>
              ? Esta acción no se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="border-border bg-popover">
            <Button
              variant="ghost"
              onClick={() => setRuleToDelete(null)}
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
                'Eliminar regla'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
