"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Boxes,
  Building2,
  ChartNoAxesColumn,
  ChevronRight,
  CircleHelp,
  LayoutDashboard,
  Loader2,
  LogOut,
  Settings,
  ShoppingCart,
  Tags,
  Users,
  Wallet,
} from "lucide-react";

import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";
import { isModuleEnabled } from "@/lib/modules";
import { PosRateProvider, usePosRate } from "@/components/pos/rate-context";
import { PosSettingsDialog } from "@/components/pos/settings-dialog";
import { formatBs, formatUsd } from "@/lib/pos/money";

const ACCENT = "#3f3fd8";

interface NavLeaf {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  soon?: boolean;
}

interface NavGroup {
  label: string;
  icon: typeof LayoutDashboard;
  href?: string;
  children?: NavLeaf[];
}

const NAV: NavGroup[] = [
  { href: "/pos", label: "Inicio", icon: LayoutDashboard },
  {
    label: "Ventas",
    icon: ShoppingCart,
    children: [
      { href: "/pos/vender", label: "Vender", icon: ShoppingCart },
      { href: "/pos/ventas", label: "Historial", icon: ChartNoAxesColumn },
    ],
  },
  { href: "/pos/catalogo", label: "Catálogo", icon: Tags },
  { href: "/pos/inventario", label: "Inventario", icon: Boxes } as NavLeaf,
  { href: "/contacts", label: "Contactos", icon: Users },
  { href: "/pos/finanzas", label: "Finanzas", icon: Wallet, soon: true } as NavLeaf,
  { href: "/pos/informes", label: "Informes", icon: ChartNoAxesColumn, soon: true } as NavLeaf,
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/pos") return pathname === "/pos";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function PosShell({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <PosRateProvider>
        <PosFrame>{children}</PosFrame>
      </PosRateProvider>
    </AuthProvider>
  );
}

function PosFrame({ children }: { children: ReactNode }) {
  const { user, loading, account, enabledModules, signOut } = useAuth();
  const { rate, refresh } = usePosRate();
  const [rateOpen, setRateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  // El POS respeta los módulos del negocio: si se desactiva, no se
  // puede entrar ni por URL directa.
  useEffect(() => {
    if (!loading && user && !isModuleEnabled(enabledModules, "pos")) {
      router.replace("/inbox");
    }
  }, [loading, user, enabledModules, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f5f6fb]">
        <Loader2 className="h-6 w-6 animate-spin text-[#3f3fd8]" />
      </div>
    );
  }
  if (!user) return null;

  return (
    <div className="min-h-screen bg-[#f5f6fb] text-slate-800">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 backdrop-blur">
        <div className="flex h-16 items-center gap-4 px-4 sm:px-6">
          <Link href="/pos" className="flex items-center gap-2">
            <span className="text-lg font-black tracking-tight text-[#3f3fd8]">
              NEXUS
            </span>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
              POS
            </span>
            <span className="ml-2 hidden text-sm font-semibold text-slate-700 sm:block">
              {account?.name ?? "Mi negocio"}
            </span>
          </Link>

          <div className="ml-auto flex items-center gap-2">
            <RateChip open={rateOpen} onOpenChange={setRateOpen} />
            <Link
              href="/inbox"
              className="hidden items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 sm:flex"
            >
              <CircleHelp className="h-3.5 w-3.5" />
              Ir al CRM
            </Link>
            <button
              type="button"
              onClick={() => void signOut()}
              className="rounded-full border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"
              title="Cerrar sesión"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1600px] gap-4 px-3 py-4 sm:px-5">
        <Sidebar onOpenSettings={() => setSettingsOpen(true)} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>

      <PosSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        currentRate={rate}
        onRateSaved={() => void refresh()}
      />
    </div>
  );
}

function Sidebar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const pathname = usePathname();
  const [openSales, setOpenSales] = useState(
    pathname.startsWith("/pos/vender") || pathname.startsWith("/pos/ventas"),
  );

  return (
    <aside className="hidden w-60 shrink-0 lg:block">
      <div className="sticky top-20 rounded-2xl border border-slate-200 bg-white p-2">
        <nav className="space-y-0.5">
          {NAV.map((item) => {
            const isGroup = Boolean(item.children);
            const active = item.href ? isActive(pathname, item.href) : false;
            const groupActive = isGroup
              ? item.children!.some((child) => isActive(pathname, child.href))
              : false;

            if (isGroup) {
              return (
                <div key={item.label}>
                  <button
                    type="button"
                    onClick={() => setOpenSales((v) => !v)}
                    className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${
                      groupActive
                        ? "bg-[#3f3fd8] text-white"
                        : "text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                    <ChevronRight
                      className={`ml-auto h-4 w-4 transition-transform ${
                        openSales ? "rotate-90" : ""
                      }`}
                    />
                  </button>
                  {openSales ? (
                    <div className="ml-3 mt-1 space-y-0.5 border-l border-slate-200 pl-3">
                      {item.children!.map((child) => (
                        <Link
                          key={child.href}
                          href={child.href}
                          className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
                            isActive(pathname, child.href)
                              ? "bg-indigo-50 font-semibold text-[#3f3fd8]"
                              : "text-slate-600 hover:bg-slate-50"
                          }`}
                        >
                          <span className="h-1.5 w-1.5 rounded-full bg-current opacity-60" />
                          {child.label}
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            }

            const leaf = item as NavLeaf;
            if (leaf.soon) {
              return (
                <div
                  key={leaf.href}
                  className="flex cursor-not-allowed items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-slate-400"
                  title="Próximamente"
                >
                  <leaf.icon className="h-4 w-4" />
                  {leaf.label}
                  <span className="ml-auto rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-slate-400">
                    Pronto
                  </span>
                </div>
              );
            }

            return (
              <Link
                key={leaf.href}
                href={leaf.href}
                className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${
                  active
                    ? "bg-[#3f3fd8] text-white"
                    : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                <leaf.icon className="h-4 w-4" />
                {leaf.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-3 border-t border-slate-100 pt-2">
          <button
            type="button"
            onClick={onOpenSettings}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            <Settings className="h-4 w-4" />
            Ajustes
          </button>
        </div>
      </div>
    </aside>
  );
}

function RateChip({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
}) {
  const { rate, saveRate, loading } = usePosRate();
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setValue(rate ? String(rate) : "");
      setError(null);
    }
  }, [open, rate]);

  async function submit() {
    setSaving(true);
    const message = await saveRate(Number(value));
    setSaving(false);
    if (message) {
      setError(message);
      return;
    }
    onOpenChange(false);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
      >
        <Building2 className="h-3.5 w-3.5 text-slate-400" />
        {loading ? "…" : rate > 0 ? formatBs(rate) : "Sin tasa"}
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] uppercase text-slate-400">
          BCV
        </span>
      </button>

      {open ? (
        <div className="absolute right-0 top-11 z-50 w-72 rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
          <p className="text-xs font-bold text-slate-700">Tasa del día (Bs/USD)</p>
          <p className="mt-1 text-[11px] text-slate-500">
            Se usa para mostrar los equivalentes en bolívares y guardar la tasa
            de cada venta.
          </p>
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            inputMode="decimal"
            placeholder="887302.00"
            className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#3f3fd8]"
          />
          {error ? (
            <p className="mt-2 text-[11px] text-red-600">{error}</p>
          ) : null}
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={saving}
              className="rounded-lg bg-[#3f3fd8] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-60"
            >
              {saving ? "Guardando…" : "Guardar tasa"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Cabecera de página reutilizable por las pantallas del POS. */
export function PosPageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-black tracking-tight text-slate-900">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Tarjeta de métrica con equivalente en bolívares. */
export function PosMetric({
  label,
  value,
  rate,
  hint,
  highlight,
}: {
  label: string;
  value: number;
  rate: number;
  hint?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        highlight
          ? "border-indigo-200 bg-indigo-50/60"
          : "border-slate-200 bg-white"
      }`}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-2xl font-black tracking-tight text-slate-900">
        {formatUsd(value)}
      </p>
      <p className="text-[11px] text-slate-500">{formatBs(value * rate)}</p>
      {hint ? <p className="mt-1 text-[11px] text-slate-400">{hint}</p> : null}
    </div>
  );
}

/** Botón primario del POS. */
export function PosButton({
  children,
  onClick,
  type = "button",
  disabled,
  variant = "primary",
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  variant?: "primary" | "outline" | "ghost";
  className?: string;
}) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60";
  const styles =
    variant === "primary"
      ? "bg-[#3f3fd8] text-white hover:bg-[#3535c4]"
      : variant === "outline"
        ? "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
        : "text-slate-600 hover:bg-slate-100";

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

export { ACCENT };
