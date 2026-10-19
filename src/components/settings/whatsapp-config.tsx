'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Eye,
  EyeOff,
  Copy,
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
  Zap,
  AlertTriangle,
  RotateCcw,
  Plus,
  Star,
  Trash2,
  Pencil,
  Phone,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { SettingsPanelHead } from './settings-panel-head';
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion';
import type { WhatsAppConfig as WhatsAppConfigType } from '@/types';

const MASKED_TOKEN = '••••••••••••••••';

// Sentinel for "the form is adding a new line" (no row selected yet).
const NEW_LINE = 'new';

type ConnectionStatus = 'connected' | 'disconnected' | 'unknown';
type ResetReason = 'token_corrupted' | 'meta_api_error' | null;

/** One row of `GET /api/whatsapp/config?list=1` (never carries tokens). */
interface WhatsappLine {
  id: string;
  label: string | null;
  phone_number_id: string;
  waba_id: string | null;
  status: string;
  is_default: boolean;
  registered_at: string | null;
  last_registration_error: string | null;
}

/** Which line `fetchConfig` should open after (re)loading the list. */
interface LineTarget {
  id?: string | null;
  phone?: string | null;
  isNew?: boolean;
}

export function WhatsAppConfig() {
  const supabase = createClient();
  // After multi-user, whatsapp_config is one-row-per-account, not
  // one-row-per-user. We pull `accountId` straight off the auth
  // context and key every read off it — so a teammate who just
  // joined an account sees the inviter's saved config without
  // having to re-enter anything.
  const { user, accountId, loading: authLoading, profileLoading } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [config, setConfig] = useState<WhatsAppConfigType | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('unknown');
  const [resetReason, setResetReason] = useState<ResetReason>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');
  // Guards against re-hydrating the form when the load effect below
  // re-runs for reasons unrelated to actually switching accounts —
  // e.g. Supabase's onAuthStateChange fires a token refresh (new
  // `user` object, profileLoading flips true/false) when the browser
  // tab regains focus. Without this, that churn calls fetchConfig()
  // again and overwrites whatever the user typed but hadn't saved yet.
  const loadedAccountIdRef = useRef<string | null>(null);

  // Several lines per business (067). The form below edits ONE of
  // them: `selectedId` (a row id) or NEW_LINE while adding a number.
  const [lines, setLines] = useState<WhatsappLine[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lineAction, setLineAction] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const isNewLine = selectedId === NEW_LINE;

  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [pin, setPin] = useState('');
  const [tokenEdited, setTokenEdited] = useState(false);

  // True once /register has succeeded on Meta's side (timestamp set
  // in the row). When false, the saved config is metadata-only and
  // Meta will silently drop every inbound event — that's the
  // multi-number bug that prompted this work.
  const isRegistered = Boolean(config?.registered_at);
  const lastRegistrationError = config?.last_registration_error ?? null;

  const [verifyingRegistration, setVerifyingRegistration] = useState(false);
  type RegistrationProbe = {
    live: boolean;
    checks: Record<string, boolean | null>;
    errors?: string[];
    last_registration_error?: string | null;
    registered_at?: string | null;
    subscribed_apps_at?: string | null;
  };
  const [registrationProbe, setRegistrationProbe] =
    useState<RegistrationProbe | null>(null);

  const webhookUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/whatsapp/webhook`
      : '';

  const fetchConfig = useCallback(async (acctId: string, want: LineTarget = {}) => {
    setLoading(true);
    try {
      // 1) Every line of the business (no tokens), default first.
      let list: WhatsappLine[] = [];
      try {
        const res = await fetch('/api/whatsapp/config?list=1', { cache: 'no-store' });
        if (res.ok) {
          const payload = (await res.json()) as { lines?: WhatsappLine[] };
          list = payload.lines ?? [];
        }
      } catch (err) {
        console.error('Failed to list WhatsApp lines:', err);
      }
      setLines(list);

      // 2) Which one the form edits. No lines at all = adding the first.
      const target = want.isNew
        ? null
        : (want.id ? list.find((l) => l.id === want.id) : undefined) ??
          (want.phone ? list.find((l) => l.phone_number_id === want.phone) : undefined) ??
          list.find((l) => l.is_default) ??
          list[0] ??
          null;
      setSelectedId(target ? target.id : NEW_LINE);

      // 3) Full row for the form (registration timestamps etc.), keyed on
      // id AND account so a stale id can't load another business's row.
      let data: WhatsAppConfigType | null = null;
      if (target) {
        const { data: row, error } = await supabase
          .from('whatsapp_config')
          .select('*')
          .eq('id', target.id)
          .eq('account_id', acctId)
          .maybeSingle();
        if (error) console.error('Failed to load config row:', error);
        data = (row as WhatsAppConfigType | null) ?? null;
      }

      if (data) {
        setConfig(data);
        setLabel(target?.label ?? '');
        setPhoneNumberId(data.phone_number_id || '');
        setWabaId(data.waba_id || '');
        setAccessToken(MASKED_TOKEN);
        setVerifyToken('');
        setPin('');
        setTokenEdited(false);
      } else {
        setConfig(null);
        setLabel('');
        setPhoneNumberId('');
        setWabaId('');
        setAccessToken('');
        setVerifyToken('');
        setPin('');
        setTokenEdited(false);
      }
      // Clear any stale probe result when reloading the row.
      setRegistrationProbe(null);

      // Then verify health via the API (decrypts token + pings Meta)
      if (data) {
        try {
          const res = await fetch(
            `/api/whatsapp/config?config_id=${encodeURIComponent(data.id)}`,
            { method: 'GET' },
          );
          const payload = await res.json();

          if (payload.connected) {
            setConnectionStatus('connected');
            setResetReason(null);
            setStatusMessage('');
          } else {
            setConnectionStatus('disconnected');
            setResetReason(payload.needs_reset ? 'token_corrupted' : payload.reason === 'meta_api_error' ? 'meta_api_error' : null);
            setStatusMessage(payload.message || '');
          }
        } catch (err) {
          console.error('Health check failed:', err);
          setConnectionStatus('disconnected');
        }
      } else {
        setConnectionStatus('disconnected');
        setResetReason(null);
        setStatusMessage('');
      }
    } catch (err) {
      console.error('fetchConfig error:', err);
      toast.error('Error al cargar la configuración de WhatsApp');
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    // Need both the auth session (`!authLoading`) AND the profile
    // (`!profileLoading`, which carries `accountId`). Without the
    // second guard, the effect would fire with `accountId === null`
    // for the first render window and bail without ever retrying
    // once the profile arrives.
    if (authLoading || profileLoading) return;
    if (!user || !accountId) {
      loadedAccountIdRef.current = null;
      setLoading(false);
      return;
    }
    if (loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    fetchConfig(accountId);
  }, [authLoading, profileLoading, user?.id, accountId, fetchConfig]);

  async function handleSave() {
    if (!phoneNumberId.trim()) {
      toast.error('ID del Número de Teléfono is required');
      return;
    }
    if (!config && (!accessToken.trim() || !tokenEdited)) {
      toast.error('El Token de Acceso es obligatorio para la configuración inicial');
      return;
    }

    try {
      setSaving(true);

      // Always POST through the API — it verifies with Meta and encrypts
      // the access_token server-side with ENCRYPTION_KEY. Skipping this
      // and writing direct to Supabase stores the token in plaintext,
      // which then fails decryption on every subsequent health check.
      const payload: Record<string, unknown> = {
        phone_number_id: phoneNumberId.trim(),
        waba_id: wabaId.trim() || null,
        verify_token: verifyToken.trim() || null,
        // Optional — only sent when the user filled it in. The server
        // requires it on first save or when changing numbers; for a
        // simple token rotation, leaving it blank skips re-register.
        pin: pin.trim() || null,
        label: label.trim() || null,
      };
      // 067: say which line this is. Without either field the server
      // would fall back to "the default line" (legacy single-line form).
      if (isNewLine || !config) payload.mode = 'add';
      else payload.config_id = config.id;

      if (tokenEdited && accessToken !== MASKED_TOKEN && accessToken.trim()) {
        payload.access_token = accessToken.trim();
      } else if (config) {
        // Renaming alone doesn't touch Meta, so it doesn't need the
        // token: save just the label (PATCH) and stop there.
        const onlyLabelChanged =
          phoneNumberId.trim() === config.phone_number_id &&
          (wabaId.trim() || null) === (config.waba_id || null) &&
          !pin.trim() &&
          !verifyToken.trim() &&
          label.trim() !== (config.label ?? '');
        if (onlyLabelChanged) {
          const res = await fetch('/api/whatsapp/config', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ config_id: config.id, label: label.trim() }),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            toast.error(data.error || 'No se pudo renombrar el número');
          } else {
            toast.success('Nombre del número actualizado');
            if (accountId) await fetchConfig(accountId, { id: config.id });
          }
          setSaving(false);
          return;
        }
        // Existing config — reuse stored encrypted token by decrypting on the
        // server. But our POST handler requires an access_token to verify
        // with Meta. If the user didn't change the token, we need to signal
        // that. Simplest: require token re-entry if they're updating.
        toast.error('Por favor, vuelve a ingresar el Token de Acceso para guardar los cambios');
        setSaving(false);
        return;
      }

      const res = await fetch('/api/whatsapp/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || 'Error al guardar la configuración');
        setSaving(false);
        return;
      }

      // The route now returns a structured outcome:
      //   * registered=true   → number is live, events will flow
      //   * registered=false  → credentials saved but /register
      //                         failed; UI shows the specific error
      //                         and a retry path. registration_error
      //                         is human-readable from Meta.
      if (data.registered === false && data.registration_error) {
        toast.error(
          `Guardado, pero Meta no pudo't register the number: ${data.registration_error}`,
          { duration: 12000 },
        );
      } else if (data.registration_skipped) {
        // Credentials saved + verified, but /register was skipped
        // because no PIN was supplied (e.g. a Meta test number).
        // Don't claim the number is "Live" — point at the
        // Registration status banner instead.
        toast.success(
          'Credentials saved and verified. Inbound registration was skipped (no PIN) — see Registration status below.',
          { duration: 10000 },
        );
        setPin('');
      } else {
        toast.success(
          data.phone_info?.verified_name
            ? `Live — ${data.phone_info.verified_name} ahora puede recibir eventos.`
            : 'WhatsApp conectado. Los eventos comenzar\u00e1n a llegar en un minuto.',
        );
        // Clear the PIN so subsequent saves don't accidentally
        // re-register (which would void the active subscription if
        // the PIN became stale).
        setPin('');
      }

      // Reopen the line just saved (a new one is found by its number).
      if (accountId) {
        await fetchConfig(accountId, {
          id: config?.id ?? null,
          phone: phoneNumberId.trim(),
        });
      }
    } catch (err) {
      console.error('Save error:', err);
      toast.error('Error al guardar la configuración');
    } finally {
      setSaving(false);
    }
  }

  async function handleTestConnection() {
    try {
      setTesting(true);
      const res = await fetch(
        config
          ? `/api/whatsapp/config?config_id=${encodeURIComponent(config.id)}`
          : '/api/whatsapp/config',
        { method: 'GET' },
      );
      const payload = await res.json();

      if (payload.connected) {
        setConnectionStatus('connected');
        setResetReason(null);
        setStatusMessage('');
        toast.success(
          payload.phone_info?.verified_name
            ? `Conectado a ${payload.phone_info.verified_name}`
            : 'Conexión de API exitosa'
        );
      } else {
        setConnectionStatus('disconnected');
        setResetReason(payload.needs_reset ? 'token_corrupted' : payload.reason === 'meta_api_error' ? 'meta_api_error' : null);
        setStatusMessage(payload.message || '');
        toast.error(payload.message || 'Conexión de API fallida');
      }
    } catch (err) {
      console.error('Test connection error:', err);
      setConnectionStatus('disconnected');
      toast.error('La prueba de conexión falló. Revisa la red e inténtalo de nuevo.');
    } finally {
      setTesting(false);
    }
  }

  async function handleVerifyRegistration() {
    setVerifyingRegistration(true);
    setRegistrationProbe(null);
    try {
      const res = await fetch(
        config
          ? `/api/whatsapp/config/verify-registration?config_id=${encodeURIComponent(config.id)}`
          : '/api/whatsapp/config/verify-registration',
        { method: 'GET' },
      );
      const data = (await res.json()) as RegistrationProbe;
      if (data.live) {
        toast.success('Number is fully wired — Meta is delivering events.');
      } else {
        toast.error(
          'El número no est\u00e1 completamente registrado. Revisa las verificaciones abajo para ver qué paso falló.',
          { duration: 8000 },
        );
      }
      // Reload keeps the same line open; the probe is set AFTER the
      // reload because fetchConfig clears it.
      if (accountId) await fetchConfig(accountId, { id: config?.id ?? null });
      setRegistrationProbe(data);
    } catch (err) {
      console.error('verify-registration failed:', err);
      toast.error('No se pudo alcanzar el endpoint de verificación.');
    } finally {
      setVerifyingRegistration(false);
    }
  }

  function lineName(line: Pick<WhatsappLine, 'label' | 'phone_number_id'>) {
    return line.label?.trim() || `Número ${line.phone_number_id}`;
  }

  async function handleReset() {
    if (!config) return;
    if (!confirm('Esto eliminar\u00e1 la configuración de este número para que puedas volver a ingresarla. \u00bfContinuar?')) {
      return;
    }

    try {
      setResetting(true);
      const res = await fetch(
        `/api/whatsapp/config?config_id=${encodeURIComponent(config.id)}`,
        { method: 'DELETE' },
      );
      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || 'Error al reiniciar la configuración');
        return;
      }

      toast.success('Configuración eliminada. Ahora puedes volver a ingresar tus credenciales.');
      setConnectionStatus('disconnected');
      setResetReason(null);
      setStatusMessage('');
      // Reopen the same number empty so the credentials can be re-entered.
      if (accountId) await fetchConfig(accountId, { isNew: true });
      setPhoneNumberId(config.phone_number_id);
      setWabaId(config.waba_id ?? '');
      setLabel(config.label ?? '');
    } catch (err) {
      console.error('Reset error:', err);
      toast.error('Error al reiniciar la configuración');
    } finally {
      setResetting(false);
    }
  }

  function handleSelectLine(id: string) {
    if (!accountId || id === selectedId) return;
    void fetchConfig(accountId, { id });
  }

  function handleAddLine() {
    if (!accountId) return;
    void fetchConfig(accountId, { isNew: true });
  }

  async function handleMakeDefault(line: WhatsappLine) {
    setLineAction(line.id);
    try {
      const res = await fetch('/api/whatsapp/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config_id: line.id, is_default: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'No se pudo marcar como número por defecto');
        return;
      }
      toast.success(`${lineName(line)} es ahora el número por defecto`);
      if (accountId) await fetchConfig(accountId, { id: selectedId === NEW_LINE ? null : selectedId });
    } catch (err) {
      console.error('make-default error:', err);
      toast.error('No se pudo conectar con el servidor');
    } finally {
      setLineAction(null);
    }
  }

  async function handleRemoveLine(line: WhatsappLine) {
    const warning = line.is_default && lines.length > 1
      ? ' Es el número por defecto: otro pasará a serlo.'
      : '';
    if (!confirm(`¿Desconectar ${lineName(line)}? Las conversaciones que entraron por él se responderán desde el número por defecto.${warning}`)) {
      return;
    }
    setLineAction(line.id);
    try {
      const res = await fetch(
        `/api/whatsapp/config?config_id=${encodeURIComponent(line.id)}`,
        { method: 'DELETE' },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'No se pudo desconectar el número');
        return;
      }
      toast.success(`${lineName(line)} desconectado`);
      if (accountId) {
        await fetchConfig(accountId, {
          id: line.id === selectedId ? null : selectedId,
        });
      }
    } catch (err) {
      console.error('remove-line error:', err);
      toast.error('No se pudo conectar con el servidor');
    } finally {
      setLineAction(null);
    }
  }

  function handleCopyWebhookUrl() {
    navigator.clipboard.writeText(webhookUrl);
    toast.success('URL del Webhook copiada al portapapeles');
  }

  if (loading) {
    return (
      <section className="animate-in fade-in-50 duration-200">
        <SettingsPanelHead
          title="Conexión WhatsApp"
          description="Conecta tu API de Meta WhatsApp Business. Credenciales, webhook y configuración."
        />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      </section>
    );
  }

  const showResetBanner = resetReason === 'token_corrupted';

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="Conexión WhatsApp"
        description="Conecta tu API de Meta WhatsApp Business. Credenciales, webhook y pasos de configuración."
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      {/* Main config form */}
      <div className="space-y-6">
        {/* Lines of this business (067). The form below edits the one
            selected here, or a new one after "Añadir número". */}
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
            <div className="space-y-1.5">
              <CardTitle className="text-foreground">Números de WhatsApp</CardTitle>
              <CardDescription className="text-muted-foreground">
                Cada conversación se responde desde el número por el que
                escribió el cliente. El número por defecto se usa para
                difusiones, la API y los chats que inicias tú.
              </CardDescription>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handleAddLine}
              disabled={isNewLine}
              className="shrink-0 border-border"
            >
              <Plus className="size-4" />
              Añadir número
            </Button>
          </CardHeader>
          <CardContent className="space-y-2">
            {lines.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Aún no hay números conectados. Completa el formulario de abajo
                para conectar el primero.
              </p>
            ) : (
              <ul className="space-y-2">
                {lines.map((line) => {
                  const selected = line.id === selectedId;
                  const busy = lineAction === line.id;
                  const live = line.status === 'connected';
                  return (
                    <li
                      key={line.id}
                      className={
                        'flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 ' +
                        (selected ? 'border-primary/60 bg-primary/5' : 'border-border')
                      }
                    >
                      <Phone className="size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-medium text-foreground" title={lineName(line)}>
                            {lineName(line)}
                          </span>
                          {line.is_default && (
                            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                              Por defecto
                            </span>
                          )}
                          <span
                            className={
                              'inline-flex items-center gap-1 text-xs ' +
                              (live ? 'text-emerald-400' : 'text-red-400')
                            }
                          >
                            {live ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />}
                            {live ? 'Conectado' : 'Desconectado'}
                          </span>
                        </div>
                        <p className="truncate text-xs text-muted-foreground">
                          ID {line.phone_number_id}
                          {line.waba_id ? ` · WABA ${line.waba_id}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        {busy ? (
                          <Loader2 className="size-4 animate-spin text-muted-foreground" />
                        ) : (
                          <>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleSelectLine(line.id)}
                              disabled={selected}
                              title="Editar este número"
                            >
                              <Pencil className="size-3.5" />
                              {selected ? 'Editando' : 'Editar'}
                            </Button>
                            {!line.is_default && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => void handleMakeDefault(line)}
                                title="Usar como número por defecto"
                              >
                                <Star className="size-3.5" />
                                Por defecto
                              </Button>
                            )}
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              onClick={() => void handleRemoveLine(line)}
                              title="Desconectar este número"
                              aria-label={`Desconectar ${lineName(line)}`}
                              className="text-red-400 hover:bg-red-950/40 hover:text-red-300"
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {isNewLine && lines.length > 0 && (
              <p className="text-xs text-primary">
                Añadiendo un número nuevo: completa las credenciales de abajo y
                pulsa Guardar.{' '}
                <button
                  type="button"
                  className="underline"
                  onClick={() => accountId && void fetchConfig(accountId)}
                >
                  Cancelar
                </button>
              </p>
            )}
          </CardContent>
        </Card>

        {/* Corrupted-token reset banner */}
        {showResetBanner && (
          <Alert className="bg-amber-950/40 border-amber-600/40">
            <div className="flex items-start gap-3">
              <AlertTriangle className="size-5 text-amber-400 mt-0.5 shrink-0" />
              <div className="flex-1">
                <AlertTitle className="text-amber-200 mb-1">
                  El token almacenado no se puede descifrar
                </AlertTitle>
                <AlertDescription className="text-amber-100/80 text-sm">
                  {statusMessage}
                </AlertDescription>
                <Button
                  onClick={handleReset}
                  disabled={resetting}
                  size="sm"
                  className="mt-3 bg-amber-600 hover:bg-amber-700 text-white"
                >
                  {resetting ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Reiniciando...
                    </>
                  ) : (
                    <>
                      <RotateCcw className="size-4" />
                      Restablecer configuración
                    </>
                  )}
                </Button>
              </div>
            </div>
          </Alert>
        )}

        {/* Connection Status */}
        <Alert className="bg-card border-border">
          <div className="flex items-center gap-2">
            {connectionStatus === 'connected' ? (
              <CheckCircle2 className="size-4 text-primary" />
            ) : (
              <XCircle className="size-4 text-red-500" />
            )}
            <AlertTitle className="text-foreground mb-0">
              {connectionStatus === 'connected' ? 'Credenciales válidas' : 'No conectado'}
            </AlertTitle>
          </div>
          <AlertDescription className="text-muted-foreground">
            {connectionStatus === 'connected'
              ? 'Tu token de acceso autentica con Meta. Revisa el estado de registro abajo para ver si los webhooks est\u00e1n conectados.'
              : statusMessage ||
                'Configura tus credenciales de la API de Meta abajo para conectar tu cuenta de WhatsApp Business.'}
          </AlertDescription>
        </Alert>

        {/* Registration Status — the "is it actually live?" check.
            Credentials being valid is necessary but not sufficient;
            without a successful /register call the number won't
            receive inbound events. Surface this dimension separately
            so users don't trust a misleading green banner. */}
        {config && (
          <Alert
            className={
              isRegistered
                ? 'bg-emerald-950/30 border-emerald-700/50'
                : 'bg-amber-950/30 border-amber-700/50'
            }
          >
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                {isRegistered ? (
                  <CheckCircle2 className="size-4 text-emerald-400" />
                ) : (
                  <AlertTriangle className="size-4 text-amber-400" />
                )}
                <AlertTitle
                  className={
                    'mb-0 ' + (isRegistered ? 'text-emerald-200' : 'text-amber-200')
                  }
                >
                  {isRegistered
                    ? 'Registrado — Meta entregará eventos a wacrm'
                    : 'No registrado — Meta no entregará eventos'}
                </AlertTitle>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleVerifyRegistration}
                disabled={verifyingRegistration}
                className="border-border bg-transparent text-foreground hover:bg-muted h-7"
              >
                {verifyingRegistration ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Zap className="size-3.5" />
                )}
                Verificar con Meta
              </Button>
            </div>
            <AlertDescription className="text-muted-foreground mt-2 text-xs leading-relaxed">
              {isRegistered ? (
                <>
                  Suscrito desde{' '}
                  {config.registered_at
                    ? new Date(config.registered_at).toLocaleString()
                    : 'unknown'}
                  . Haz clic en <strong>Verificar con Meta</strong> si los eventos
                  dejan de llegar.
                </>
              ) : lastRegistrationError ? (
                <>
                  Último intento falló con:{' '}
                  <span className="text-red-300">
                    &quot;{lastRegistrationError}&quot;
                  </span>
                  . Ingresa (o corrige) el PIN de 2 pasos abajo y haz clic en
                  Guardar Configuración para reintentar.
                </>
              ) : (
                <>
                  Este número se guardó antes de que existiera el seguimiento
                  de registro, o el registro fue omitido. Ingresa el
                  PIN de 2 pasos abajo y haz clic en Guardar Configuración
                  para suscribirlo.
                </>
              )}
            </AlertDescription>

            {registrationProbe && (
              <div className="mt-3 rounded border border-border bg-card/60 px-3 py-2 space-y-1.5 text-[11px]">
                <p className="font-medium text-foreground">
                  Diagnóstico — última ejecución: {' '}
                  <span className={registrationProbe.live ? 'text-emerald-400' : 'text-amber-400'}>
                    {registrationProbe.live ? 'en vivo' : 'sin conexión'}
                  </span>
                </p>
                <ul className="space-y-0.5 text-muted-foreground">
                  {Object.entries(registrationProbe.checks).map(([k, v]) => (
                    <li key={k} className="flex items-center gap-1.5">
                      {v === true ? (
                        <CheckCircle2 className="size-3 text-emerald-400 shrink-0" />
                      ) : v === false ? (
                        <XCircle className="size-3 text-red-400 shrink-0" />
                      ) : (
                        <span className="size-3 rounded-full border border-border shrink-0" />
                      )}
                      <code className="text-muted-foreground">{k}</code>
                    </li>
                  ))}
                </ul>
                {(registrationProbe.errors ?? []).length > 0 && (
                  <ul className="pt-1 space-y-0.5 text-red-300">
                    {registrationProbe.errors?.map((e, i) => (
                      <li key={i}>• {e}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Alert>
        )}

        {/* API Credentials */}
        <Card>
          <CardHeader>
            <CardTitle className="text-foreground">
              {isNewLine || !config
                ? 'Conectar un número nuevo'
                : `Credenciales de ${lineName({ label: config.label ?? null, phone_number_id: config.phone_number_id })}`}
            </CardTitle>
            <CardDescription className="text-muted-foreground">
              Ingresa tus credenciales de la API de Meta WhatsApp Business.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label className="text-muted-foreground" htmlFor="wa-line-label">
                Nombre del número
                <span className="ml-1 text-muted-foreground">(opcional)</span>
              </Label>
              <Input
                id="wa-line-label"
                placeholder="ej. Ventas, Soporte, Sucursal Centro"
                value={label}
                maxLength={60}
                onChange={(e) => setLabel(e.target.value)}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              />
              <p className="text-xs text-muted-foreground">
                Así lo verá tu equipo en la bandeja para saber por qué número
                escribió cada cliente.
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-muted-foreground">ID del Número de Teléfono</Label>
              <Input
                placeholder="ej. 100234567890123"
                value={phoneNumberId}
                onChange={(e) => setPhoneNumberId(e.target.value)}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-muted-foreground">ID de la Cuenta de WhatsApp Business</Label>
              <Input
                placeholder="ej. 100234567890456"
                value={wabaId}
                onChange={(e) => setWabaId(e.target.value)}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-muted-foreground">Token de Acceso Permanente</Label>
              <div className="relative">
                <Input
                  type={showToken ? 'text' : 'password'}
                  placeholder="Ingresa tu token de acceso"
                  value={accessToken}
                  onChange={(e) => {
                    setAccessToken(e.target.value);
                    setTokenEdited(true);
                  }}
                  onFocus={() => {
                    if (accessToken === MASKED_TOKEN) {
                      setAccessToken('');
                      setTokenEdited(true);
                    }
                  }}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              {config && !tokenEdited && (
                <p className="text-xs text-muted-foreground">
                  El token está oculto por seguridad. Vuelve a ingresarlo para actualizar la configuración.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-muted-foreground">Token de Verificación del Webhook</Label>
              <Input
                placeholder="Crea un token de verificación personalizado"
                value={verifyToken}
                onChange={(e) => setVerifyToken(e.target.value)}
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
              />
              <p className="text-xs text-muted-foreground">
                Un texto personalizado que creas. Debe coincidir con el token que configuras en los ajustes del webhook de Meta.
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-muted-foreground">
                PIN de verificación en dos pasos
                <span className="ml-1 text-muted-foreground">(optional)</span>
              </Label>
              <Input
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="PIN de 6 dígitos de Meta WhatsApp Manager"
                value={pin}
                onChange={(e) =>
                  setPin(e.target.value.replace(/\D/g, '').slice(0, 6))
                }
                className="bg-muted border-border text-foreground placeholder:text-muted-foreground tracking-widest"
              />
              <p className="text-xs text-muted-foreground leading-relaxed">
                Needed only to wire <strong className="text-muted-foreground">inbound</strong> messages
                for a <strong className="text-muted-foreground">production</strong> number. Set it in{' '}
                <strong className="text-muted-foreground">
                  Meta Business Manager → WhatsApp Accounts → Phone
                  Numbers → Two-step verification
                </strong>
                , then paste it here so wacrm can subscribe the number —
                otherwise Meta routes inbound events to whichever app
                last claimed it (the symptom that hits second numbers
                under a shared WABA).{' '}
                <strong className="text-muted-foreground">Meta test numbers</strong> have no
                PIN and are pre-registered — leave this blank for them.
                Leaving it blank also keeps an existing registration
                untouched.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Webhook URL */}
        <Card>
          <CardHeader>
            <CardTitle className="text-foreground">Configuración de Webhook</CardTitle>
            <CardDescription className="text-muted-foreground">
              Usa esta URL como callback del webhook en el Panel de la App de Meta.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label className="text-muted-foreground">URL de Callback del Webhook</Label>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={webhookUrl}
                  className="bg-muted border-border text-muted-foreground font-mono text-sm"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={handleCopyWebhookUrl}
                  className="shrink-0 border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                >
                  <Copy className="size-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-3">
          <Button
            onClick={handleSave}
            disabled={saving}
            className="bg-primary hover:bg-primary/90 text-primary-foreground"
          >
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Guardando...
              </>
            ) : (
              'Guardar configuración'
            )}
          </Button>
          <Button
            variant="outline"
            onClick={handleTestConnection}
            disabled={testing || !config}
            className="border-border text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            {testing ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Probando...
              </>
            ) : (
              <>
                <Zap className="size-4" />
                Probar Conexión de API
              </>
            )}
          </Button>
          {config && (
            <Button
              variant="outline"
              onClick={handleReset}
              disabled={resetting}
              className="border-red-900 text-red-400 hover:text-red-300 hover:bg-red-950/40"
            >
              {resetting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Reiniciando...
                </>
              ) : (
                <>
                  <RotateCcw className="size-4" />
                  Restablecer configuración
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Instrucciones de Configuración Sidebar */}
      <div>
        <Card>
          <CardHeader>
            <CardTitle className="text-foreground text-base">Instrucciones de Configuración</CardTitle>
            <CardDescription className="text-muted-foreground">
              Sigue estos pasos para conectar tu API de WhatsApp Business.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Accordion>
              <AccordionItem className="border-border">
                <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                  <span className="flex items-center gap-2">
                    <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">1</span>
                    Crear una App de Meta
                  </span>
                </AccordionTrigger>
                <AccordionContent className="text-muted-foreground">
                  <ol className="list-decimal list-inside space-y-1 text-sm">
                    <li>Ve a <span className="text-primary">developers.facebook.com</span></li>
                    <li>Haz clic en &quot;Mis Apps&quot; y luego en &quot;Crear App&quot;</li>
                    <li>Selecciona &quot;Business&quot; como tipo de app</li>
                    <li>Completa los detalles de la app y créala</li>
                  </ol>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem className="border-border">
                <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                  <span className="flex items-center gap-2">
                    <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">2</span>
                    Agregar Producto de WhatsApp
                  </span>
                </AccordionTrigger>
                <AccordionContent className="text-muted-foreground">
                  <ol className="list-decimal list-inside space-y-1 text-sm">
                    <li>En el panel de tu app, haz clic en &quot;Agregar Producto&quot;</li>
                    <li>Encuentra &quot;WhatsApp&quot; y haz clic en &quot;Configurar&quot;</li>
                    <li>Sigue el asistente de configuración para vincular tu negocio</li>
                  </ol>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem className="border-border">
                <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                  <span className="flex items-center gap-2">
                    <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">3</span>
                    Obtener Credenciales de API
                  </span>
                </AccordionTrigger>
                <AccordionContent className="text-muted-foreground">
                  <ol className="list-decimal list-inside space-y-1 text-sm">
                    <li>Ve a WhatsApp &gt; Configuración de API</li>
                    <li>Copia tu <strong className="text-foreground">ID del Número de Teléfono</strong></li>
                    <li>Copia tu <strong className="text-foreground">ID de la Cuenta de WhatsApp Business</strong></li>
                    <li>Genera un <strong className="text-foreground">Token de Acceso Permanente</strong> desde Configuración de Negocio &gt; Usuarios del Sistema</li>
                  </ol>
                </AccordionContent>
              </AccordionItem>

              <AccordionItem className="border-border">
                <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
                  <span className="flex items-center gap-2">
                    <span className="flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">4</span>
                    Configurar Webhooks
                  </span>
                </AccordionTrigger>
                <AccordionContent className="text-muted-foreground">
                  <ol className="list-decimal list-inside space-y-1 text-sm">
                    <li>Ve a WhatsApp &gt; Configuración</li>
                    <li>Haz clic en &quot;Editar&quot; en la sección de Webhook</li>
                    <li>Pega la <strong className="text-foreground">URL de Callback del Webhook</strong> de arriba</li>
                    <li>Ingresa el mismo <strong className="text-foreground">Token de Verificación</strong> que configuraste aquí</li>
                    <li>Suscríbete al campo de webhook &quot;messages&quot;</li>
                  </ol>
                </AccordionContent>
              </AccordionItem>
            </Accordion>

            <div className="mt-4 pt-4 border-t border-border">
              <a
                href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 transition-colors"
              >
                <ExternalLink className="size-3.5" />
                Documentación de la API de Meta WhatsApp
              </a>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
    </section>
  );
}
