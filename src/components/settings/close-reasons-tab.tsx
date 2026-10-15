'use client';

// ============================================================
// CloseReasonsTab — Configuración → Gestión de equipos →
// Cierre de conversaciones.
//
// CRUD del catálogo de motivos que aparecen en el diálogo de cierre
// de la Bandeja (tabla `close_reasons`, migración 055). Antes el
// catálogo estaba fijo en el código; ahora cada cuenta lo gestiona.
//
// Las mutaciones exigen rol `admin` (RLS) y se envuelven en
// `<RequireRole min="admin">`.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Flag,
  Loader2,
  Plus,
  RotateCcw,
  Trash2,
  XCircle,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { RequireRole } from '@/components/auth/require-role';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { SettingsPanelHead } from './settings-panel-head';

interface CloseReason {
  id: string;
  label: string;
  position: number;
  is_active: boolean;
}

const DEFAULT_REASONS = [
  'Resuelto',
  'Sin respuesta del cliente',
  'Seguimiento pendiente',
  'Derivado a otra área',
  'Spam / no deseado',
  'Duplicado',
];

export function CloseReasonsTab() {
  const supabase = createClient();
  const { accountId, user, profileLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [reasons, setReasons] = useState<CloseReason[]>([]);
  const [newLabel, setNewLabel] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const load = useCallback(
    async (account: string) => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('close_reasons')
          .select('id, label, position, is_active')
          .eq('account_id', account)
          .order('position', { ascending: true })
          .order('label', { ascending: true });
        if (error) throw error;
        setReasons((data ?? []) as CloseReason[]);
      } catch (err) {
        console.error('[CloseReasonsTab] load error:', err);
        toast.error('Error al cargar los motivos de cierre');
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

  async function handleAdd() {
    const label = newLabel.trim();
    if (!label || !accountId) return;
    setAdding(true);
    try {
      const nextPosition =
        reasons.length > 0
          ? Math.max(...reasons.map((r) => r.position)) + 1
          : 1;
      const { error } = await supabase.from('close_reasons').insert({
        account_id: accountId,
        label,
        position: nextPosition,
        created_by: user?.id,
      } as never);
      if (error) throw error;
      setNewLabel('');
      toast.success('Motivo añadido');
      await load(accountId);
    } catch (err) {
      console.error('[CloseReasonsTab] add error:', err);
      toast.error('Error al añadir el motivo');
    } finally {
      setAdding(false);
    }
  }

  async function handleRename(reason: CloseReason, label: string) {
    const next = label.trim();
    if (!next || next === reason.label) return;
    setBusyId(reason.id);
    try {
      const { error } = await supabase
        .from('close_reasons')
        .update({ label: next })
        .eq('id', reason.id);
      if (error) throw error;
      toast.success('Motivo actualizado');
      if (accountId) await load(accountId);
    } catch (err) {
      console.error('[CloseReasonsTab] rename error:', err);
      toast.error('Error al actualizar el motivo');
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggle(reason: CloseReason) {
    setBusyId(reason.id);
    try {
      const { error } = await supabase
        .from('close_reasons')
        .update({ is_active: !reason.is_active })
        .eq('id', reason.id);
      if (error) throw error;
      setReasons((prev) =>
        prev.map((r) =>
          r.id === reason.id ? { ...r, is_active: !r.is_active } : r,
        ),
      );
    } catch (err) {
      console.error('[CloseReasonsTab] toggle error:', err);
      toast.error('Error al cambiar el estado');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(reason: CloseReason) {
    setBusyId(reason.id);
    try {
      const { error } = await supabase
        .from('close_reasons')
        .delete()
        .eq('id', reason.id);
      if (error) throw error;
      toast.success('Motivo eliminado');
      if (accountId) await load(accountId);
    } catch (err) {
      console.error('[CloseReasonsTab] delete error:', err);
      toast.error('Error al eliminar el motivo');
    } finally {
      setBusyId(null);
    }
  }

  async function handleMove(reason: CloseReason, direction: -1 | 1) {
    if (!accountId) return;
    const index = reasons.findIndex((r) => r.id === reason.id);
    const swapWith = reasons[index + direction];
    if (!swapWith) return;
    setBusyId(reason.id);
    try {
      const [a, b] = await Promise.all([
        supabase
          .from('close_reasons')
          .update({ position: swapWith.position })
          .eq('id', reason.id),
        supabase
          .from('close_reasons')
          .update({ position: reason.position })
          .eq('id', swapWith.id),
      ]);
      if (a.error) throw a.error;
      if (b.error) throw b.error;
      await load(accountId);
    } catch (err) {
      console.error('[CloseReasonsTab] move error:', err);
      toast.error('Error al reordenar');
    } finally {
      setBusyId(null);
    }
  }

  async function handleRestoreDefaults() {
    if (!accountId) return;
    setRestoring(true);
    try {
      const existing = new Set(reasons.map((r) => r.label.toLowerCase()));
      const missing = DEFAULT_REASONS.filter(
        (label) => !existing.has(label.toLowerCase()),
      );
      if (missing.length === 0) {
        toast.info('Ya están todos los motivos por defecto');
        return;
      }
      const base = reasons.length > 0 ? Math.max(...reasons.map((r) => r.position)) : 0;
      const { error } = await supabase.from('close_reasons').insert(
        missing.map((label, i) => ({
          account_id: accountId,
          label,
          position: base + i + 1,
          created_by: user?.id,
        })) as never,
      );
      if (error) throw error;
      toast.success('Motivos por defecto restaurados');
      await load(accountId);
    } catch (err) {
      console.error('[CloseReasonsTab] restore error:', err);
      toast.error('Error al restaurar los motivos');
    } finally {
      setRestoring(false);
    }
  }

  return (
    <section className="animate-in fade-in-50 space-y-6 duration-200">
      <SettingsPanelHead
        title="Cierre de conversaciones"
        description="Elige los motivos que aparecen al cerrar una conversación en la Bandeja. Puedes activar, renombrar, reordenar o quitar los que no uses."
        action={
          <RequireRole min="admin">
            <Button
              variant="outline"
              onClick={handleRestoreDefaults}
              disabled={restoring}
            >
              {restoring ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RotateCcw className="size-4" />
              )}
              Restaurar por defecto
            </Button>
          </RequireRole>
        }
      />

      {/* Añadir */}
      <RequireRole min="admin">
        <div className="flex items-center gap-2">
          <Input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Nuevo motivo…"
            maxLength={60}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleAdd();
            }}
          />
          <Button onClick={handleAdd} disabled={adding || !newLabel.trim()}>
            {adding ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            Añadir
          </Button>
        </div>
      </RequireRole>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : reasons.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-10 text-center">
            <Flag className="size-6 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">
              No hay motivos de cierre configurados.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Añade uno arriba o restaura los motivos por defecto. Mientras tanto,
              la Bandeja usa el catálogo estándar.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-border">
              {reasons.map((reason, index) => {
                const isBusy = busyId === reason.id;
                return (
                  <li
                    key={reason.id}
                    className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-3"
                  >
                    <div className="flex items-center gap-1">
                      <RequireRole min="admin">
                        <button
                          type="button"
                          onClick={() => handleMove(reason, -1)}
                          disabled={isBusy || index === 0}
                          aria-label="Subir"
                          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30"
                        >
                          <ArrowUp className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMove(reason, 1)}
                          disabled={isBusy || index === reasons.length - 1}
                          aria-label="Bajar"
                          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30"
                        >
                          <ArrowDown className="size-3.5" />
                        </button>
                      </RequireRole>
                    </div>

                    <div className="min-w-0 flex-1">
                      <RequireRole
                        min="admin"
                        fallback={
                          <span
                            className={cn(
                              'text-sm',
                              reason.is_active
                                ? 'text-foreground'
                                : 'text-muted-foreground line-through',
                            )}
                          >
                            {reason.label}
                          </span>
                        }
                      >
                        <Input
                          defaultValue={reason.label}
                          maxLength={60}
                          disabled={isBusy}
                          className={cn(
                            'h-8 max-w-[320px]',
                            !reason.is_active && 'text-muted-foreground line-through',
                          )}
                          onBlur={(e) => handleRename(reason, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') e.currentTarget.blur();
                          }}
                        />
                      </RequireRole>
                    </div>

                    <div className="flex items-center gap-2">
                      <RequireRole min="admin">
                        <button
                          type="button"
                          onClick={() => handleToggle(reason)}
                          disabled={isBusy}
                          className={cn(
                            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition-colors',
                            reason.is_active
                              ? 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25'
                              : 'bg-muted text-muted-foreground hover:bg-muted/70',
                          )}
                        >
                          {reason.is_active ? (
                            <CheckCircle2 className="size-3" />
                          ) : (
                            <XCircle className="size-3" />
                          )}
                          {reason.is_active ? 'Activo' : 'Inactivo'}
                        </button>
                      </RequireRole>

                      <RequireRole min="admin">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDelete(reason)}
                          disabled={isBusy}
                          className="border-red-500/40 bg-red-500/10 text-red-300 hover:border-red-500/60 hover:bg-red-500/20 hover:text-red-200"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </RequireRole>
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
