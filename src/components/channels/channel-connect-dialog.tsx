'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
import { ChannelIcon } from '@/components/channels/channel-icon';
import type { SerializedChannel } from '@/lib/channels/config';
import type { MessageChannel } from '@/types';
import { launchEmbeddedSignup, preloadMetaSdk } from '@/lib/channels/meta-embedded-signup';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  Link2,
  Loader2,
  MessageCircle,
  QrCode,
  TriangleAlert,
} from 'lucide-react';

// ============================================================
// Modal de conexión de canal — estilo Kommo.
//
// WhatsApp usa un asistente paso a paso: Conectar número → vincular
// existente o número nuevo → Elegir app (QR vía Evolution) o la API
// oficial de WhatsApp Business (Embedded Signup de Meta). Instagram y
// Facebook usan Facebook Login (redirección a Meta, estilo Kommo):
// el usuario autoriza, Meta vuelve al callback y el CRM guarda las
// credenciales. Queda un modo manual con token de página como respaldo.
// TikTok requiere acceso partner de su Business Messaging API, así que
// se muestra como informativo.
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
  /** Fila del canal de Meta (Instagram/Facebook) de la cuenta (o null). */
  metaRow: SerializedChannel | null;
  /** Fila del canal TikTok de la cuenta (o null). */
  tiktokRow: SerializedChannel | null;
  /** Recarga el estado de canales tras conectar/desconectar. */
  onChanged: () => void;
}

export function ChannelConnectDialog({
  channel,
  open,
  onOpenChange,
  evolutionRow,
  metaRow,
  tiktokRow,
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

  if (channel === 'instagram' || channel === 'facebook') {
    return (
      <MetaConnectDialog
        channel={channel}
        open={open}
        onOpenChange={onOpenChange}
        row={metaRow}
        onChanged={onChanged}
      />
    );
  }

  // TikTok — conexión por OAuth (Login Kit).
  return (
    <TikTokConnectDialog
      open={open}
      onOpenChange={onOpenChange}
      row={tiktokRow}
      onChanged={onChanged}
    />
  );
}

// ---- Campos de formulario --------------------------------------

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 shrink-0 text-xs text-muted-foreground">{label}</span>
      <code className="min-w-0 flex-1 truncate text-xs text-foreground">{value}</code>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => {
          navigator.clipboard?.writeText(value);
          toast.success('Copiado');
        }}
      >
        <Copy className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

// ---- Instagram / Facebook (token de Meta) ----------------------

function randomVerifyToken(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `nexus_${crypto.randomUUID().replace(/-/g, '')}`;
    }
  } catch {
    // Sin Web Crypto: se genera abajo.
  }
  return `nexus_${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`;
}

function MetaConnectDialog({
  channel,
  open,
  onOpenChange,
  row,
  onChanged,
}: {
  channel: 'instagram' | 'facebook';
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: SerializedChannel | null;
  onChanged: () => void;
}) {
  const meta = channelMeta(channel);
  const network = channel === 'facebook' ? 'Facebook Messenger' : 'Instagram Direct';
  const connected = Boolean(row?.is_active);
  const oauthReady = Boolean(process.env.NEXT_PUBLIC_META_APP_ID);

  const [mode, setMode] = useState<'connect' | 'manual' | 'choose' | 'connected'>(
    connected ? 'connected' : 'connect',
  );
  const [pending, setPending] = useState<
    { page_id: string; name: string; username: string }[]
  >([]);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [pageId, setPageId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  const hasToken = Boolean(row?.config?.has_access_token);
  const hasSecret = Boolean(row?.config?.has_app_secret);

  useEffect(() => {
    if (!open) return;
    setMode(connected ? 'connected' : 'connect');
    setPending([]);
    setSelectingId(null);
    setPageId('');
    setAccessToken('');
    setAppSecret('');
    setVerifyToken(String(row?.config?.verify_token ?? '') || randomVerifyToken());
  }, [open, connected, row]);

  // Al abrir sin conexión, mira si quedaron páginas pendientes de elegir
  // (volvimos de un OAuth en el que se autorizaron varias cuentas).
  useEffect(() => {
    if (!open || connected) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/channels/meta/oauth/candidates?channel=${channel}`,
        );
        const json = (await res.json()) as {
          data?: { page_id?: string; name?: string; username?: string }[];
        };
        const list = (json.data ?? [])
          .map((p) => ({
            page_id: String(p.page_id ?? ''),
            name: String(p.name ?? ''),
            username: String(p.username ?? ''),
          }))
          .filter((p) => p.page_id);
        if (!cancelled && list.length > 0) {
          setPending(list);
          setMode('choose');
        }
      } catch {
        // Sin pendientes: se muestra la vista normal de conexión.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, connected, channel]);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const webhookUrl = `${origin}/api/webhooks/meta/${row?.id ?? ''}`;
  const redirectUri = `${origin}/api/channels/meta/oauth/callback`;

  const canSubmit =
    Boolean(pageId.trim()) &&
    (Boolean(accessToken.trim()) || hasToken) &&
    (Boolean(appSecret.trim()) || hasSecret);

  function startOAuth() {
    if (!oauthReady) {
      toast.error('Falta configurar la app de Meta (NEXT_PUBLIC_META_APP_ID).');
      setMode('manual');
      return;
    }
    window.location.href = `/api/channels/meta/oauth/start?channel=${channel}`;
  }

  async function selectAccount(chosenPageId: string) {
    setSelectingId(chosenPageId);
    try {
      const res = await fetch('/api/channels/meta/oauth/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, page_id: chosenPageId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'No se pudo conectar');
      toast.success(
        `${network} conectado${json.page_name ? `: ${json.page_name}` : ''}`,
      );
      setMode('connected');
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al conectar');
    } finally {
      setSelectingId(null);
    }
  }

  async function connect() {
    setBusy(true);
    try {
      const res = await fetch('/api/channels/meta/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel,
          page_id: pageId.trim(),
          verify_token: verifyToken.trim(),
          ...(accessToken.trim() ? { access_token: accessToken.trim() } : {}),
          ...(appSecret.trim() ? { app_secret: appSecret.trim() } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'No se pudo conectar');
      toast.success(
        `${network} conectado${json.page_name ? `: ${json.page_name}` : ''}`,
      );
      setMode('connected');
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al conectar');
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      const res = await fetch(`/api/channels/${channel}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('No se pudo desconectar');
      setMode('connect');
      toast.success(`${network} desconectado`);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error');
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setTesting(true);
    try {
      const res = await fetch(`/api/channels/${channel}/test`, { method: 'POST' });
      const json = await res.json();
      if (json.ok) toast.success('Conexión verificada con Meta');
      else toast.error(json.error || 'Meta rechazó la conexión');
    } catch {
      toast.error('No se pudo probar la conexión');
    } finally {
      setTesting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-lg ${meta.tint}`}
            >
              <ChannelIcon meta={meta} size={20} />
            </div>
            <div>
              <DialogTitle>
                {mode === 'connected' ? `${network} conectado` : `Conectar ${network}`}
              </DialogTitle>
              <DialogDescription>
                {mode === 'manual'
                  ? 'Pega las credenciales de tu app de Meta.'
                  : 'Autoriza con tu cuenta de Facebook para conectarlo.'}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {mode === 'connected' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-lg bg-emerald-400/10 p-3 text-sm">
              <Check className="h-4 w-4 text-emerald-400" />
              <span className="text-foreground">{network} está conectado.</span>
            </div>

            <div className="space-y-2 rounded-lg bg-muted/50 p-3">
              <p className="text-xs font-medium text-foreground">
                Webhook en tu app de Meta
              </p>
              <p className="text-xs text-muted-foreground">
                Callback URL y Verify Token para el canal {network}:
              </p>
              <Field label="Callback URL" value={webhookUrl} />
              <Field
                label="Verify Token"
                value={String(row?.config?.verify_token ?? verifyToken)}
              />
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setMode('connect')}
                className="border-border text-muted-foreground"
              >
                Reconectar
              </Button>
              <Button variant="outline" onClick={test} disabled={testing}>
                {testing && <Loader2 className="h-4 w-4 animate-spin" />}
                Probar
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

        {mode === 'choose' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Autorizaste varias cuentas. Elige cuál quieres conectar a {network}:
            </p>
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {pending.map((p) => (
                <button
                  key={p.page_id}
                  type="button"
                  onClick={() => selectAccount(p.page_id)}
                  disabled={selectingId !== null}
                  className="flex w-full items-center gap-3 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:border-primary/40 hover:bg-muted/40 disabled:opacity-60"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {p.name || p.page_id}
                    </p>
                    {p.username && (
                      <p className="truncate text-xs text-muted-foreground">
                        @{p.username}
                      </p>
                    )}
                  </div>
                  {selectingId === p.page_id ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                </button>
              ))}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setPending([]);
                  setMode('connect');
                }}
                className="border-border text-muted-foreground"
              >
                <ArrowLeft className="h-4 w-4" />
                Atrás
              </Button>
            </DialogFooter>
          </div>
        )}

        {mode === 'connect' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Conecta {network} con tu cuenta de Facebook. Te llevamos a Meta para
              autorizar el acceso a tu página; al volver quedará conectado aquí.
            </p>

            {!oauthReady && (
              <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <span>
                  Falta configurar la app de Meta en el servidor
                  (NEXT_PUBLIC_META_APP_ID y META_APP_SECRET). Mientras tanto puedes
                  conectar manualmente con un token de página.
                </span>
              </div>
            )}

            <div className="space-y-2 rounded-lg bg-muted/50 p-3">
              <p className="text-xs font-medium text-foreground">
                URI de redirección para tu app de Meta
              </p>
              <p className="text-xs text-muted-foreground">
                Añádela en Facebook Login → Configuración → URIs de redirección válidos:
              </p>
              <Field label="Redirect URI" value={redirectUri} />
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setMode('manual')}
                className="border-border text-muted-foreground"
              >
                Conectar manualmente
              </Button>
              <Button onClick={startOAuth} disabled={!oauthReady}>
                <MessageCircle className="h-4 w-4" />
                Continuar con Facebook
              </Button>
            </DialogFooter>
          </div>
        )}

        {mode === 'manual' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {network} también admite credenciales de Meta (no usa QR). Necesitas una
              app en{' '}
              <strong className="text-foreground">developers.facebook.com</strong> con
              el producto de mensajería y un token de página.
            </p>

            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">Page ID</label>
                <Input
                  value={pageId}
                  onChange={(e) => setPageId(e.target.value)}
                  placeholder="1234567890123456"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">
                  Token de acceso {hasToken && '(guardado)'}
                </label>
                <Input
                  type="password"
                  value={accessToken}
                  onChange={(e) => setAccessToken(e.target.value)}
                  placeholder={hasToken ? '•••••••• (sin cambios)' : 'EAAG…'}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">
                  App Secret {hasSecret && '(guardado)'}
                </label>
                <Input
                  type="password"
                  value={appSecret}
                  onChange={(e) => setAppSecret(e.target.value)}
                  placeholder={
                    hasSecret ? '•••••••• (sin cambios)' : 'App Secret de tu app de Meta'
                  }
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">
                  Verify Token (para el webhook)
                </label>
                <Input
                  value={verifyToken}
                  onChange={(e) => setVerifyToken(e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <span>
                Los secretos se guardan cifrados y nunca se devuelven. Al conectar se
                validará el token contra Meta; después deberás apuntar el webhook de tu
                app a la URL que aparecerá aquí (con el mismo Verify Token).
              </span>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setMode('connect')}
                className="border-border text-muted-foreground"
              >
                <ArrowLeft className="h-4 w-4" />
                Atrás
              </Button>
              <Button onClick={connect} disabled={busy || !canSubmit}>
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Link2 className="h-4 w-4" />
                )}
                Probar y conectar
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---- TikTok (OAuth / Login Kit) --------------------------------

function TikTokConnectDialog({
  open,
  onOpenChange,
  row,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: SerializedChannel | null;
  onChanged: () => void;
}) {
  const meta = channelMeta('tiktok');
  const connected = Boolean(row?.is_active);
  const oauthReady = Boolean(process.env.NEXT_PUBLIC_TIKTOK_CLIENT_KEY);
  const [busy, setBusy] = useState(false);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const redirectUri = `${origin}/api/channels/tiktok/oauth/callback`;

  function startOAuth() {
    if (!oauthReady) {
      toast.error('Falta configurar la app de TikTok (NEXT_PUBLIC_TIKTOK_CLIENT_KEY).');
      return;
    }
    window.location.href = '/api/channels/tiktok/oauth/start';
  }

  async function disconnect() {
    setBusy(true);
    try {
      const res = await fetch('/api/channels/tiktok', { method: 'DELETE' });
      if (!res.ok) throw new Error('No se pudo desconectar');
      toast.success('TikTok desconectado');
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-lg ${meta.tint}`}
            >
              <ChannelIcon meta={meta} size={20} />
            </div>
            <div>
              <DialogTitle>
                {connected ? 'TikTok conectado' : 'Conectar TikTok'}
              </DialogTitle>
              <DialogDescription>TikTok Login Kit</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {connected ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-lg bg-emerald-400/10 p-3 text-sm">
              <Check className="h-4 w-4 text-emerald-400" />
              <span className="text-foreground">
                {String(
                  row?.config?.display_name ||
                    row?.config?.username ||
                    'Cuenta de TikTok',
                )}{' '}
                conectada.
              </span>
            </div>

            <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <span>
                La cuenta está conectada (Login Kit). Leer y enviar mensajes
                (Business Messaging API) requiere acceso de partner aprobado
                por TikTok; hasta entonces la mensajería permanece
                deshabilitada en el CRM.
              </span>
            </div>

            <div className="space-y-2 rounded-lg bg-muted/50 p-3">
              <p className="text-xs font-medium text-foreground">
                Webhook de mensajes (para cuando tengas acceso de partner)
              </p>
              <p className="text-xs text-muted-foreground">
                Regístrala en TikTok API for Business → Webhooks:
              </p>
              <Field
                label="Webhook URL"
                value={`${origin}/api/webhooks/tiktok/${row?.id ?? ''}`}
              />
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={startOAuth}
                className="border-border text-muted-foreground"
              >
                Reconectar
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
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Inicia sesión en tu Cuenta de empresa de TikTok para autorizar el acceso.
              Para poder conectarte, tu cuenta de empresa debe estar registrada fuera
              de Europa, el Reino Unido o Suiza.
            </p>

            <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <span>
                Si estás usando una cuenta personal de TikTok, cámbiala a cuenta de
                empresa en la app (Cuenta → Cambiar a cuenta de empresa). Leer y
                enviar mensajes (Business Messaging API) requiere además acceso
                aprobado por TikTok.
              </span>
            </div>

            {!oauthReady && (
              <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <span>
                  Falta configurar la app de TikTok en el servidor
                  (NEXT_PUBLIC_TIKTOK_CLIENT_KEY y TIKTOK_CLIENT_SECRET).
                </span>
              </div>
            )}

            <div className="space-y-2 rounded-lg bg-muted/50 p-3">
              <p className="text-xs font-medium text-foreground">
                URI de redirección para tu app de TikTok
              </p>
              <p className="text-xs text-muted-foreground">
                Añádela en TikTok for Developers → tu app → Login Kit → Redirect URI:
              </p>
              <Field label="Redirect URI" value={redirectUri} />
            </div>

            <DialogFooter>
              <Button onClick={startOAuth} disabled={!oauthReady}>
                <ExternalLink className="h-4 w-4" />
                Continuar con TikTok
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---- WhatsApp (asistente estilo Kommo) -------------------------

type WAStep = 'intro' | 'method' | 'evolution' | 'facebook' | 'buy' | 'connected';
type EvolutionMode = 'form' | 'qr';

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
  const [step, setStep] = useState<WAStep>('intro');
  const [evolutionMode, setEvolutionMode] = useState<EvolutionMode>('form');

  // Evolution API (QR / Baileys)
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [qr, setQr] = useState<string | null>(null);
  const [instance, setInstance] = useState('');
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // WhatsApp Business API (Embedded Signup de Meta)
  const metaAppId = process.env.NEXT_PUBLIC_META_APP_ID ?? '';
  const metaConfigId = process.env.NEXT_PUBLIC_META_CONFIG_ID ?? '';
  const [verifyToken, setVerifyToken] = useState('');
  const [cloudPhoneNumberId, setCloudPhoneNumberId] = useState<string | null>(null);
  const [cloudVerifyToken, setCloudVerifyToken] = useState('');
  const [signingUp, setSigningUp] = useState(false);

  const evolutionConnected = Boolean(evolutionRow?.is_active);
  const cloudConnected = cloudPhoneNumberId !== null;
  const metaReady = Boolean(metaAppId && metaConfigId);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setWaiting(false);
  }, []);

  const startPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    setWaiting(true);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch('/api/channels/evolution/status', { method: 'POST' });
        const json = await res.json();
        if (json.connected) {
          stopPolling();
          setStep('connected');
          toast.success('WhatsApp conectado');
          onChanged();
        }
      } catch {
        // Sigue sondeando.
      }
    }, 3000);
  }, [stopPolling, onChanged]);

  useEffect(() => {
    if (!open) return;
    stopPolling();
    setQr(null);
    setApiKey('');
    setEvolutionMode('form');
    setBaseUrl(
      typeof evolutionRow?.config?.base_url === 'string' ? evolutionRow.config.base_url : '',
    );
    setInstance(
      typeof evolutionRow?.config?.instance === 'string' ? evolutionRow.config.instance : '',
    );
    setVerifyToken(randomVerifyToken());
    setCloudPhoneNumberId(null);
    setCloudVerifyToken('');
    setSigningUp(false);

    if (evolutionRow?.is_active) {
      setStep('connected');
      return;
    }

    setStep('intro');
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/whatsapp/config?lazy=1');
        const json = await res.json();
        if (!cancelled && json?.connected) {
          setCloudPhoneNumberId(
            typeof json.phone_number_id === 'string' ? json.phone_number_id : '',
          );
          setStep('connected');
        }
      } catch {
        // La rejilla se muestra igual; el asistente queda disponible.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, evolutionRow, stopPolling]);

  useEffect(() => () => stopPolling(), [stopPolling]);

  // Precarga el SDK de Facebook al entrar al paso de Meta, para que el
  // popup de "Continuar con Facebook" no lo bloquee el navegador.
  useEffect(() => {
    if (open && step === 'facebook' && metaReady) {
      void preloadMetaSdk(metaAppId);
    }
  }, [open, step, metaReady, metaAppId]);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const webhookUrl = `${origin}/api/whatsapp/webhook`;
  const evolutionWebhookUrl = evolutionRow
    ? `${origin}/api/webhooks/evolution/${evolutionRow.id}`
    : '';

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
      setEvolutionMode('qr');
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

  async function connectWithFacebook() {
    if (!metaReady) {
      toast.error(
        'Falta configurar la app de Meta (NEXT_PUBLIC_META_APP_ID y NEXT_PUBLIC_META_CONFIG_ID).',
      );
      return;
    }
    setSigningUp(true);
    try {
      const result = await launchEmbeddedSignup({
        appId: metaAppId,
        configId: metaConfigId,
      });
      if (!result.wabaId || !result.phoneNumberId) {
        throw new Error('Meta no devolvió la cuenta de WhatsApp. Inténtalo de nuevo.');
      }
      const res = await fetch('/api/whatsapp/embedded-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: result.code,
          waba_id: result.wabaId,
          phone_number_id: result.phoneNumberId,
          verify_token: verifyToken,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'No se pudo conectar con Meta');
      setCloudPhoneNumberId(result.phoneNumberId);
      setCloudVerifyToken(
        typeof json.verify_token === 'string' ? json.verify_token : verifyToken,
      );
      setStep('connected');
      toast.success(
        `WhatsApp conectado${
          json.phone_info?.display_phone_number
            ? `: ${json.phone_info.display_phone_number}`
            : ''
        }`,
      );
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo conectar');
    } finally {
      setSigningUp(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      if (cloudConnected) {
        const res = await fetch('/api/whatsapp/config', { method: 'DELETE' });
        if (!res.ok) throw new Error('No se pudo desconectar');
        setCloudPhoneNumberId(null);
        setCloudVerifyToken('');
        toast.success('WhatsApp desconectado');
        onChanged();
        setStep('intro');
      } else {
        const res = await fetch('/api/channels/evolution/disconnect', { method: 'POST' });
        if (!res.ok) throw new Error('No se pudo desconectar');
        stopPolling();
        toast.success('WhatsApp desconectado');
        onChanged();
        setStep('intro');
      }
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
              <ChannelIcon meta={channelMeta('whatsapp')} size={20} />
            </div>
            <div>
              <DialogTitle>
                {step === 'connected' ? 'WhatsApp conectado' : 'Conectar número'}
              </DialogTitle>
              <DialogDescription>Conecta WhatsApp a tu cuenta.</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {step === 'intro' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Vincula tu WhatsApp existente o comienza con un nuevo número de teléfono.
              Si aún no tienes un número, puedes comprar uno.
            </p>
            <div className="space-y-2">
              <Button className="w-full justify-start" onClick={() => setStep('method')}>
                <Link2 className="h-4 w-4" />
                Vincular mi WhatsApp existente
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start border-border text-muted-foreground"
                onClick={() => setStep('buy')}
              >
                <MessageCircle className="h-4 w-4" />
                Comprar un número nuevo
              </Button>
            </div>
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => onOpenChange(false)}
                className="text-muted-foreground"
              >
                Cancelar
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 'method' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              ¿Qué WhatsApp estás utilizando? Conecta tu aplicación de WhatsApp para
              seguir usándola en tu teléfono, o usa la conexión oficial de WhatsApp
              Business API.
            </p>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setStep('evolution')}
                className="flex w-full items-start gap-3 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:border-emerald-400/40 hover:bg-muted/40"
              >
                <QrCode className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
                <div>
                  <p className="text-sm font-medium text-foreground">
                    WhatsApp / WhatsApp Business (app)
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Escanea un código QR desde tu teléfono y sincroniza los chats.
                  </p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setStep('facebook')}
                className="flex w-full items-start gap-3 rounded-xl border border-border bg-card p-3 text-left transition-colors hover:border-[#1877F2]/40 hover:bg-muted/40"
              >
                <MessageCircle className="mt-0.5 h-5 w-5 shrink-0 text-[#1877F2]" />
                <div>
                  <p className="text-sm font-medium text-foreground">
                    WhatsApp Business API (oficial)
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Conexión oficial con Meta. Continuar con Facebook.
                  </p>
                </div>
              </button>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setStep('intro')}
                className="border-border text-muted-foreground"
              >
                <ArrowLeft className="h-4 w-4" />
                Atrás
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 'buy' && (
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <span>
                Comprar un número desde el CRM todavía no está disponible. Por ahora
                puedes vincular un número que ya tengas, ya sea la app de WhatsApp o la
                API oficial de WhatsApp Business.
              </span>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setStep('intro')}
                className="border-border text-muted-foreground"
              >
                <ArrowLeft className="h-4 w-4" />
                Atrás
              </Button>
              <Button onClick={() => setStep('method')}>Vincular un número</Button>
            </DialogFooter>
          </div>
        )}

        {step === 'evolution' && evolutionMode === 'form' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Introduce la URL base y la API key global de tu servidor
              <strong className="text-foreground"> Evolution API</strong>. Crearemos la
              instancia y te mostraremos el QR automáticamente.
            </p>
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">Base URL</label>
                <Input
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://evolution.tudominio.com"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground">
                  API key global
                </label>
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="API key de Evolution API"
                />
              </div>
            </div>
            <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <span>
                La API key se guarda cifrada. Si aún no tienes un servidor Evolution
                API, puedes desplegarlo con Docker (
                <code className="text-foreground">atendai/evolution-api</code>).
              </span>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setStep('method')}
                className="border-border text-muted-foreground"
              >
                <ArrowLeft className="h-4 w-4" />
                Atrás
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

        {step === 'evolution' && evolutionMode === 'qr' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Abre WhatsApp en tu teléfono →{' '}
              <strong className="text-foreground">Dispositivos vinculados</strong> →{' '}
              <strong className="text-foreground">Vincular un dispositivo</strong> y
              escanea este código:
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
                  setStep('method');
                }}
                className="border-border text-muted-foreground"
              >
                <ArrowLeft className="h-4 w-4" />
                Atrás
              </Button>
              <Button variant="outline" onClick={refreshQr} disabled={busy}>
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <QrCode className="h-4 w-4" />
                )}
                Refrescar QR
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 'facebook' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Te redirigiremos a Facebook para vincular tu cuenta de WhatsApp Business.
              Elige tu cuenta y tu número: el proceso puede tardar unos minutos.
              Asegúrate de que tu número esté activo y accesible durante la
              configuración.
            </p>

            {!metaReady && (
              <div className="flex items-start gap-2 rounded-lg bg-amber-400/10 p-3 text-xs text-amber-200">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <span>
                  Falta configurar la app de Meta: define{' '}
                  <code className="text-foreground">NEXT_PUBLIC_META_APP_ID</code> y{' '}
                  <code className="text-foreground">NEXT_PUBLIC_META_CONFIG_ID</code> y
                  vuelve a desplegar.
                </span>
              </div>
            )}

            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">
                Verify Token (para el webhook)
              </label>
              <Input
                value={verifyToken}
                onChange={(e) => setVerifyToken(e.target.value)}
              />
            </div>

            <div className="rounded-lg bg-muted/50 p-3">
              <p className="text-xs font-medium text-foreground">Webhook de Meta</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Cuando conectes, en tu app de Meta → Webhooks usa esta URL con el
                Verify Token de arriba:
              </p>
              <div className="mt-2">
                <Field label="Callback URL" value={webhookUrl} />
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setStep('method')}
                className="border-border text-muted-foreground"
              >
                <ArrowLeft className="h-4 w-4" />
                Atrás
              </Button>
              <Button
                onClick={connectWithFacebook}
                disabled={signingUp || !metaReady}
              >
                {signingUp ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <MessageCircle className="h-4 w-4" />
                )}
                Continuar con Facebook
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 'connected' && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-lg bg-emerald-400/10 p-3 text-sm">
              <Check className="h-4 w-4 text-emerald-400" />
              <span className="text-foreground">
                WhatsApp conectado y activo
                {cloudConnected && !evolutionConnected ? ' (API oficial)' : ''}.
              </span>
            </div>

            <div className="space-y-1 text-xs text-muted-foreground">
              {evolutionConnected ? (
                <>
                  <p>
                    Instancia: <code className="text-foreground">{instance || '—'}</code>
                  </p>
                  <p>
                    Base URL: <code className="text-foreground">{baseUrl || '—'}</code>
                  </p>
                </>
              ) : (
                <p>
                  Número (phone_number_id):{' '}
                  <code className="text-foreground">{cloudPhoneNumberId || '—'}</code>
                </p>
              )}
            </div>

            {cloudConnected && (
              <div className="space-y-2 rounded-lg bg-muted/50 p-3">
                <p className="text-xs font-medium text-foreground">Webhook de Meta</p>
                <Field label="Callback URL" value={webhookUrl} />
                {(cloudVerifyToken || verifyToken) && (
                  <Field
                    label="Verify Token"
                    value={cloudVerifyToken || verifyToken}
                  />
                )}
              </div>
            )}

            {evolutionConnected && evolutionWebhookUrl && (
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">Webhook de ingesta:</p>
                <div className="mt-2">
                  <Field label="URL" value={evolutionWebhookUrl} />
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
      </DialogContent>
    </Dialog>
  );
}
