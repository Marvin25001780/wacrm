import {
  Coins,
  FileText,
  Flag,
  Globe,
  KeyRound,
  LayoutGrid,
  Network,
  Palette,
  PlugZap,
  Shield,
  ShieldCheck,
  Shuffle,
  Sparkles,
  Tags,
  User,
  Users,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';

import type { AccountRole } from '@/lib/auth/roles';
import { hasMinRole } from '@/lib/auth/roles';

/**
 * Settings information architecture for the redesigned page.
 *
 * The flat tab strip became a grouped left rail with a new Overview
 * landing. The URL query param stays `?tab=` (deep-linkable, and it
 * keeps the existing links in sidebar.tsx / header.tsx working) — we
 * just map the old values onto the new sections.
 */
export const SETTINGS_SECTIONS = [
  'overview',
  'profile',
  'security',
  'appearance',
  'whatsapp',
  'templates',
  'fields',
  'deals',
  'members',
  'teams',
  'groups',
  'roles',
  'assignment',
  'close-reasons',
  'ai',
  'webchat',
  'api',
  'integrations',
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export const DEFAULT_SECTION: SettingsSection = 'overview';

/** Rail grouping. `minRole` restricts the section to a role or higher. */
export interface SectionMeta {
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
  group: 'top' | 'account' | 'team' | 'workspace';
  /** (Opcional) descripción corta usada por el Overview. */
  description?: string;
  /** Minimum role required to access this section. */
  minRole?: AccountRole;
}

export const SECTION_META: Record<SettingsSection, SectionMeta> = {
  overview: { id: 'overview', label: 'Resumen', icon: LayoutGrid, group: 'top', minRole: 'admin' },
  profile: { id: 'profile', label: 'Tu perfil', icon: User, group: 'account' },
  security: { id: 'security', label: 'Inicio de sesión y seguridad', icon: Shield, group: 'account' },
  appearance: { id: 'appearance', label: 'Apariencia', icon: Palette, group: 'account' },
  whatsapp: { id: 'whatsapp', label: 'WhatsApp', icon: PlugZap, group: 'workspace', minRole: 'admin' },
  templates: { id: 'templates', label: 'Plantillas', icon: FileText, group: 'workspace', minRole: 'admin' },
  fields: { id: 'fields', label: 'Campos y etiquetas', icon: Tags, group: 'workspace', minRole: 'admin' },
  deals: { id: 'deals', label: 'Ofertas y moneda', icon: Coins, group: 'workspace', minRole: 'admin' },
  members: { id: 'members', label: 'Equipo y permisos', icon: UsersRound, group: 'team', description: 'Roster de miembros y sus roles.', minRole: 'admin' },
  teams: { id: 'teams', label: 'Equipos', icon: Network, group: 'team', description: 'Agrupa agentes para los reportes.', minRole: 'admin' },
  groups: { id: 'groups', label: 'Grupos de usuarios', icon: Users, group: 'team', description: 'Listas guardadas de miembros.', minRole: 'admin' },
  roles: { id: 'roles', label: 'Roles', icon: ShieldCheck, group: 'team', description: 'Qué puede hacer cada rol.', minRole: 'admin' },
  assignment: { id: 'assignment', label: 'Reglas de asignación', icon: Shuffle, group: 'team', description: 'Reparte conversaciones automáticamente.', minRole: 'admin' },
  'close-reasons': { id: 'close-reasons', label: 'Cierre de conversaciones', icon: Flag, group: 'team', description: 'Motivos disponibles al cerrar.', minRole: 'admin' },
  ai: { id: 'ai', label: 'Asistente IA', icon: Sparkles, group: 'workspace', minRole: 'admin' },
  webchat: { id: 'webchat', label: 'Widget de webchat', icon: Globe, group: 'workspace', minRole: 'admin' },
  api: { id: 'api', label: 'Claves API', icon: KeyRound, group: 'workspace', minRole: 'admin' },
  integrations: { id: 'integrations', label: 'Integraciones', icon: PlugZap, group: 'workspace', minRole: 'admin' },
};

export const RAIL_GROUPS: {
  label: string | null;
  group: SectionMeta['group'];
  /** Indenta los hijos (submenú de una sección padre). */
  indent?: boolean;
}[] = [
  { label: null, group: 'top' },
  { label: 'Cuenta', group: 'account' },
  { label: 'Gestión de equipos', group: 'team', indent: true },
  { label: 'Espacio de trabajo', group: 'workspace' },
];

function isSection(value: string | null): value is SettingsSection {
  return !!value && (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

/**
 * Resolve a raw `?tab=` value to a section. Legacy tabs from the old
 * flat layout collapse onto their new home (Tags + Custom fields → the
 * merged "Fields & tags" section). Anything unknown falls back to the
 * Overview landing.
 */
export function resolveSection(raw: string | null): SettingsSection {
  if (raw === 'tags' || raw === 'custom-fields') return 'fields';
  if (isSection(raw)) return raw;
  return DEFAULT_SECTION;
}

/**
 * True if the section can be edited by the given role.
 * This is the strict permission check used to guard forms/actions.
 */
export function isSectionAllowed(section: SettingsSection, role: AccountRole): boolean {
  const meta = SECTION_META[section];
  return !meta.minRole || hasMinRole(role, meta.minRole);
}

/**
 * True if the section should appear in the settings rail for the role.
 * Viewers see every section (read-only browsing); everyone else sees
 * only sections they are allowed to edit.
 */
export function isSectionVisible(section: SettingsSection, role: AccountRole): boolean {
  if (role === 'viewer') return true;
  return isSectionAllowed(section, role);
}

/** All sections visible in the rail for the given role. */
export function allowedSectionsForRole(role: AccountRole): SettingsSection[] {
  return SETTINGS_SECTIONS.filter((s) => isSectionVisible(s, role));
}

/**
 * Default section to land on for a role. Admins see the Overview;
 * non-admins fall back to profile (a safe, personal section).
 */
export function defaultSectionForRole(role: AccountRole): SettingsSection {
  if (isSectionAllowed(DEFAULT_SECTION, role)) return DEFAULT_SECTION;
  if (isSectionAllowed('profile', role)) return 'profile';
  return allowedSectionsForRole(role)[0] ?? 'profile';
}
