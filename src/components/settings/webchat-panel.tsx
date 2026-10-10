'use client';

// ============================================================
// Widget de webchat — configuración (módulo 2.6)
//
// Crea/edita el widget público de la cuenta, muestra el enlace y el
// código de incrustación, y permite habilitarlo/deshabilitarlo o
// regenerar el token. Escribe vía /api/webchat/config (admin+).
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Loader2,
  Globe,
  Copy,
  ExternalLink,
  RefreshCw,
  Trash2,
  Plus,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SettingsPanelHead } from './settings-panel-head';
import type { WebchatConfig, WebchatPosition } from '@/types';

interface FormState {
  enabled: boolean;
  title: string;
  welcome_message: string;
  color: string;
  button_text: string;
  position: WebchatPosition;
}

const EMPTY: FormState = {
  enabled: false,
  title: 'Chatea con nosotros',
  welcome_message: 'Déjanos tus datos y te contactamos.',
  color: '#2563eb',
  button_text: 'Enviar',
  position: 'bottom-right',
};

export function WebchatPanel() {
  const { accountId, accountRole, profileLoading } = useAuth();
  const canEdit = accountRole ? canEditSettings(accountRole) : false;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [config, setConfig] = useState<WebchatConfig | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);

  const loadedAccountIdRef = useRef<string | null>(null);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/webchat/config');
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'No se pudo cargar la configuración.');
        return;
      }
      if (data.configured && data.config) {
        const c = data.config as WebchatConfig;
        setConfigured(true);
        setConfig(c);
        setForm({
          enabled: c.enabled,
          title: c.title,
          welcome_message: c.welcome_message ?? '',
          color: c.color,
          button_text: c.button_text,
          position: c.position,
        });
      } else {
        setConfigured(false);
        setConfig(null);
        setForm(EMPTY);
      }
    } catch {
      toast.error('No se pudo cargar la configuración.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!accountId || loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    void fetchConfig();
  }, [accountId, fetchConfig]);

  const save = async (extra?: Record<string, unknown>) => {
    setSaving(true);
    try {
      const res = await fetch('/api/webchat/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'No se pudo guardar.');
        return;
      }
      if (data.config) {
        const c = data.config as WebchatConfig;
        setConfigured(true);
        setConfig(c);
        setForm({
          enabled: c.enabled,
          title: c.title,
          welcome_message: c.welcome_message ?? '',
          color: c.color,
          button_text: c.button_text,
          position: c.position,
        });
      }
      toast.success('Widget guardado.');
    } catch {
      toast.error('No se pudo guardar.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm('¿Eliminar el widget? El enlace dejará de funcionar.')) return;
    setSaving(true);
    try {
      const res = await fetch('/api/webchat/config', { method: 'DELETE' });
      if (res.ok) {
        toast.success('Widget eliminado.');
        setConfigured(false);
        setConfig(null);
        setForm(EMPTY);
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? 'No se pudo eliminar.');
      }
    } catch {
      toast.error('No se pudo eliminar.');
    } finally {
      setSaving(false);
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
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const widgetUrl = config ? `${origin}/webchat/${config.token}` : '';
  const embedCode = widgetUrl
    ? `<iframe src="${widgetUrl}" style="position:fixed;bottom:20px;right:20px;width:380px;height:560px;border:0;border-radius:16px;box-shadow:0 10px 30px rgba(0,0,0,.2);z-index:9999" title="Chat"></iframe>`
    : '';

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(label + ' copiado.');
    } catch {
      toast.error('No se pudo copiar.');
    }
  };

  return (
    <div>
      <SettingsPanelHead
        title="Widget de webchat"
        description="Embebe un widget en tu sitio para capturar prospectos. Cada envío entra como un Lead (origen «webchat») y lo ves en la sección Leads."
      />

      {!canEdit && (
        <p className="mb-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          Solo administradores y propietarios pueden cambiar el widget.
        </p>
      )}

      {!configured ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Globe className="h-4 w-4 text-primary" /> Aún no hay widget
            </CardTitle>
            <CardDescription>
              Créalo y obtén un enlace público + código para incrustar en tu web.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => save()} disabled={disabled}>
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              Crear widget
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Globe className="h-4 w-4 text-primary" /> Apariencia
              </CardTitle>
              <CardDescription>
                Título, mensaje y color que verán tus visitantes.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
                <div>
                  <p className="text-sm font-medium text-foreground">Widget activo</p>
                  <p className="text-xs text-muted-foreground">
                    Si lo desactivas, el enlace y el formulario dejan de responder.
                  </p>
                </div>
                <Switch
                  checked={form.enabled}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, enabled: v }))}
                  disabled={disabled}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="wc-title">Título</Label>
                  <Input
                    id="wc-title"
                    value={form.title}
                    onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                    disabled={disabled}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="wc-button">Texto del botón</Label>
                  <Input
                    id="wc-button"
                    value={form.button_text}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, button_text: e.target.value }))
                    }
                    disabled={disabled}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="wc-welcome">Mensaje de bienvenida</Label>
                <Textarea
                  id="wc-welcome"
                  value={form.welcome_message}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, welcome_message: e.target.value }))
                  }
                  rows={2}
                  disabled={disabled}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="wc-color">Color</Label>
                  <div className="flex gap-2">
                    <input
                      id="wc-color"
                      type="color"
                      value={form.color}
                      onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                      disabled={disabled}
                      className="h-9 w-12 cursor-pointer rounded-md border border-border bg-background"
                    />
                    <Input
                      value={form.color}
                      onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                      disabled={disabled}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Posición</Label>
                  <Select
                    value={form.position}
                    onValueChange={(v) =>
                      setForm((f) => ({ ...f, position: v as WebchatPosition }))
                    }
                    disabled={disabled}
                  >
                    <SelectTrigger>
                      <SelectValue>
                        {form.position === 'bottom-left'
                          ? 'Abajo a la izquierda'
                          : 'Abajo a la derecha'}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bottom-right">Abajo a la derecha</SelectItem>
                      <SelectItem value="bottom-left">Abajo a la izquierda</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Enlace e incrustación</CardTitle>
              <CardDescription>
                Comparte el enlace directo o pega el código en tu sitio.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Enlace público</Label>
                <div className="flex gap-2">
                  <Input readOnly value={widgetUrl} className="flex-1" />
                  <Button variant="outline" onClick={() => copy(widgetUrl, 'Enlace')}>
                    <Copy className="h-4 w-4" />
                  </Button>
                  <a href={widgetUrl} target="_blank" rel="noreferrer">
                    <Button variant="outline">
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                  </a>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Código para incrustar (iframe)</Label>
                <Textarea readOnly value={embedCode} rows={3} className="font-mono text-xs" />
                <Button
                  variant="outline"
                  onClick={() => copy(embedCode, 'Código')}
                >
                  <Copy className="mr-2 h-4 w-4" /> Copiar código
                </Button>
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
                <Button
                  variant="outline"
                  onClick={() => {
                    if (
                      window.confirm(
                        'Se generará un token nuevo; el enlace y el código actuales dejarán de funcionar. ¿Continuar?',
                      )
                    )
                      void save({ regenerate_token: true });
                  }}
                  disabled={disabled}
                >
                  <RefreshCw className="mr-2 h-4 w-4" /> Regenerar token
                </Button>
                <Button
                  variant="ghost"
                  onClick={remove}
                  disabled={disabled}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" /> Eliminar
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button onClick={() => save()} disabled={disabled}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Guardar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
