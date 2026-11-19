'use client';

// ============================================================
// Campañas salientes (migraciones 117 y 124).
//
// La campaña es una cola de trabajo. El agente pulsa "Siguiente
// contacto": el CRM reclama el próximo pendiente de forma atómica y
// abre el softphone en un solo paso. Al terminar la llamada, el
// intento se cuenta; si no contestaron vuelve a la cola mientras le
// queden intentos (`max_attempts`).
//
// Sin troncal SIP la llamada real no se puede probar, pero la cola,
// las reservas y los intentos sí funcionan.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Pause,
  Phone,
  Play,
  Plus,
  RefreshCw,
  SkipForward,
  Trash2,
} from 'lucide-react';

import { Panel } from '@/components/metrics/panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/hooks/use-auth';
import { useTelephony } from '@/components/telephony/telephony-provider';
import {
  attemptsLabel,
  campaignContactStatusLabel,
  campaignOutcomeLabel,
  campaignProgress,
  campaignStatusLabel,
  isCampaignOpen,
} from '@/lib/telephony/campaigns';
import { cn } from '@/lib/utils';
import type {
  OutboundCampaign,
  OutboundCampaignContact,
} from '@/types';

interface CampaignContactRow extends OutboundCampaignContact {
  contact_name: string | null;
  contact_phone: string | null;
}

interface CampaignWithContacts extends OutboundCampaign {
  contacts: CampaignContactRow[];
}

interface ContactOption {
  id: string;
  name: string | null;
  phone: string | null;
  phone_normalized: string | null;
}

const CONTACT_BADGE: Record<string, string> = {
  pending: 'border-border text-muted-foreground',
  dialing:
    'border-primary/40 bg-primary/10 text-primary dark:bg-primary/15',
  called:
    'border-emerald-300/60 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300',
  exhausted:
    'border-amber-300/60 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200',
};

function formatMoment(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return format(date, 'dd/MM/yyyy HH:mm', { locale: es });
}

export default function CampanasPage() {
  const { accountRole } = useAuth();
  const { startCall, callable } = useTelephony();
  const canManage = accountRole === 'admin' || accountRole === 'owner';
  const canWork = canManage || accountRole === 'agent';

  const [campaigns, setCampaigns] = useState<CampaignWithContacts[]>([]);
  const [loading, setLoading] = useState(true);
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [contactsLoading, setContactsLoading] = useState(true);
  const [campaignName, setCampaignName] = useState('');
  const [maxAttempts, setMaxAttempts] = useState('3');
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [workingId, setWorkingId] = useState<string | null>(null);

  const loadCampaigns = useCallback(async () => {
    try {
      const res = await fetch('/api/telephony/campaigns', { cache: 'no-store' });
      const body = (await res.json().catch(() => ({}))) as {
        campaigns?: CampaignWithContacts[];
        error?: string;
      };
      if (!res.ok) {
        toast.error(body.error ?? 'No se pudieron cargar las campañas.');
        return;
      }
      setCampaigns(body.campaigns ?? []);
    } catch {
      toast.error('Sin conexión: no se pudieron cargar las campañas.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canWork) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadCampaigns();
  }, [canWork, loadCampaigns]);

  useEffect(() => {
    if (!canManage) return;
    const loadContacts = async () => {
      try {
        const res = await fetch('/api/telephony/campaigns/contacts', {
          cache: 'no-store',
        });
        const body = (await res.json().catch(() => ({}))) as {
          contacts?: ContactOption[];
        };
        if (res.ok && body.contacts) setContacts(body.contacts);
      } catch {
        // La creación queda con la lista anterior.
      } finally {
        setContactsLoading(false);
      }
    };
    void loadContacts();
  }, [canManage]);

  const toggleContact = (id: string) => {
    setSelectedContactIds((current) =>
      current.includes(id) ? current.filter((row) => row !== id) : [...current, id]
    );
  };

  const createCampaign = async () => {
    const attempts = Number(maxAttempts);
    if (!Number.isInteger(attempts) || attempts < 1 || attempts > 10) {
      toast.error('Los intentos por contacto deben ser un número entre 1 y 10.');
      return;
    }
    if (!campaignName.trim() || selectedContactIds.length === 0) {
      toast.error('Pon un nombre y elige al menos un contacto.');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/telephony/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: campaignName.trim(),
          contactIds: selectedContactIds,
          maxAttempts: attempts,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        toast.error(body.error ?? 'No se pudo crear la campaña.');
        return;
      }
      setCampaignName('');
      setSelectedContactIds([]);
      await loadCampaigns();
      toast.success('Campaña creada.');
    } catch {
      toast.error('Sin conexión: no se pudo crear la campaña.');
    } finally {
      setCreating(false);
    }
  };

  const updateCampaign = async (
    campaignId: string,
    patch: Record<string, unknown>,
    successMessage: string
  ) => {
    setActionId(campaignId);
    try {
      const res = await fetch(`/api/telephony/campaigns/${campaignId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        toast.error(body.error ?? 'No se pudo actualizar la campaña.');
        return;
      }
      await loadCampaigns();
      toast.success(successMessage);
    } catch {
      toast.error('Sin conexión: no se pudo actualizar la campaña.');
    } finally {
      setActionId(null);
    }
  };

  const deleteCampaign = async (campaign: CampaignWithContacts) => {
    if (
      !window.confirm(
        `¿Eliminar la campaña "${campaign.name}"? Las llamadas ya hechas se conservan en el historial.`
      )
    ) {
      return;
    }
    setActionId(campaign.id);
    try {
      const res = await fetch(`/api/telephony/campaigns/${campaign.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        toast.error('No se pudo eliminar la campaña.');
        return;
      }
      await loadCampaigns();
      toast.success('Campaña eliminada.');
    } catch {
      toast.error('Sin conexión: no se pudo eliminar la campaña.');
    } finally {
      setActionId(null);
    }
  };

  const releaseContact = async (campaignId: string, contactId: string) => {
    try {
      await fetch(`/api/telephony/campaigns/${campaignId}/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId }),
      });
    } catch {
      // La reserva vence sola a los 2 minutos.
    }
  };

  const callNext = async (campaign: CampaignWithContacts) => {
    setWorkingId(campaign.id);
    try {
      const res = await fetch(
        `/api/telephony/campaigns/${campaign.id}/next`,
        { method: 'POST' }
      );
      const body = (await res.json().catch(() => ({}))) as {
        contact?: CampaignContactRow | null;
        error?: string;
      };
      if (!res.ok) {
        toast.error(body.error ?? 'No se pudo tomar el siguiente contacto.');
        await loadCampaigns();
        return;
      }

      const contact = body.contact ?? null;
      if (!contact) {
        toast.info('No quedan contactos pendientes en esta campaña.');
        await loadCampaigns();
        return;
      }
      if (!contact.contact_phone) {
        await releaseContact(campaign.id, contact.id);
        toast.error('El contacto no tiene teléfono; volvió a la cola.');
        await loadCampaigns();
        return;
      }

      const started = await startCall(contact.contact_phone, {
        contactId: contact.contact_id,
        campaignContactId: contact.id,
      });
      if (!started) {
        await releaseContact(campaign.id, contact.id);
        toast.error('No se pudo iniciar la llamada; el contacto vuelve a la cola.');
      } else {
        toast.success(
          `Marcando a ${contact.contact_name ?? contact.contact_phone}…`
        );
      }
      await loadCampaigns();
    } catch {
      toast.error('Sin conexión: no se pudo tomar el siguiente contacto.');
    } finally {
      setWorkingId(null);
    }
  };

  if (!canWork) {
    return (
      <Panel title="Campañas salientes">
        <p className="text-muted-foreground text-sm">
          Solo agentes y administradores trabajan campañas. Tu rol es{' '}
          {accountRole}.
        </p>
      </Panel>
    );
  }

  const activeCampaigns = campaigns.filter((campaign) =>
    isCampaignOpen(campaign.status)
  );
  const migrationMissing =
    campaigns.length > 0 && campaigns.some((campaign) => !campaign.status);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-foreground text-lg font-semibold">
            Campañas salientes
          </h2>
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
            El siguiente contacto se reclama y se marca en un solo paso. Al
            colgar, el intento se cuenta: si no contestaron, vuelve a la cola
            mientras le queden intentos.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void loadCampaigns()}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          )}
          Actualizar
        </Button>
      </div>

      {migrationMissing ? (
        <div className="flex items-start gap-3 rounded-xl border border-amber-300/60 bg-amber-50 p-4 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <p className="text-sm">
            Falta aplicar la migración{' '}
            <code className="text-foreground">124_campaign_progressive.sql</code>
            . Las campañas existentes se ven, pero no se pueden trabajar hasta
            aplicarla.
          </p>
        </div>
      ) : null}

      {canManage ? (
        <Panel
          title="Nueva campaña"
          subtitle="El admin arma la lista; los agentes la trabajan con Siguiente contacto."
        >
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-[1fr_140px_auto] md:items-end">
              <div className="space-y-1.5">
                <Label htmlFor="campaign-name">Nombre</Label>
                <Input
                  id="campaign-name"
                  placeholder="Campaña de renovación"
                  value={campaignName}
                  onChange={(event) => setCampaignName(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="campaign-attempts">Intentos</Label>
                <Input
                  id="campaign-attempts"
                  type="number"
                  min={1}
                  max={10}
                  value={maxAttempts}
                  onChange={(event) => setMaxAttempts(event.target.value)}
                />
              </div>
              <Button
                onClick={() => void createCampaign()}
                disabled={
                  creating ||
                  campaignName.trim().length === 0 ||
                  selectedContactIds.length === 0
                }
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {creating ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-1.5 h-4 w-4" />
                )}
                Crear campaña
              </Button>
            </div>

            <div className="space-y-1.5">
              <Label>
                Contactos ({selectedContactIds.length} seleccionados)
              </Label>
              <div className="border-border max-h-56 overflow-auto rounded-lg border">
                {contactsLoading ? (
                  <p className="text-muted-foreground p-3 text-sm">
                    Cargando contactos…
                  </p>
                ) : contacts.length === 0 ? (
                  <p className="text-muted-foreground p-3 text-sm">
                    Sin contactos para este negocio todavía.
                  </p>
                ) : (
                  <ul className="divide-border divide-y">
                    {contacts.map((contact) => (
                      <li
                        key={contact.id}
                        className="hover:bg-muted/50 flex cursor-pointer items-center gap-2 p-2"
                        onClick={() => toggleContact(contact.id)}
                      >
                        <input
                          id={`contact-${contact.id}`}
                          type="checkbox"
                          checked={selectedContactIds.includes(contact.id)}
                          onChange={() => toggleContact(contact.id)}
                          className="h-4 w-4"
                        />
                        <label
                          htmlFor={`contact-${contact.id}`}
                          className="flex-1 text-sm"
                        >
                          {contact.name ?? 'Sin nombre'}
                          <span className="text-muted-foreground ml-2 font-mono text-xs">
                            {contact.phone_normalized ?? contact.phone ?? ''}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </Panel>
      ) : null}

      <Panel
        title="Campañas activas"
        subtitle="Cada campaña activa tiene una cola propia; el trabajo se reparte solo entre los agentes que piden el siguiente contacto."
      >
        {loading ? (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando campañas…
          </p>
        ) : activeCampaigns.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No hay campañas activas. Cuando el admin cree una o reanude una
            pausada, aparecerá aquí.
          </p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {activeCampaigns.map((campaign) => {
              const progress = campaignProgress(campaign.contacts);
              const working = workingId === campaign.id;
              return (
                <div
                  key={campaign.id}
                  className="border-border rounded-xl border p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-foreground truncate text-sm font-semibold">
                        {campaign.name}
                      </p>
                      <p className="text-muted-foreground text-[11px]">
                        {progress.called} contactados · {progress.exhausted} sin
                        intentos · {progress.pending} pendientes
                        {progress.dialing > 0
                          ? ` · ${progress.dialing} marcando`
                          : ''}
                      </p>
                    </div>
                    <Badge variant="outline">
                      {progress.percent}% cerrada
                    </Badge>
                  </div>

                  <div className="bg-muted mt-3 h-2 overflow-hidden rounded-full">
                    <div
                      className="bg-primary h-full rounded-full"
                      style={{ width: `${progress.percent}%` }}
                    />
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-muted-foreground text-[11px]">
                      Hasta {campaign.max_attempts} intentos por contacto
                    </p>
                    <Button
                      size="sm"
                      onClick={() => void callNext(campaign)}
                      disabled={!callable || working || progress.pending === 0}
                      title={
                        callable
                          ? undefined
                          : 'La telefonía (LiveKit + troncal) no está configurada.'
                      }
                      className="bg-primary text-primary-foreground hover:bg-primary/90"
                    >
                      {working ? (
                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                      ) : (
                        <SkipForward className="mr-1.5 h-4 w-4" />
                      )}
                      Siguiente contacto
                    </Button>
                  </div>

                  {!callable ? (
                    <p className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-300">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                      Sin LiveKit ni troncal SIP no se puede marcar. La cola y
                      los intentos quedan listos.
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {canManage ? (
        <Panel
          title="Administrar campañas"
          subtitle="Pausa, reanuda o cierra la campaña y revisa el detalle de cada contacto."
          bodyClassName="p-0"
        >
          {loading ? (
            <p className="text-muted-foreground p-5 text-sm">Cargando…</p>
          ) : campaigns.length === 0 ? (
            <p className="text-muted-foreground p-5 text-sm">
              Todavía no hay campañas salientes para este negocio.
            </p>
          ) : (
            <div className="divide-border divide-y">
              {campaigns.map((campaign) => {
                const progress = campaignProgress(campaign.contacts);
                const busy = actionId === campaign.id;
                return (
                  <details key={campaign.id} className="group">
                    <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-5 py-3">
                      <div className="min-w-0">
                        <p className="text-foreground flex items-center gap-2 text-sm font-medium">
                          {campaign.name}
                          <Badge
                            variant={
                              campaign.status === 'active'
                                ? 'default'
                                : 'secondary'
                            }
                          >
                            {campaignStatusLabel(campaign.status)}
                          </Badge>
                        </p>
                        <p className="text-muted-foreground text-[11px]">
                          {formatMoment(campaign.created_at)} ·{' '}
                          {progress.closed}/{progress.total} cerrados ·{' '}
                          {campaign.max_attempts} intentos
                        </p>
                      </div>
                      <span className="text-muted-foreground text-[11px]">
                        {progress.percent}%
                      </span>
                    </summary>

                    <div className="flex flex-wrap items-center gap-2 px-5 pb-3">
                      {campaign.status === 'active' ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            void updateCampaign(
                              campaign.id,
                              { status: 'paused' },
                              'Campaña pausada.'
                            )
                          }
                        >
                          <Pause className="mr-1.5 h-3.5 w-3.5" /> Pausar
                        </Button>
                      ) : null}
                      {campaign.status === 'paused' ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            void updateCampaign(
                              campaign.id,
                              { status: 'active' },
                              'Campaña reanudada.'
                            )
                          }
                        >
                          <Play className="mr-1.5 h-3.5 w-3.5" /> Reanudar
                        </Button>
                      ) : null}
                      {campaign.status !== 'completed' ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => {
                            if (
                              !window.confirm(
                                `¿Cerrar "${campaign.name}"? Los pendientes dejarán de trabajarse.`
                              )
                            ) {
                              return;
                            }
                            void updateCampaign(
                              campaign.id,
                              { status: 'completed' },
                              'Campaña completada.'
                            );
                          }}
                        >
                          <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />{' '}
                          Completar
                        </Button>
                      ) : null}

                      <label className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
                        Intentos
                        <select
                          className="border-input bg-background h-8 rounded-md border px-2 text-xs"
                          value={campaign.max_attempts}
                          disabled={busy}
                          onChange={(event) =>
                            void updateCampaign(
                              campaign.id,
                              { maxAttempts: Number(event.target.value) },
                              'Intentos actualizados.'
                            )
                          }
                        >
                          {Array.from({ length: 10 }, (_, index) => index + 1).map(
                            (value) => (
                              <option key={value} value={value}>
                                {value}
                              </option>
                            )
                          )}
                        </select>
                      </label>

                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => void deleteCampaign(campaign)}
                        className="ml-auto"
                      >
                        {busy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>

                    {campaign.contacts.length === 0 ? (
                      <p className="text-muted-foreground px-5 pb-4 text-sm">
                        Esta campaña todavía no tiene contactos.
                      </p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Contacto</TableHead>
                            <TableHead>Teléfono</TableHead>
                            <TableHead>Estado</TableHead>
                            <TableHead>Intentos</TableHead>
                            <TableHead>Último resultado</TableHead>
                            <TableHead>Último intento</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {campaign.contacts.map((contact) => {
                            const attempts = attemptsLabel({
                              attempts: contact.attempts,
                              maxAttempts: campaign.max_attempts,
                            });
                            return (
                              <TableRow key={contact.id}>
                                <TableCell className="text-foreground">
                                  {contact.contact_name ?? 'Sin nombre'}
                                </TableCell>
                                <TableCell className="font-mono text-xs">
                                  {contact.contact_phone ?? '—'}
                                </TableCell>
                                <TableCell>
                                  <Badge
                                    variant="outline"
                                    className={cn(
                                      CONTACT_BADGE[contact.status]
                                    )}
                                  >
                                    {campaignContactStatusLabel(contact.status)}
                                  </Badge>
                                </TableCell>
                                <TableCell className="tabular-nums">
                                  {attempts ?? (
                                    <span className="text-muted-foreground">
                                      —
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell className="text-xs">
                                  {contact.last_outcome
                                    ? campaignOutcomeLabel(contact.last_outcome)
                                    : '—'}
                                </TableCell>
                                <TableCell className="text-muted-foreground text-xs">
                                  {formatMoment(contact.last_attempt_at)}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    )}
                  </details>
                );
              })}
            </div>
          )}
        </Panel>
      ) : null}

      {!canManage ? (
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <Phone className="h-3 w-3" />
          El teléfono aparece al reclamar el siguiente contacto.
        </p>
      ) : null}
    </div>
  );
}
