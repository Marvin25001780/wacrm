// ============================================================
// Nombres del equipo en el cliente.
//
// `profiles` tiene RLS de "solo mi perfil": leerla directamente
// devuelve una sola fila y el resto del equipo aparece como
// "Usuario". `account_member_roster()` (109/110) resuelve el nombre
// por negocio con `display_name` y es la fuente que ya usan la
// telefonía y los ajustes. Este helper centraliza ese lookup para
// reportes, fichas y selectores de asignación, con respaldo si la
// RPC aún no está aplicada.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

export interface MemberOption {
  /** auth.uid() del miembro. */
  user_id: string;
  /** Nombre visible en este negocio (display_name → full_name → correo). */
  name: string;
  /** Rol dentro del negocio; `viewer` no puede recibir cartera. */
  role: string;
}

/** user_id (auth) -> nombre visible en el negocio. */
export type MemberNameMap = Record<string, string>;

export async function loadMemberOptions(db: SupabaseClient): Promise<MemberOption[]> {
  const rpc = await db.rpc("account_member_roster");

  if (!rpc.error) {
    const rows = (rpc.data ?? []) as {
      user_id?: string | null;
      full_name?: string | null;
      display_name?: string | null;
      email?: string | null;
      role?: string | null;
    }[];

    return rows.flatMap((row) => {
      if (!row.user_id || !row.role) return [];
      return [
        {
          user_id: row.user_id,
          name:
            row.display_name?.trim() ||
            row.full_name?.trim() ||
            row.email?.trim() ||
            "Usuario",
          role: row.role,
        },
      ];
    });
  }

  const missing =
    rpc.error.code === "PGRST202" ||
    rpc.error.code === "42883" ||
    rpc.error.code === "PGRST205";

  if (!missing) {
    console.warn("[account/members] roster error:", rpc.error.message);
  }

  // Respaldo: antes de la 109 solo se podía leer `profiles` (y la RLS
  // devuelve el perfil propio). Mantiene la pantalla en pie.
  const legacy = await db
    .from("profiles")
    .select("user_id, full_name, email, account_role");
  if (legacy.error) {
    console.error("[account/members] legacy names error:", legacy.error);
    return [];
  }

  return (legacy.data ?? []).flatMap((row) => {
    const userId = row.user_id as string | null;
    const role = row.account_role as string | null;
    if (!userId || !role) return [];
    return [
      {
        user_id: userId,
        name:
          (row.full_name as string | null)?.trim() ||
          (row.email as string | null)?.trim() ||
          "Usuario",
        role,
      },
    ];
  });
}

export async function loadMemberNames(db: SupabaseClient): Promise<MemberNameMap> {
  const options = await loadMemberOptions(db);
  const map: MemberNameMap = {};
  for (const option of options) {
    map[option.user_id] = option.name;
  }
  return map;
}
