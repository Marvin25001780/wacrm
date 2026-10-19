"use client";

// ============================================================
// WorkspaceSwitcher — the sidebar control that shows which
// workspace (account) the user is acting in and lets them change it
// or create a new one. Backed by 066_account_members.sql.
//
// Mental model
//   A user can belong to several accounts at once. Exactly one of
//   them is ACTIVE (`profiles.account_id`), and every RLS-scoped
//   query in the app resolves against it — including the role the
//   API routes enforce. This control is the only supported way to
//   change that pointer.
//
// Why the switch does a HARD reload
//   The JWT doesn't change when the active account changes, so
//   nothing is invalidated automatically: PostgREST keeps its
//   schema cache and connection, Next's RSC cache still holds
//   server-rendered trees computed for the old account, and every
//   Realtime channel is still subscribed to the old account's
//   topics. `window.location.replace` throws all of that away in one
//   shot. A soft `router.refresh()` would leave the previous
//   workspace's data (and live subscriptions) leaking into the new
//   one, which is exactly the failure this feature must not have.
//
// Creating a workspace also lands the caller in it
//   `create_workspace` makes the new account active, so the create
//   path reloads for the same reason the switch path does.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Building2,
  ChevronsUpDown,
  Loader2,
  Pencil,
  Plus,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import type { WorkspaceMembership } from "@/types";
import { cn } from "@/lib/utils";
import { RoleChip } from "@/components/layout/role-chip";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// User-facing name for the account concept. The DB, the RPCs and
// this file keep calling it "workspace" (that's the technical name
// in 066 and the API routes); the UI says "negocio" because the app
// already has an unrelated "Espacios" section under Operaciones and
// two different things called "espacio" is a support ticket waiting
// to happen. Renaming the product term is a one-line diff here.
const WORKSPACE_LABEL = "negocio";
const WORKSPACE_LABEL_TITLE = "Negocio";

// Matches the server's cap in /api/account/workspaces and the
// account-rename route — three places, one number.
const MAX_NAME_LEN = 80;

// Where the user lands after a switch. The inbox is the app's home
// base and the screen every role can open (viewers included), so it
// can't strand anyone on a page their new role can't see.
const LANDING_PATH = "/inbox";

type NameDialogMode = "create" | "rename";

export function WorkspaceSwitcher() {
  const { user, profileLoading, account, accountRole, canEditSettings, refreshProfile } =
    useAuth();

  const [workspaces, setWorkspaces] = useState<
    { userId: string; list: WorkspaceMembership[] } | null
  >(null);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [dialogMode, setDialogMode] = useState<NameDialogMode | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const activeId = account?.id ?? null;

  // The list is stored next to the user it was loaded for. That way a
  // list left over from a previous sign-in reads as "still loading"
  // (see `list` below) instead of flashing someone else's workspaces
  // — and we avoid a state reset inside the effect.
  const load = useCallback(async (userId: string) => {
    try {
      const res = await fetch("/api/account/memberships", {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = (await res.json()) as {
        workspaces?: WorkspaceMembership[];
      };
      setWorkspaces({ userId, list: payload.workspaces ?? [] });
    } catch (err) {
      console.error("[WorkspaceSwitcher] load error:", err);
      // An empty list renders as nothing rather than a spinner that
      // never resolves.
      setWorkspaces({ userId, list: [] });
    }
  }, []);

  // Re-fetch when the user changes (sign-in). Not keyed on
  // `account.id`: a switch reloads the page, so the stale list never
  // survives to be seen.
  useEffect(() => {
    if (!user) return;
    void load(user.id);
  }, [user, load]);

  // `null` while loading (or while the list belongs to another user).
  const list =
    workspaces && user && workspaces.userId === user.id
      ? workspaces.list
      : null;

  const active = useMemo(
    () => list?.find((w) => w.account_id === activeId) ?? null,
    [list, activeId],
  );

  // Fall back to the auth context's account name while the list is in
  // flight (or if the memberships call failed): the switcher should
  // still name the current workspace.
  const displayName = active?.name ?? account?.name ?? "";
  const displayRole = active?.role ?? accountRole;

  const switchTo = useCallback(
    async (accountId: string) => {
      if (accountId === activeId || switchingTo) return;
      setSwitchingTo(accountId);
      try {
        const res = await fetch("/api/account/switch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ account_id: accountId }),
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          toast.error(payload.error || "No se pudo cambiar de negocio");
          setSwitchingTo(null);
          return;
        }
        // No toast: the page is about to be replaced. A message that
        // lives 200ms is noise.
        window.location.replace(LANDING_PATH);
      } catch (err) {
        console.error("[WorkspaceSwitcher] switch error:", err);
        toast.error("No se pudo conectar con el servidor");
        setSwitchingTo(null);
      }
    },
    [activeId, switchingTo],
  );

  async function submitName() {
    const trimmed = name.trim();
    if (!trimmed || !dialogMode || !user) return;

    setSaving(true);
    try {
      const isCreate = dialogMode === "create";
      const res = await fetch(
        isCreate ? "/api/account/workspaces" : "/api/account",
        {
          method: isCreate ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmed }),
        },
      );

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        toast.error(
          payload.error ||
            (isCreate
              ? "Error al crear el negocio"
              : "Error al renombrar el negocio"),
        );
        return;
      }

      if (isCreate) {
        // `create_workspace` already made the new account active —
        // reload into it rather than leaving the UI showing the old
        // workspace's data.
        // `location.replace` (not `assign`): the previous entry is
        // discarded, so "Back" can't land the user on a page rendered
        // for the workspace they just left.
        window.location.replace(LANDING_PATH);
        return;
      }

      // Rename needs no reload: it changes one string, and nothing
      // cached is keyed on it.
      toast.success("Negocio renombrado");
      setDialogMode(null);
      await Promise.all([refreshProfile(), load(user.id)]);
    } catch (err) {
      console.error("[WorkspaceSwitcher] save error:", err);
      toast.error("No se pudo conectar con el servidor");
    } finally {
      setSaving(false);
    }
  }

  // Hooks above, early exits here. While the profile resolves (or
  // there's no session) render nothing; the sidebar's skeleton rows
  // already cover the pop-in.
  if (profileLoading || !user) return null;
  if (list === null) {
    return <div className="mb-2 h-8 animate-pulse rounded-lg bg-muted" />;
  }
  if (list.length === 0) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            "mb-2 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors",
            "text-xs text-muted-foreground hover:bg-muted/60 focus:bg-muted/60 focus:outline-none data-popup-open:bg-muted/60",
          )}
          aria-label={`${WORKSPACE_LABEL_TITLE} actual: ${displayName}`}
        >
          <Building2 className="size-3.5 shrink-0" />
          {/* `title=` exposes the full name on hover when it
              truncates (long names + narrow sidebar). */}
          <span className="truncate font-medium text-foreground" title={displayName}>
            {displayName}
          </span>
          {displayRole ? <RoleChip role={displayRole} /> : null}
          <ChevronsUpDown className="ml-auto size-3.5 shrink-0" />
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="start"
          side="top"
          sideOffset={6}
          className="min-w-60 bg-popover text-popover-foreground ring-border"
        >
          {/* Label + radio group must live inside a <Group>: Base UI's
              GroupLabel reads its context and throws otherwise. */}
          <DropdownMenuGroup>
            <DropdownMenuLabel>Cambiar de negocio</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={activeId ?? undefined}
              onValueChange={(value) => {
                if (typeof value === "string") void switchTo(value);
              }}
              disabled={!!switchingTo}
            >
              {list.map((workspace) => {
                const isSwitching = switchingTo === workspace.account_id;
                return (
                  <DropdownMenuRadioItem
                    key={workspace.account_id}
                    value={workspace.account_id}
                    // The menu closes on click by default; keep it open
                    // so the spinner is visible while the request flies.
                    closeOnClick={false}
                    className="gap-2"
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="truncate" title={workspace.name}>
                        {workspace.name}
                      </span>
                      {isSwitching ? (
                        <Loader2 className="size-3 shrink-0 animate-spin" />
                      ) : (
                        <RoleChip role={workspace.role} />
                      )}
                    </span>
                  </DropdownMenuRadioItem>
                );
              })}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>

          {/* Creating a workspace is admin+ (the RPC re-checks: an
              agent calling it directly still gets 403). Hiding the
              row is UX, not security. */}
          {canEditSettings ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  setName(displayName);
                  setDialogMode("rename");
                }}
              >
                <Pencil />
                Renombrar este negocio
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setName("");
                  setDialogMode("create");
                }}
              >
                <Plus />
                Crear negocio
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={dialogMode !== null}
        onOpenChange={(next) => {
          if (!next && !saving) setDialogMode(null);
        }}
      >
        <DialogContent className="border-border bg-popover sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {dialogMode === "create"
                ? "Crear negocio"
                : "Renombrar negocio"}
            </DialogTitle>
            <DialogDescription>
              {dialogMode === "create"
                ? "Tendrás el rol de Dueño en el negocio nuevo y pasarás a trabajar en él. Podrás invitar a tu equipo y conectar sus propios canales."
                : `El nombre es visible para todo el equipo de este ${WORKSPACE_LABEL}.`}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor="workspace-name">
              Nombre del {WORKSPACE_LABEL}
            </Label>
            <Input
              id="workspace-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={MAX_NAME_LEN}
              placeholder="Ej. Clínica Los Robles"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void submitName();
                }
              }}
              className="border-border bg-card text-foreground"
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogMode(null)}
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button
              onClick={() => void submitName()}
              disabled={saving || name.trim().length === 0}
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              {dialogMode === "create" ? "Crear" : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
