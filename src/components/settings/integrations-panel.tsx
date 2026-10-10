'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, MessageCircle, Mail, Check } from 'lucide-react';
import { WebhookEndpointsManager } from '@/components/settings/webhook-endpoints';

export function IntegrationsPanel() {
  const { accountId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  // Slack
  const [slackWebhook, setSlackWebhook] = useState('');
  const [slackEnabled, setSlackEnabled] = useState(false);

  // SMTP Email
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('');
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [smtpFrom, setSmtpFrom] = useState('');
  const [emailEnabled, setEmailEnabled] = useState(false);

  useEffect(() => {
    if (!accountId) return;
    const fetchConfig = async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('integrations')
        .select('*')
        .eq('account_id', accountId)
        .maybeSingle();

      if (data) {
        setSlackWebhook(data.slack_webhook_url ?? '');
        setSlackEnabled(data.slack_enabled ?? false);
        setSmtpHost(data.smtp_host ?? '');
        setSmtpPort(data.smtp_port ?? '');
        setSmtpUser(data.smtp_user ?? '');
        setSmtpPass(data.smtp_pass ?? '');
        setSmtpFrom(data.smtp_from ?? '');
        setEmailEnabled(data.email_enabled ?? false);
      }
      setLoading(false);
    };
    fetchConfig();
  }, [accountId]);

  const saveSlack = async () => {
    if (!accountId) return;
    setSaving('slack');
    const supabase = createClient();
    const { error } = await supabase.from('integrations').upsert({
      account_id: accountId,
      slack_webhook_url: slackWebhook,
      slack_enabled: true,
    }, { onConflict: 'account_id' });
    if (error) toast.error('Error al guardar Slack');
    else toast.success('Slack configurado');
    setSaving(null);
  };

  const saveEmail = async () => {
    if (!accountId) return;
    setSaving('email');
    const supabase = createClient();
    const { error } = await supabase.from('integrations').upsert({
      account_id: accountId,
      smtp_host: smtpHost,
      smtp_port: smtpPort,
      smtp_user: smtpUser,
      smtp_pass: smtpPass,
      smtp_from: smtpFrom,
      email_enabled: true,
    }, { onConflict: 'account_id' });
    if (error) toast.error('Error al guardar correo');
    else toast.success('Correo configurado');
    setSaving(null);
  };

  if (loading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Integraciones</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Conecta tu CRM con otras herramientas.
        </p>
      </div>

      {/* Slack */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
            <MessageCircle className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-medium text-foreground">Slack</h3>
            <p className="text-xs text-muted-foreground">
              Recibe notificaciones de nuevas conversaciones en un canal de Slack.
            </p>
          </div>
          {slackEnabled && <Check className="h-4 w-4 text-primary" />}
        </div>
        <div className="mt-4 space-y-3">
          <Input
            value={slackWebhook}
            onChange={(e) => setSlackWebhook(e.target.value)}
            placeholder="https://hooks.slack.com/services/..."
            className="border-border text-foreground placeholder:text-muted-foreground"
          />
          <div className="flex gap-2">
            <Button onClick={saveSlack} disabled={saving === 'slack' || !slackWebhook} className="bg-primary text-primary-foreground hover:bg-primary/90">
              {saving === 'slack' && <Loader2 className="h-4 w-4 animate-spin" />}
              Guardar Slack
            </Button>
            {slackEnabled && (
              <Button variant="outline" className="border-border text-muted-foreground" onClick={async () => {
                if (!accountId) return;
                const supabase = createClient();
                await supabase.from('integrations').upsert({
                  account_id: accountId,
                  slack_enabled: false,
                }, { onConflict: 'account_id' });
                setSlackEnabled(false);
                toast.success('Slack desactivado');
              }}>Desactivar</Button>
            )}
          </div>
        </div>
      </div>

      {/* Email / SMTP */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
            <Mail className="h-5 w-5 text-muted-foreground" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-medium text-foreground">Correo SMTP</h3>
            <p className="text-xs text-muted-foreground">
              Envía correos desde tu propio servidor SMTP.
            </p>
          </div>
          {emailEnabled && <Check className="h-4 w-4 text-primary" />}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Input value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.example.com" className="border-border text-foreground placeholder:text-muted-foreground" />
          <Input value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} placeholder="587" className="border-border text-foreground placeholder:text-muted-foreground" />
          <Input value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} placeholder="Usuario SMTP" className="border-border text-foreground placeholder:text-muted-foreground" />
          <Input type="password" value={smtpPass} onChange={(e) => setSmtpPass(e.target.value)} placeholder="Contraseña SMTP" className="border-border text-foreground placeholder:text-muted-foreground" />
          <Input value={smtpFrom} onChange={(e) => setSmtpFrom(e.target.value)} placeholder="tucorreo@ejemplo.com" className="col-span-2 border-border text-foreground placeholder:text-muted-foreground" />
        </div>
        <div className="mt-3 flex gap-2">
          <Button onClick={saveEmail} disabled={saving === 'email' || !smtpHost} className="bg-primary text-primary-foreground hover:bg-primary/90">
            {saving === 'email' && <Loader2 className="h-4 w-4 animate-spin" />}
            Guardar Correo
          </Button>
          {emailEnabled && (
            <Button variant="outline" className="border-border text-muted-foreground" onClick={async () => {
              if (!accountId) return;
              const supabase = createClient();
              await supabase.from('integrations').upsert({
                account_id: accountId,
                email_enabled: false,
              }, { onConflict: 'account_id' });
              setEmailEnabled(false);
              toast.success('Correo desactivado');
            }}>Desactivar</Button>
          )}
        </div>
      </div>

      {/* Webhooks salientes (endpoints firmados) */}
      <div className="rounded-xl border border-border bg-card p-5">
        <WebhookEndpointsManager />
      </div>
    </div>
  );
}