'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Sparkles, CheckCircle2, Trash2, Eye, EyeOff } from 'lucide-react';
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
import { AI_PROVIDER_DEFAULT_MODEL, AI_PROVIDER_LABEL } from '@/lib/ai/defaults';
import type { AiProvider } from '@/lib/ai/types';

const MASKED_KEY = '••••••••••••••••';

const KEY_PLACEHOLDER: Record<AiProvider, string> = {
  openai: 'sk-...',
  anthropic: 'sk-ant-...',
  gemini: 'AIza...',
  deepseek: 'sk-...',
  groq: 'gsk_...',
};

export function AiConfig() {
  const { accountId, accountRole, profileLoading } = useAuth();
  const canEdit = accountRole ? canEditSettings(accountRole) : false;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [removing, setRemoving] = useState(false);

  const [configured, setConfigured] = useState(false);
  const [provider, setProvider] = useState<AiProvider>('openai');
  const [model, setModel] = useState(AI_PROVIDER_DEFAULT_MODEL.openai);
  const [fallbackModel, setFallbackModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [keyEdited, setKeyEdited] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [isActive, setIsActive] = useState(false);
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(false);
  const [maxPerConversation, setMaxPerConversation] = useState(3);

  // Guard keyed on the account (not a bare boolean) so an in-place
  // account switch — ownership transfer, multi-account membership —
  // refetches instead of showing the previous account's config. Mirrors
  // the loadedAccountIdRef pattern in whatsapp-config.tsx.
  const loadedAccountIdRef = useRef<string | null>(null);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ai/config');
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Error al cargar la configuraci\u00f3n de IA');
        return;
      }
      if (data.configured) {
        setConfigured(true);
        setProvider(data.provider);
        setModel(data.model);
        setFallbackModel(data.fallback_model ?? '');
        setSystemPrompt(data.system_prompt ?? '');
        setIsActive(data.is_active);
        setAutoReplyEnabled(data.auto_reply_enabled);
        setMaxPerConversation(data.auto_reply_max_per_conversation ?? 3);
        setHasStoredKey(Boolean(data.has_key));
        setApiKey(data.has_key ? MASKED_KEY : '');
        setKeyEdited(false);
      }
    } catch {
      toast.error('Error al cargar la configuraci\u00f3n de IA');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!accountId || loadedAccountIdRef.current === accountId) return;
    loadedAccountIdRef.current = accountId;
    void fetchConfig();
  }, [accountId, fetchConfig]);

  const handleProviderChange = (next: AiProvider) => {
    setProvider(next);
    const defaults = AI_PROVIDER_DEFAULT_MODEL;
    const isDefaultModel =
      model === defaults.openai ||
      model === defaults.anthropic ||
      model === defaults.gemini ||
      model === defaults.deepseek ||
      model === defaults.groq ||
      model.trim() === '';
    if (isDefaultModel) setModel(defaults[next]);
  };

  const keyPayload = () => (keyEdited ? apiKey.trim() : undefined);

  const buildBody = () => ({
    provider,
    model: model.trim(),
    fallback_model: fallbackModel.trim() || null,
    api_key: keyPayload(),
    system_prompt: systemPrompt.trim() || null,
    is_active: isActive,
    auto_reply_enabled: autoReplyEnabled,
    auto_reply_max_per_conversation: maxPerConversation,
  });

  const handleTest = async () => {
    setTesting(true);
    try {
      const res = await fetch('/api/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          model: model.trim(),
          api_key: keyPayload(),
        }),
      });
      const data = await res.json();
      if (res.ok) toast.success('La clave funciona — el proveedor respondió.');
      else toast.error(data.error ?? 'El proveedor rechaz\u00f3 la solicitud.');
    } catch {
      toast.error('No se pudo contactar al proveedor.');
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!model.trim()) {
      toast.error('Ingresa un nombre de modelo.');
      return;
    }
    if (!configured && !keyEdited) {
      toast.error('Ingresa tu clave de API.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/ai/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildBody()),
      });
      const data = await res.json();
      if (res.ok) {
        toast.success('Asistente de IA guardado.');
        await fetchConfig();
      } else {
        toast.error(data.error ?? 'Error al guardar.');
      }
    } catch {
      toast.error('Error al guardar.');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    try {
      const res = await fetch('/api/ai/config', { method: 'DELETE' });
      if (res.ok) {
        toast.success('Configuraci\u00f3n de IA eliminada.');
        setConfigured(false);
        setHasStoredKey(false);
        setApiKey('');
        setKeyEdited(false);
        setIsActive(false);
        setAutoReplyEnabled(false);
        setSystemPrompt('');
        setFallbackModel('');
      } else {
        const data = await res.json();
        toast.error(data.error ?? 'Error al eliminar.');
      }
    } catch {
      toast.error('Error al eliminar.');
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
        title="Asistente de IA"
        description="Usa tu propia clave de OpenAI, Anthropic, Google Gemini, DeepSeek o Groq. NEXUS CRM llama al proveedor directamente con tu clave — sin cargos de IA por usuario, y tus datos se quedan contigo. Configura un modelo de respaldo para una IA híbrida más resistente. Impulsa respuestas redactadas por IA en la bandeja de entrada y un bot opcional de respuestas automáticas."
      />

      {!canEdit && (
        <p className="mb-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          Solo los administradores y propietarios pueden cambiar la configuraci\u00f3n de IA.
        </p>
      )}

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary" /> Proveedor y clave
            </CardTitle>
            <CardDescription>
              Tu clave está cifrada en reposo (AES-256-GCM) y nunca se vuelve a mostrar
              después de guardarla.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Proveedor</Label>
                <Select
                  value={provider}
                  onValueChange={(v) => handleProviderChange(v as AiProvider)}
                  disabled={disabled}
                >
                  <SelectTrigger>
                    <SelectValue>{AI_PROVIDER_LABEL[provider]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">{AI_PROVIDER_LABEL.openai}</SelectItem>
                    <SelectItem value="anthropic">
                      {AI_PROVIDER_LABEL.anthropic}
                    </SelectItem>
                    <SelectItem value="gemini">
                      {AI_PROVIDER_LABEL.gemini}
                    </SelectItem>
                    <SelectItem value="deepseek">
                      {AI_PROVIDER_LABEL.deepseek}
                    </SelectItem>
                    <SelectItem value="groq">
                      {AI_PROVIDER_LABEL.groq}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ai-model">Modelo</Label>
                <Input
                  id="ai-model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={AI_PROVIDER_DEFAULT_MODEL[provider]}
                  disabled={disabled}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-fallback">Modelo de respaldo (IA híbrida)</Label>
              <Input
                id="ai-fallback"
                value={fallbackModel}
                onChange={(e) => setFallbackModel(e.target.value)}
                placeholder="Opcional — p. ej. llama-3.1-8b-instant"
                disabled={disabled}
              />
              <p className="text-xs text-muted-foreground">
                Si el modelo principal falla por saturación, tiempo de espera o
                límite de uso, se reintenta una vez con este modelo (misma clave).
                Déjalo vacío para desactivar el respaldo.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-key">Clave de API</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id="ai-key"
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
                    placeholder={KEY_PLACEHOLDER[provider]}
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
                  Probar clave
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Comportamiento</CardTitle>
            <CardDescription>
              Cuéntale al asistente sobre tu negocio — productos, tono, qué puede
              y qué no puede prometer. Este contexto alimenta tanto los borradores
              como las respuestas automáticas.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ai-prompt">Contexto e instrucciones del negocio</Label>
              <Textarea
                id="ai-prompt"
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="p. ej. Somos Acme, una tienda de equipos de café. Sé cordial y conciso. Nunca cotices precios ni fechas de entrega — derívalo a un humano."
                rows={5}
                disabled={disabled}
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
              <div>
                <p className="text-sm font-medium text-foreground">
                  Activar asistente de IA
                </p>
                <p className="text-xs text-muted-foreground">
                  Interruptor principal. Activa el botón “Redactar con IA” en la
                  bandeja de entrada.
                </p>
              </div>
              <Switch
                checked={isActive}
                onCheckedChange={setIsActive}
                disabled={disabled}
              />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
              <div>
                <p className="text-sm font-medium text-foreground">
                  Responder autom\u00e1ticamente a mensajes entrantes
                </p>
                <p className="text-xs text-muted-foreground">
                  El bot responde mensajes entrantes automáticamente (solo cuando
                  ningún flujo los maneja y no hay un agente asignado). Deriva a un
                  humano cuando no puede ayudar.
                </p>
              </div>
              <Switch
                checked={autoReplyEnabled}
                onCheckedChange={setAutoReplyEnabled}
                disabled={disabled || !isActive}
              />
            </div>

            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="ai-max">M\u00e1ximo de respuestas autom\u00e1ticas por conversaci\u00f3n</Label>
                <p className="text-xs text-muted-foreground">
                  Despu\u00e9s de esta cantidad de respuestas del bot en un hilo, este se silencia.
                </p>
              </div>
              <Input
                id="ai-max"
                type="number"
                min={1}
                max={20}
                value={maxPerConversation}
                onChange={(e) =>
                  setMaxPerConversation(
                    Math.min(20, Math.max(1, Number(e.target.value) || 1)),
                  )
                }
                disabled={disabled || !autoReplyEnabled}
                className="w-20"
              />
            </div>
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
              Eliminar
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
