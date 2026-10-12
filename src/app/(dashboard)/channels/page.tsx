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
import { Check, Link2, QrCode, ShieldAlert } from 'lucide-react';

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
            const connected = isConnected(c.key);
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
                  {connected ? (
                    <Badge className="gap-1 border-emerald-400/30 bg-emerald-400/10 text-emerald-400">
                      <Check className="h-3 w-3" />
                      Conectado
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">
                      Por habilitar
                    </Badge>
                  )}
                </div>

                <p className="flex-1 text-xs text-muted-foreground">{c.description}</p>

                <Button
                  variant={connected ? 'outline' : 'default'}
                  onClick={() => openChannel(c.key)}
                  className={
                    connected
                      ? 'border-border text-muted-foreground'
                      : 'bg-primary text-primary-foreground hover:bg-primary/90'
                  }
                >
                  {c.key === 'whatsapp' ? (
                    <QrCode className="h-4 w-4" />
                  ) : (
                    <Link2 className="h-4 w-4" />
                  )}
                  {connected ? 'Gestionar' : 'Conectar'}
                </Button>
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
