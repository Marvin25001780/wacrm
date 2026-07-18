"use client";

import { useCallback, useEffect, useState } from "react";
import { MessageSquare, Send, Smartphone, KeyRound, Activity, BarChart3, Phone, History, Plus, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

interface SentMessage {
  id: string;
  to: string;
  message: string;
  sentAt: string;
}

export default function SmsPage() {
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState<SentMessage[]>([]);
  const [activeTab, setActiveTab] = useState<"send" | "bulk" | "history">("send");

  const [deviceId, setDeviceId] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem("sms_device_id") ?? "" : "",
  );
  const [apiKey, setApiKey] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem("sms_api_key") ?? "" : "",
  );
  const [showConfig, setShowConfig] = useState(!deviceId || !apiKey);
  const [configTab, setConfigTab] = useState<"device" | "apikey">("device");

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
      setHistory((prev) => [
        { id: crypto.randomUUID(), to: phone, message, sentAt: new Date().toISOString() },
        ...prev,
      ]);
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
      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Total SMS Sent</span>
            <MessageSquare className="size-4 text-primary" />
          </div>
          <p className="mt-1 text-2xl font-bold text-foreground">{history.length}</p>
          <span className="text-[10px] text-muted-foreground">Since last year</span>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Active Devices</span>
            <Smartphone className="size-4 text-primary" />
          </div>
          <p className="mt-1 text-2xl font-bold text-foreground">{deviceId ? 1 : 0}</p>
          <span className="text-[10px] text-muted-foreground">Connected now</span>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">API Keys</span>
            <KeyRound className="size-4 text-primary" />
          </div>
          <p className="mt-1 text-2xl font-bold text-foreground">{apiKey ? 1 : 0}</p>
          <span className="text-[10px] text-muted-foreground">Active keys</span>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">SMS Received</span>
            <Activity className="size-4 text-primary" />
          </div>
          <p className="mt-1 text-2xl font-bold text-foreground">{lastReceived.length}</p>
          <span className="text-[10px] text-muted-foreground">Since last year</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Left: Messaging tabs */}
        <div className="rounded-lg border border-border bg-card lg:col-span-2">
          {/* Tab bar */}
          <div className="flex border-b border-border">
            <button
              onClick={() => setActiveTab("send")}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
                activeTab === "send"
                  ? "border-b-2 border-primary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Send className="size-4" />
              Send
            </button>
            <button
              onClick={() => setActiveTab("bulk")}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
                activeTab === "bulk"
                  ? "border-b-2 border-primary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <BarChart3 className="size-4" />
              Bulk Send
            </button>
            <button
              onClick={() => setActiveTab("history")}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
                activeTab === "history"
                  ? "border-b-2 border-primary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <History className="size-4" />
              History
            </button>
          </div>

          {/* Tab content */}
          <div className="p-4">
            {activeTab === "send" && (
              <div className="flex flex-col gap-3">
                <h3 className="text-sm font-semibold text-foreground">Send SMS</h3>
                <p className="text-xs text-muted-foreground">Send a message to any recipient(s)</p>
                <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
                  <Smartphone className="size-4 text-muted-foreground" />
                  <span className="flex-1 text-sm text-muted-foreground">
                    {deviceId
                      ? `${deviceId.slice(0, 16)}...`
                      : "Select a device"}
                  </span>
                  <button
                    onClick={() => setShowConfig(true)}
                    className="text-xs text-primary underline"
                  >
                    {deviceId ? "Change" : "Configure"}
                  </button>
                </div>
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
                  {sending ? (
                    <span className="flex items-center gap-2">
                      <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      Sending...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <Send className="size-4" />
                      Send Message
                    </span>
                  )}
                </Button>
              </div>
            )}

            {activeTab === "bulk" && (
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <BarChart3 className="size-10 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Bulk sending will be available soon. You can upload a CSV file and send to multiple recipients at once.
                </p>
              </div>
            )}

            {activeTab === "history" && (
              <div className="flex flex-col gap-2">
                {history.length === 0 && (
                  <div className="flex flex-col items-center gap-3 py-8 text-center">
                    <History className="size-10 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">No messages sent yet</p>
                  </div>
                )}
                {history.map((item) => (
                  <div key={item.id} className="rounded-md bg-muted/30 p-3">
                    <div className="flex items-center gap-2 text-sm">
                      <Send className="size-3 text-primary" />
                      <span className="font-medium text-foreground">{item.to}</span>
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {new Date(item.sentAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{item.message}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Device info */}
        <div className="flex flex-col gap-4">
          {/* Received SMS */}
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Activity className="size-4" />
              Recent Received
            </div>
            <div className="mt-3 flex flex-col gap-2" style={{ maxHeight: 200 }}>
              {lastReceived.length === 0 && (
                <p className="py-4 text-center text-xs text-muted-foreground">No messages received yet</p>
              )}
              {lastReceived.map((msg, i) => (
                <div key={i} className="rounded-md bg-muted/50 p-2">
                  <span className="text-xs font-medium text-foreground">{msg.from}</span>
                  <p className="text-xs text-muted-foreground">{msg.message}</p>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(msg.receivedAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Connected device */}
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Registered Devices</h3>
              <Button variant="outline" size="sm" onClick={() => setShowConfig(true)}>
                <Plus className="size-3" />
                Add device
              </Button>
            </div>
            {deviceId && (
              <div className="mt-3 flex items-center gap-3 rounded-md bg-muted/30 p-3">
                <div className="flex size-8 items-center justify-center rounded-full bg-primary/10">
                  <Smartphone className="size-4 text-primary" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">TECNO KI5k</p>
                  <p className="text-xs font-mono text-muted-foreground">{deviceId.slice(0, 24)}...</p>
                </div>
                <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-400">
                  Enabled
                </span>
              </div>
            )}
            {!deviceId && (
              <p className="mt-3 text-xs text-muted-foreground">No device configured</p>
            )}
          </div>

          {/* API Key */}
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">API Keys</h3>
              <Button variant="outline" size="sm" onClick={() => setShowConfig(true)}>
                <Plus className="size-3" />
                Add API key
              </Button>
            </div>
            {apiKey && (
              <div className="mt-3 rounded-md bg-muted/30 p-3">
                <div className="flex items-center gap-2">
                  <KeyRound className="size-3 text-primary" />
                  <span className="flex-1 text-xs font-mono text-muted-foreground">
                    {apiKey.slice(0, 18)}...
                  </span>
                  <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-400">
                    Active
                  </span>
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Created at: Jul 4, 2026
                </p>
              </div>
            )}
            {!apiKey && (
              <p className="mt-3 text-xs text-muted-foreground">No API key configured</p>
            )}
          </div>
        </div>
      </div>

      {/* Config modal */}
      {showConfig && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-lg">
            <h3 className="mb-4 text-lg font-semibold text-foreground">SMS Gateway Configuration</h3>
            <p className="mb-4 text-xs text-muted-foreground">
              Get these credentials from{" "}
              <a href="https://app.textbee.dev/dashboard" target="_blank" rel="noopener noreferrer" className="text-primary underline">
                app.textbee.dev/dashboard
              </a>
            </p>
            <div className="flex gap-2 border-b border-border">
              <button
                onClick={() => setConfigTab("device")}
                className={`pb-2 text-sm font-medium ${
                  configTab === "device" ? "border-b-2 border-primary text-foreground" : "text-muted-foreground"
                }`}
              >
                Device
              </button>
              <button
                onClick={() => setConfigTab("apikey")}
                className={`pb-2 text-sm font-medium ${
                  configTab === "apikey" ? "border-b-2 border-primary text-foreground" : "text-muted-foreground"
                }`}
              >
                API Key
              </button>
            </div>
            <div className="mt-4 flex flex-col gap-3">
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
