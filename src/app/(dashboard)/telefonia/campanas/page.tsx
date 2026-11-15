'use client';

// ============================================================
// Campañas salientes — v1 preview (migración 117).
//
// Una campaña agrupa contactos a los que el equipo va a marcar por
// el softphone. V1 no hace fan-out automático: el admin arma la
// lista y cada contacto se marca con el flujo normal de llamadas
// (startCall → claim → answer → disposition). Al colgar, el contacto
// pasa a `called` y la campaña registra el estado.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { toast } from 'sonner';
import { Loader2, Phone, Plus, Trash2 } from 'lucide-react';

import { Panel } from '@/components/metrics/panel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuth } from '@/hooks/use-auth';
import { useTelephony } from '@/components/telephony/telephony-provider';
import type {
  OutboundCampaign,
  OutboundCampaignContact,
} from '@/types';

interface CampaignContactRow extends OutboundCampaignContact {
  contact_id: string;
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

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pendiente',
  called: 'Llamada registrada',
};

export default function CampanasPage() {
  const { isAdmin, accountRole } = useAuth();
  const { startCall, callable } = useTelephony();

  const [campaigns, setCampaigns] = useState<CampaignWithContacts[]>([]);
  const [loading, setLoading] = useState(true);
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [contactsLoading, setContactsLoading] = useState(true);
  const [campaignName, setCampaignName] = useState('');
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [callingId, setCallingId] = useState<string | null>(null);

  const loadCampaigns = useCallback(async () => {
    try {
      const res = await fetch('/api/telephony/campaigns', { cache: 'no-store' });
      const body = (await res.json().catch(() => ({}))) as {
        campaigns?: CampaignWithContacts[];
        error?: string;
      };
      if (res.ok && body.campaigns) {
        setCampaigns(body.campaigns);
      }
    } catch {
      // Sin red: se conserva la lista anterior.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadCampaigns();
  }, [loadCampaigns]);

  useEffect(() => {
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
        // El alta de campañas puede quedar con la lista anterior.
      } finally {
        setContactsLoading(false);
      }
    };
    if (accountRole !== 'admin' && accountRole !== 'owner') return;
    void loadContacts();
  }, [accountRole]);

  const toggleContact = (id: string) => {
    setSelectedContactIds((current) =>
      current.includes(id) ? current.filter((row) => row !== id) : [...current, id]
    );
  };

  const createCampaign = async () => {
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
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        campaign?: CampaignWithContacts;
      };
      if (!res.ok) {
        toast.error(body.error ?? 'No se pudo crear la campaña.');
        return;
      }
      setCampaignName('');
      setSelectedContactIds([]);
      await loadCampaigns();
      toast.success('Campaña creada.');
    } finally {
      setCreating(false);
    }
  };

  const deleteCampaign = async (id: string) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/telephony/campaigns/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        toast.error('No se pudo eliminar la campaña.');
        return;
      }
      await loadCampaigns();
      toast.success('Campaña eliminada.');
    } finally {
      setDeletingId(null);
    }
  };

  const callContact = async (contact: CampaignContactRow) => {
    const to = contact.contact_phone;
    if (!to) {
      toast.error('El contacto no tiene teléfono.');
      return;
    }
    setCallingId(contact.id);
    try {
      const ok = await startCall(to, {
        contactId: contact.contact_id,
        campaignContactId: contact.id,
      });
      if (ok) toast.success('Llamada saliente iniciada desde la campaña.');
    } finally {
      setCallingId(null);
    }
  };

  if (!isAdmin) {
    return (
      <Panel title="Campañas salientes">
        <p className="text-muted-foreground text-sm">
          Solo admin+ gestiona campañas. Tu rol es {accountRole}.
        </p>
      </Panel>
    );
  }

  return (
    <div className="space-y-6">
      <Panel
        title="Campañas salientes"
        subtitle="V1 preview: arma la lista y marca desde el softphone. Las llamadas van por LiveKit → SIP con la troncal."
      >
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
            <div className="space-y-1.5">
              <Label htmlFor="campaign-name">Nombre</Label>
              <Input
                id="campaign-name"
                placeholder="Campaña de renovación"
                value={campaignName}
                onChange={(event) => setCampaignName(event.target.value)}
              />
            </div>
            <Button
              onClick={() => void createCampaign()}
              disabled={creating || campaignName.trim().length === 0 || selectedContactIds.length === 0}
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
                <ul className="divide-y">
                  {contacts.map((contact) => (
                    <li
                      key={contact.id}
                      className="hover:bg-muted/50 flex cursor-pointer items-center gap-2 p-2"
                      onClick={() =>
                        setSelectedContactIds((current) =>
                          current.includes(contact.id)
                            ? current.filter((id) => id !== contact.id)
                            : [...current, contact.id]
                        )
                      }
                    >
                      <input
                        id={`contact-${contact.id}`}
                        type="checkbox"
                        checked={selectedContactIds.includes(contact.id)}
                        onChange={() => toggleContact(contact.id)}
                        className="h-4 w-4"
                      />
                      <label htmlFor={`contact-${contact.id}`} className="flex-1 text-sm">
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

      <Panel
        title="Campañas"
        subtitle="Cada campaña lista los contactos que el equipo va a marcar."
      >
        {loading ? (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando campañas…
          </p>
        ) : campaigns.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Todavía no hay campañas salientes para este negocio.
          </p>
        ) : (
          <div className="space-y-6">
            {campaigns.map((campaign) => {
              const pending = campaign.contacts.filter(
                (contact) => contact.status === 'pending'
              ).length;
              const called = campaign.contacts.filter(
                (contact) => contact.status === 'called'
              ).length;
              return (
                <div
                  key={campaign.id}
                  className="border-border rounded-xl border p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-foreground text-sm font-semibold">
                        {campaign.name}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {format(new Date(campaign.created_at), 'dd/MM/yyyy HH:mm', {
                          locale: es,
                        })}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{pending} pendientes</Badge>
                      <Badge variant="outline">{called} llamadas</Badge>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={deletingId === campaign.id}
                        onClick={() => void deleteCampaign(campaign.id)}
                        className="border-border"
                      >
                        {deletingId === campaign.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>

                  {campaign.contacts.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Contacto</TableHead>
                          <TableHead>Teléfono</TableHead>
                          <TableHead>Estado</TableHead>
                          <TableHead className="text-right">Acción</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {campaign.contacts.map((contact) => (
                          <TableRow key={contact.id}>
                            <TableCell className="text-foreground">
                              {contact.contact_name ?? 'Sin nombre'}
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {contact.contact_phone ?? '—'}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  contact.status === 'called' ? 'default' : 'secondary'
                                }
                              >
                                {STATUS_LABEL[contact.status] ?? contact.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              {contact.status === 'pending' ? (
                                <Button
                                  size="sm"
                                  disabled={!callable || callingId === contact.id}
                                  onClick={() => void callContact(contact)}
                                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                                >
                                  {callingId === contact.id ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Phone className="h-4 w-4" />
                                  )}
                                  <span className="ml-1.5">Marcar</span>
                                </Button>
                              ) : (
                                <span className="text-muted-foreground text-xs">
                                  {contact.called_at
                                    ? format(new Date(contact.called_at), 'dd/MM/yyyy HH:mm', {
                                        locale: es,
                                      })
                                    : '—'}
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <p className="text-muted-foreground mt-3 text-sm">
                      Esta campaña todavía no tiene contactos asignados.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}
