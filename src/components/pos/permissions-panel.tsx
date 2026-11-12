"use client";

// ============================================================
// Matriz de permisos individuales del POS.
//
// Roles del CRM + overrides por persona (migración 106). El dueño
// siempre conserva todo; un administrador no puede tocar a otro
// administrador.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Loader2,
  RotateCcw,
  ShieldCheck,
  UserCog,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import { createClient } from "@/lib/supabase/client";
import { isAccountRole, type AccountRole } from "@/lib/auth/roles";
import {
  capabilitiesByGroup,
  defaultPermission,
  isPosCapability,
  resolvePermissions,
  type PosCapability,
} from "@/lib/pos/permissions";

interface Member {
  user_id: string;
  full_name: string | null;
  email: string | null;
  account_role: string | null;
}

type OverrideMap = Partial<Record<PosCapability, boolean>>;

const ROLE_LABEL: Record<string, string> = {
  owner: "Dueño",
  admin: "Administrador",
  agent: "Agente",
  viewer: "Visor",
};

function initials(value: string): string {
  const parts = value
    .replace(/@.*/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export function PosPermissionsPanel({ accountId }: { accountId: string }) {
  const { user, accountRole } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [overrides, setOverrides] = useState<Record<string, OverrideMap>>({});
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();

    const [membersRes, overridesRes] = await Promise.all([
      supabase
        .from("profiles")
        .select("user_id, full_name, email, account_role")
        .eq("account_id", accountId),
      supabase
        .from("pos_permissions")
        .select("user_id, capability, allowed")
        .eq("account_id", accountId),
    ]);

    if (membersRes.error) {
      setError(membersRes.error.message);
      setLoading(false);
      return;
    }

    const rows = (membersRes.data ?? []) as Member[];
    rows.sort((a, b) =>
      (a.full_name ?? a.email ?? "").localeCompare(
        b.full_name ?? b.email ?? "",
        "es",
      ),
    );
    setMembers(rows);

    const nextOverrides: Record<string, OverrideMap> = {};
    for (const row of (overridesRes.data ?? []) as {
      user_id: string;
      capability: string;
      allowed: boolean;
    }[]) {
      if (!isPosCapability(row.capability)) continue;
      nextOverrides[row.user_id] = {
        ...nextOverrides[row.user_id],
        [row.capability]: row.allowed,
      };
    }
    setOverrides(nextOverrides);

    setSelectedId((current) => {
      if (current && rows.some((row) => row.user_id === current)) {
        return current;
      }
      return (
        user?.id && rows.some((row) => row.user_id === user.id)
          ? user.id
          : rows[0]?.user_id ?? ""
      );
    });
    setLoading(false);
  }, [accountId, user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = members.find((member) => member.user_id === selectedId);
  const selectedRole: AccountRole | null =
    selected && isAccountRole(selected.account_role)
      ? selected.account_role
      : null;
  const effective = useMemo(
    () => resolvePermissions(selectedRole, overrides[selectedId] ?? {}),
    [selectedRole, overrides, selectedId],
  );

  const canEditTarget =
    Boolean(selected) &&
    selected?.account_role !== "owner" &&
    (accountRole === "owner" || selected?.account_role !== "admin");

  async function toggle(capability: PosCapability, next: boolean) {
    if (!selected || !canEditTarget) return;

    setBusy(`${selected.user_id}:${capability}`);
    setError(null);
    setMessage(null);

    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("pos_set_permission", {
      p_user_id: selected.user_id,
      p_capability: capability,
      p_allowed: next,
    });

    if (rpcError) {
      setError(rpcError.message);
      setBusy(null);
      return;
    }

    setOverrides((current) => {
      const target = { ...(current[selected.user_id] ?? {}) };
      if (selectedRole && next === defaultPermission(selectedRole, capability)) {
        delete target[capability];
      } else {
        target[capability] = next;
      }
      return { ...current, [selected.user_id]: target };
    });
    setMessage("Permiso actualizado.");
    setBusy(null);
  }

  async function resetSelected() {
    if (!selected || !canEditTarget) return;
    setBusy(`${selected.user_id}:reset`);
    setError(null);
    setMessage(null);

    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc(
      "pos_reset_user_permissions",
      { p_user_id: selected.user_id },
    );

    if (rpcError) {
      setError(rpcError.message);
      setBusy(null);
      return;
    }

    setOverrides((current) => ({ ...current, [selected.user_id]: {} }));
    setMessage("Permisos restablecidos al rol.");
    setBusy(null);
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-[#3f3fd8]" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Control de acceso
          </p>
          <h3 className="text-lg font-black text-slate-900">
            Permisos por persona
          </h3>
          <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-slate-500">
            El rol define lo que la persona puede hacer. Aquí puedes quitar o
            conceder una función concreta sin cambiar su rol en el CRM. El dueño
            siempre conserva todos los permisos.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 text-[11px] font-bold text-[#3f3fd8]">
          <ShieldCheck className="h-3.5 w-3.5" />
          Se aplica en el servidor
        </span>
      </div>

      <div className="grid gap-3 lg:grid-cols-[240px_1fr]">
        <div className="space-y-1.5 rounded-2xl border border-slate-200 bg-white p-2">
          {members.map((member) => {
            const active = member.user_id === selectedId;
            const role = member.account_role ?? "";
            return (
              <button
                key={member.user_id}
                type="button"
                onClick={() => {
                  setSelectedId(member.user_id);
                  setError(null);
                  setMessage(null);
                }}
                className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors ${
                  active
                    ? "bg-indigo-50 text-[#3f3fd8]"
                    : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                    active
                      ? "bg-[#3f3fd8] text-white"
                      : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {initials(member.full_name ?? member.email ?? "")}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-bold">
                    {member.full_name || member.email || "Sin nombre"}
                    {member.user_id === user?.id ? " · Tú" : ""}
                  </span>
                  <span className="block text-[10px] text-slate-400">
                    {ROLE_LABEL[role] ?? role ?? "—"}
                  </span>
                </span>
              </button>
            );
          })}
          {members.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-slate-500">
              No hay usuarios en el negocio.
            </p>
          ) : null}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          {selected ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <UserCog className="h-4 w-4 text-slate-400" />
                  <div>
                    <p className="text-sm font-bold text-slate-800">
                      {selected.full_name || selected.email}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      Rol:{" "}
                      {ROLE_LABEL[selected.account_role ?? ""] ??
                        selected.account_role ??
                        "—"}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void resetSelected()}
                  disabled={
                    !canEditTarget ||
                    Object.keys(overrides[selected.user_id] ?? {}).length === 0 ||
                    busy === `${selected.user_id}:reset`
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy === `${selected.user_id}:reset` ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RotateCcw className="h-3 w-3" />
                  )}
                  Restablecer al rol
                </button>
              </div>

              {!canEditTarget ? (
                <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                  {selected.account_role === "owner"
                    ? "El dueño siempre conserva todos los permisos."
                    : "Solo el dueño puede cambiar los permisos de un administrador."}
                </p>
              ) : null}

              <div className="mt-4 space-y-4">
                {capabilitiesByGroup().map((group) => (
                  <div key={group.group}>
                    <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      {group.group}
                    </p>
                    <div className="overflow-hidden rounded-xl border border-slate-200">
                      {group.items.map((capability, index) => {
                        const enabled = effective[capability.key];
                        const isDefault =
                          selectedRole !== null &&
                          enabled ===
                            defaultPermission(selectedRole, capability.key);
                        const rowBusy =
                          busy === `${selected.user_id}:${capability.key}`;

                        return (
                          <div
                            key={capability.key}
                            className={`flex items-center gap-3 px-3 py-2.5 ${
                              index > 0 ? "border-t border-slate-100" : ""
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-bold text-slate-800">
                                {capability.label}
                                {!isDefault ? (
                                  <span className="ml-2 rounded bg-indigo-50 px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#3f3fd8]">
                                    Ajustado
                                  </span>
                                ) : null}
                              </p>
                              <p className="text-[10px] leading-snug text-slate-500">
                                {capability.description}
                              </p>
                            </div>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={enabled}
                              aria-label={capability.label}
                              disabled={!canEditTarget || rowBusy}
                              onClick={() =>
                                void toggle(capability.key, !enabled)
                              }
                              className={`relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                                enabled ? "bg-[#3f3fd8]" : "bg-slate-200"
                              }`}
                            >
                              <span
                                className={`absolute top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-white text-[#3f3fd8] shadow transition-all ${
                                  enabled ? "left-[18px]" : "left-0.5"
                                }`}
                              >
                                {rowBusy ? (
                                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                                ) : enabled ? (
                                  <Check className="h-2.5 w-2.5" />
                                ) : null}
                              </span>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              {error ? (
                <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                  {error}
                </p>
              ) : null}
              {message ? (
                <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                  {message}
                </p>
              ) : null}
            </>
          ) : (
            <p className="py-12 text-center text-xs text-slate-500">
              Elige una persona para ver sus permisos.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
