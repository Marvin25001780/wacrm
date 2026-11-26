"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { BookOpen, Loader2, Save, ShieldCheck } from "lucide-react";

import { SkeletonCard } from "@/components/dashboard/skeleton";
import { Panel } from "@/components/metrics/panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCan } from "@/hooks/use-can";
import {
  DEFAULT_RESPONSE_SLA_MINUTES,
  normalizeSlaMinutes,
} from "@/lib/collections/response";
import {
  COLLECTION_TRAMOS,
  type CollectionCommissionRule,
  type CollectionPolicy,
  type CollectionSettings,
} from "@/types/collections";

const selectClass =
  "h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

export default function ConfiguracionPage() {
  const supabase = createClient();
  const { accountId } = useAuth();
  const canEdit = useCan("edit-settings");

  const [settings, setSettings] = useState<CollectionSettings | null>(null);
  const [policies, setPolicies] = useState<CollectionPolicy[]>([]);
  const [commissions, setCommissions] = useState<CollectionCommissionRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);

    const [settingsRes, policiesRes, commissionsRes] = await Promise.all([
      supabase.from("collection_settings").select("*").maybeSingle(),
      supabase.from("collection_policies").select("*").order("tramo"),
      supabase.from("collection_commission_rules").select("*").order("tramo"),
    ]);

    setLoading(false);

    if (settingsRes.error || policiesRes.error || commissionsRes.error) {
      console.error("[cobranza/configuracion] load error", {
        settings: settingsRes.error,
        policies: policiesRes.error,
        commissions: commissionsRes.error,
      });
      toast.error("No se pudo cargar la configuración");
      return;
    }

    setSettings((settingsRes.data ?? null) as CollectionSettings | null);
    setPolicies((policiesRes.data ?? []) as CollectionPolicy[]);
    setCommissions((commissionsRes.data ?? []) as CollectionCommissionRule[]);
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load, accountId]);

  function updatePolicy(id: string, patch: Partial<CollectionPolicy>) {
    setPolicies((current) =>
      current.map((policy) => (policy.id === id ? { ...policy, ...patch } : policy)),
    );
  }

  function updateCommission(id: string, patch: Partial<CollectionCommissionRule>) {
    setCommissions((current) =>
      current.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)),
    );
  }

  // Repara una base donde la 078 no sembró las políticas/comisiones.
  // La función es idempotente: no pisa valores ya configurados.
  async function seedDefaults() {
    if (!accountId) return;
    setSeeding(true);
    try {
      const { error } = await supabase.rpc("collection_seed_account_defaults", {
        p_account_id: accountId,
      });
      if (error) {
        console.error("[cobranza/configuracion] seed error", error);
        toast.error(
          "No se pudieron sembrar los valores. Aplica PROD_UPDATE_133.sql en Supabase.",
        );
        return;
      }
      await load();
      toast.success("Valores por defecto sembrados.");
    } finally {
      setSeeding(false);
    }
  }

  async function handleSave() {
    if (!accountId) return;
    setSaving(true);

    try {
      const settingsPayload = settings
        ? {
            account_id: accountId,
            country_code: settings.country_code,
            timezone: settings.timezone,
            currency: "USD" as const,
            business_hours_start: settings.business_hours_start,
            business_hours_end: settings.business_hours_end,
            knowledge_base_url: settings.knowledge_base_url?.trim() || null,
            response_sla_minutes: normalizeSlaMinutes(
              settings.response_sla_minutes,
            ),
          }
        : {
            account_id: accountId,
            country_code: "VE",
            timezone: "America/Caracas",
            currency: "USD" as const,
            business_hours_start: "09:00",
            business_hours_end: "18:00",
            knowledge_base_url: null,
            response_sla_minutes: DEFAULT_RESPONSE_SLA_MINUTES,
          };

      // Las columnas de 125 (wiki) y 129 (SLA) pueden no existir aún en
      // una base atrasada. Se reintenta sin ellas para no perder el
      // trabajo del admin por una migración pendiente.
      const firstSettings = await supabase
        .from("collection_settings")
        .upsert(settingsPayload, { onConflict: "account_id" });
      let settingsError = firstSettings.error;
      const skippedColumns: string[] = [];

      if (settingsError?.code === "42703") {
        const baseSettings = {
          account_id: settingsPayload.account_id,
          country_code: settingsPayload.country_code,
          timezone: settingsPayload.timezone,
          currency: settingsPayload.currency,
          business_hours_start: settingsPayload.business_hours_start,
          business_hours_end: settingsPayload.business_hours_end,
        };

        const withSla = await supabase
          .from("collection_settings")
          .upsert(
            {
              ...baseSettings,
              response_sla_minutes: settingsPayload.response_sla_minutes,
            },
            { onConflict: "account_id" },
          );
        settingsError = withSla.error;

        if (!withSla.error) {
          skippedColumns.push("el enlace de la wiki");
        } else if (withSla.error.code === "42703") {
          const retry = await supabase
            .from("collection_settings")
            .upsert(baseSettings, { onConflict: "account_id" });
          settingsError = retry.error;
          if (!retry.error) {
            skippedColumns.push("el SLA de respuesta", "el enlace de la wiki");
          }
        }
      }

      if (settingsError) throw settingsError;

      const policyQueries = policies.map((policy) =>
        supabase
          .from("collection_policies")
          .update({
            max_discount_pct: Number(policy.max_discount_pct),
            max_attempts_per_day: Number(policy.max_attempts_per_day),
            allowed_start: policy.allowed_start,
            allowed_end: policy.allowed_end,
            ptp_max_days: Number(policy.ptp_max_days),
            ptp_grace_days: Number(policy.ptp_grace_days),
            min_down_payment_pct: Number(policy.min_down_payment_pct),
            target_recovery_pct: Number(policy.target_recovery_pct),
            script_template: policy.script_template,
            active: policy.active,
          })
          .eq("id", policy.id)
          .eq("account_id", accountId),
      );

      const commissionQueries = commissions.map((rule) =>
        supabase
          .from("collection_commission_rules")
          .update({
            percentage: Number(rule.percentage),
            active: rule.active,
          })
          .eq("id", rule.id)
          .eq("account_id", accountId),
      );

      const results = await Promise.all([...policyQueries, ...commissionQueries]);
      const failed = results.find((result) => result.error);
      if (failed?.error) throw failed.error;

      toast.success(
        skippedColumns.length > 0
          ? `Políticas guardadas. ${skippedColumns.join(" y ")} se guardarán al aplicar la migración pendiente.`
          : "Políticas guardadas"
      );
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudieron guardar las políticas");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <SkeletonCard className="h-40" />
        <SkeletonCard className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Políticas de cobranza</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Tramos, topes de gestión, acuerdos y comisiones. Los cambios aplican a
            nuevas gestiones; las PTP ya creadas no se recalculan.
          </p>
        </div>
        {canEdit ? (
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Guardar cambios
          </Button>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted px-3 py-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" />
            Solo administradores pueden editar
          </span>
        )}
      </div>

      <Panel title="Operación" subtitle="País, zona horaria y moneda de la cobranza">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2">
            <Label className="text-muted-foreground">País</Label>
            <select
              value={settings?.country_code ?? "VE"}
              onChange={(event) =>
                setSettings((current) =>
                  current
                    ? { ...current, country_code: event.target.value }
                    : {
                        account_id: accountId ?? "",
                        country_code: event.target.value,
                        timezone: "America/Caracas",
                        currency: "USD",
                        business_hours_start: "09:00",
                        business_hours_end: "18:00",
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString(),
                      },
                )
              }
              disabled={!canEdit}
              className={selectClass}
            >
              <option value="VE">Venezuela</option>
              <option value="US">Estados Unidos</option>
              <option value="MX">México</option>
              <option value="CO">Colombia</option>
              <option value="CL">Chile</option>
              <option value="AR">Argentina</option>
            </select>
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground">Zona horaria</Label>
            <Input
              value={settings?.timezone ?? "America/Caracas"}
              onChange={(event) =>
                setSettings((current) =>
                  current ? { ...current, timezone: event.target.value } : current,
                )
              }
              disabled={!canEdit}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground">Inicio de gestión</Label>
            <Input
              type="time"
              value={(settings?.business_hours_start ?? "09:00").slice(0, 5)}
              onChange={(event) =>
                setSettings((current) =>
                  current ? { ...current, business_hours_start: event.target.value } : current,
                )
              }
              disabled={!canEdit}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground">Fin de gestión</Label>
            <Input
              type="time"
              value={(settings?.business_hours_end ?? "18:00").slice(0, 5)}
              onChange={(event) =>
                setSettings((current) =>
                  current ? { ...current, business_hours_end: event.target.value } : current,
                )
              }
              disabled={!canEdit}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-muted-foreground">
              SLA de respuesta (min)
            </Label>
            <Input
              type="number"
              min={1}
              max={1440}
              value={settings?.response_sla_minutes ?? DEFAULT_RESPONSE_SLA_MINUTES}
              onChange={(event) =>
                setSettings((current) =>
                  current
                    ? {
                        ...current,
                        response_sla_minutes: normalizeSlaMinutes(
                          event.target.value,
                        ),
                      }
                    : current,
                )
              }
              disabled={!canEdit}
            />
          </div>
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          Moneda fija del módulo: <span className="font-medium text-foreground">USD</span>. Los
          teléfonos se normalizan con el país seleccionado.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          El SLA es el tiempo máximo para contestar el primer mensaje de
          WhatsApp. La consola y la supervisión lo usan para colorear la espera;
          no bloquea el envío de mensajes.
        </p>
      </Panel>

      <Panel
        title="Base de conocimiento"
        subtitle="Guiones, procedimientos y respuestas frecuentes para el agente"
      >
        <div className="space-y-2">
          <Label className="text-muted-foreground">Enlace de la wiki</Label>
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
            <Input
              value={settings?.knowledge_base_url ?? ""}
              onChange={(event) =>
                setSettings((current) =>
                  current
                    ? { ...current, knowledge_base_url: event.target.value }
                    : {
                        account_id: accountId ?? "",
                        country_code: "VE",
                        timezone: "America/Caracas",
                        currency: "USD",
                        business_hours_start: "09:00",
                        business_hours_end: "18:00",
                        knowledge_base_url: event.target.value,
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString(),
                      },
                )
              }
              disabled={!canEdit}
              placeholder="https://wiki.tudominio.com/espacio/cobranza"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Se abre como enlace externo desde la consola del agente. Docmost encaja
            bien aquí, pero cualquier wiki con URL sirve: el CRM no copia su
            contenido ni lo indexa.
          </p>
        </div>
      </Panel>

      <Panel title="Políticas por tramo" subtitle="Reglas que validan gestiones y acuerdos">
        {policies.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              No hay políticas configuradas: la migración 078 no sembró los
              valores por defecto en esta base.
            </p>
            {canEdit && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void seedDefaults()}
                disabled={seeding}
              >
                {seeding && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                Sembrar valores por defecto
              </Button>
            )}
            <p className="text-xs text-muted-foreground">
              Si el botón falla, aplica <code>PROD_UPDATE_133.sql</code> en
              Supabase y recarga.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {policies.map((policy) => {
              const meta = COLLECTION_TRAMOS.find((item) => item.value === policy.tramo);
              return (
                <div key={policy.id} className="rounded-xl border border-border p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">
                        {meta?.label ?? policy.tramo}
                      </h3>
                      <p className="text-xs text-muted-foreground">{meta?.days}</p>
                    </div>
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={policy.active}
                        onChange={(event) =>
                          updatePolicy(policy.id, { active: event.target.checked })
                        }
                        disabled={!canEdit}
                        className="h-3.5 w-3.5 accent-primary"
                      />
                      Activa
                    </label>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Descuento máx. %</Label>
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        step="0.5"
                        value={policy.max_discount_pct}
                        onChange={(event) =>
                          updatePolicy(policy.id, {
                            max_discount_pct: Number(event.target.value),
                          })
                        }
                        disabled={!canEdit}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Intentos / día</Label>
                      <Input
                        type="number"
                        min="1"
                        step="1"
                        value={policy.max_attempts_per_day}
                        onChange={(event) =>
                          updatePolicy(policy.id, {
                            max_attempts_per_day: Number(event.target.value),
                          })
                        }
                        disabled={!canEdit}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">PTP máx. días</Label>
                      <Input
                        type="number"
                        min="1"
                        step="1"
                        value={policy.ptp_max_days}
                        onChange={(event) =>
                          updatePolicy(policy.id, { ptp_max_days: Number(event.target.value) })
                        }
                        disabled={!canEdit}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Abono mín. %</Label>
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        step="0.5"
                        value={policy.min_down_payment_pct}
                        onChange={(event) =>
                          updatePolicy(policy.id, {
                            min_down_payment_pct: Number(event.target.value),
                          })
                        }
                        disabled={!canEdit}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Meta recuperación %</Label>
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        step="0.5"
                        value={policy.target_recovery_pct}
                        onChange={(event) =>
                          updatePolicy(policy.id, {
                            target_recovery_pct: Number(event.target.value),
                          })
                        }
                        disabled={!canEdit}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Gracia PTP días</Label>
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        value={policy.ptp_grace_days}
                        onChange={(event) =>
                          updatePolicy(policy.id, { ptp_grace_days: Number(event.target.value) })
                        }
                        disabled={!canEdit}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Desde</Label>
                      <Input
                        type="time"
                        value={policy.allowed_start.slice(0, 5)}
                        onChange={(event) =>
                          updatePolicy(policy.id, { allowed_start: event.target.value })
                        }
                        disabled={!canEdit}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Hasta</Label>
                      <Input
                        type="time"
                        value={policy.allowed_end.slice(0, 5)}
                        onChange={(event) =>
                          updatePolicy(policy.id, { allowed_end: event.target.value })
                        }
                        disabled={!canEdit}
                      />
                    </div>
                  </div>

                  <div className="mt-3 space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Guion sugerido</Label>
                    <Textarea
                      value={policy.script_template ?? ""}
                      onChange={(event) =>
                        updatePolicy(policy.id, { script_template: event.target.value })
                      }
                      rows={2}
                      placeholder="Guion de apertura y cierre para este tramo"
                      disabled={!canEdit}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      <Panel title="Comisiones" subtitle="Porcentaje sobre el monto recuperado">
        {commissions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No hay reglas de comisión. Se siembran junto con las políticas:
            usa “Sembrar valores por defecto” en Políticas por tramo (arriba).
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tramo</TableHead>
                <TableHead>Comisión %</TableHead>
                <TableHead>Activa</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {commissions.map((rule) => {
                const meta = COLLECTION_TRAMOS.find((item) => item.value === rule.tramo);
                return (
                  <TableRow key={rule.id}>
                    <TableCell className="font-medium">
                      {meta?.label ?? rule.tramo}
                      <span className="ml-2 text-xs text-muted-foreground">{meta?.days}</span>
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        step="0.5"
                        value={rule.percentage}
                        onChange={(event) =>
                          updateCommission(rule.id, { percentage: Number(event.target.value) })
                        }
                        disabled={!canEdit}
                        className="w-28"
                      />
                    </TableCell>
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={rule.active}
                        onChange={(event) =>
                          updateCommission(rule.id, { active: event.target.checked })
                        }
                        disabled={!canEdit}
                        className="h-3.5 w-3.5 accent-primary"
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          La comisión se calcula sobre los pagos del mes usando el tramo del crédito al
          momento del reporte.
        </p>
      </Panel>
    </div>
  );
}
