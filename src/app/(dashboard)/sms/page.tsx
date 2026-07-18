"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export default function SmsPage() {
  const [ready, setReady] = useState(false);
  const [deviceId, setDeviceId] = useState("");
  const [apiKey, setApiKey] = useState("");

  useEffect(() => {
    setDeviceId(localStorage.getItem("sms_device_id") ?? "");
    setApiKey(localStorage.getItem("sms_api_key") ?? "");
    setReady(true);
  }, []);

  const save = () => {
    localStorage.setItem("sms_device_id", deviceId);
    localStorage.setItem("sms_api_key", apiKey);
    toast.success("Saved");
  };

  if (!ready) return null;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-4">
      <h1 className="text-2xl font-bold text-foreground">SMS</h1>
      <p className="text-sm text-muted-foreground">
        Device: {deviceId ? deviceId.slice(0, 16) + "..." : "Not configured"}
      </p>
      <p className="text-sm text-muted-foreground">
        API Key: {apiKey ? apiKey.slice(0, 8) + "..." : "Not configured"}
      </p>
      <div className="flex gap-2">
        <Input
          placeholder="Device ID"
          value={deviceId}
          onChange={(e) => setDeviceId(e.target.value)}
          className="max-w-60 font-mono"
        />
        <Input
          placeholder="API Key"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          className="max-w-60 font-mono"
        />
        <Button onClick={save}>Save</Button>
      </div>
    </div>
  );
}
