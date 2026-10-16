'use client';

import { useEffect, useMemo, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { SettingsRail } from '@/components/settings/settings-rail';
import { SettingsOverview } from '@/components/settings/settings-overview';
import { ProfileForm } from '@/components/settings/profile-form';
import { SecurityPanel } from '@/components/settings/security-panel';
import { AppearancePanel } from '@/components/settings/appearance-panel';
import { WhatsAppConfig } from '@/components/settings/whatsapp-config';
import { TemplateManager } from '@/components/settings/template-manager';
import { FieldsAndTagsPanel } from '@/components/settings/fields-and-tags-panel';
import { DealsSettings } from '@/components/settings/deals-settings';
import { MembersTab } from '@/components/settings/members-tab';
import { TeamsTab } from '@/components/settings/teams-tab';
import { GroupsTab } from '@/components/settings/groups-tab';
import { RolesTab } from '@/components/settings/roles-tab';
import { AssignmentRulesTab } from '@/components/settings/assignment-rules-tab';
import { CloseReasonsTab } from '@/components/settings/close-reasons-tab';
import { ApiKeysSettings } from '@/components/settings/api-keys-settings';
import { AiConfig } from '@/components/settings/ai-config';
import { WebchatPanel } from '@/components/settings/webchat-panel';
import { IntegrationsPanel } from '@/components/settings/integrations-panel';
import {
  resolveSection,
  isSectionAllowed,
  defaultSectionForRole,
  type SettingsSection,
} from '@/components/settings/settings-sections';

export default function SettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { defaultCurrency, accountRole } = useAuth();
  const { mode } = useTheme();

  // The URL (`?tab=`) is the single source of truth for the active
  // section — deep-linkable, and it keeps the existing links in the
  // app sidebar/header working. Legacy tab values (tags, custom-fields)
  // resolve onto their new home; unknown/empty → the Overview landing.
  const role = accountRole ?? 'viewer';
  const requestedSection = resolveSection(searchParams.get('tab'));

  // Non-admins can't edit admin-only settings sections. Viewers are
  // allowed to browse them in read-only mode (shown a placeholder);
  // agents are redirected to their first editable section.
  const isReadOnly = role === 'viewer';
  const canEditSection = isSectionAllowed(requestedSection, role);
  const section = canEditSection
    ? requestedSection
    : isReadOnly
      ? requestedSection
      : defaultSectionForRole(role);

  useEffect(() => {
    if (!canEditSection && !isReadOnly) {
      router.replace(`/settings?tab=${section}`);
    }
  }, [canEditSection, isReadOnly, section, router]);

  const go = (next: SettingsSection) => {
    router.push(`/settings?tab=${next}`);
  };

  // Cheap, fetch-free rail hints. The Overview landing carries the
  // full live status/counts; the rail just surfaces the two that are
  // already in context.
  const hints: Partial<Record<SettingsSection, ReactNode>> = useMemo(
    () => ({
      appearance: mode.charAt(0).toUpperCase() + mode.slice(1),
      deals: defaultCurrency,
    }),
    [mode, defaultCurrency],
  );

  const panel: Record<SettingsSection, ReactNode> = {
    overview: <SettingsOverview onSelect={go} />,
    profile: <ProfileForm />,
    security: <SecurityPanel />,
    appearance: <AppearancePanel />,
    whatsapp: <WhatsAppConfig />,
    templates: <TemplateManager />,
    fields: <FieldsAndTagsPanel />,
    deals: <DealsSettings />,
    members: <MembersTab />,
    teams: <TeamsTab />,
    groups: <GroupsTab />,
    roles: <RolesTab />,
    assignment: <AssignmentRulesTab />,
    'close-reasons': <CloseReasonsTab />,
    ai: <AiConfig />,
    webchat: <WebchatPanel />,
    api: <ApiKeysSettings />,
    integrations: <IntegrationsPanel />,
  };

  return (
    <div>
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Configuración
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Todo en un solo lugar — tu cuenta y tu espacio de trabajo. Elige una
          sección para gestionarla.
        </p>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[236px_minmax(0,1fr)] lg:items-start">
        <SettingsRail active={section} onSelect={go} hints={hints} />
        <div className="min-w-0">
          {canEditSection ? (
            panel[section]
          ) : (
            <div className="rounded-xl border border-border bg-card p-8 text-center">
              <h3 className="text-lg font-semibold text-foreground">Solo lectura</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Tu rol de espectador te permite ver la configuración, pero no
                modificarla. Contactá a un administrador si necesitás cambios.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
