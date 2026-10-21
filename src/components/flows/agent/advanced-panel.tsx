"use client";

// ============================================================
// Panel de Configuración avanzada del agente (A4).
// Todo suma al estado del editor (un solo "Guardar agente") y llega
// al prompt del turno — ver agent-prompt.ts.
// ============================================================

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface AgentAdvanced {
  exit_message: string;
  response_quality: "concise" | "balanced" | "detailed";
  max_reply_buttons: number;
  max_reminders: number;
  follow_up_delay_minutes: number;
}

function SelectRow({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string | number;
  onChange: (next: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <Label className="text-sm text-foreground">{label}</Label>
      <Select
        value={String(value)}
        onValueChange={(v) => {
          if (typeof v === "string") onChange(v);
        }}
      >
        <SelectTrigger className="w-44 border-border">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="border-border bg-popover">
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value} className="text-sm">
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function AdvancedPanel({
  value,
  onChange,
}: {
  value: AgentAdvanced;
  onChange: (next: AgentAdvanced) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="exit-message">Comportamiento del agente · salida</Label>
        <Textarea
          id="exit-message"
          value={value.exit_message}
          onChange={(e) => onChange({ ...value, exit_message: e.target.value })}
          placeholder="Una vez alcanzados mis objetivos, resumiré la conversación y confirmaré el siguiente paso..."
          rows={3}
          maxLength={2000}
        />
        <p className="text-xs text-muted-foreground">
          Lo que el agente dice al cliente cuando el objetivo se cumplió — antes de dejar el turno a un humano.
        </p>
      </div>

      <div className="space-y-4 rounded-xl border border-border bg-card p-4">
        <SelectRow
          label="Calidad de la respuesta"
          value={value.response_quality}
          onChange={(v) => onChange({ ...value, response_quality: v as AgentAdvanced["response_quality"] })}
          options={[
            { value: "concise", label: "Muy corta" },
            { value: "balanced", label: "Equilibrada" },
            { value: "detailed", label: "Detallada" },
          ]}
        />
        <SelectRow
          label="Botones de respuesta (hasta)"
          value={value.max_reply_buttons}
          onChange={(v) => onChange({ ...value, max_reply_buttons: Number(v) })}
          options={[0, 1, 2, 3, 4].map((n) => ({
            value: String(n),
            label: n === 0 ? "Sin botones" : String(n),
          }))}
        />
        <SelectRow
          label="Recordatorios si no responde (hasta)"
          value={value.max_reminders}
          onChange={(v) => onChange({ ...value, max_reminders: Number(v) })}
          options={[0, 1, 2, 3, 4, 5].map((n) => ({
            value: String(n),
            label: n === 0 ? "Sin recordatorios" : String(n),
          }))}
        />
        <SelectRow
          label="Retraso del seguimiento"
          value={value.follow_up_delay_minutes}
          onChange={(v) => onChange({ ...value, follow_up_delay_minutes: Number(v) })}
          options={[
            { value: "5", label: "5 minutos" },
            { value: "15", label: "15 minutos" },
            { value: "30", label: "30 minutos" },
            { value: "60", label: "1 hora" },
            { value: "120", label: "2 horas" },
            { value: "240", label: "4 horas" },
            { value: "720", label: "12 horas" },
          ]}
        />
      </div>
    </div>
  );
}
