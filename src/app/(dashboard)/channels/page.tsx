'use client';

// ============================================================
// Canales — activación estilo Kommo.
//
// Rejilla de tarjetas por canal. WhatsApp se conecta escaneando un QR
// REAL (Evolution API/Baileys); Instagram, Facebook y TikTok muestran
// su estado real y se activan por OAuth/token (sin QR). Un canal se
// considera "conectado" cuando tiene integración activa; en el panel
// se ilumina automáticamente en cuanto genera mensajes.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
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
      'Vincula tu número escaneando un código QR (Evolution API). Es el único canal con QR real.',
  },
  {
    key: 'instagram',
    description: 'Conecta Instagram Direct con OAuth de Meta y recibe sus mensajes en la bandeja.',
  },
  {
    key: 'facebook',
    description: 'Conecta Facebook Messenger con OAuth de Meta para centralizar su atención.',
  },
  {
    key: 'tiktok',
    description: 'Mensajería de TikTok (requiere acceso partner a la Business Messaging API).',
  },
];

export default function ChannelsPage() {
  const [loading, setLoading] = useState(true);
  const [evolutionRow, setEvolutionRow] = useState<SerializedChannel | null>(null);
  const [dialogChannel, setDialogChannel] = useState<ConnectableChannel | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/channels');
      const json = (await res.json()) as { data?: SerializedChannel[] };
      const evo = (json.data ?? []).find((r) => r.channel === 'evolution') ?? null;
      setEvolutionRow(evo);
    } catch {
      // La rejilla se muestra igual; el estado queda como desconectado.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openChannel(key: ConnectableChannel) {
    setDialogChannel(key);
    setDialogOpen(true);
  }

  const isConnected = (key: ConnectableChannel) =>
    key === 'whatsapp' ? Boolean(evolutionRow?.is_active) : false;

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
          La URL de webhook se registra automáticamente al conectar (no hace falta copiarla).
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
        onChanged={load}
      />
    </div>
  );
}
