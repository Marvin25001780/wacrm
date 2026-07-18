"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export default function SmsPage() {
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

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <h1 className="text-2xl font-bold text-foreground">SMS</h1>

      <div className="grid grid-cols-4 gap-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Total SMS Sent</p>
          <p className="mt-1 text-2xl font-bold text-foreground">0</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Devices</p>
          <p className="mt-1 text-2xl font-bold text-foreground">0</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">API Keys</p>
          <p className="mt-1 text-2xl font-bold text-foreground">0</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Received</p>
          <p className="mt-1 text-2xl font-bold text-foreground">0</p>
        </div>
      </div>

      <div className="flex gap-2">
        <Input placeholder="Device ID" value={deviceId} onChange={(e) => setDeviceId(e.target.value)} className="max-w-60 font-mono" />
        <Input placeholder="API Key" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="max-w-60 font-mono" />
        <Button onClick={save}>Save</Button>
      </div>
    </div>
  );
}
