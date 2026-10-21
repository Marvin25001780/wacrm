"use client";

// ============================================================
// OnboardingWizard — el wizard de bienvenida estilo Kommo (068).
//
// Secuencia (cada paso guarda en el server al avanzar, así que si el
// usuario sale —p. ej. a conectar WhatsApp— y vuelve, reanuda donde
// quedó, no desde el inicio):
//   1. "Hagamos Nexus tuyo"    → avatar (galería de caricaturas)
//   2. "¿De dónde vienen tus leads?" → multi (prende el paso del canal)
//   3. "Conecta tu primer canal" → botón a Ajustes (conecta de verdad
//      en Ajustes > Canales: duplicar el formulario aquí sería mantener
//      dos rutas de configuración)
//   4. "Personalicemos tu espacio" → industria + cargo
//   5. "¿Qué buscas lograr?"  → hasta 2 metas
//   6. "¿Cuántos usarán Nexus?" → tamaño del equipo
//   7. "Cuéntanos sobre tu negocio" → nombre (renombra el negocio) + web
//
// Se muestra mientras `profiles.onboarding_completed_at` sea NULL.
// Cerrar (X) es "saltar": guarda el sello y no vuelve — igual que
// Kommo respeta el abandono.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  X,
} from "lucide-react";

import { useAuth } from "@/hooks/use-auth";
import type { MessageChannel } from "@/types";
import { ChannelIcon, channelName } from "@/components/inbox/channel-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Galería de avatares (semillas deterministas → la URL es estable y
// cacheable). Es una URL remota como las fotos subidas: nada nuevo.
const AVATAR_STYLES = [
  "heart-eyes",
  "rainbow",
  "thunder",
  "star",
  "backpack",
  "cool",
  "sparkle",
  "smile",
] as const;
const avatarUrl = (seed: string) =>
  `https://api.dicebear.com/9.x/glass/svg?seed=${encodeURIComponent(seed)}`;

const LEAD_SOURCES: { id: string; label: string; channel?: MessageChannel }[] = [
  { id: "whatsapp", label: "WhatsApp", channel: "whatsapp" },
  { id: "instagram", label: "Instagram", channel: "instagram" },
  { id: "facebook", label: "Facebook", channel: "facebook" },
  { id: "tiktok", label: "TikTok", channel: "tiktok" },
  { id: "sms", label: "SMS", channel: "sms" },
  { id: "web", label: "Sitio web / webchat" },
  { id: "llamadas", label: "Llamadas" },
  { id: "otras", label: "Otras fuentes" },
];

const INDUSTRIES = [
  "Finanzas & seguros",
  "Creadores de contenido",
  "Servicios tecnológicos",
  "Transporte",
  "Retail & ecommerce",
  "Organizaciones sin fines de lucro",
  "Manufactura",
  "Legal & consultoría",
  "Servicios de alimentos",
  "Automotriz",
  "Telecomunicaciones",
  "Turismo",
  "Salud & bienestar",
  "Gobierno",
  "Educación",
  "Bienes raíces",
];

const ROLE_TITLES = [
  "Propietario / fundador / CEO",
  "Director de ventas",
  "Gerente de ventas",
  "Agente de ventas",
  "Analista / asistente de ventas",
  "Coordinador / supervisor de ventas",
  "Gerente / ejecutivo de cuentas",
  "Director de marketing",
  "Gerente de marketing",
  "Coordinador / supervisor de marketing",
  "Analista / asistente de marketing",
  "Socio de agencia de marketing",
  "Influencer / creador de contenido",
  "Especialista en TI",
  "Especialista en soporte al cliente",
  "Trabajador independiente / freelancer",
  "Gerente de proyectos",
  "Practicante / becario",
];

const GOALS: { id: string; label: string }[] = [
  { id: "mensajes_segmentados", label: "Enviar mensajes segmentados a grupos de clientes" },
  { id: "oportunidades_venta", label: "Seguir oportunidades de venta y automatizar las etapas" },
  { id: "seguimientos_auto", label: "Responder a clientes y realizar seguimientos automáticamente" },
  { id: "leads_campanas", label: "Gestionar leads de campañas publicitarias" },
  { id: "reservas", label: "Programar y gestionar reservas" },
];

const TEAM_SIZES: { id: string; label: string }[] = [
  { id: "solo_yo", label: "Solo yo" },
  { id: "2_3", label: "2–3" },
  { id: "4_5", label: "4–5" },
  { id: "6_10", label: "6–10" },
  { id: "11_20", label: "11–20" },
  { id: "21_50", label: "21–50" },
  { id: "51_100", label: "51–100" },
  { id: "101_mas", label: "101+" },
];

// De un `lead_sources` al tab de Ajustes donde se conecta ese canal.
const SETTINGS_TAB_BY_SOURCE: Record<string, string> = {
  whatsapp: "whatsapp",
  instagram: "instagram",
  facebook: "facebook",
  tiktok: "tiktok",
  sms: "sms",
};

interface OnboardingState {
  avatarUrl: string | null;
  leadSources: string[];
  industry: string | null;
  roleTitle: string | null;
  goals: string[];
  teamSize: string | null;
  accountName: string;
  website: string;
}

const EMPTY: OnboardingState = {
  avatarUrl: null,
  leadSources: [],
  industry: null,
  roleTitle: null,
  goals: [],
  teamSize: null,
  accountName: "",
  website: "",
};

// Pasos de cada modo, en orden. El corto recorre el 2 (fuentes), el 5
// (metas) y el 6 (tamaño) — mismos contenidos, sin avatar/canal/estilo.
const LONG_SEQ = [1, 2, 3, 4, 5, 6, 7];
// Un miembro que no administra el negocio no puede escribir en
// `accounts` (la API responde 403). Su wizard solo toca lo suyo:
// avatar, industria y cargo. Los pasos 2/3/5/6/7 son del negocio.
const MEMBER_SEQ = [1, 4];
const SHORT_SEQ = [2, 5, 6];

function OptionCard({
  selected,
  disabled,
  children,
  onClick,
}: {
  selected: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-colors",
        selected
          ? "border-primary bg-primary/5 text-foreground"
          : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground",
        disabled && "cursor-not-allowed opacity-40 hover:border-border",
      )}
    >
      {children}
    </button>
  );
}

function Pick({ selected }: { selected: boolean }) {
  return (
    <span
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
        selected
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border",
      )}
    >
      {selected && <Check className="size-3" strokeWidth={3} />}
    </span>
  );
}

function ListPicker({
  options,
  value,
  onSelect,
  label,
}: {
  options: string[];
  value: string | null;
  onSelect: (next: string | null) => void;
  label: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const filtered = useMemo(
    () =>
      options.filter((o) => o.toLowerCase().includes(query.trim().toLowerCase())),
    [options, query],
  );
  const custom = query.trim().length >= 2 && !options.includes(query.trim());

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "flex h-10 w-full items-center justify-between rounded-lg border bg-card px-3 text-sm",
          value ? "border-primary text-foreground" : "border-border text-muted-foreground",
        )}
      >
        <span className="truncate">{value || label}</span>
        {value && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(null);
            }}
            className="ml-2 text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
          </span>
        )}
      </button>
      {open && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar o escribir..."
            className="mb-1 h-8 border-input bg-card text-foreground"
          />
          {filtered.map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => {
                onSelect(o);
                setOpen(false);
                setQuery("");
              }}
              className={cn(
                "flex w-full items-center rounded px-2 py-1.5 text-left text-sm hover:bg-muted",
                value === o && "text-primary",
              )}
            >
              {o}
            </button>
          ))}
          {custom && (
            <button
              type="button"
              onClick={() => {
                onSelect(query.trim());
                setOpen(false);
                setQuery("");
              }}
              className="flex w-full items-center rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
            >
              Usar &quot;{query.trim()}&quot;
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function OnboardingWizard() {
  const { account, profile, canEditSettings, refreshProfile } = useAuth();
  const router = useRouter();

  // Modo: LARGO (7 pasos) cuando el USUARIO no tiene sello (068);
  // CORTO —fuentes → metas → tamaño— cuando el sello de la persona ya
  // está pero el NEGOCIO activo no selló el suyo (069). La shell solo
  // nos monta en esos dos casos.
  const isShort = Boolean(profile?.onboarding_completed_at);
  // El wizard corto es solo para admin+ (lo monta la shell). En el
  // largo, un miembro sin permiso de administración no recorre los
  // pasos que escriben en `accounts`.
  const seq = isShort ? SHORT_SEQ : canEditSettings ? LONG_SEQ : MEMBER_SEQ;

  const [step, setStep] = useState(isShort ? 2 : 1);
  const [state, setState] = useState<OnboardingState>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [whatsappConnected, setWhatsappConnected] = useState(false);
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState(false);

  // El nombre del negocio no lo sabemos hasta que el auth context
  // resuelve la cuenta; prellenar SIN pisar si ya está cargado.
  useEffect(() => {
    if (!account?.name) return;
    setState((prev) =>
      prev.accountName === "" ? { ...prev, accountName: account.name } : prev,
    );
  }, [account?.name]);

  const loadState = useCallback(async () => {
    try {
      const res = await fetch("/api/onboarding", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        const next: OnboardingState = {
          avatarUrl: data.profile?.avatar_url ?? null,
          leadSources: data.account?.lead_sources ?? [],
          industry: data.profile?.industry ?? null,
          roleTitle: data.profile?.role_title ?? null,
          goals: data.account?.goals ?? [],
          teamSize: data.account?.team_size ?? null,
          accountName: data.account?.name ?? "",
          website: data.account?.website ?? "",
        };
        setState((prev) => ({ ...prev, ...next }));
        const connected = !!data.whatsapp_connected;
        setWhatsappConnected(connected);
        // Reanudar en el primer paso sin responder (no siempre en el 1):
        // los saltos quedan sellados por paso, así que quien dejó la
        // mitad del wizard no lo repite desde cero. En el largo, además,
        // el paso del canal se da por completo si ya hay una línea.
        // Quien no administra el negocio solo tiene pasos de perfil.
        const resume = isShort
          ? next.leadSources.length === 0
            ? 2
            : next.goals.length === 0
              ? 5
              : 6
          : !canEditSettings
            ? !next.avatarUrl
              ? 1
              : 4
            : !next.avatarUrl
              ? 1
              : next.leadSources.length === 0
                ? 2
                : !connected
                  ? 3
                  : !next.industry
                    ? 4
                    : next.goals.length === 0
                      ? 5
                      : !next.teamSize
                        ? 6
                        : 7;
        setStep(resume);
      }
    } catch (err) {
      console.error("[onboarding] state load failed:", err);
    } finally {
      setLoaded(true);
    }
  }, [isShort, canEditSettings]);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  // Guarda "por paso" y avanza (siguiendo la secuencia del modo).
  const save = useCallback(
    async (patch: Record<string, unknown>, advance = true) => {
      setSaving(true);
      try {
        const res = await fetch("/api/onboarding", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error(payload.error || "No se pudo guardar");
          return false;
        }
        if (advance) {
          setStep((prev) => {
            return seq[seq.indexOf(prev) + 1] ?? prev;
          });
        }
        return true;
      } catch (err) {
        console.error("[onboarding] save error:", err);
        toast.error("No se pudo conectar con el servidor");
        return false;
      } finally {
        setSaving(false);
      }
    },
    // `seq` solo cambia si cambia el modo (largo/corto/miembro).
    [seq],
  );

  const stepIdx = seq.indexOf(step);

  // Cierra el wizard (fin o salto) sellando SU onboarding: el largo
  // sella a la persona (068) y el corto, al negocio (069).
  const finish = useCallback(async () => {
    setClosing(true);
    const sealPatch = isShort
      ? { account_completed: true }
      : { completed: true };
    const ok = await save(sealPatch, false);
    if (ok) {
      await refreshProfile();
      toast.success("Onboarding saltado — puedes completarlo después desde Ajustes");
      router.push("/inbox");
    }
    setClosing(false);
  }, [save, refreshProfile, router, isShort]);

  const primaryChannel = useMemo(
    () => LEAD_SOURCES.find((s) => state.leadSources.includes(s.id) && s.channel)?.channel ?? "whatsapp",
    [state.leadSources],
  );
  const settingsTab = SETTINGS_TAB_BY_SOURCE[primaryChannel] ?? "whatsapp";

  if (!loaded) return null;

  const canAdvanceGlobal = step === 4 ? !!state.industry : true;

  return (
    // Cobertura fija: el wizard vive sobre cualquier pantalla del app
    // (Kommo lo mismo), con scroll interno en pantallas bajas.
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background/70 backdrop-blur-[2px]">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl sm:p-8">
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-xl font-bold text-foreground">
              {step === 1
                ? "Hagamos Nexus tuyo"
                : step === 2
                  ? "¿De dónde provienen tus leads?"
                  : step === 3
                    ? "Conecta tu primer canal"
                    : step === 4
                      ? "Personalicemos tu espacio"
                      : step === 5
                        ? "¿Qué buscas lograr?"
                        : step === 6
                          ? "¿Cuántos usarán Nexus?"
                          : "Cuéntanos sobre tu negocio"}
            </h1>
            <button
              type="button"
              onClick={() => void finish()}
              disabled={closing}
              aria-label="Saltar onboarding"
              className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {step === 1
              ? "Elige tu avatar para que tu equipo te reconozca al momento."
              : step === 2
                ? "Elige fuentes de leads para personalizar tu espacio."
                : step === 3
                  ? "Conecta tu canal para empezar a recibir mensajes."
                  : step === 4
                    ? "Selecciona de la lista o ingresa tu propia opción."
                    : step === 5
                      ? "Elige hasta 2 para personalizar tu experiencia."
                      : step === 6
                        ? "Sugerimos herramientas e integraciones según el tamaño de tu equipo."
                        : "Esto nos ayuda a personalizar tu experiencia en Nexus."}
          </p>
          <div className="mt-1 text-[11px] text-muted-foreground/70">
            Paso {stepIdx + 1} de {seq.length}
          </div>

          <div className="mt-5 space-y-4">
            {step === 1 && (
              <>
                <div className="grid grid-cols-4 gap-2">
                  {AVATAR_STYLES.map((style) => {
                    const url = avatarUrl(style);
                    const selected = state.avatarUrl === url;
                    return (
                      <button
                        key={style}
                        type="button"
                        onClick={() => setState((prev) => ({ ...prev, avatarUrl: url }))}
                        className={cn(
                          "flex aspect-square items-center justify-center rounded-lg border text-3xl transition-colors",
                          selected ? "border-primary bg-primary/10" : "border-border hover:border-primary/50",
                        )}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt={`Avatar ${style}`} className="size-10 rounded-full" />
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">
                  Puedes subir una foto real después, en tu Perfil.
                </p>
              </>
            )}

            {step === 2 && (
              <div className="space-y-2">
                {LEAD_SOURCES.map((src) => {
                  const selected = state.leadSources.includes(src.id);
                  return (
                    <OptionCard
                      key={src.id}
                      selected={selected}
                      onClick={() =>
                        setState((prev) => ({
                          ...prev,
                          leadSources: selected
                            ? prev.leadSources.filter((s) => s !== src.id)
                            : [...prev.leadSources, src.id],
                        }))
                      }
                    >
                      <Pick selected={selected} />
                      {src.channel ? (
                        <ChannelIcon channel={src.channel} className="size-4" imgClassName="size-4" />
                      ) : null}
                      <span className="font-medium">{src.label}</span>
                    </OptionCard>
                  );
                })}
              </div>
            )}

            {step === 3 && (
              <div className="space-y-3">
                <OptionCard
                  selected={false}
                  onClick={() => router.push(`/settings?tab=${settingsTab}`)}
                >
                  <ChannelIcon channel={primaryChannel} className="size-4" imgClassName="size-4" />
                  <span className="flex-1 font-medium">
                    Conectar {channelName(primaryChannel)} ahora
                  </span>
                  <ArrowRight className="ml-auto size-4" />
                </OptionCard>
                {step === 3 && whatsappConnected && (
                  <p className="flex items-center gap-1.5 text-xs text-emerald-400">
                    <Check className="size-3.5" /> Ya tienes un número conectado
                    — este paso está completo.
                  </p>
                )}
              </div>
            )}

            {step === 4 && (
              <div className="space-y-3">
                <ListPicker
                  options={INDUSTRIES}
                  value={state.industry}
                  onSelect={(v) => setState((prev) => ({ ...prev, industry: v }))}
                  label="Selecciona la industria"
                />
                <ListPicker
                  options={ROLE_TITLES}
                  value={state.roleTitle}
                  onSelect={(v) => setState((prev) => ({ ...prev, roleTitle: v }))}
                  label="Selecciona tu cargo"
                />
              </div>
            )}

            {step === 5 && (
              <div className="space-y-2">
                {GOALS.map((goal) => {
                  const selected = state.goals.includes(goal.id);
                  const full = state.goals.length >= 2;
                  return (
                    <OptionCard
                      key={goal.id}
                      selected={selected}
                      disabled={!selected && full}
                      onClick={() =>
                        setState((prev) => ({
                          ...prev,
                          goals: selected
                            ? prev.goals.filter((g) => g !== goal.id)
                            : full
                              ? prev.goals
                              : [...prev.goals, goal.id],
                        }))
                      }
                    >
                      <Pick selected={selected} />
                      <span className="font-medium">{goal.label}</span>
                    </OptionCard>
                  );
                })}
              </div>
            )}

            {step === 6 && (
              <div className="grid grid-cols-2 gap-2">
                {TEAM_SIZES.map((size) => {
                  const selected = state.teamSize === size.id;
                  return (
                    <OptionCard
                      key={size.id}
                      selected={selected}
                      onClick={() => setState((prev) => ({ ...prev, teamSize: size.id }))}
                    >
                      <span className="font-medium">{size.label}</span>
                    </OptionCard>
                  );
                })}
              </div>
            )}

            {step === 7 && (
              <div className="mt-1 space-y-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground" htmlFor="onboarding-company">
                    El nombre de tu compañía
                  </label>
                  <Input
                    id="onboarding-company"
                    value={state.accountName}
                    onChange={(e) =>
                      setState((prev) => ({ ...prev, accountName: e.target.value }))
                    }
                    maxLength={80}
                    disabled={!canEditSettings}
                    className="border-border bg-muted text-foreground"
                  />
                  {state.accountName.trim().length < 2 && (
                    <p className="text-xs text-red-400">
                      Por favor, ingresa entre 2 y 80 caracteres.
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground" htmlFor="onboarding-website">
                    Sitio web o redes sociales
                  </label>
                  <Input
                    id="onboarding-website"
                    placeholder="ej. https://miempresa.com"
                    value={state.website}
                    onChange={(e) =>
                      setState((prev) => ({ ...prev, website: e.target.value }))
                    }
                    maxLength={200}
                    disabled={!canEditSettings}
                    className="border-border bg-muted text-foreground"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="mt-6 flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setStep(seq[Math.max(stepIdx - 1, 0)] ?? step)
              }
              disabled={saving || closing || stepIdx === 0}
              className="text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-4" />
              Atrás
            </Button>
            {stepIdx === seq.length - 1 ? (
              <Button
                onClick={() =>
                  void (async () => {
                    // Último paso: en el largo, TODO lo acumulado; en el
                    // corto, solo lo del negocio + su sello (069).
                    const ok = await save(
                      isShort
                        ? {
                            lead_sources: state.leadSources,
                            goals: state.goals,
                            team_size: state.teamSize,
                            account_completed: true,
                          }
                        : {
                            ...(canEditSettings
                              ? {
                                  account_name: state.accountName.trim(),
                                  website: state.website.trim() || null,
                                  lead_sources: state.leadSources,
                                  goals: state.goals,
                                  team_size: state.teamSize,
                                }
                              : {}),
                            industry: state.industry,
                            role_title: state.roleTitle,
                            avatar_url: state.avatarUrl,
                            completed: true,
                          },
                      false,
                    );
                    if (ok) {
                      await refreshProfile();
                      toast.success(isShort ? "Configuración del negocio guardada" : "Nexus listo para ti");
                      router.push("/inbox");
                      setClosing(true);
                    }
                  })()
                }
                disabled={saving || closing}
              >
                {closing || saving ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : null}
                {isShort ? "Guardar y activar" : "Guardar y entrar"}
              </Button>
            ) : step === 3 ? (
              <Button onClick={() => void save({ lead_sources: state.leadSources })} disabled={saving || closing}>
                {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                Siguiente
                <ArrowRight className="ml-1 size-4" />
              </Button>
            ) : (
              <Button
                onClick={() =>
                  void save(
                    (() => {
                      const patch: Record<string, unknown> = {};
                      if (step === 1 && state.avatarUrl) patch.avatar_url = state.avatarUrl;
                      if (step === 2) patch.lead_sources = state.leadSources;
                      if (step === 4) {
                        patch.industry = state.industry;
                        patch.role_title = state.roleTitle;
                      }
                      if (step === 5) patch.goals = state.goals;
                      if (step === 6) patch.team_size = state.teamSize;
                      return patch;
                    })(),
                    true,
                  )
                }
                disabled={saving || closing || !canAdvanceGlobal}
              >
                {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                Siguiente
                <ArrowRight className="ml-1 size-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// La shell decide si montarnos — exportamos el criterio para no
// duplicarlo.
export function isOnboardingPending(
  onboardingCompletedAt: string | null | undefined
): boolean {
  return !onboardingCompletedAt;
}

export function useOnboardingWatcher() {
  const { profile, profileLoading, user } = useAuth();
  return useMemo(() => {
    if (profileLoading || !user || !profile) return false;
    return isOnboardingPending(profile.onboarding_completed_at);
  }, [profile, profileLoading, user]);
}
