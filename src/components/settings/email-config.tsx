'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Mail,
  Trash2,
} from 'lucide-react';

import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { SettingsPanelHead } from './settings-panel-head';

const MASKED_KEY = '••••••••••••••••';

interface MailboxOption {
  id: string;
  name: string;
  mailboxId: string;
  role: string | null;
}

interface IdentityOption {
  id: string;
  name: string;
  email: string;
}

export function EmailConfig() {
  const { accountId, accountRole, profileLoading } = useAuth();
  const canEdit = accountRole ? canEditSettings(accountRole) : false;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [discovering, setDiscovering] = useState(false);

  const [configured, setConfigured] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [keyEdited, setKeyEdited] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [fromName, setFromName] = useState('');
  const [fromAddress, setFromAddress] = useState('');
  const [mailboxId, setMailboxId] = useState('');
  const [signature, setSignature] = useState('');
  const [enabled, setEnabled] = useState(true);

  const [mailboxes, setMailboxes] = useState<MailboxOption[]>([]);
  const [identities, setIdentities] = useState<IdentityOption[]>([]);

  const loadedAccountIdRef = useRef<string | null>(null);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/email/settings');
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Error al cargar la configuración de correo');
        return;
      }
      if (data.configured) {
        setConfigured(true);
        setBaseUrl(data.base_url ?? '');
        setFromName(data.from_name ?? '');
        setFromAddress(data.from_address ?? '');
        setMailboxId(data.mailbox_id ?? '');
        setSignature(data.signature ?? '');
        setEnabled(data.enabled !== false);
        setHasStoredKey(Boolean(data.has_key));
        setApiKey(data.has_key ? MASKED_KEY : '');
        setKeyEdited(false);
      } else {
        setConfigured(false);
        setHasStoredKey(false);
        setApiKey('');
        setKeyEdited(false);
      }
    } catch {
      toast.error('Error al cargar la configuración de correo');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!accountId || loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    void fetchConfig();
  }, [accountId, fetchConfig]);

  // Buzones e identidades se leen de Mailflare (JMAP). Si la conexión
  // todavía no está guardada o falla, los selectores caen a texto libre.
  const discover = useCallback(async () => {
    setDiscovering(true);
    try {
      const res = await fetch('/api/email/mailboxes');
      if (!res.ok) return;
      const data = await res.json();
      setMailboxes(data.mailboxes ?? []);
      setIdentities(data.identities ?? []);
    } catch {
      // Silencioso: los selectores simplemente quedan vacíos.
    } finally {
      setDiscovering(false);
    }
  }, []);

  useEffect(() => {
    if (configured) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void discover();
    }
  }, [configured, discover]);

  const uniqueMailboxes = useMemo(() => {
    const map = new Map<string, MailboxOption>();
    for (const mailbox of mailboxes) {
      if (!map.has(mailbox.mailboxId)) map.set(mailbox.mailboxId, mailbox);
    }
    return Array.from(map.values());
  }, [mailboxes]);

  const uniqueAddresses = useMemo(() => {
    const seen = new Set<string>();
    return identities.filter((identity) => {
      const key = identity.email.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [identities]);

  const keyPayload = () => (keyEdited ? apiKey.trim() : undefined);

  const handleTest = async () => {
    if (!baseUrl.trim()) {
      toast.error('Ingresa la URL de Mailflare.');
      return;
    }
    setTesting(true);
    try {
      const res = await fetch('/api/email/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base_url: baseUrl, api_key: keyPayload() }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Mailflare rechazó la conexión.');
        return;
      }
      setMailboxes(data.mailboxes ?? []);
      setIdentities(data.identities ?? []);
      const count = Array.isArray(data.mailboxes) ? data.mailboxes.length : 0;
      toast.success(
        count > 0
          ? `Conexión correcta — ${count} ${count === 1 ? 'buzón disponible' : 'buzones disponibles'}.`
          : 'Conexión correcta, pero la key no ve ningún buzón.',
      );
    } catch {
      toast.error('No se pudo contactar a Mailflare.');
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!baseUrl.trim()) {
      toast.error('Ingresa la URL de Mailflare.');
      return;
    }
    if (!configured && !keyEdited) {
      toast.error('Ingresa la API key de Mailflare.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/email/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base_url: baseUrl,
          api_key: keyPayload(),
          from_name: fromName.trim() || null,
          from_address: fromAddress.trim() || null,
          mailbox_id: mailboxId || null,
          signature: signature.trim() || null,
          enabled,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Error al guardar.');
        return;
      }
      toast.success('Correo conectado.');
      setConfigured(true);
      await fetchConfig();
    } catch {
      toast.error('Error al guardar.');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    try {
      const res = await fetch('/api/email/settings', { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? 'Error al desconectar.');
        return;
      }
      toast.success('Correo desconectado.');
      setConfigured(false);
      setHasStoredKey(false);
      setApiKey('');
      setKeyEdited(false);
      setMailboxes([]);
      setIdentities([]);
      setMailboxId('');
      setFromAddress('');
    } catch {
      toast.error('Error al desconectar.');
    } finally {
      setRemoving(false);
    }
  };

  if (loading || profileLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando…
      </div>
    );
  }

  const disabled = !canEdit || saving;

  return (
    <div>
      <SettingsPanelHead
        title="Correo"
        description="Conecta tu servidor Mailflare para leer, responder y enviar correos desde el CRM. Todo pasa por la API de Mailflare: el CRM no copia su código ni guarda tu correo en otra parte."
      />

      {!canEdit && (
        <p className="mb-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          Solo los administradores y propietarios pueden cambiar la conexión de
          correo.
        </p>
      )}

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Mail className="h-4 w-4 text-primary" />
              Servidor y credenciales
            </CardTitle>
            <CardDescription>
              La API key se guarda cifrada en reposo (AES-256-GCM) y nunca se
              vuelve a mostrar después de guardarla. Créala en Mailflare en
              Ajustes → API keys con permisos <code>read</code>, <code>send</code>{' '}
              y <code>jmap</code>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email-base-url">URL de Mailflare</Label>
              <Input
                id="email-base-url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://mailflare.tu-dominio.com"
                disabled={disabled}
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                La URL del Worker o contenedor donde corre Mailflare, sin barra
                final.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="email-api-key">API key</Label>
                {configured && hasStoredKey && (
                  <Badge variant="secondary" className="font-normal">
                    Guardada
                  </Badge>
                )}
              </div>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id="email-api-key"
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      setKeyEdited(true);
                    }}
                    onFocus={() => {
                      if (!keyEdited && hasStoredKey) {
                        setApiKey('');
                        setKeyEdited(true);
                      }
                    }}
                    placeholder="mf_..."
                    disabled={disabled}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {showKey ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <Button
                  variant="outline"
                  onClick={handleTest}
                  disabled={disabled || testing}
                >
                  {testing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                  )}
                  Probar conexión
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Buzón de envío</CardTitle>
            <CardDescription>
              Desde qué buzón y con qué dirección salen los correos que escribas
              en el CRM. Prueba la conexión para cargar las opciones reales de tu
              servidor.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Buzón</Label>
                {uniqueMailboxes.length > 0 ? (
                  <Select
                    value={mailboxId || undefined}
                    onValueChange={(value) => setMailboxId(value ?? '')}
                    disabled={disabled}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Elige un buzón" />
                    </SelectTrigger>
                    <SelectContent>
                      {uniqueMailboxes.map((mailbox) => (
                        <SelectItem key={mailbox.mailboxId} value={mailbox.mailboxId}>
                          {mailbox.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={mailboxId}
                    onChange={(e) => setMailboxId(e.target.value)}
                    placeholder={discovering ? 'Cargando buzones…' : 'ID del buzón (opcional)'}
                    disabled={disabled || discovering}
                  />
                )}
                <p className="text-xs text-muted-foreground">
                  Si lo dejas vacío se usa el primer buzón con permiso de envío.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Dirección de envío</Label>
                {uniqueAddresses.length > 0 ? (
                  <Select
                    value={fromAddress || '__auto__'}
                    onValueChange={(value) =>
                      setFromAddress(value === '__auto__' || !value ? '' : value)
                    }
                    disabled={disabled}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Automática" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__auto__">Automática</SelectItem>
                      {uniqueAddresses.map((identity) => (
                        <SelectItem key={identity.email} value={identity.email}>
                          {identity.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={fromAddress}
                    onChange={(e) => setFromAddress(e.target.value)}
                    placeholder="ventas@tu-dominio.com"
                    disabled={disabled}
                    autoComplete="off"
                  />
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email-from-name">Nombre del remitente</Label>
              <Input
                id="email-from-name"
                value={fromName}
                onChange={(e) => setFromName(e.target.value)}
                placeholder="Equipo de ventas"
                disabled={disabled}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email-signature">Firma</Label>
              <Textarea
                id="email-signature"
                value={signature}
                onChange={(e) => setSignature(e.target.value)}
                placeholder={'Nombre y cargo\nTeléfono\nSitio web'}
                rows={3}
                disabled={disabled}
              />
              <p className="text-xs text-muted-foreground">
                Se añade automáticamente al final de cada correo que envíes desde
                el CRM.
              </p>
            </div>

            <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
              <div>
                <p className="text-sm font-medium text-foreground">
                  Módulo Correo activo
                </p>
                <p className="text-xs text-muted-foreground">
                  Al desactivarlo, la bandeja deja de cargar mensajes sin borrar
                  la conexión ni la clave.
                </p>
              </div>
              <Switch
                checked={enabled}
                onCheckedChange={setEnabled}
                disabled={disabled}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cómo desplegar Mailflare</CardTitle>
            <CardDescription>
              Mailflare corre en tu propia infraestructura. Necesitas una cuenta
              de Cloudflare con tu dominio.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
              <li>
                Abre el repositorio{' '}
                <a
                  href="https://github.com/hieunc229/mailflare"
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  hieunc229/mailflare
                </a>{' '}
                y pulsa <strong>Deploy to Cloudflare</strong>. El Worker debe
                llamarse exactamente <code>mailflare</code>.
              </li>
              <li>
                Crea un token de Cloudflare con permisos de DNS, Email Routing y
                Email Sending, y guárdalo como secreto <code>CF_TOKEN</code>.
              </li>
              <li>
                Entra a <code>/setup</code>, crea la cuenta de administrador y
                conecta tu dominio.
              </li>
              <li>
                En Mailflare ve a <strong>Ajustes → API keys</strong>, crea una
                key con <code>read</code>, <code>send</code> y <code>jmap</code>,
                y pégala aquí.
              </li>
            </ol>
            <p className="mt-3 text-xs text-muted-foreground">
              Detalle paso a paso, variables y solución de problemas en{' '}
              <code>docs/mailflare-integracion.md</code>.
            </p>
          </CardContent>
        </Card>

        <div className="flex items-center justify-between">
          {configured ? (
            <Button
              variant="ghost"
              onClick={handleRemove}
              disabled={!canEdit || removing}
              className="text-destructive hover:text-destructive"
            >
              {removing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              Desconectar
            </Button>
          ) : (
            <span />
          )}

          <Button onClick={handleSave} disabled={disabled}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Guardar
          </Button>
        </div>
      </div>
    </div>
  );
}
