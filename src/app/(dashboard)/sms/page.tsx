"use client";

import { useCallback, useEffect, useState } from "react";
import { MessageSquare, Send, Smartphone, KeyRound, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export default function SmsPage() {
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState<Array<{ to: string; message: string; sentAt: string }>>([]);

  const [deviceId, setDeviceId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showConfig, setShowConfig] = useState(true);

  useEffect(() => {
    const d = localStorage.getItem("sms_device_id");
    const k = localStorage.getItem("sms_api_key");
    if (d) setDeviceId(d);
    if (k) setApiKey(k);
    if (d && k) setShowConfig(false);
  }, []);

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

  const [lastReceived, setLastReceived] = useState<Array<{ from: string; message: string; receivedAt: string }>>([]);

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
    <div className="flex h-full flex-col gap-4 p-4 lg:p-6">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Total SMS Sent</span>
            <MessageSquare className="size-4 text-primary" />
          </div>
          <p className="mt-1 text-2xl font-bold text-foreground">{history.length}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Active Devices</span>
            <Smartphone className="size-4 text-primary" />
          </div>
          <p className="mt-1 text-2xl font-bold text-foreground">{deviceId ? 1 : 0}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">API Keys</span>
            <KeyRound className="size-4 text-primary" />
          </div>
          <p className="mt-1 text-2xl font-bold text-foreground">{apiKey ? 1 : 0}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-foreground">SMS Received</span>
            <Activity className="size-4 text-primary" />
          </div>
          <p className="mt-1 text-2xl font-bold text-foreground">{lastReceived.length}</p>
        </div>
      </div>

      {/* Main content */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Send SMS */}
        <div className="rounded-lg border border-border bg-card p-4 lg:col-span-2">
          <h3 className="mb-1 text-sm font-semibold text-foreground">Send SMS</h3>
          <p className="mb-3 text-xs text-muted-foreground">Send a message to any recipient</p>

          <div className="mb-3 flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
            <Smartphone className="size-4 text-muted-foreground" />
            <span className="flex-1 text-sm text-muted-foreground">
              {deviceId ? deviceId.slice(0, 16) + "..." : "No device configured"}
            </span>
            <button onClick={() => setShowConfig(true)} className="text-xs text-primary underline">
              {deviceId ? "Change" : "Configure"}
            </button>
          </div>

          <div className="flex flex-col gap-3">
            <Input
              placeholder="+584141234567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="font-mono"
            />
            <Textarea
              placeholder="Message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
            />
            <Button
              onClick={sendSms}
              disabled={sending || !phone || !message || !deviceId || !apiKey}
              className="self-start"
            >
              {sending ? "Sending..." : "Send Message"}
            </Button>
          </div>
        </div>

        {/* Received */}
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-semibold text-foreground">Recent Received</h3>
          {lastReceived.length === 0 && (
            <p className="py-4 text-center text-xs text-muted-foreground">No messages received yet</p>
          )}
          {lastReceived.map((msg, i) => (
            <div key={i} className="mb-2 rounded-md bg-muted/50 p-2">
              <span className="text-xs font-medium text-foreground">{msg.from}</span>
              <p className="text-xs text-muted-foreground">{msg.message}</p>
              <span className="text-[10px] text-muted-foreground">{new Date(msg.receivedAt).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Sent history */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold text-foreground">Sent History</h3>
        {history.length === 0 && (
          <p className="text-xs text-muted-foreground">No messages sent yet</p>
        )}
        {history.map((item, i) => (
          <div key={i} className="mb-2 rounded-md bg-muted/30 p-3">
            <div className="flex items-center gap-2 text-sm">
              <Send className="size-3 text-primary" />
              <span className="font-medium text-foreground">{item.to}</span>
              <span className="ml-auto text-[10px] text-muted-foreground">{new Date(item.sentAt).toLocaleString()}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{item.message}</p>
          </div>
        ))}
      </div>

      {/* Config modal */}
      {showConfig && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-lg">
            <h3 className="mb-4 text-lg font-semibold text-foreground">SMS Configuration</h3>
            <p className="mb-4 text-xs text-muted-foreground">
              Get credentials from{" "}
              <a href="https://app.textbee.dev/dashboard" target="_blank" rel="noopener noreferrer" className="text-primary underline">
                app.textbee.dev
              </a>
            </p>
            <div className="flex flex-col gap-3">
              <Input
                placeholder="Device ID"
                value={deviceId}
                onChange={(e) => setDeviceId(e.target.value)}
                className="font-mono text-sm"
              />
              <Input
                placeholder="API Key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="font-mono text-sm"
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowConfig(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  localStorage.setItem("sms_device_id", deviceId);
                  localStorage.setItem("sms_api_key", apiKey);
                  setShowConfig(false);
                  fetchReceived();
                  toast.success("Credentials saved");
                }}
              >
                Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
