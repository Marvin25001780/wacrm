'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Inbox,
  Loader2,
  Mail,
  MailOpen,
  PenSquare,
  RefreshCw,
  Search,
  Send,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

interface EmailMessage {
  id: string;
  mailboxId: string | null;
  direction: 'inbound' | 'outbound';
  fromAddr: string | null;
  toAddr: string | null;
  ccAddr: string | null;
  bccAddr: string | null;
  replyTo: string | null;
  subject: string | null;
  snippet: string | null;
  textBody: string | null;
  htmlBody: string | null;
  read: boolean;
  starred: boolean;
  status: string | null;
  threadId: string | null;
  messageId: string | null;
  inReplyTo: string | null;
  references: string | null;
  createdAt: string | null;
}

interface Mailbox {
  id: string;
  name: string;
  mailboxId: string;
  role: string | null;
  totalEmails: number;
  unreadEmails: number;
}

interface Composer {
  mode: 'new' | 'reply';
  to: string;
  subject: string;
  inReplyTo: string | null;
  references: string | null;
  text: string;
}

function addressOnly(value: string | null): string {
  if (!value) return '';
  const match = value.match(/<([^>]+)>/);
  return (match?.[1] ?? value).trim();
}

function displayName(value: string | null): string {
  if (!value) return 'Sin remitente';
  const match = value.match(/^"?([^"<]*)"?\s*<[^>]+>$/);
  const name = match?.[1]?.trim();
  if (name) return name;
  return addressOnly(value) || value;
}

function formatDate(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return new Intl.DateTimeFormat('es-VE', {
    day: '2-digit',
    month: 'short',
    ...(sameDay
      ? { hour: '2-digit', minute: '2-digit' }
      : { year: 'numeric' }),
  }).format(date);
}

function replySubject(subject: string | null): string {
  const base = (subject ?? '').trim() || '(sin asunto)';
  return /^re:/i.test(base) ? base : `Re: ${base}`;
}

function EmailBody({ message }: { message: EmailMessage }) {
  if (message.htmlBody?.trim()) {
    return (
      <iframe
        title="Contenido del correo"
        sandbox=""
        referrerPolicy="no-referrer"
        className="h-[60vh] w-full rounded-lg border border-border bg-white"
        srcDoc={`<!doctype html><html><head><meta charset="utf-8"/><base target="_blank"/><style>html,body{margin:0;padding:16px;font-family:Inter,Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.55;color:#1f2937;}img{max-width:100%;height:auto;}a{color:#4338d8;}</style></head><body>${message.htmlBody}</body></html>`}
      />
    );
  }
  return (
    <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/20 p-4 font-sans text-sm leading-relaxed text-foreground">
      {message.textBody?.trim() || message.snippet?.trim() || 'Este correo no tiene cuerpo de texto.'}
    </pre>
  );
}

export default function EmailPage() {
  const [checking, setChecking] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composer, setComposer] = useState<Composer | null>(null);
  const [sending, setSending] = useState(false);

  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [direction, setDirection] = useState<'all' | 'inbound' | 'outbound'>('all');
  const [mailboxFilter, setMailboxFilter] = useState('__all__');

  const selected = useMemo(
    () => messages.find((message) => message.id === selectedId) ?? null,
    [messages, selectedId],
  );

  const unread = useMemo(
    () => messages.filter((message) => !message.read).length,
    [messages],
  );

  const uniqueMailboxes = useMemo(() => {
    const map = new Map<string, Mailbox>();
    for (const mailbox of mailboxes) {
      if (!map.has(mailbox.mailboxId)) map.set(mailbox.mailboxId, mailbox);
    }
    return Array.from(map.values());
  }, [mailboxes]);

  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    void (async () => {
      try {
        const res = await fetch('/api/email/settings');
        const data = await res.json();
        setConfigured(Boolean(res.ok && data.configured));
        setEnabled(Boolean(res.ok && data.configured && data.enabled));
      } catch {
        setConfigured(false);
        setEnabled(false);
      } finally {
        setChecking(false);
      }
    })();
  }, []);

  const loadMailboxes = useCallback(async () => {
    try {
      const res = await fetch('/api/email/mailboxes');
      if (!res.ok) return;
      const data = await res.json();
      setMailboxes(data.mailboxes ?? []);
    } catch {
      // La lista de filtros es opcional; la bandeja sigue funcionando.
    }
  }, []);

  const loadMessages = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (appliedQuery.trim()) params.set('q', appliedQuery.trim());
      if (direction !== 'all') params.set('direction', direction);
      if (mailboxFilter !== '__all__') params.set('mailboxId', mailboxFilter);

      const res = await fetch(`/api/email/messages?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'No se pudo cargar la bandeja.');
        return;
      }
      setMessages(data.messages ?? []);
      setSelectedId((current) =>
        current && (data.messages as EmailMessage[]).some((m) => m.id === current)
          ? current
          : null,
      );
    } catch {
      toast.error('No se pudo cargar la bandeja.');
    } finally {
      setLoading(false);
    }
  }, [appliedQuery, direction, mailboxFilter]);

  useEffect(() => {
    if (!enabled) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadMailboxes();
  }, [enabled, loadMailboxes]);

  useEffect(() => {
    if (!enabled) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadMessages();
  }, [enabled, loadMessages]);

  const openMessage = async (message: EmailMessage) => {
    setSelectedId(message.id);
    setComposer(null);
    if (!message.read) {
      setMessages((current) =>
        current.map((item) =>
          item.id === message.id ? { ...item, read: true } : item,
        ),
      );
      try {
        await fetch(`/api/email/messages/${encodeURIComponent(message.id)}/read`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ read: true }),
        });
      } catch {
        // La marca de leído es best-effort: no bloquea la lectura.
      }
    }
  };

  const startReply = (message: EmailMessage) => {
    const ownAddress = addressOnly(message.fromAddr);
    const isOutbound = message.direction === 'outbound';
    setComposer({
      mode: 'reply',
      to: isOutbound ? addressOnly(message.toAddr) : ownAddress,
      subject: replySubject(message.subject),
      inReplyTo: message.messageId,
      references: [message.references, message.messageId]
        .filter(Boolean)
        .join(' '),
      text: '',
    });
  };

  const handleSend = async () => {
    if (!composer) return;
    if (!composer.to.trim()) {
      toast.error('Agrega un destinatario.');
      return;
    }
    if (!composer.subject.trim()) {
      toast.error('Agrega un asunto.');
      return;
    }
    if (!composer.text.trim()) {
      toast.error('Escribe el mensaje.');
      return;
    }
    setSending(true);
    try {
      const res = await fetch('/api/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: composer.to,
          subject: composer.subject,
          text: composer.text,
          inReplyTo: composer.inReplyTo,
          references: composer.references,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'No se pudo enviar el correo.');
        return;
      }
      toast.success('Correo enviado.');
      setComposer(null);
      await loadMessages();
    } catch {
      toast.error('No se pudo enviar el correo.');
    } finally {
      setSending(false);
    }
  };

  if (checking) {
    return (
      <div className="flex h-[60vh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando correo…
      </div>
    );
  }

  if (!configured) {
    return (
      <div className="mx-auto max-w-xl py-10">
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Mail className="h-6 w-6 text-primary" />
          </div>
          <h1 className="mt-4 text-xl font-semibold text-foreground">
            Conecta tu correo
          </h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            El módulo Correo usa tu servidor Mailflare para leer, responder y
            enviar desde el CRM. Conecta la URL y la API key para empezar.
          </p>
          <Button className="mt-6" render={<Link href="/settings?tab=email" />}>
            Configurar correo
          </Button>
        </div>
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="mx-auto max-w-xl py-10">
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Mail className="h-6 w-6 text-muted-foreground" />
          </div>
          <h1 className="mt-4 text-xl font-semibold text-foreground">
            Correo desactivado
          </h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            La conexión con Mailflare está guardada, pero el módulo está apagado.
            Actívalo en Ajustes → Correo para volver a cargar la bandeja.
          </p>
          <Button className="mt-6" render={<Link href="/settings?tab=email" />}>
            Ir a Ajustes
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] min-h-[520px] flex-col">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
            <Mail className="h-5 w-5 text-primary" />
            Correo
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {unread > 0
              ? `${unread} sin leer en la bandeja cargada`
              : 'Todo al día en la bandeja cargada'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => void loadMessages()} disabled={loading}>
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Actualizar
          </Button>
          <Button
            onClick={() =>
              setComposer({
                mode: 'new',
                to: '',
                subject: '',
                inReplyTo: null,
                references: null,
                text: '',
              })
            }
          >
            <PenSquare className="mr-2 h-4 w-4" />
            Nuevo correo
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]">
        {/* Lista */}
        <div className={cn('flex min-h-0 flex-col rounded-xl border border-border bg-card', selected && 'hidden lg:flex')}>
          <div className="space-y-2 border-b border-border p-3">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const next = query.trim();
                if (next === appliedQuery) void loadMessages();
                else setAppliedQuery(next);
              }}
              className="relative"
            >
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar en el correo…"
                className="pl-9"
              />
            </form>
            <div className="flex gap-2">
              <Select
                value={direction}
                onValueChange={(value) =>
                  setDirection(
                    value === 'inbound' || value === 'outbound' ? value : 'all',
                  )
                }
              >
                <SelectTrigger className="h-9 flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="inbound">Recibidos</SelectItem>
                  <SelectItem value="outbound">Enviados</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={mailboxFilter}
                onValueChange={(value) => setMailboxFilter(value ?? '__all__')}
              >
                <SelectTrigger className="h-9 flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">Todos los buzones</SelectItem>
                  {uniqueMailboxes.map((mailbox) => (
                    <SelectItem key={mailbox.mailboxId} value={mailbox.mailboxId}>
                      {mailbox.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading && messages.length === 0 ? (
              <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando…
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-6 py-16 text-center text-sm text-muted-foreground">
                <Inbox className="mb-3 h-8 w-8 opacity-50" />
                No hay correos con estos filtros.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {messages.map((message) => (
                  <li key={message.id}>
                    <button
                      type="button"
                      onClick={() => void openMessage(message)}
                      className={cn(
                        'flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50',
                        selectedId === message.id && 'bg-primary/5',
                        !message.read && 'bg-primary/[0.03]',
                      )}
                    >
                      <span className="mt-1.5 shrink-0">
                        {message.read ? (
                          <MailOpen className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <span className="block h-2 w-2 rounded-full bg-primary" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span
                            className={cn(
                              'truncate text-sm',
                              message.read
                                ? 'text-foreground'
                                : 'font-semibold text-foreground',
                            )}
                          >
                            {message.direction === 'outbound'
                              ? `Para: ${displayName(message.toAddr)}`
                              : displayName(message.fromAddr)}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {formatDate(message.createdAt)}
                          </span>
                        </span>
                        <span
                          className={cn(
                            'mt-0.5 block truncate text-sm',
                            message.read
                              ? 'text-muted-foreground'
                              : 'font-medium text-foreground',
                          )}
                        >
                          {message.subject?.trim() || '(sin asunto)'}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                          {message.snippet?.trim() || ''}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Lector / compositor */}
        <div className={cn('min-h-0 overflow-y-auto rounded-xl border border-border bg-card', !selected && !composer && 'hidden lg:block')}>
          {composer ? (
            <div className="p-4 sm:p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-base font-semibold text-foreground">
                  {composer.mode === 'reply' ? 'Responder' : 'Nuevo correo'}
                </h2>
                <Button variant="ghost" size="sm" onClick={() => setComposer(null)}>
                  Descartar
                </Button>
              </div>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="compose-to">Para</Label>
                  <Input
                    id="compose-to"
                    value={composer.to}
                    onChange={(event) =>
                      setComposer({ ...composer, to: event.target.value })
                    }
                    placeholder="cliente@ejemplo.com"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="compose-subject">Asunto</Label>
                  <Input
                    id="compose-subject"
                    value={composer.subject}
                    onChange={(event) =>
                      setComposer({ ...composer, subject: event.target.value })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="compose-text">Mensaje</Label>
                  <Textarea
                    id="compose-text"
                    value={composer.text}
                    onChange={(event) =>
                      setComposer({ ...composer, text: event.target.value })
                    }
                    rows={12}
                    placeholder="Escribe tu respuesta…"
                  />
                </div>
                <div className="flex items-center justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={() => setComposer(null)}
                    disabled={sending}
                  >
                    Cancelar
                  </Button>
                  <Button onClick={handleSend} disabled={sending}>
                    {sending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="mr-2 h-4 w-4" />
                    )}
                    Enviar
                  </Button>
                </div>
              </div>
            </div>
          ) : selected ? (
            <div className="flex min-h-full flex-col">
              <div className="border-b border-border p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="-ml-2 mb-1 lg:hidden"
                      onClick={() => setSelectedId(null)}
                    >
                      <ArrowLeft className="mr-1 h-4 w-4" /> Volver
                    </Button>
                    <h2 className="text-lg font-semibold text-foreground">
                      {selected.subject?.trim() || '(sin asunto)'}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      De <span className="text-foreground">{selected.fromAddr || '—'}</span>
                      {' · '}
                      Para <span className="text-foreground">{selected.toAddr || '—'}</span>
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {selected.createdAt
                        ? new Intl.DateTimeFormat('es-VE', {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          }).format(new Date(selected.createdAt))
                        : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {selected.direction === 'outbound' && (
                      <Badge variant="secondary" className="font-normal">
                        Enviado
                      </Badge>
                    )}
                    <Button size="sm" onClick={() => startReply(selected)}>
                      <PenSquare className="mr-2 h-4 w-4" />
                      Responder
                    </Button>
                  </div>
                </div>
                {selected.ccAddr && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    CC: {selected.ccAddr}
                  </p>
                )}
              </div>
              <div className="p-4 sm:p-5">
                <EmailBody message={selected} />
              </div>
            </div>
          ) : (
            <div className="flex h-full min-h-[320px] flex-col items-center justify-center p-8 text-center text-sm text-muted-foreground">
              <Mail className="mb-3 h-10 w-10 opacity-40" />
              Elige un correo para leerlo o escribe uno nuevo.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
