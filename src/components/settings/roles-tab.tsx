'use client';

// ============================================================
// RolesTab — Configuración → Gestión de equipos → Roles.
//
// Vista de solo lectura de los cuatro roles de la cuenta y lo que
// cada uno puede hacer. La fuente de verdad es
// `src/lib/auth/roles.ts` (los mismos predicados que usan las rutas
// de API y los gates de UI), de modo que esta matriz no puede
// desincronizarse del comportamiento real.
//
// Los roles son fijos (no hay roles personalizados): para cambiar el
// rol de una persona se hace desde «Equipo y permisos».
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, Minus } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/hooks/use-auth';
import {
  canEditSettings,
  canManageMembers,
  canSendMessages,
  canTransferOwnership,
  type AccountRole,
} from '@/lib/auth/roles';
import { SettingsPanelHead } from './settings-panel-head';
import { ROLE_META } from './role-meta';

interface MemberRow {
  role: AccountRole;
}

// Orden de columnas: de mayor a menor privilegio.
const COLUMN_ORDER: AccountRole[] = ['owner', 'admin', 'agent', 'viewer'];

const CAPABILITIES: {
  label: string;
  hint: string;
  has: (role: AccountRole) => boolean;
}[] = [
  {
    label: 'Ver el espacio de trabajo',
    hint: 'Acceso de lectura a conversaciones, contactos y reportes.',
    has: () => true,
  },
  {
    label: 'Operar el día a día',
    hint: 'Enviar mensajes, crear contactos, mover ofertas y usar automatizaciones.',
    has: canSendMessages,
  },
  {
    label: 'Editar la configuración',
    hint: 'Canales, plantillas, campos, etiquetas, moneda y ajustes de la cuenta.',
    has: canEditSettings,
  },
  {
    label: 'Gestionar el equipo',
    hint: 'Invitar miembros, cambiar roles y quitarlos de la cuenta.',
    has: canManageMembers,
  },
  {
    label: 'Transferir la propiedad',
    hint: 'Ceder la cuenta a otra persona.',
    has: canTransferOwnership,
  },
  {
    label: 'Eliminar la cuenta',
    hint: 'Borrar el espacio de trabajo por completo.',
    has: (role) => role === 'owner',
  },
];

function CapabilityMark({ enabled }: { enabled: boolean }) {
  return enabled ? (
    <span
      className="inline-flex size-6 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400"
      title="Permitido"
    >
      <Check className="size-3.5" />
    </span>
  ) : (
    <span
      className="inline-flex size-6 items-center justify-center rounded-full bg-muted text-muted-foreground"
      title="No permitido"
    >
      <Minus className="size-3.5" />
    </span>
  );
}

export function RolesTab() {
  const { profileLoading, accountId } = useAuth();
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/account/members', { cache: 'no-store' });
      if (!res.ok) throw new Error('members');
      const data = (await res.json()) as { members: MemberRow[] };
      const next: Record<string, number> = { owner: 0, admin: 0, agent: 0, viewer: 0 };
      for (const m of data.members) {
        if (next[m.role] != null) next[m.role] += 1;
      }
      setCounts(next);
    } catch {
      setCounts(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (profileLoading || !accountId) return;
    void load();
  }, [profileLoading, accountId, load]);

  return (
    <section className="animate-in fade-in-50 space-y-6 duration-200">
      <SettingsPanelHead
        title="Roles"
        description="Los roles definen lo que cada persona puede hacer. Son fijos: para cambiar el rol de alguien, edítalo en «Equipo y permisos»."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {COLUMN_ORDER.map((role) => {
          const meta = ROLE_META[role];
          const Icon = meta.icon;
          return (
            <Card key={role}>
              <CardContent className="space-y-2">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium ${meta.className}`}
                >
                  <Icon className="size-3.5" />
                  {meta.label}
                </span>
                <p className="text-sm text-muted-foreground">
                  {loading
                    ? '…'
                    : counts
                      ? `${counts[role]} ${counts[role] === 1 ? 'miembro' : 'miembros'}`
                      : '—'}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs tracking-wider text-muted-foreground uppercase">
                    <th className="px-5 py-3 font-medium">Permiso</th>
                    {COLUMN_ORDER.map((role) => (
                      <th
                        key={role}
                        className="px-4 py-3 text-center font-medium whitespace-nowrap"
                      >
                        {ROLE_META[role].label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {CAPABILITIES.map((cap) => (
                    <tr
                      key={cap.label}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-5 py-3">
                        <p className="font-medium text-foreground">{cap.label}</p>
                        <p className="mt-0.5 max-w-[52ch] text-xs text-muted-foreground">
                          {cap.hint}
                        </p>
                      </td>
                      {COLUMN_ORDER.map((role) => (
                        <td key={role} className="px-4 py-3 text-center">
                          <CapabilityMark enabled={cap.has(role)} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
