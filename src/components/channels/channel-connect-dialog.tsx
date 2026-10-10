'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { channelMeta } from '@/lib/metrics/channels';
import type { SerializedChannel } from '@/lib/channels/config';
import type { MessageChannel } from '@/types';
import {
  Check,
  Copy,
  ExternalLink,
  Loader2,
  QrCode,
  RefreshCw,
  Smartphone,
  TriangleAlert,
} from 'lucide-react';

// ============================================================
// Modal de conexión de canal — estilo Kommo.
//
// Solo WhatsApp tiene un QR de emparejamiento REAL (vía Evolution
// API/Baileys): se genera, se escanea desde el móvil y el canal se
// activa solo al confirmarse. Instagram/Facebook (OAuth de Meta) y
// TikTok (acceso partner) NO admiten QR, así que aquí muestran su
// estado real y los requisitos pendientes.
// ============================================================

type ConnectableChannel = Extract<
  MessageChannel,
  'whatsapp' | 'instagram' | 'facebook' | 'tiktok'
>;

interface Props {
  channel: ConnectableChannel | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fila del canal Evolution de la cuenta (o null si no hay). */
  evolutionRow: SerializedChannel | null;
  /** Recarga el estado de canales tras conectar/desconectar. */
  onChanged: () => void;
}

export function ChannelConnectDialog({
  channel,
  open,
  onOpenChange,
  evolutionRow,
  onChanged,
}: Props) {
  if (channel === 'whatsapp') {
    return (
      <WhatsAppConnectDialog
        open={open}
        onOpenChange={onOpenChange}
        evolutionRow={evolutionRow}
        onChanged={onChanged}
      />
    );
  }

  // Instagram / Facebook / TikTok — sin QR posible.
  const meta = channel ? channelMeta(channel) : channelMeta('instagram');
  const network =
    channel === 'tiktok'
      ? 'TikTok (Business Messaging API)'
      : channel === 'facebook'
        ? 'Facebook Messenger'
        : 'Instagram Direct';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${meta.tint}`}>
              <meta.icon className={`h-5 w-5 ${meta.color}`} />
            </div>
            <div>
              <DialogTitle>Conectar {meta.label}</DialogTitle>
              <DialogDescription>{network}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-3 text-sm text-muted-foreground">
          <p>
            {meta.label} se conecta con <strong className="text-foreground">OAuth / token</strong>,
            no con un código QR. El QR solo lo usa WhatsApp Web. Para habilitar este canal
            necesitas una app aprobada en la plataforma y configurar sus credenciales.
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Crea/abre tu app de desarrollador para {meta.label}.</li>
            <li>Concede los permisos de mensajería y activa el webhook de mensajes.</li>
            <li>Pega el token de acceso aquí para activar el canal.</li>
          </ul>
          <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <span>
              Aún no has conectado credenciales de {meta.label}. El canal queda
              <strong className="text-foreground"> “por habilitar”</strong> y aparecerá
              en el panel en cuanto empiece a recibir mensajes.
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-border text-muted-foreground"
          >
            Cerrar
          </Button>
          <Button disabled title="Requiere credenciales de la app (pendiente)">
            <ExternalLink className="h-4 w-4" />
            Conectar con {meta.label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- WhatsApp (QR real vía Evolution) --------------------------

type WAMode = 'form' | 'qr' | 'connected';

function WhatsAppConnectDialog({
  open,
  onOpenChange,
  evolutionRow,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  evolutionRow: SerializedChannel | null;
  onChanged: () => void;
}) {
  const connected = Boolean(evolutionRow?.is_active);
  const [mode, setMode] = useState<WAMode>(connected ? 'connected' : 'form');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [qr, setQr] = useState<string | null>(null);
  const [instance, setInstance] = useState('');
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Re-sincroniza el estado cuando se abre el modal.
  useEffect(() => {
    if (!open) return;
    setMode(connected ? 'connected' : 'form');
    setBaseUrl(String((evolutionRow?.config?.base_url as string | undefined) ?? ''));
    setApiKey('');
    setQr(null);
    setInstance(String((evolutionRow?.config?.instance as string | undefined) ?? ''));
  }, [open, connected, evolutionRow]);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setWaiting(false);
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const webhookUrl = useMemo(() => {
    if (!evolutionRow) return '';
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return `${origin}/api/webhooks/evolution/${evolutionRow.id}`;
  }, [evolutionRow]);

  const startPolling = useCallback(() => {
    stopPolling();
    setWaiting(true);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch('/api/channels/evolution/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        const json = await res.json();
        if (json.connected) {
          stopPolling();
          setMode('connected');
          toast.success('¡WhatsApp conectado!');
          onChanged();
        }
      } catch {
        // Sigue sondeando.
      }
    }, 3000);
  }, [stopPolling, onChanged]);

  async function generateQr() {
    setBusy(true);
    try {
      const res = await fetch('/api/channels/evolution/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base_url: baseUrl, api_key: apiKey }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'No se pudo generar el QR');
      setQr(json.qr ?? null);
      setInstance(json.instance ?? '');
      setMode('qr');
      if (json.qr) startPolling();
      else toast.error('Evolution no devolvió un QR. Revisa las credenciales.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al conectar');
    } finally {
      setBusy(false);
    }
  }

  async function refreshQr() {
    setBusy(true);
    try {
      const res = await fetch('/api/channels/evolution/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base_url: baseUrl, api_key: apiKey }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'No se pudo refrescar el QR');
      setQr(json.qr ?? null);
      if (json.qr) startPolling();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error');
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      const res = await fetch('/api/channels/evolution/disconnect', { method: 'POST' });
      if (!res.ok) throw new Error('No se pudo desconectar');
      stopPolling();
      setMode('form');
      toast.success('WhatsApp desconectado');
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) stopPolling();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-400/10">
              <Smartphone className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <DialogTitle>Conectar WhatsApp</DialogTitle>
              <DialogDescription>
                Vincula tu número escaneando un código QR (Evolution API).
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {mode === 'connected' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-lg bg-emerald-400/10 p-3 text-sm">
              <Check className="h-4 w-4 text-emerald-400" />
              <span className="text-foreground">WhatsApp conectado y activo.</span>
            </div>
            <div className="space-y-1 text-xs text-muted-foreground">
              <p>
                Instancia: <code className="text-foreground">{instance || '—'}</code>
              </p>
              <p>
                Base URL: <code className="text-foreground">{baseUrl || '—'}</code>
              </p>
            </div>
            {webhookUrl && (
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Webhook de ingesta:</p>
                <div className="mt-1 flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate text-xs text-foreground">
                    {webhookUrl}
                  </code>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => {
                      navigator.clipboard?.writeText(webhookUrl);
                      toast.success('URL copiada');
                    }}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="border-border text-muted-foreground"
              >
                Cerrar
              </Button>
              <Button
                variant="outline"
                onClick={disconnect}
                disabled={busy}
                className="border-destructive/40 text-destructive hover:bg-destructive/10"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Desconectar
              </Button>
            </DialogFooter>
          </div>
        )}

        {mode === 'form' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Introduce la URL base y la API key global de tu servidor
              <strong className="text-foreground"> Evolution API</strong>. Crearemos la
              instancia y te mostraremos el QR automáticamente.
            </p>
            <div className="space-y-3">
              <Input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://evolution.midominio.com"
                className="border-border text-foreground placeholder:text-muted-foreground"
              />
              <Input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="API key global de Evolution"
                className="border-border text-foreground placeholder:text-muted-foreground"
              />
            </div>
            <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <span>
                ¿Aún no tienes un servidor Evolution API? Despliégalo con Docker
                (<code className="text-foreground">atendai/evolution-api</code>) y usa su
                URL + API key global. La API key se guarda cifrada.
              </span>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="border-border text-muted-foreground"
              >
                Cancelar
              </Button>
              <Button onClick={generateQr} disabled={busy || !baseUrl || !apiKey}>
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <QrCode className="h-4 w-4" />
                )}
                Generar QR
              </Button>
            </DialogFooter>
          </div>
        )}

        {mode === 'qr' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Abre WhatsApp en tu teléfono → <strong className="text-foreground">Dispositivos
              vinculados</strong> → <strong className="text-foreground">Vincular un dispositivo</strong>
              {' '}y escanea este código:
            </p>
            <div className="flex justify-center">
              <div className="rounded-xl border border-border bg-white p-3">
                {qr ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={qr} alt="Código QR de WhatsApp" className="h-56 w-56" />
                ) : (
                  <div className="flex h-56 w-56 items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                )}
              </div>
            </div>
            {waiting && (
              <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Esperando confirmación desde tu teléfono…
              </div>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  stopPolling();
                  setMode('form');
                }}
                className="border-border text-muted-foreground"
              >
                Cancelar
              </Button>
              <Button variant="outline" onClick={refreshQr} disabled={busy}>
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Nuevo QR
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
