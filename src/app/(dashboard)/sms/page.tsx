"use client";

import { useCallback, useEffect, useState } from "react";
import { MessageSquare, Send, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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
  const [deviceId, setDeviceId] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem("sms_device_id") ?? "" : "",
  );
  const [showConfig, setShowConfig] = useState(!deviceId);

  const sendSms = useCallback(async () => {
    if (!phone || !message) return;
    setSending(true);
    try {
      const res = await fetch("/api/sms/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: phone, message, deviceId }),
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
  }, [phone, message, deviceId]);

  const [lastReceived, setLastReceived] = useState<Array<{ from: string; message: string; receivedAt: string }>>([]);

  const fetchReceived = useCallback(async () => {
    try {
      const res = await fetch(`/api/sms/received?deviceId=${encodeURIComponent(deviceId)}`);
      if (res.ok) {
        const data = await res.json();
        setLastReceived(data.messages ?? []);
      }
    } catch {
      // silent
    }
  }, [deviceId]);

  useEffect(() => {
    if (!deviceId) return;
    const interval = setInterval(fetchReceived, 15000);
    fetchReceived();
    return () => clearInterval(interval);
  }, [deviceId, fetchReceived]);

  return (
    <div className="flex h-full flex-col gap-4 p-4 lg:p-6">
      {/* Config banner */}
      {showConfig && (
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-2 text-sm font-semibold text-foreground">SMS Gateway Configuration</h3>
          <p className="mb-3 text-xs text-muted-foreground">
            To send SMS you need a textbee.dev API key and device ID.
            Install the app on an Android phone and get your credentials from{" "}
            <a href="https://textbee.dev" target="_blank" rel="noopener noreferrer" className="text-primary underline">
              textbee.dev
            </a>
          </p>
          <div className="flex gap-2">
            <Input
              placeholder="Device ID"
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              className="max-w-xs"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                localStorage.setItem("sms_device_id", deviceId);
                setShowConfig(false);
                toast.success("Device saved");
              }}
            >
              Save
            </Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Send SMS */}
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 lg:col-span-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Send className="size-4" />
            Send SMS
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="+584141234567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="font-mono"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowConfig(true)}
              title="Change device"
            >
              <Smartphone className="size-4" />
            </Button>
          </div>
          <Textarea
            placeholder="Type your message..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
          />
          <Button onClick={sendSms} disabled={sending || !phone || !message || !deviceId} className="self-end">
            {sending ? "Sending..." : "Send"}
          </Button>
        </div>

        {/* Recent received */}
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <MessageSquare className="size-4" />
            Recent Received
          </div>
          <div className="flex flex-col gap-2 overflow-y-auto text-sm" style={{ maxHeight: 240 }}>
            {lastReceived.length === 0 && (
              <p className="text-xs text-muted-foreground">No messages received yet</p>
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
      </div>

      {/* Sent history */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-3 text-sm font-semibold text-foreground">Sent History</h3>
        {history.length === 0 && (
          <p className="text-xs text-muted-foreground">No messages sent yet</p>
        )}
        <div className="flex flex-col gap-2">
          {history.map((item) => (
            <div key={item.id} className="flex items-start gap-3 rounded-md bg-muted/30 p-3 text-sm">
              <div className="flex-1">
                <span className="font-medium text-foreground">{item.to}</span>
                <p className="text-xs text-muted-foreground">{item.message}</p>
                <span className="text-[10px] text-muted-foreground">
                  {new Date(item.sentAt).toLocaleString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
