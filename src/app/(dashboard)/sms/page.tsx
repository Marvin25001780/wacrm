"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

function SmsIcon({ type }: { type: "send" | "sms" | "key" | "device" | "history" | "upload" | "bulk" | "clock" }) {
  const paths: Record<string, string> = {
    send: "M3 12l18-9-9 18-4-9z",
    sms: "M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z",
    key: "M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.78 7.78 5.5 5.5 0 017.78-7.78zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4",
    device: "M22 12h-4l-3 9L9 3l-3 9H2",
    history: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
    upload: "M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4m7-1l3 3m0 0l3-3m-3 3V3",
    bulk: "M17 20v-5m-5 5v-9M7 20v-3m13 3h-4M9 12l-4 4m0 0l4 4m-4-4h16",
    clock: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
  };
  return (
    <svg className="size-4 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={paths[type] || paths.sms} />
    </svg>
  );
}

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("58") && digits.length >= 11) return `+${digits}`;
  return phone.startsWith("+") ? phone : `+${digits}`;
}

export default function SmsPage() {
  const [tab, setTab] = useState<"dashboard" | "messaging">("dashboard");
  const [msgTab, setMsgTab] = useState<"send" | "bulk" | "history">("send");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState<Array<{ to: string; message: string; sentAt: string }>>([]);
  const [lastReceived, setLastReceived] = useState<Array<{ from: string; message: string; receivedAt: string }>>([]);
  const [deviceId, setDeviceId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showConfig, setShowConfig] = useState(false);

  // Bulk send state
  const [csvData, setCsvData] = useState<Array<Record<string, string>>>([]);
  const [csvColumns, setCsvColumns] = useState<string[]>([]);
  const [selectedColumn, setSelectedColumn] = useState("");
  const [bulkTemplate, setBulkTemplate] = useState("");
  const [delaySeconds, setDelaySeconds] = useState(5);
  const [bulkSending, setBulkSending] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ sent: 0, total: 0, fallidos: 0 });
  const [previewRecipient, setPreviewRecipient] = useState("");
  const cancelRef = useRef(false);

  useEffect(() => {
    const d = localStorage.getItem("sms_device_id") ?? "";
    const k = localStorage.getItem("sms_api_key") ?? "";
    setDeviceId(d);
    setApiKey(k);
  }, []);

  const saveConfig = () => {
    localStorage.setItem("sms_device_id", deviceId);
    localStorage.setItem("sms_api_key", apiKey);
    setShowConfig(false);
    toast.success("Credenciales guardadas");
  };

  const sendSms = useCallback(async () => {
    if (!phone || !message || !deviceId || !apiKey) return;
    setSending(true);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25000);
      const res = await fetch("/api/sms/send", {
        signal: controller.signal,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: formatPhone(phone), message, deviceId, apiKey }),
      });
      clearTimeout(timeout);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Error al enviar SMS");
      }
      toast.success("SMS enviado exitosamente");
      setHistory((prev) => [{ to: phone, message, sentAt: new Date().toISOString() }, ...prev]);
      setPhone("");
      setMessage("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al enviar SMS");
    } finally {
      setSending(false);
    }
  }, [phone, message, deviceId, apiKey]);

  const fetchReceived = useCallback(async () => {
    if (!deviceId || !apiKey) return;
    try {
      const res = await fetch("/api/sms/received", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceId, apiKey }) });
      if (res.ok) {
        const data = await res.json();
        setLastReceived(data.messages ?? []);
      }
    } catch {}
  }, [deviceId, apiKey]);

  useEffect(() => {
    if (!deviceId || !apiKey) return;
    fetchReceived();
    const interval = setInterval(fetchReceived, 15000);
    return () => clearInterval(interval);
  }, [deviceId, apiKey, fetchReceived]);

  // CSV upload handler
  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1048576) { toast.error("Archivo demasiado grande (m\u00e1x 1MB)"); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split("\n").filter(Boolean);
      if (lines.length < 2) { toast.error("El CSV debe tener una fila de encabezado y al menos una fila de datos"); return; }
      const headers = lines[0].split(",").map((h) => h.trim());
      const rows = lines.slice(1).map((line) => {
        const vals = line.split(",").map((v) => v.trim());
        const row: Record<string, string> = {};
        headers.forEach((h, i) => { row[h] = vals[i] || ""; });
        return row;
      });
      setCsvColumns(headers);
      setCsvData(rows);
      if (!selectedColumn && headers.length > 0) setSelectedColumn(headers[0]);
      toast.success(`Cargados ${rows.length} contactos`);
    };
    reader.readAsText(file);
  };

  // Bulk send
  const startBulkSend = async () => {
    if (!deviceId || !apiKey || !selectedColumn || !bulkTemplate || csvData.length === 0) return;
    cancelRef.current = false;
    setBulkSending(true);
    setBulkProgress({ sent: 0, total: csvData.length, fallidos: 0 });

    for (let i = 0; i < csvData.length; i++) {
      if (cancelRef.current) break;
      const row = csvData[i];
      let msg = bulkTemplate;
      csvColumns.forEach((col) => { msg = msg.replaceAll(`{{ ${col} }}`, row[col] || ""); });
      const recipient = row[selectedColumn];
      if (!recipient) { setBulkProgress((p) => ({ ...p, fallidos: p.fallidos + 1 })); continue; }

      try {
        const res = await fetch("/api/sms/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to: formatPhone(recipient), message: msg, deviceId, apiKey }),
        });
        if (!res.ok) throw new Error();
        setBulkProgress((p) => ({ ...p, sent: p.sent + 1 }));
        setHistory((prev) => [{ to: recipient, message: msg, sentAt: new Date().toISOString() }, ...prev]);
      } catch {
        setBulkProgress((p) => ({ ...p, fallidos: p.fallidos + 1 }));
      }

      if (i < csvData.length - 1 && delaySeconds > 0) {
        await new Promise((r) => setTimeout(r, delaySeconds * 1000));
      }
    }

    setBulkSending(false);
    toast.success(`Envío masivo completado: ${bulkProgress.sent} enviados, ${bulkProgress.fallidos} fallidos`);
  };

  // Preview for selected recipient
  const getPreview = () => {
    if (!previewRecipient || !bulkTemplate) return null;
    const row = csvData.find((r) => r[selectedColumn] === previewRecipient);
    if (!row) return null;
    let msg = bulkTemplate;
    csvColumns.forEach((col) => { msg = msg.replaceAll(`{{ ${col} }}`, row[col] || ""); });
    return { phone: row[selectedColumn], message: msg };
  };

  return (
    <div className="flex h-full flex-col gap-4 p-4 lg:p-6">
      {/* Top nav tabs */}
      <div className="flex gap-6 border-b border-border pb-2">
        <button onClick={() => setTab("dashboard")} className={`pb-2 text-sm font-medium transition-colors ${tab === "dashboard" ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground"}`}>Panel</button>
        <button onClick={() => setTab("messaging")} className={`pb-2 text-sm font-medium transition-colors ${tab === "messaging" ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground"}`}>Mensajer\u00eda</button>
        <button onClick={() => setShowConfig(true)} className="pb-2 text-sm font-medium text-muted-foreground hover:text-foreground">Cuenta</button>
      </div>

      {tab === "dashboard" && (
        <div className="flex flex-col gap-4">
          <p className="text-lg font-semibold text-foreground">Bienvenido de nuevo, Aaron Carrillo</p>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center justify-between"><span className="text-xs font-medium text-muted-foreground">Total de SMS Enviados</span><SmsIcon type="send" /></div>
              <p className="mt-1 text-2xl font-bold text-foreground">{history.length}</p>
              <span className="text-[10px] text-muted-foreground">Desde el a\u00f1o pasado</span>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center justify-between"><span className="text-xs font-medium text-muted-foreground">Dispositivos Activos</span><SmsIcon type="device" /></div>
              <p className="mt-1 text-2xl font-bold text-foreground">{deviceId ? 1 : 0}</p>
              <span className="text-[10px] text-muted-foreground">Conectado ahora</span>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center justify-between"><span className="text-xs font-medium text-muted-foreground">Claves de API</span><SmsIcon type="key" /></div>
              <p className="mt-1 text-2xl font-bold text-foreground">{apiKey ? 1 : 0}</p>
              <span className="text-[10px] text-muted-foreground">Claves activas</span>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center justify-between"><span className="text-xs font-medium text-muted-foreground">SMS Recibidos</span><SmsIcon type="sms" /></div>
              <p className="mt-1 text-2xl font-bold text-foreground">{lastReceived.length}</p>
              <span className="text-[10px] text-muted-foreground">Desde el a\u00f1o pasado</span>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Claves de API</h3>
              <Button variant="outline" size="sm" onClick={() => window.open("https://app.textbee.dev/dashboard", "_blank")}>Agregar clave de API</Button>
            </div>
            {apiKey && (
              <div className="mt-3 rounded-md bg-muted/30 p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2"><SmsIcon type="key" /><span className="text-xs font-mono text-muted-foreground">{apiKey.slice(0, 18)}**********</span></div>
                  <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-400">Activo</span>
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">Creada el: 4 de julio de 2026</p>
                <p className="text-[10px] text-muted-foreground">\u00daltimo uso: {new Date().toLocaleDateString()}</p>
              </div>
            )}
            {!apiKey && <p className="mt-3 text-xs text-muted-foreground">No hay clave de API configurada</p>}
          </div>
        </div>
      )}

      {tab === "messaging" && (
        <div className="flex flex-col gap-4">
          <div className="flex gap-4 border-b border-border pb-2">
            <button onClick={() => setMsgTab("send")} className={`pb-2 text-sm font-medium ${msgTab === "send" ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground"}`}>Enviar</button>
            <button onClick={() => setMsgTab("bulk")} className={`pb-2 text-sm font-medium ${msgTab === "bulk" ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground"}`}>Env\u00edo Masivo</button>
            <button onClick={() => setMsgTab("history")} className={`pb-2 text-sm font-medium ${msgTab === "history" ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground"}`}>Historial</button>
          </div>

          {msgTab === "send" && (
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="mb-1 text-sm font-semibold text-foreground">Enviar SMS</h3>
              <p className="mb-3 text-xs text-muted-foreground">Env\u00eda un mensaje a cualquier destinatario</p>
              <div className="mb-3 flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
                <SmsIcon type="device" />
                <span className="flex-1 text-sm text-muted-foreground">{deviceId ? deviceId.slice(0, 16) + "..." : "Seleccionar un dispositivo"}</span>
                <button onClick={() => setShowConfig(true)} className="text-xs text-primary underline">{deviceId ? "Cambiar" : "Configurar"}</button>
              </div>
              <div className="flex flex-col gap-3">
                <Input placeholder="Agregar destinatario" value={phone} onChange={(e) => setPhone(e.target.value)} className="font-mono" />
                <textarea className="flex min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm" placeholder="Mensaje" value={message} onChange={(e) => setMessage(e.target.value)} rows={3} />
                <Button onClick={sendSms} disabled={sending || !phone || !message} className="self-start">{sending ? "Enviando..." : "Enviar mensaje"}</Button>
              </div>
            </div>
          )}

          {msgTab === "bulk" && (
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="mb-1 text-sm font-semibold text-foreground">Enviar SMS Masivos</h3>
              <p className="mb-4 text-xs text-muted-foreground">Sube un CSV, configura tu mensaje y env\u00eda SMS masivos en 3 simples pasos.</p>

              {/* Step 1: Upload CSV */}
              <div className="mb-4">
                <p className="mb-2 text-sm font-medium text-foreground">1. Subir CSV</p>
                <div className="rounded-lg border-2 border-dashed border-border bg-muted/20 p-6 text-center">
                  <SmsIcon type="upload" />
                  <p className="mt-2 text-sm text-muted-foreground">Sube un archivo CSV con informaci\u00f3n de los destinatarios.</p>
                  <label className="mt-2 inline-block cursor-pointer rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                    Seleccionar archivo CSV
                    <input type="file" accept=".csv" onChange={handleCsvUpload} className="hidden" />
                  </label>
                  {csvData.length > 0 && <p className="mt-2 text-xs text-muted-foreground">{csvData.length} contactos cargados</p>}
                  <p className="mt-1 text-[10px] text-muted-foreground">Tama\u00f1o m\u00e1ximo: 1MB</p>
                </div>
              </div>

              {/* Step 2: Configure */}
              <div className="mb-4">
                <p className="mb-2 text-sm font-medium text-foreground">2. Configurar SMS</p>
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
                    <SmsIcon type="device" />
                    <span className="text-sm text-muted-foreground">{deviceId ? "Dispositivo: " + deviceId.slice(0, 12) + "..." : "Sin dispositivo"}</span>
                  </div>
                  <select value={selectedColumn} onChange={(e) => setSelectedColumn(e.target.value)} className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm">
                    <option value="">Seleccionar Columna de Destinatarios</option>
                    {csvColumns.filter((c) => c !== selectedColumn).map((col) => (<option key={col} value={col}>{col}</option>))}
                    {csvColumns.includes(selectedColumn) && <option value={selectedColumn}>{selectedColumn}</option>}
                  </select>
                  <textarea value={bulkTemplate} onChange={(e) => setBulkTemplate(e.target.value)} className="flex min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base transition-colors placeholder:text-muted-foreground focus-visible:border-ring md:text-sm" placeholder={'Ingresa tu plantilla de mensaje aqu\u00ed. Usa {{ nombre_columna }} para contenido din\u00e1mico.'} rows={3} />
                  {/* Delay configuration */}
                  <div className="flex items-center gap-2">
                    <SmsIcon type="clock" />
                    <span className="text-xs text-muted-foreground">Retraso entre SMS:</span>
                    <select value={delaySeconds} onChange={(e) => setDelaySeconds(Number(e.target.value))} className="h-7 rounded-md border border-input bg-transparent px-2 text-xs">
                      <option value={1}>1 segundo</option>
                      <option value={3}>3 segundos</option>
                      <option value={5}>5 segundos</option>
                      <option value={10}>10 segundos</option>
                      <option value={15}>15 segundos</option>
                      <option value={30}>30 segundos</option>
                      <option value={60}>1 minuto</option>
                    </select>
                    <span className="text-[10px] text-muted-foreground">Est. total: {csvData.length > 0 && delaySeconds > 0 ? `${Math.ceil((csvData.length * delaySeconds) / 60)} min` : "N/A"}</span>
                  </div>
                </div>
              </div>

              {/* Step 3: Preview */}
              <div className="mb-4">
                <p className="mb-2 text-sm font-medium text-foreground">3. Vista Previa del Mensaje</p>
                <select value={previewRecipient} onChange={(e) => setPreviewRecipient(e.target.value)} className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm">
                  <option value="">Seleccionar un destinatario</option>
                  {csvData.map((row, i) => {
                    const val = selectedColumn ? row[selectedColumn] : `Row ${i + 1}`;
                    return <option key={i} value={val}>{val}</option>;
                  })}
                </select>
                {getPreview() && (
                  <div className="mt-2 rounded-md bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">Para: {getPreview()?.phone}</p>
                    <p className="mt-1 text-sm text-foreground">{getPreview()?.message}</p>
                  </div>
                )}
              </div>

              {/* Progress */}
              {bulkSending && (
                <div className="mb-4">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Enviando: {bulkProgress.sent} / {bulkProgress.total}</span>
                    <span>Fallidos: {bulkProgress.fallidos}</span>
                    <span>{Math.round((bulkProgress.sent / bulkProgress.total) * 100)}%</span>
                  </div>
                  <div className="mt-1 h-2 w-full rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(bulkProgress.sent / bulkProgress.total) * 100}%` }} />
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <Button onClick={startBulkSend} disabled={bulkSending || !deviceId || !apiKey || !selectedColumn || !bulkTemplate || csvData.length === 0} className="self-start">
                  {bulkSending ? `Sending... (${bulkProgress.sent}/${bulkProgress.total})` : "Enviar SMS Masivos"}
                </Button>
                {bulkSending && <Button variant="outline" size="sm" onClick={() => { cancelRef.current = true; toast.info("Cancelando..."); }} className="self-start">Cancelar</Button>}
              </div>
            </div>
          )}

          {msgTab === "history" && (
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="mb-3 text-sm font-semibold text-foreground">Historial de Env\u00edos</h3>
              {history.length === 0 && <p className="text-xs text-muted-foreground">A\u00fan no se han enviado mensajes</p>}
              {history.map((item, i) => (
                <div key={i} className="mb-2 rounded-md bg-muted/30 p-3">
                  <div className="flex items-center gap-2 text-sm">
                    <SmsIcon type="send" />
                    <span className="font-medium text-foreground">{item.to}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">{new Date(item.sentAt).toLocaleString()}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{item.message}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showConfig && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-lg">
            <h3 className="mb-4 text-lg font-semibold text-foreground">Configuraci\u00f3n de la Cuenta</h3>
            <p className="mb-4 text-xs text-muted-foreground">Obt\u00e9n credenciales de <a href="https://app.textbee.dev/dashboard" target="_blank" rel="noopener noreferrer" className="text-primary underline">app.textbee.dev</a></p>
            <div className="flex flex-col gap-3">
              <Input placeholder="ID del Dispositivo" value={deviceId} onChange={(e) => setDeviceId(e.target.value)} className="font-mono" />
              <Input placeholder="Clave de API" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="font-mono" />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowConfig(false)}>Cancelar</Button>
              <Button size="sm" onClick={saveConfig}>Guardar</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
