"use client";

// ============================================================
// WhatsApp dentro de la consola de cobranza (migración 127).
//
// Reutiliza el mismo camino de envío que el inbox
// (/api/cobranza/whatsapp → sendMessageToConversation), así que no
// hay una segunda implementación de Meta. Aquí solo se pinta el hilo,
// se elige texto o plantilla y se respetan las reglas de WhatsApp:
//
//   - texto libre solo dentro de la ventana de 24 h;
//   - primer contacto siempre con plantilla aprobada;
//   - las variables {{1}}, {{2}}… se piden una por una.
//
// Si el deudor no tiene contacto, el servidor lo crea al enviar el
// primer mensaje (resolveConversationByPhone), igual que el inbox.
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCheck,
  Loader2,
  MessageCircle,
  RefreshCw,
  Send,
} from "lucide-react";
import { toast } from "sonner";

import { Panel } from "@/components/metrics/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  WHATSAPP_TEXT_LIMIT,
  canSendFreeText,
  fillTemplatePreview,
  formatWindowLeft,
  messagePreview,
  messageStatusLabel,
  serviceWindow,
  templateSupportsSimpleSend,
  templateVariableCount,
  type CollectionWhatsappMessage,
  type CollectionWhatsappTarget,
  type CollectionWhatsappTemplate,
} from "@/lib/collections/whatsapp";

interface WhatsappPanelProps {
  debtorId: string;
  debtorName: string;
  /** Se llama tras un envío correcto (la consola cambia el canal). */
  onSent?: () => void;
}

interface Payload {
  target: CollectionWhatsappTarget | null;
  messages: CollectionWhatsappMessage[];
  templates: CollectionWhatsappTemplate[];
  templatesError?: string | null;
}

const EMPTY: Payload = { target: null, messages: [], templates: [] };

export function WhatsappPanel({
  debtorId,
  debtorName,
  onSent,
}: WhatsappPanelProps) {
  const [data, setData] = useState<Payload>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<"text" | "template">("text");
  const [text, setText] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [params, setParams] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setLoadError(null);
      try {
        const response = await fetch(
          `/api/cobranza/whatsapp?debtor_id=${encodeURIComponent(debtorId)}`,
          { signal }
        );
        const json = (await response.json().catch(() => ({}))) as
          | Payload
          | { error?: string };

        if (!response.ok || !("target" in json)) {
          setData(EMPTY);
          setLoadError(
            ("error" in json && json.error) ||
              "No se pudo cargar el WhatsApp del deudor."
          );
          return;
        }

        setData({
          target: json.target,
          messages: json.messages ?? [],
          templates: json.templates ?? [],
          templatesError: json.templatesError ?? null,
        });
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setData(EMPTY);
        setLoadError("Sin conexión con el servidor.");
      } finally {
        setLoading(false);
      }
    },
    [debtorId]
  );

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    const node = threadRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [data.messages.length]);

  const target = data.target;
  const window = useMemo(() => serviceWindow(data.messages), [data.messages]);
  const canText = canSendFreeText(target, window);

  const usableTemplates = useMemo(
    () => data.templates.filter(templateSupportsSimpleSend),
    [data.templates]
  );
  const hiddenTemplates = data.templates.length - usableTemplates.length;
  const selectedTemplate = useMemo(
    () => usableTemplates.find((t) => t.name === templateName) ?? null,
    [templateName, usableTemplates]
  );
  const variableCount = selectedTemplate
    ? templateVariableCount(selectedTemplate.body_text)
    : 0;

  function chooseTemplate(name: string) {
    setTemplateName(name);
    setSendError(null);
    const found = usableTemplates.find((t) => t.name === name);
    const count = found ? templateVariableCount(found.body_text) : 0;
    setParams(Array.from({ length: count }, () => ""));
  }

  function switchTab(next: "text" | "template") {
    setTab(next);
    setSendError(null);
  }

  async function send() {
    if (sending || !target) return;
    setSending(true);
    setSendError(null);

    try {
      const body =
        tab === "text"
          ? {
              debtor_id: debtorId,
              message_type: "text",
              content_text: text,
            }
          : {
              debtor_id: debtorId,
              message_type: "template",
              template_name: templateName,
              template_params: params,
            };

      const response = await fetch("/api/cobranza/whatsapp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        setSendError(json.error ?? "No se pudo enviar el mensaje.");
        return;
      }

      toast.success("Mensaje enviado por WhatsApp");
      setText("");
      setParams((current) => current.map(() => ""));
      await load();
      onSent?.();
    } catch {
      setSendError("Sin conexión con el servidor. El mensaje no se envió.");
    } finally {
      setSending(false);
    }
  }

  const phone = target?.phone_e164 ?? target?.phone ?? null;

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4" />
          WhatsApp
        </span>
      }
      subtitle={
        target
          ? `${target.display_name} · ${target.phone_e164 ?? "sin teléfono válido"}`
          : debtorName
      }
      actions={
        <div className="flex items-center gap-2">
          {target?.unread_count ? (
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">
              {target.unread_count} sin leer
            </span>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => void load()}
            disabled={loading}
            title="Actualizar hilo"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      }
    >
      {loading && !target ? (
        <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Cargando conversación…
        </div>
      ) : loadError ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          {loadError}
        </div>
      ) : !target ? (
        <p className="text-sm text-muted-foreground">
          No se encontró el deudor.
        </p>
      ) : (
        <div className="space-y-3">
          {!target.whatsapp_configured ? (
            <Banner tone="amber">
              La cuenta no tiene línea de WhatsApp configurada. Ve a{" "}
              <span className="font-medium">Ajustes → WhatsApp</span> antes de
              enviar.
            </Banner>
          ) : !target.whatsapp_connected ? (
            <Banner tone="amber">
              La línea figura desconectada en Ajustes → WhatsApp. El envío puede
              fallar hasta reconectarla.
            </Banner>
          ) : null}

          {data.templatesError ? (
            <Banner tone="amber">
              No se pudieron leer las plantillas: {data.templatesError}
            </Banner>
          ) : null}

          <div
            ref={threadRef}
            className="max-h-56 space-y-2 overflow-y-auto rounded-lg border border-border bg-muted/20 p-3"
          >
            {data.messages.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">
                Todavía no hay conversación. El primer mensaje la crea y debe
                salir como plantilla aprobada.
              </p>
            ) : (
              data.messages.map((message) => (
                <MessageBubble key={message.message_id} message={message} />
              ))
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-2 py-1",
                window.open
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                  : "border-border bg-muted/40 text-muted-foreground"
              )}
            >
              <CheckCheck className="h-3.5 w-3.5" />
              {formatWindowLeft(window)}
            </span>
            <span className="text-muted-foreground">
              La ventana de 24 h la abre el último mensaje del deudor.
            </span>
          </div>

          <div className="flex gap-1 rounded-lg border border-border bg-muted/40 p-1">
            <TabButton
              active={tab === "text"}
              onClick={() => switchTab("text")}
              label="Texto"
            />
            <TabButton
              active={tab === "template"}
              onClick={() => switchTab("template")}
              label="Plantilla"
            />
          </div>

          {tab === "text" ? (
            <div className="space-y-2">
              {!window.open ? (
                <Banner tone="amber">
                  Fuera de la ventana de 24 h. WhatsApp no permite texto libre:
                  usa una plantilla aprobada o espera a que el deudor escriba.
                </Banner>
              ) : null}
              <Textarea
                rows={3}
                value={text}
                maxLength={WHATSAPP_TEXT_LIMIT}
                onChange={(event) => setText(event.target.value)}
                disabled={!canText || sending}
                placeholder={
                  window.open
                    ? "Escribe el mensaje para el deudor…"
                    : "Ventana cerrada: envía una plantilla"
                }
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-muted-foreground">
                  {text.length}/{WHATSAPP_TEXT_LIMIT}
                </span>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void send()}
                  disabled={!canText || sending || !text.trim()}
                >
                  {sending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="mr-2 h-4 w-4" />
                  )}
                  Enviar texto
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="space-y-1.5">
                <Label htmlFor="wa-template">Plantilla aprobada</Label>
                <select
                  id="wa-template"
                  className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  value={templateName}
                  onChange={(event) => chooseTemplate(event.target.value)}
                  disabled={sending || usableTemplates.length === 0}
                >
                  <option value="">Selecciona…</option>
                  {usableTemplates.map((template) => (
                    <option key={template.id} value={template.name}>
                      {template.name}
                      {template.category ? ` · ${template.category}` : ""}
                    </option>
                  ))}
                </select>
                {usableTemplates.length === 0 ? (
                  <p className="text-xs text-amber-300">
                    No hay plantillas aprobadas para enviar. Créalas o
                    sincronízalas en Ajustes → WhatsApp.
                  </p>
                ) : null}
                {hiddenTemplates > 0 ? (
                  <p className="text-[11px] text-muted-foreground">
                    {hiddenTemplates} plantilla
                    {hiddenTemplates === 1 ? "" : "s"} con encabezado variable
                    no se muestra aquí (requiere un formulario de encabezado).
                  </p>
                ) : null}
              </div>

              {selectedTemplate ? (
                <>
                  <div className="rounded-lg border border-border bg-muted/30 p-2.5 text-xs whitespace-pre-wrap text-foreground">
                    {fillTemplatePreview(selectedTemplate.body_text, params)}
                  </div>
                  {Array.from({ length: variableCount }).map((_, index) => (
                    <div key={index} className="space-y-1">
                      <Label htmlFor={`wa-param-${index}`}>
                        {`Variable {{${index + 1}}}`}
                      </Label>
                      <Input
                        id={`wa-param-${index}`}
                        value={params[index] ?? ""}
                        onChange={(event) => {
                          const next = [...params];
                          next[index] = event.target.value;
                          setParams(next);
                        }}
                        placeholder={
                          index === 0 ? debtorName : "Valor de la variable"
                        }
                        disabled={sending}
                      />
                    </div>
                  ))}
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void send()}
                      disabled={
                        sending ||
                        !selectedTemplate ||
                        params.slice(0, variableCount).some((v) => !v.trim())
                      }
                    >
                      {sending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="mr-2 h-4 w-4" />
                      )}
                      Enviar plantilla
                    </Button>
                  </div>
                </>
              ) : null}
            </div>
          )}

          {sendError ? <Banner tone="red">{sendError}</Banner> : null}

          {phone ? (
            <p className="text-[11px] text-muted-foreground">
              Si el agente necesita responder desde su teléfono, el número es{" "}
              <span className="font-medium text-foreground">{phone}</span>.
            </p>
          ) : null}
        </div>
      )}
    </Panel>
  );
}

function MessageBubble({ message }: { message: CollectionWhatsappMessage }) {
  const inbound = message.sender_type === "customer";
  return (
    <div className={cn("flex", inbound ? "justify-start" : "justify-end")}>
      <div
        className={cn(
          "max-w-[85%] rounded-xl px-2.5 py-1.5 text-xs whitespace-pre-wrap",
          inbound
            ? "border border-border bg-card text-foreground"
            : "bg-primary/15 text-foreground"
        )}
      >
        <p className="break-words">{messagePreview(message)}</p>
        <p
          className={cn(
            "mt-1 flex items-center gap-1 text-[10px] text-muted-foreground",
            inbound ? "justify-start" : "justify-end"
          )}
        >
          {formatTime(message.created_at)}
          {!inbound ? ` · ${messageStatusLabel(message.status)}` : ""}
        </p>
      </div>
    </div>
  );
}

function TabButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
        active
          ? "bg-card text-foreground shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      {label}
    </button>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: "amber" | "red";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2 text-xs",
        tone === "amber"
          ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
          : "border-red-500/30 bg-red-500/10 text-red-300"
      )}
    >
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

const timeFormatter = new Intl.DateTimeFormat("es-VE", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : timeFormatter.format(date);
}
