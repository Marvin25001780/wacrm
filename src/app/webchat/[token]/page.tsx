'use client';

// ============================================================
// /webchat/[token] — vista pública del widget  ·  módulo 2.6
//
// Página sin sesión que se embebe (iframe) o se comparte como enlace
// directo. Lee la config pública por `token` y envía un Lead al CRM.
// ============================================================

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Loader2, MessageCircle, CheckCircle2 } from 'lucide-react';
import type { WebchatPublicConfig } from '@/types';

type Status = 'loading' | 'ready' | 'notfound' | 'sent' | 'sending' | 'error';

export default function WebchatWidgetPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? '';

  const [config, setConfig] = useState<WebchatPublicConfig | null>(null);
  const [status, setStatus] = useState<Status>(token ? 'loading' : 'notfound');
  const [error, setError] = useState('');

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    if (!token) return;
    fetch(`/api/webchat/widget/${token}`)
      .then(async (res) => {
        if (!active) return;
        if (!res.ok) {
          setStatus('notfound');
          return;
        }
        const data = (await res.json()) as WebchatPublicConfig;
        setConfig(data);
        setStatus('ready');
      })
      .catch(() => active && setStatus('notfound'));
    return () => {
      active = false;
    };
  }, [token]);

  const accent = config?.color || '#2563eb';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name.trim()) {
      setError('El nombre es obligatorio.');
      return;
    }
    if (!phone.trim() && !email.trim()) {
      setError('Deja un teléfono o un correo para contactarte.');
      return;
    }
    setStatus('sending');
    try {
      const res = await fetch(`/api/webchat/widget/${token}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone, email, message }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setStatus('sent');
      } else {
        setError(data.error ?? 'No se pudo enviar. Intenta de nuevo.');
        setStatus('ready');
      }
    } catch {
      setError('No se pudo enviar. Intenta de nuevo.');
      setStatus('ready');
    }
  };

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (status === 'notfound' || !config) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-background text-muted-foreground">
        <MessageCircle className="size-8" />
        <p className="text-sm">Este widget no está disponible.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
        <div className="px-5 py-4 text-white" style={{ backgroundColor: accent }}>
          <div className="flex items-center gap-2">
            <MessageCircle className="size-5" />
            <p className="font-semibold">{config.title}</p>
          </div>
          {config.welcome_message && (
            <p className="mt-1 text-sm text-white/85">{config.welcome_message}</p>
          )}
        </div>

        {status === 'sent' ? (
          <div className="flex flex-col items-center gap-3 px-5 py-12 text-center">
            <CheckCircle2 className="size-10" style={{ color: accent }} />
            <p className="font-medium text-foreground">¡Gracias! Te contactaremos pronto.</p>
            <p className="text-sm text-muted-foreground">
              Recibimos tus datos y un asesor te escribirá.
            </p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3 p-5">
            <Field label="Nombre">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Tu nombre"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring"
              />
            </Field>
            <Field label="Teléfono (WhatsApp)">
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+56 9 1234 5678"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring"
              />
            </Field>
            <Field label="Correo">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@correo.com"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring"
              />
            </Field>
            <Field label="Mensaje">
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                placeholder="¿En qué podemos ayudarte?"
                className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring"
              />
            </Field>

            {error && <p className="text-xs text-destructive">{error}</p>}

            <button
              type="submit"
              disabled={status === 'sending'}
              className="flex w-full items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
              style={{ backgroundColor: accent }}
            >
              {status === 'sending' && <Loader2 className="size-4 animate-spin" />}
              {config.button_text || 'Enviar'}
            </button>
            <p className="text-center text-[11px] text-muted-foreground">
              Con la tecnología de NEXUS CRM
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
