'use client';

// ============================================================
// Canales — activación estilo Kommo.
//
// Rejilla de tarjetas por canal. WhatsApp se conecta escaneando un QR
// REAL (Evolution API/Baileys); Instagram, Facebook y TikTok se conectan
// con OAuth (redirección a Meta / TikTok, sin QR). Un canal se considera
// "conectado" cuando tiene integración activa; en el panel se ilumina
// automáticamente en cuanto genera mensajes.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/dashboard/skeleton';
import { channelMeta } from '@/lib/metrics/channels';
import { ChannelIcon } from '@/components/channels/channel-icon';
import { ChannelConnectDialog } from '@/components/channels/channel-connect-dialog';
import type { SerializedChannel } from '@/lib/channels/config';
import type { MessageChannel } from '@/types';
import { Check, Link2, QrCode, ShieldAlert, Trash2, AlertTriangle, Wifi, WifiOff } from 'lucide-react';

type ConnectableChannel = Extract<
  MessageChannel,
  'whatsapp' | 'instagram' | 'facebook' | 'tiktok'
>;

const CHANNELS: { key: ConnectableChannel; description: string }[] = [
  {
    key: 'whatsapp',
    description:
      'Vincula tu número escaneando un QR (WhatsApp app) o con la API oficial de WhatsApp Business (Meta).',
  },
  {
    key: 'instagram',
    description:
      'Conecta Instagram Direct con las credenciales de Meta y recibe sus mensajes en la bandeja.',
  },
  {
    key: 'facebook',
    description:
      'Conecta Facebook Messenger con las credenciales de Meta y recibe sus mensajes en la bandeja.',
  },
  {
    key: 'tiktok',
    description:
      'Conecta tu cuenta de empresa de TikTok con OAuth e interactúa con sus mensajes.',
  },
];

function metaErrorMessage(reason: string | null): string {
  switch (reason) {
    case 'config':
      return 'Falta configurar la app de Meta en el servidor (META_APP_ID / META_APP_SECRET).';
    case 'state':
      return 'La sesión de conexión caducó o no es válida. Inténtalo de nuevo.';
    case 'account':
      return 'La conexión no corresponde a esta cuenta.';
    case 'auth':
      return 'Necesitas ser administrador para conectar canales.';
    case 'no_accounts':
      return 'No encontramos páginas o cuentas aptas para este canal.';
    case 'channel':
      return 'Canal no válido.';
    case 'save':
      return 'No se pudieron guardar las credenciales.';
    default:
      return reason
        ? `No se pudo conectar con Meta: ${reason}`
        : 'No se pudo conectar con Meta.';
  }
}

function tiktokErrorMessage(reason: string | null): string {
  switch (reason) {
    case 'config':
      return 'Falta configurar la app de TikTok en el servidor (NEXT_PUBLIC_TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET).';
    case 'state':
      return 'La sesión de conexión caducó o no es válida. Inténtalo de nuevo.';
    case 'account':
      return 'La conexión no corresponde a esta cuenta.';
    case 'auth':
      return 'Necesitas ser administrador para conectar canales.';
    case 'save':
      return 'No se pudieron guardar las credenciales.';
    default:
      return reason
        ? `No se pudo conectar con TikTok: ${reason}`
        : 'No se pudo conectar con TikTok.';
  }
}

export default function ChannelsPage() {
  const [loading, setLoading] = useState(true);
  const [evolutionRow, setEvolutionRow] = useState<SerializedChannel | null>(null);
  const [cloudConnected, setCloudConnected] = useState(false);
  const [metaRows, setMetaRows] = useState<
    Partial<Record<'instagram' | 'facebook', SerializedChannel>>
  >({});
  const [tiktokRow, setTiktokRow] = useState<SerializedChannel | null>(null);
  const [dialogChannel, setDialogChannel] = useState<ConnectableChannel | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [channelsRes, cloudRes] = await Promise.all([
        fetch('/api/channels'),
        fetch('/api/whatsapp/config?lazy=1'),
      ]);
      const json = (await channelsRes.json()) as { data?: SerializedChannel[] };
      const rows = json.data ?? [];
      setEvolutionRow(rows.find((r) => r.channel === 'evolution') ?? null);
      setMetaRows({
        instagram: rows.find((r) => r.channel === 'instagram'),
        facebook: rows.find((r) => r.channel === 'facebook'),
      });
      setTiktokRow(rows.find((r) => r.channel === 'tiktok') ?? null);
      const cloud = (await cloudRes.json()) as { connected?: boolean };
      setCloudConnected(Boolean(cloud.connected));
    } catch {
      // La rejilla se muestra igual; el estado queda como desconectado.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Vuelta del OAuth (Meta o TikTok): muestra el aviso correspondiente y,
  // si hay que elegir página de Meta, abre el diálogo.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const meta = params.get('meta');
    const tiktok = params.get('tiktok');
    if (!meta && !tiktok) return;

    // Vuelta de TikTok dentro del popup: avisa a la ventana principal y se cierra.
    if (tiktok && window.opener && window.opener !== window) {
      window.opener.postMessage(
        { type: 'nexus:tiktok-oauth', status: tiktok, reason: params.get('reason') },
        window.location.origin,
      );
      window.close();
      return;
    }

    const channel = params.get('channel');

    if (meta === 'connected') {
      const label =
        channel === 'facebook'
          ? 'Facebook Messenger'
          : channel === 'instagram'
            ? 'Instagram Direct'
            : 'Canal';
      toast.success(`${label} conectado`);
    } else if (meta === 'choose') {
      if (channel === 'instagram' || channel === 'facebook') {
        setDialogChannel(channel);
        setDialogOpen(true);
      }
    } else if (meta === 'error') {
      toast.error(metaErrorMessage(params.get('reason')));
    }

    if (tiktok === 'connected') {
      toast.success('TikTok conectado');
    } else if (tiktok === 'error') {
      toast.error(tiktokErrorMessage(params.get('reason')));
    }

    // Limpia el query para que el aviso no se repita al recargar.
    window.history.replaceState({}, '', '/channels');
    void load();
  }, [load]);

  // Resultado de TikTok llegado desde el popup de OAuth.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      const data = event.data as
        | { type?: string; status?: string; reason?: string | null }
        | null;
      if (!data || data.type !== 'nexus:tiktok-oauth') return;

      if (data.status === 'connected') {
        toast.success('TikTok conectado');
      } else {
        toast.error(tiktokErrorMessage(data.reason ?? null));
      }
      void load();
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [load]);

  function openChannel(key: ConnectableChannel) {
    setDialogChannel(key);
    setDialogOpen(true);
  }

  const isConnected = (key: ConnectableChannel) => {
    if (key === 'whatsapp')
      return Boolean(evolutionRow?.is_active) || cloudConnected;
    if (key === 'instagram' || key === 'facebook')
      return Boolean(metaRows[key]?.is_active);
    if (key === 'tiktok') return Boolean(tiktokRow?.is_active);
    return false;
  };

  async function disconnectChannel(key: ConnectableChannel) {
    if (!confirm('¿Desconectar este canal? Se eliminará la configuración del CRM.')) return;
    try {
      let ok = false;
      if (key === 'whatsapp' && evolutionRow?.is_active) {
        const res = await fetch('/api/channels/evolution/disconnect', { method: 'POST' });
        ok = res.ok;
        if (!ok) {
          // Si el servidor de Evolution no responde, igual borramos la fila local.
          await fetch('/api/channels/evolution', { method: 'DELETE' });
        }
      } else {
        const channel = key === 'whatsapp' ? 'evolution' : key;
        const res = await fetch(`/api/channels/${channel}`, { method: 'DELETE' });
        ok = res.ok;
      }
      await load();
      toast.success(ok ? 'Canal desconectado' : 'Configuración eliminada del CRM');
    } catch {
      toast.error('No se pudo desconectar el canal');
    }
  }

  interface ChannelStatus {
    state: 'connected' | 'warning' | 'disconnected';
    label: string;
    details: string[];
    warnings: string[];
  }

  function getStatus(key: ConnectableChannel): ChannelStatus {
    if (key === 'whatsapp') {
      if (cloudConnected) {
        return {
          state: 'connected',
          label: 'Conectado',
          details: ['API oficial de Meta'],
          warnings: [],
        };
      }
      if (evolutionRow?.is_active) {
        const baseUrl = typeof evolutionRow.config.base_url === 'string' ? evolutionRow.config.base_url : '';
        const instance = typeof evolutionRow.config.instance === 'string' ? evolutionRow.config.instance : '';
        const warnings: string[] = [];
        if (baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1')) {
          warnings.push('La URL apunta a localhost: no funcionará en producción.');
        }
        return {
          state: warnings.length ? 'warning' : 'connected',
          label: warnings.length ? 'Conectado con advertencias' : 'Conectado',
          details: instance ? [`Instancia: ${instance}`, `URL: ${baseUrl || '—'}`] : [`URL: ${baseUrl || '—'}`],
          warnings,
        };
      }
      return {
        state: 'disconnected',
        label: 'Por habilitar',
        details: [],
        warnings: [],
      };
    }

    if (key === 'instagram' || key === 'facebook') {
      const row = metaRows[key];
      if (row?.is_active) {
        const pageId = typeof row.config.page_id === 'string' ? row.config.page_id : '';
        const hasAppSecret = row.config.has_app_secret === true;
        const warnings: string[] = [];
        if (!hasAppSecret) {
          warnings.push('Falta app_secret guardado. Los mensajes pueden no entrar.');
        }
        return {
          state: warnings.length ? 'warning' : 'connected',
          label: warnings.length ? 'Conectado con advertencias' : 'Conectado',
          details: pageId ? [`Página: ${pageId}`] : [],
          warnings,
        };
      }
      return {
        state: 'disconnected',
        label: 'Por habilitar',
        details: [],
        warnings: [],
      };
    }

    if (key === 'tiktok') {
      if (tiktokRow?.is_active) {
        const username = typeof tiktokRow.config.username === 'string' ? tiktokRow.config.username : '';
        const displayName = typeof tiktokRow.config.display_name === 'string' ? tiktokRow.config.display_name : '';
        return {
          state: 'connected',
          label: 'Cuenta vinculada',
          details: [displayName || username || 'Sin nombre'].filter(Boolean),
          warnings: ['La mensajería real requiere partner aprobado por TikTok.'],
        };
      }
      return {
        state: 'disconnected',
        label: 'Por habilitar',
        details: [],
        warnings: [],
      };
    }

    return { state: 'disconnected', label: 'Por habilitar', details: [], warnings: [] };
  }

  return (
    <div className="space-y-6 p-4 lg:p-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-foreground">Canales de mensajería</h2>
        <p className="text-sm text-muted-foreground">
          Conecta WhatsApp, Instagram, Facebook y TikTok para centralizar toda la
          conversación. Cada canal aparece en el panel en cuanto empieza a generar
          mensajes.
        </p>
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
        <span>
          Conectar canales requiere rol <strong className="text-foreground">administrador</strong>.
          WhatsApp registra su webhook automáticamente; en Instagram y Facebook
          deberás copiar la URL que verás al conectar.
        </span>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CHANNELS.map((c) => (
            <Skeleton key={c.key} className="h-44 w-full" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {CHANNELS.map((c) => {
            const meta = channelMeta(c.key);
            const status = getStatus(c.key);
            const connected = status.state !== 'disconnected';
            return (
              <div
                key={c.key}
                className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex h-11 w-11 items-center justify-center rounded-lg ${meta.tint}`}
                    >
                      <ChannelIcon meta={meta} size={20} />
                    </div>
                    <div>
                      <h3 className="text-sm font-medium text-foreground">{meta.label}</h3>
                      <p className="text-xs text-muted-foreground">{meta.hint}</p>
                    </div>
                  </div>
                  {status.state === 'connected' ? (
                    <Badge className="gap-1 border-emerald-400/30 bg-emerald-400/10 text-emerald-400">
                      <Wifi className="h-3 w-3" />
                      {status.label}
                    </Badge>
                  ) : status.state === 'warning' ? (
                    <Badge className="gap-1 border-amber-400/30 bg-amber-400/10 text-amber-400">
                      <AlertTriangle className="h-3 w-3" />
                      {status.label}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="gap-1 text-muted-foreground">
                      <WifiOff className="h-3 w-3" />
                      {status.label}
                    </Badge>
                  )}
                </div>

                <div className="flex-1 space-y-2">
                  <p className="text-xs text-muted-foreground">{c.description}</p>
                  {status.details.length > 0 && (
                    <ul className="space-y-1">
                      {status.details.map((d, i) => (
                        <li key={i} className="text-xs text-foreground/80 font-mono truncate" title={d}>
                          {d}
                        </li>
                      ))}
                    </ul>
                  )}
                  {status.warnings.length > 0 && (
                    <div className="space-y-1">
                      {status.warnings.map((w, i) => (
                        <p key={i} className="flex items-start gap-1.5 text-xs text-amber-400">
                          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                          <span>{w}</span>
                        </p>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant={connected ? 'outline' : 'default'}
                    onClick={() => openChannel(c.key)}
                    className={
                      connected
                        ? 'flex-1 border-border text-muted-foreground'
                        : 'flex-1 bg-primary text-primary-foreground hover:bg-primary/90'
                    }
                  >
                    {c.key === 'whatsapp' ? (
                      <QrCode className="h-4 w-4" />
                    ) : (
                      <Link2 className="h-4 w-4" />
                    )}
                    {connected ? 'Gestionar' : 'Conectar'}
                  </Button>
                  {connected && (
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => disconnectChannel(c.key)}
                      className="border-destructive/30 text-destructive hover:bg-destructive/10"
                      aria-label="Desconectar"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ChannelConnectDialog
        channel={dialogChannel}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        evolutionRow={evolutionRow}
        metaRow={
          dialogChannel === 'instagram'
            ? metaRows.instagram ?? null
            : dialogChannel === 'facebook'
              ? metaRows.facebook ?? null
              : null
        }
        tiktokRow={tiktokRow}
        onChanged={load}
      />
    </div>
  );
}
