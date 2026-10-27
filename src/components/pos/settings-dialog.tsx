"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DollarSign,
  History,
  Loader2,
  Percent,
  Search,
  Store,
  Users,
  X,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";
import { formatBs, formatUsd, toNumber, usdToBs } from "@/lib/pos/money";

export type PosSettingsSection =
  | "negocio"
  | "moneda"
  | "impuestos"
  | "usuarios"
  | "bitacora";

type Section = PosSettingsSection;

interface SettingsForm {
  legal_name: string;
  tax_id: string;
  address: string;
  phone: string;
  receipt_title: string;
  receipt_footer: string;
  receipt_width: "58" | "80" | "letter";
  receipt_fields: Record<string, boolean>;
  rate_source: "bcv_usd" | "bcv_eur" | "manual";
  iva_rate: number;
  igtf_rate: number;
  iva_enabled: boolean;
  igtf_enabled: boolean;
  default_taxable: boolean;
  currency_primary: "USD" | "VES";
}

interface RateRow {
  id: string;
  rate_date: string;
  rate: number | string;
  source: string;
}

interface TeamRow {
  user_id: string;
  full_name: string | null;
  email: string | null;
  account_role: string | null;
}

interface LogRow {
  id: string;
  table_name: string;
  operation: string;
  actor_email: string | null;
  created_at: string;
}

const FIELDS: { key: string; label: string }[] = [
  { key: "legal_name", label: "Razón social" },
  { key: "tax_id", label: "RIF" },
  { key: "address", label: "Dirección" },
  { key: "phone", label: "Teléfono" },
  { key: "customer", label: "Cliente" },
  { key: "sku", label: "SKU de cada producto" },
  { key: "total_bs", label: "Total en bolívares" },
  { key: "rate", label: "Tasa de la venta" },
  { key: "notes", label: "Notas de la venta" },
];

const ROLE_LABEL: Record<string, string> = {
  owner: "Dueño",
  admin: "Administrador",
  agent: "Agente",
  viewer: "Visor",
};

const ROLE_CARDS: { role: string; label: string; description: string }[] = [
  {
    role: "owner",
    label: "Dueño",
    description:
      "Administra todo el negocio, su configuración y los accesos del equipo.",
  },
  {
    role: "admin",
    label: "Administrador",
    description:
      "Opera y consulta el negocio. Puede ver Ajustes y gestionar al equipo.",
  },
  {
    role: "agent",
    label: "Agente",
    description:
      "Vende y atiende conversaciones. Sin acceso a costos ni configuración.",
  },
  {
    role: "viewer",
    label: "Visor",
    description: "Consulta la información sin modificar nada.",
  },
];

function initials(value: string): string {
  const parts = value
    .replace(/@.*/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function lastSeenLabel(
  value?: { status: string; last_seen_at: string },
): string {
  if (!value?.last_seen_at) return "—";
  const date = new Date(value.last_seen_at);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es-VE", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

const DEFAULT_FORM: SettingsForm = {
  legal_name: "",
  tax_id: "",
  address: "",
  phone: "",
  receipt_title: "",
  receipt_footer: "¡Gracias por su compra!",
  receipt_width: "80",
  receipt_fields: {
    legal_name: true,
    tax_id: true,
    address: true,
    phone: true,
    customer: true,
    sku: true,
    total_bs: true,
    rate: true,
    notes: true,
  },
  rate_source: "manual",
  iva_rate: 16,
  igtf_rate: 3,
  iva_enabled: true,
  igtf_enabled: true,
  default_taxable: true,
  currency_primary: "USD",
};

export function PosSettingsDialog({
  open,
  onOpenChange,
  currentRate,
  onRateSaved,
  initialSection = "negocio",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentRate: number;
  onRateSaved: () => void;
  initialSection?: PosSettingsSection;
}) {
  const { accountId, account, user } = useAuth();
  const [section, setSection] = useState<Section>("negocio");
  const [form, setForm] = useState<SettingsForm>(DEFAULT_FORM);
  const [commercialName, setCommercialName] = useState("");
  const [manualRate, setManualRate] = useState("");
  const [rates, setRates] = useState<RateRow[]>([]);
  const [team, setTeam] = useState<TeamRow[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [teamSearch, setTeamSearch] = useState("");
  const [presence, setPresence] = useState<
    Record<string, { status: string; last_seen_at: string }>
  >({});
  const [inviteOpen, setInviteOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accountId) return;
    const supabase = createClient();
    setLoading(true);

    const [settingsRes, ratesRes, teamRes, logsRes, presenceRes] =
      await Promise.all([
      supabase
        .from("pos_settings")
        .select(
          "legal_name, tax_id, address, phone, receipt_title, receipt_footer, receipt_width, receipt_fields, rate_source, iva_rate, igtf_rate, iva_enabled, igtf_enabled, default_taxable, currency_primary",
        )
        .eq("account_id", accountId)
        .maybeSingle(),
      supabase
        .from("exchange_rates")
        .select("id, rate_date, rate, source")
        .eq("account_id", accountId)
        .order("rate_date", { ascending: false })
        .limit(20),
      supabase
        .from("profiles")
        .select("user_id, full_name, email, account_role")
        .eq("account_id", accountId),
      supabase
        .from("audit_logs")
        .select("id, table_name, operation, actor_email, created_at")
        .eq("account_id", accountId)
        .like("table_name", "pos_%")
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("member_presence")
        .select("user_id, status, last_seen_at")
        .eq("account_id", accountId),
    ]);

    const row = settingsRes.data as Record<string, unknown> | null;
    setForm({
      legal_name: (row?.legal_name as string) ?? "",
      tax_id: (row?.tax_id as string) ?? "",
      address: (row?.address as string) ?? "",
      phone: (row?.phone as string) ?? "",
      receipt_title: (row?.receipt_title as string) ?? "",
      receipt_footer:
        (row?.receipt_footer as string) ?? DEFAULT_FORM.receipt_footer,
      receipt_width: ((row?.receipt_width as string) ?? "80") as
        | "58"
        | "80"
        | "letter",
      receipt_fields: {
        ...DEFAULT_FORM.receipt_fields,
        ...((row?.receipt_fields as Record<string, boolean>) ?? {}),
      },
      rate_source: ((row?.rate_source as string) ?? "manual") as
        | "bcv_usd"
        | "bcv_eur"
        | "manual",
      iva_rate: toNumber(row?.iva_rate, 16),
      igtf_rate: toNumber(row?.igtf_rate, 3),
      iva_enabled: row?.iva_enabled !== false,
      igtf_enabled: row?.igtf_enabled !== false,
      default_taxable: row?.default_taxable !== false,
      currency_primary:
        row?.currency_primary === "VES" ? "VES" : "USD",
    });

    setManualRate(currentRate > 0 ? String(currentRate) : "");
    setRates((ratesRes.data ?? []) as RateRow[]);
    setTeam((teamRes.data ?? []) as TeamRow[]);
    setLogs((logsRes.data ?? []) as LogRow[]);
    setPresence(
      Object.fromEntries(
        (
          (presenceRes.data ?? []) as {
            user_id: string;
            status: string;
            last_seen_at: string;
          }[]
        ).map((row) => [
          row.user_id,
          { status: row.status, last_seen_at: row.last_seen_at },
        ]),
      ),
    );
    setLoading(false);
  }, [accountId, currentRate]);

  useEffect(() => {
    if (!open) return;
    setCommercialName(account?.name ?? "");
    setSection(initialSection);
    setMessage(null);
    setError(null);
    void load();
  }, [open, account?.name, load, initialSection]);

  const preview = useMemo(
    () => ({
      name: commercialName || "Tu comercio",
      legalName: form.legal_name,
      taxId: form.tax_id,
      address: form.address,
      phone: form.phone,
      title: form.receipt_title || "Comprobante de venta",
      footer: form.receipt_footer,
      fields: form.receipt_fields,
      rate: toNumber(manualRate),
      width: form.receipt_width,
    }),
    [commercialName, form, manualRate],
  );

  const filteredTeam = useMemo(() => {
    const term = teamSearch.trim().toLowerCase();
    if (!term) return team;
    return team.filter((member) => {
      const role = ROLE_LABEL[member.account_role ?? ""] ?? "";
      return (
        (member.full_name ?? "").toLowerCase().includes(term) ||
        (member.email ?? "").toLowerCase().includes(term) ||
        role.toLowerCase().includes(term)
      );
    });
  }, [team, teamSearch]);

  async function save() {
    if (!accountId) return;
    setSaving(true);
    setError(null);
    setMessage(null);

    const supabase = createClient();

    if (commercialName.trim() && commercialName.trim() !== account?.name) {
      const { error: nameError } = await supabase
        .from("accounts")
        .update({ name: commercialName.trim() })
        .eq("id", accountId);
      if (nameError) {
        setSaving(false);
        setError(nameError.message);
        return;
      }
    }

    const { error: settingsError } = await supabase
      .from("pos_settings")
      .upsert(
        {
          account_id: accountId,
          legal_name: form.legal_name || null,
          tax_id: form.tax_id || null,
          address: form.address || null,
          phone: form.phone || null,
          receipt_title: form.receipt_title || null,
          receipt_footer: form.receipt_footer || null,
          receipt_width: form.receipt_width,
          receipt_fields: form.receipt_fields,
          rate_source: form.rate_source,
          iva_rate: form.iva_rate,
          igtf_rate: form.igtf_rate,
          iva_enabled: form.iva_enabled,
          igtf_enabled: form.igtf_enabled,
          default_taxable: form.default_taxable,
          currency_primary: form.currency_primary,
        },
        { onConflict: "account_id" },
      );

    if (settingsError) {
      setSaving(false);
      setError(settingsError.message);
      return;
    }

    const rateValue = toNumber(manualRate);
    if (form.rate_source === "manual" && rateValue > 0) {
      const today = new Date().toISOString().slice(0, 10);
      const { error: rateError } = await supabase
        .from("exchange_rates")
        .upsert(
          {
            account_id: accountId,
            rate_date: today,
            rate: rateValue,
            source: "manual",
          },
          { onConflict: "account_id,rate_date,source" },
        );
      if (rateError) {
        setSaving(false);
        setError(rateError.message);
        return;
      }
      onRateSaved();
    }

    setSaving(false);
    setMessage("Ajustes guardados");
    void load();
  }

  if (!open) return null;

  const sections: { key: Section; label: string; icon: typeof Store }[] = [
    { key: "negocio", label: "Negocio", icon: Store },
    { key: "moneda", label: "Moneda", icon: DollarSign },
    { key: "impuestos", label: "Impuestos", icon: Percent },
    { key: "usuarios", label: "Usuarios y roles", icon: Users },
    { key: "bitacora", label: "Bitácora", icon: History },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
      <button
        type="button"
        aria-label="Cerrar"
        onClick={() => onOpenChange(false)}
        className="absolute inset-0 bg-slate-900/55 backdrop-blur-[2px]"
      />
      <div className="relative flex h-full max-h-[900px] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
          <div>
            <h2 className="text-xl font-black tracking-tight text-slate-900">
              Ajustes
            </h2>
            <p className="text-sm text-slate-500">
              Configura tu comercio, tu equipo y tu forma de trabajar.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          <nav className="w-56 shrink-0 space-y-0.5 border-r border-slate-100 p-3">
            {sections.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setSection(item.key)}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                  section === item.key
                    ? "bg-indigo-50 text-[#3f3fd8]"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </button>
            ))}
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            {loading ? (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-[#3f3fd8]" />
              </div>
            ) : (
              <>
                {section === "negocio" ? (
                  <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
                    <div className="space-y-5">
                      <SectionTitle
                        title="Negocio"
                        subtitle="Identidad del comercio y el comprobante que reciben tus clientes."
                      />

                      <Group title="Identidad">
                        <FieldRow label="Nombre del comercio" hint="Es obligatorio.">
                          <input
                            value={commercialName}
                            onChange={(event) =>
                              setCommercialName(event.target.value)
                            }
                            className={inputClass}
                          />
                        </FieldRow>
                        <FieldRow
                          label="Razón social"
                          hint="Si es distinta al nombre comercial."
                        >
                          <input
                            value={form.legal_name}
                            onChange={(event) =>
                              setForm((f) => ({
                                ...f,
                                legal_name: event.target.value,
                              }))
                            }
                            className={inputClass}
                          />
                        </FieldRow>
                        <FieldRow label="RIF" hint="Identificación tributaria.">
                          <input
                            value={form.tax_id}
                            onChange={(event) =>
                              setForm((f) => ({ ...f, tax_id: event.target.value }))
                            }
                            className={inputClass}
                          />
                        </FieldRow>
                      </Group>

                      <Group title="Contacto">
                        <FieldRow label="Teléfono" hint="Se imprime en el recibo.">
                          <input
                            value={form.phone}
                            onChange={(event) =>
                              setForm((f) => ({ ...f, phone: event.target.value }))
                            }
                            className={inputClass}
                          />
                        </FieldRow>
                        <FieldRow
                          label="Dirección"
                          hint="Se imprime bajo el nombre."
                        >
                          <input
                            value={form.address}
                            onChange={(event) =>
                              setForm((f) => ({
                                ...f,
                                address: event.target.value,
                              }))
                            }
                            className={inputClass}
                          />
                        </FieldRow>
                      </Group>

                      <Group title="Recibo">
                        <FieldRow
                          label="Título del recibo"
                          hint="Vacío: Comprobante de venta."
                        >
                          <input
                            value={form.receipt_title}
                            onChange={(event) =>
                              setForm((f) => ({
                                ...f,
                                receipt_title: event.target.value,
                              }))
                            }
                            placeholder="Comprobante de venta"
                            className={inputClass}
                          />
                        </FieldRow>

                        <div className="px-4 py-3">
                          <p className="text-xs font-semibold text-slate-700">
                            Formato de impresión
                          </p>
                          <p className="text-[11px] text-slate-500">
                            El ancho del papel donde imprimes.
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {(
                              [
                                ["58", "58 mm"],
                                ["80", "80 mm"],
                                ["letter", "Carta"],
                              ] as const
                            ).map(([value, label]) => (
                              <button
                                key={value}
                                type="button"
                                onClick={() =>
                                  setForm((f) => ({
                                    ...f,
                                    receipt_width: value,
                                  }))
                                }
                                className={`rounded-xl border px-4 py-2 text-xs font-semibold ${
                                  form.receipt_width === value
                                    ? "border-[#3f3fd8] bg-indigo-50 text-[#3f3fd8]"
                                    : "border-slate-200 text-slate-600"
                                }`}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <FieldRow
                          label="Pie del recibo"
                          hint="Texto al final del recibo."
                        >
                          <textarea
                            value={form.receipt_footer}
                            onChange={(event) =>
                              setForm((f) => ({
                                ...f,
                                receipt_footer: event.target.value.slice(0, 300),
                              }))
                            }
                            rows={2}
                            className={inputClass}
                          />
                        </FieldRow>

                        <div className="px-4 py-3">
                          <p className="text-xs font-semibold text-slate-700">
                            Datos que se muestran
                          </p>
                          <p className="text-[11px] text-slate-500">
                            Los datos vacíos no se imprimen.
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {FIELDS.map((field) => {
                              const active = form.receipt_fields[field.key] !== false;
                              return (
                                <button
                                  key={field.key}
                                  type="button"
                                  onClick={() =>
                                    setForm((f) => ({
                                      ...f,
                                      receipt_fields: {
                                        ...f.receipt_fields,
                                        [field.key]: !active,
                                      },
                                    }))
                                  }
                                  className={`rounded-full border px-3 py-1 text-[11px] font-semibold ${
                                    active
                                      ? "border-[#3f3fd8] bg-indigo-50 text-[#3f3fd8]"
                                      : "border-slate-200 text-slate-400"
                                  }`}
                                >
                                  {active ? "✓ " : ""}
                                  {field.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </Group>
                    </div>

                    <div className="lg:sticky lg:top-0">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Vista previa
                      </p>
                      <div className="mt-2 rounded-xl bg-slate-100/70 p-4">
                        <ReceiptPreview
                          name={preview.name}
                          legalName={preview.fields.legal_name ? preview.legalName : ""}
                          taxId={preview.fields.tax_id ? preview.taxId : ""}
                          address={preview.fields.address ? preview.address : ""}
                          phone={preview.fields.phone ? preview.phone : ""}
                          title={preview.title}
                          footer={preview.footer}
                          fields={preview.fields}
                          rate={preview.rate}
                          width={preview.width}
                        />
                      </div>
                    </div>
                  </div>
                ) : null}

                {section === "moneda" ? (
                  <div className="max-w-3xl space-y-5">
                    <SectionTitle
                      title="Moneda"
                      subtitle="Elige en qué moneda trabaja tu comercio y con qué tasa se convierte."
                    />

                    <div className="grid gap-3 sm:grid-cols-2">
                      {(
                        [
                          ["USD", "Dólares (USD)", "Los precios se ven como $"],
                          ["VES", "Bolívares (VES)", "Los precios se ven como Bs"],
                        ] as const
                      ).map(([value, label, hint]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() =>
                            setForm((f) => ({ ...f, currency_primary: value }))
                          }
                          className={`rounded-xl border p-4 text-left ${
                            form.currency_primary === value
                              ? "border-[#3f3fd8] bg-indigo-50/60"
                              : "border-slate-200 bg-white"
                          }`}
                        >
                          <p className="text-sm font-bold text-slate-800">
                            {label}
                          </p>
                          <p className="text-[11px] text-slate-500">{hint}</p>
                        </button>
                      ))}
                    </div>

                    <Group title="Tasa de cambio">
                      <div className="space-y-3 px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          {(
                            [
                              ["bcv_usd", "BCV dólar"],
                              ["bcv_eur", "BCV euro"],
                              ["manual", "Manual"],
                            ] as const
                          ).map(([value, label]) => (
                            <button
                              key={value}
                              type="button"
                              onClick={() =>
                                setForm((f) => ({ ...f, rate_source: value }))
                              }
                              className={`rounded-xl border px-3 py-1.5 text-xs font-semibold ${
                                form.rate_source === value
                                  ? "border-[#3f3fd8] bg-indigo-50 text-[#3f3fd8]"
                                  : "border-slate-200 text-slate-600"
                              }`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>

                        <label className="flex flex-col gap-1">
                          <span className="text-[11px] font-semibold text-slate-500">
                            Tasa actual (Bs por $ 1)
                          </span>
                          <input
                            value={manualRate}
                            onChange={(event) => setManualRate(event.target.value)}
                            inputMode="decimal"
                            placeholder="887302"
                            className={inputClass}
                          />
                          <span className="text-[10px] text-slate-400">
                            La actualización automática del BCV llegará en la
                            próxima entrega; por ahora se guarda la tasa manual.
                          </span>
                        </label>
                      </div>
                    </Group>

                    <div>
                      <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Historial de tasas
                      </p>
                      <div className="overflow-hidden rounded-xl border border-slate-200">
                        {rates.length === 0 ? (
                          <p className="px-4 py-6 text-center text-xs text-slate-500">
                            Todavía no hay tasas registradas.
                          </p>
                        ) : (
                          <table className="w-full text-xs">
                            <tbody className="divide-y divide-slate-100">
                              {rates.map((rate) => (
                                <tr key={rate.id}>
                                  <td className="px-4 py-2 text-slate-500">
                                    {new Intl.DateTimeFormat("es-VE", {
                                      day: "2-digit",
                                      month: "2-digit",
                                      year: "numeric",
                                    }).format(new Date(rate.rate_date))}
                                  </td>
                                  <td className="px-4 py-2">
                                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-500">
                                      {rate.source}
                                    </span>
                                  </td>
                                  <td className="px-4 py-2 text-right font-semibold text-slate-800">
                                    {formatBs(toNumber(rate.rate))}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </div>
                  </div>
                ) : null}

                {section === "impuestos" ? (
                  <div className="max-w-3xl space-y-5">
                    <SectionTitle
                      title="Impuestos"
                      subtitle="Consulta y ajusta los impuestos de tus ventas."
                    />

                    <Group title="Por producto">
                      <ToggleRow
                        title="IVA"
                        subtitle="Se aplica a los productos marcados como gravables."
                        enabled={form.iva_enabled}
                        onToggle={() =>
                          setForm((f) => ({ ...f, iva_enabled: !f.iva_enabled }))
                        }
                      >
                        <RateInput
                          value={form.iva_rate}
                          onChange={(value) =>
                            setForm((f) => ({ ...f, iva_rate: value }))
                          }
                          suffix="%"
                        />
                      </ToggleRow>

                      <ToggleRow
                        title="Gravable por defecto"
                        subtitle="Los productos nuevos nacen con IVA."
                        enabled={form.default_taxable}
                        onToggle={() =>
                          setForm((f) => ({
                            ...f,
                            default_taxable: !f.default_taxable,
                          }))
                        }
                      />
                    </Group>

                    <Group title="Sobre pago en divisa">
                      <ToggleRow
                        title="IGTF"
                        subtitle="Solo se cobra cuando el pago es en dólares."
                        enabled={form.igtf_enabled}
                        onToggle={() =>
                          setForm((f) => ({
                            ...f,
                            igtf_enabled: !f.igtf_enabled,
                          }))
                        }
                      >
                        <RateInput
                          value={form.igtf_rate}
                          onChange={(value) =>
                            setForm((f) => ({ ...f, igtf_rate: value }))
                          }
                          suffix="%"
                        />
                      </ToggleRow>
                    </Group>

                    <p className="rounded-xl bg-amber-50 px-4 py-3 text-[11px] text-amber-700">
                      Los cambios aplican a las ventas nuevas. Las ventas ya
                      registradas conservan los impuestos con los que se
                      cobraron.
                    </p>
                  </div>
                ) : null}

                {section === "usuarios" ? (
                  <div className="max-w-4xl space-y-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <SectionTitle
                        title="Usuarios y roles"
                        subtitle="Organiza los accesos de tu equipo y sus permisos."
                      />
                      <button
                        type="button"
                        onClick={() => setInviteOpen(true)}
                        className="rounded-xl bg-[#3f3fd8] px-4 py-2 text-sm font-bold text-white hover:bg-[#3535c4]"
                      >
                        Invitar usuario
                      </button>
                    </div>

                    <div className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2">
                      <Search className="h-4 w-4 text-slate-400" />
                      <input
                        value={teamSearch}
                        onChange={(event) => setTeamSearch(event.target.value)}
                        placeholder="Buscar por nombre, correo o rol..."
                        className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
                      />
                    </div>

                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Equipo
                      </p>
                      <p className="text-xs text-slate-500">
                        {filteredTeam.length}{" "}
                        {filteredTeam.length === 1
                          ? "persona con acceso"
                          : "personas con acceso"}
                      </p>

                      <div className="mt-2 space-y-2">
                        {filteredTeam.map((member) => {
                          const online =
                            presence[member.user_id]?.status === "online";
                          const role = member.account_role ?? "";
                          return (
                            <div
                              key={member.user_id}
                              className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3"
                            >
                              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xs font-bold text-[#3f3fd8]">
                                {initials(
                                  member.full_name ?? member.email ?? "",
                                )}
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="flex items-center gap-2 text-sm font-bold text-slate-800">
                                  {member.full_name || "Sin nombre"}
                                  {member.user_id === user?.id ? (
                                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-slate-500">
                                      Tú
                                    </span>
                                  ) : null}
                                </p>
                                <p className="truncate text-[11px] text-slate-400">
                                  {member.email}
                                </p>
                                <p className="text-[10px] text-slate-400">
                                  Último acceso:{" "}
                                  {lastSeenLabel(presence[member.user_id])}
                                </p>
                              </div>
                              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-600">
                                {ROLE_LABEL[role] ?? role ?? "—"}
                              </span>
                              <span
                                className={`flex items-center gap-1.5 text-[11px] font-semibold ${
                                  online ? "text-emerald-600" : "text-slate-400"
                                }`}
                              >
                                <span
                                  className={`h-1.5 w-1.5 rounded-full ${
                                    online ? "bg-emerald-500" : "bg-slate-300"
                                  }`}
                                />
                                {online ? "En línea" : "Inactivo"}
                              </span>
                            </div>
                          );
                        })}
                        {filteredTeam.length === 0 ? (
                          <p className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-xs text-slate-500">
                            Sin resultados para “{teamSearch}”.
                          </p>
                        ) : null}
                      </div>
                    </div>

                    <div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                            Roles y permisos
                          </p>
                          <p className="text-xs text-slate-500">
                            Los roles son fijos. Para cambiar el rol de alguien,
                            hazlo desde el CRM.
                          </p>
                        </div>
                        <a
                          href="/settings"
                          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
                        >
                          Gestionar en el CRM
                        </a>
                      </div>

                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        {ROLE_CARDS.map((card) => {
                          const count = team.filter(
                            (member) => member.account_role === card.role,
                          ).length;
                          return (
                            <div
                              key={card.role}
                              className="rounded-xl border border-slate-200 bg-white p-4"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-sm font-bold text-slate-800">
                                  {card.label}
                                </p>
                                <span className="text-[10px] font-semibold text-slate-400">
                                  {count === 0
                                    ? "Nadie aún"
                                    : `${count} ${
                                        count === 1 ? "persona" : "personas"
                                      }`}
                                </span>
                              </div>
                              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                                {card.description}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {inviteOpen ? (
                      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4">
                        <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
                          <h3 className="text-base font-black text-slate-900">
                            Invitar usuario
                          </h3>
                          <p className="mt-1 text-xs leading-relaxed text-slate-500">
                            Las invitaciones se envían por correo desde
                            Configuración del CRM. Allí eliges el rol y la
                            persona acepta desde el enlace.
                          </p>
                          <div className="mt-4 flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setInviteOpen(false)}
                              className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-50"
                            >
                              Cerrar
                            </button>
                            <a
                              href="/settings"
                              className="rounded-xl bg-[#3f3fd8] px-4 py-2 text-sm font-bold text-white"
                            >
                              Abrir Configuración
                            </a>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {section === "bitacora" ? (
                  <div className="max-w-4xl space-y-4">
                    <SectionTitle
                      title="Bitácora"
                      subtitle="Cambios recientes en el POS. Se registran automáticamente."
                    />

                    {logs.length === 0 ? (
                      <p className="rounded-xl border border-slate-200 px-4 py-8 text-center text-xs text-slate-500">
                        Todavía no hay movimientos registrados.
                      </p>
                    ) : (
                      <div className="overflow-hidden rounded-xl border border-slate-200">
                        <table className="w-full text-xs">
                          <thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500">
                            <tr>
                              <th className="px-4 py-2 font-semibold">Fecha</th>
                              <th className="px-4 py-2 font-semibold">Tabla</th>
                              <th className="px-4 py-2 font-semibold">Acción</th>
                              <th className="px-4 py-2 font-semibold">Usuario</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {logs.map((log) => (
                              <tr key={log.id}>
                                <td className="px-4 py-2 text-slate-500">
                                  {new Intl.DateTimeFormat("es-VE", {
                                    day: "2-digit",
                                    month: "short",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  }).format(new Date(log.created_at))}
                                </td>
                                <td className="px-4 py-2 font-medium text-slate-700">
                                  {log.table_name}
                                </td>
                                <td className="px-4 py-2">
                                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-500">
                                    {log.operation}
                                  </span>
                                </td>
                                <td className="px-4 py-2 text-slate-500">
                                  {log.actor_email || "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-slate-100 px-6 py-4">
          <div className="min-w-0 text-xs">
            {error ? (
              <span className="text-red-600">{error}</span>
            ) : message ? (
              <span className="text-emerald-600">{message}</span>
            ) : null}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-50"
            >
              Cerrar
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl bg-[#3f3fd8] px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Guardar cambios
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function SectionTitle({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div>
      <h3 className="text-lg font-black text-slate-900">{title}</h3>
      <p className="text-sm text-slate-500">{subtitle}</p>
    </div>
  );
}

function Group({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
        {title}
      </p>
      <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
        {children}
      </div>
    </div>
  );
}

function FieldRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-slate-700">{label}</p>
        {hint ? <p className="text-[11px] text-slate-500">{hint}</p> : null}
      </div>
      <div className="w-full sm:w-56">{children}</div>
    </div>
  );
}

function ToggleRow({
  title,
  subtitle,
  enabled,
  onToggle,
  children,
}: {
  title: string;
  subtitle: string;
  enabled: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-slate-700">{title}</p>
        <p className="text-[11px] text-slate-500">{subtitle}</p>
      </div>
      <div className="flex items-center gap-3">
        {children}
        <button
          type="button"
          onClick={onToggle}
          className={`relative h-5 w-9 rounded-full transition-colors ${
            enabled ? "bg-[#3f3fd8]" : "bg-slate-300"
          }`}
          aria-pressed={enabled}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
              enabled ? "left-4.5" : "left-0.5"
            }`}
          />
        </button>
      </div>
    </div>
  );
}

function RateInput({
  value,
  onChange,
  suffix,
}: {
  value: number;
  onChange: (value: number) => void;
  suffix: string;
}) {
  return (
    <div className="flex items-center gap-1">
      <input
        value={String(value)}
        onChange={(event) => onChange(toNumber(event.target.value))}
        inputMode="decimal"
        className="w-16 rounded-lg border border-slate-200 px-2 py-1 text-right text-xs outline-none focus:border-[#3f3fd8]"
      />
      <span className="text-xs text-slate-500">{suffix}</span>
    </div>
  );
}

function ReceiptPreview({
  name,
  legalName,
  taxId,
  address,
  phone,
  title,
  footer,
  fields,
  rate,
  width,
}: {
  name: string;
  legalName: string;
  taxId: string;
  address: string;
  phone: string;
  title: string;
  footer: string;
  fields: Record<string, boolean>;
  rate: number;
  width: "58" | "80" | "letter";
}) {
  const total = 10;
  const maxWidth =
    width === "58"
      ? "max-w-[190px]"
      : width === "letter"
        ? "max-w-[300px]"
        : "max-w-[240px]";
  const bsValue = formatBs(usdToBs(total, rate)).replace(/^Bs\s*/, "");

  return (
    <div
      className={`relative mx-auto ${maxWidth} rounded-t-lg bg-white px-4 py-4 text-center shadow-sm`}
    >
      <p className="text-xs font-bold text-slate-800">{name}</p>
      {legalName ? (
        <p className="text-[10px] leading-snug text-slate-500">{legalName}</p>
      ) : null}
      {taxId ? (
        <p className="text-[10px] text-slate-500">RIF: {taxId}</p>
      ) : null}
      {phone ? (
        <p className="text-[10px] text-slate-500">Tel: {phone}</p>
      ) : null}
      {address ? (
        <p className="text-[9px] leading-snug text-slate-400">{address}</p>
      ) : null}
      <div className="my-2 border-t border-dashed border-slate-300" />
      <p className="text-[11px] font-semibold text-slate-700">{title}</p>
      {fields.customer ? (
        <p className="text-[10px] text-slate-500">
          Cliente: Consumidor final
        </p>
      ) : null}
      <div className="my-2 border-t border-dashed border-slate-300" />
      <div className="flex items-start justify-between text-[10px]">
        <div className="text-left">
          <p className="font-medium text-slate-700">1 Producto de ejemplo</p>
          {fields.sku ? <p className="text-slate-400">SKU-001</p> : null}
        </div>
        <p className="font-semibold text-slate-800">{formatUsd(total)}</p>
      </div>
      <div className="my-2 border-t border-dashed border-slate-300" />
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-bold text-slate-800">TOTAL</span>
        <span className="font-bold text-slate-900">{formatUsd(total)}</span>
      </div>
      {fields.total_bs ? (
        <div className="flex items-center justify-between text-[10px] text-slate-500">
          <span>Total Bs</span>
          <span>{bsValue}</span>
        </div>
      ) : null}
      {fields.rate ? (
        <div className="flex items-center justify-between text-[10px] text-slate-500">
          <span>Tasa</span>
          <span>{rate > 0 ? rate.toLocaleString("es-VE") : "—"}</span>
        </div>
      ) : null}
      {fields.notes ? (
        <p className="mt-1 text-left text-[9px] text-slate-400">
          Nota: Notas de la venta
        </p>
      ) : null}
      {footer ? (
        <p className="mt-3 text-[9px] italic text-slate-500">{footer}</p>
      ) : null}
      <div className="mt-3 h-2 w-full bg-[linear-gradient(-45deg,transparent_33.33%,#f1f5f9_33.33%,#f1f5f9_66.66%,transparent_66.66%)] bg-[length:8px_8px]" />
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#3f3fd8]";
