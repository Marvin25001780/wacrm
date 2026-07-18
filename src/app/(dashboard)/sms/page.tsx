"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export default function SmsPage() {
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState<Array<{ to: string; message: string; sentAt: string }>>([]);
  const [lastReceived, setLastReceived] = useState<Array<{ from: string; message: string; receivedAt: string }>>([]);

  const [deviceId, setDeviceId] = useState("");
  const [apiKey, setApiKey] = useState("");

  useEffect(() => {
    setDeviceId(localStorage.getItem("sms_device_id") ?? "");
    setApiKey(localStorage.getItem("sms_api_key") ?? "");
  }, []);

  const save = () => {
    localStorage.setItem("sms_device_id", deviceId);
    localStorage.setItem("sms_api_key", apiKey);
    toast.success("Saved");
  };

  const sendSms = useCallback(async () => {
    if (!phone || !message || !deviceId || !apiKey) return;
    setSending(true);
    try {
      const res = await fetch("/api/sms/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: phone, message, deviceId, apiKey }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "Error sending SMS");
      }
      toast.success("SMS sent successfully");
      setHistory((prev) => [{ to: phone, message, sentAt: new Date().toISOString() }, ...prev]);
      setPhone("");
      setMessage("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to send SMS");
    } finally {
      setSending(false);
    }
  }, [phone, message, deviceId, apiKey]);

  const fetchReceived = useCallback(async () => {
    if (!deviceId || !apiKey) return;
    try {
      const res = await fetch("/api/sms/received", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId, apiKey }),
      });
      if (res.ok) {
        const data = await res.json();
        setLastReceived(data.messages ?? []);
      }
    } catch {}
  }, [deviceId, apiKey]);

  useEffect(() => {
    if (!deviceId || !apiKey) return;
    const interval = setInterval(fetchReceived, 15000);
    fetchReceived();
    return () => clearInterval(interval);
  }, [deviceId, apiKey, fetchReceived]);

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <h1 className="text-2xl font-bold text-foreground">SMS</h1>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Total SMS Sent</p>
          <p className="mt-1 text-2xl font-bold text-foreground">{history.length}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Devices</p>
          <p className="mt-1 text-2xl font-bold text-foreground">{deviceId ? 1 : 0}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">API Keys</p>
          <p className="mt-1 text-2xl font-bold text-foreground">{apiKey ? 1 : 0}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Received</p>
          <p className="mt-1 text-2xl font-bold text-foreground">{lastReceived.length}</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* Send SMS */}
        <div className="col-span-2 rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold text-foreground">Send SMS</h3>
          <div className="flex flex-col gap-3">
            <Input placeholder="+584141234567" value={phone} onChange={(e) => setPhone(e.target.value)} className="font-mono" />
            <textarea
              className="flex min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
              placeholder="Message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
            />
            <Button onClick={sendSms} disabled={sending || !phone || !message} className="self-start">
              {sending ? "Sending..." : "Send Message"}
            </Button>
          </div>
        </div>

        {/* Recent Received */}
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold text-foreground">Recent Received</h3>
          {lastReceived.length === 0 && <p className="text-xs text-muted-foreground">No messages received yet</p>}
          {lastReceived.map((msg, i) => (
            <div key={i} className="mb-2 rounded-md bg-muted/50 p-2">
              <p className="text-xs font-medium text-foreground">{msg.from}</p>
              <p className="text-xs text-muted-foreground">{msg.message}</p>
              <p className="text-[10px] text-muted-foreground">{new Date(msg.receivedAt).toLocaleString()}</p>
            </div>
          ))}
        </div>
      </div>

      {/* History */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold text-foreground">Sent History</h3>
        {history.length === 0 && <p className="text-xs text-muted-foreground">No messages sent yet</p>}
        {history.map((item, i) => (
          <div key={i} className="mb-2 rounded-md bg-muted/30 p-3">
            <p className="text-sm font-medium text-foreground">{item.to}</p>
            <p className="text-xs text-muted-foreground">{item.message}</p>
            <p className="text-[10px] text-muted-foreground">{new Date(item.sentAt).toLocaleString()}</p>
          </div>
        ))}
      </div>

      {/* Config */}
      <div className="flex gap-2">
        <Input placeholder="Device ID" value={deviceId} onChange={(e) => setDeviceId(e.target.value)} className="max-w-60 font-mono" />
        <Input placeholder="API Key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="max-w-60 font-mono" />
        <Button onClick={save}>Save</Button>
      </div>
    </div>
  );
}
