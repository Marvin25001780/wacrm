'use client';

// ============================================================
// Telefonía — centro de llamadas del negocio.
//
// Reúne el estado del servidor (LiveKit + troncal SIP), el marcador,
// la presencia del agente, el historial de llamadas y la
// configuración por negocio. La media la pone LiveKit; este CRM
// guarda la sesión, la actividad de CRM y la transcripción.
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { format, formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { toast } from 'sonner';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  FileText,
  Info,
  Loader2,
  Phone,
  PhoneCall,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Pencil,
  Save,
  Server,
  Sparkles,
  Users,
} from 'lucide-react';

import { MetricCard } from '@/components/dashboard/metric-card';
import { Panel } from '@/components/metrics/panel';
import { useTelephony } from '@/components/telephony/telephony-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';
import {
  agentStatusLabel,
  callResultLabel,
  callSessionStatusLabel,
  callDirectionLabel,
  type AccountMember,
  type AgentStatus,
  type CallAiEvaluation,
  type CallEvent,
  type CallEvaluation,
  type CallSession,
  type TelephonyConfig,
  type TelephonySupervision,
} from '@/types';
import { formatCallDuration, isTerminalCallStatus } from '@/lib/telephony/calls';
import { formatPhoneDisplay, normalizePhone } from '@/lib/telephony/phone';
import { QA_CRITERIA, QA_MAX_PER_CRITERION } from '@/lib/telephony/qa';

interface ConfigForm {
  enabled: boolean;
  outboundCallerId: string;
  sipOutboundTrunkId: string;
  inboundNumbers: string;
  recordingEnabled: boolean;
  transcriptionEnabled: boolean;
  /** 116 — segundos de espera en cola (0 = sin límite). */
  queueMaxWaitSeconds: number;
  /** 119 — habilidades exigidas a la cola, separadas por comas. */
  requiredSkills: string;
  /** 119 — segundos antes de levantar el requisito (0 = sin desbordamiento). */
  skillOverflowSeconds: number;
}

const EMPTY_FORM: ConfigForm = {
  enabled: true,
  outboundCallerId: '',
  sipOutboundTrunkId: '',
  inboundNumbers: '',
  recordingEnabled: false,
  transcriptionEnabled: true,
  queueMaxWaitSeconds: 60,
  requiredSkills: '',
  skillOverflowSeconds: 0,
};

function formFromConfig(config: TelephonyConfig | null): ConfigForm {
  if (!config) return EMPTY_FORM;
  return {
    enabled: config.enabled,
    outboundCallerId: config.outbound_caller_id ?? '',
    sipOutboundTrunkId: config.sip_outbound_trunk_id ?? '',
    inboundNumbers: (config.inbound_numbers ?? []).join(', '),
    recordingEnabled: config.recording_enabled,
    transcriptionEnabled: config.transcription_enabled,
    queueMaxWaitSeconds: config.queue_max_wait_seconds ?? 60,
    requiredSkills: (config.required_skills ?? []).join(', '),
    skillOverflowSeconds: config.skill_overflow_seconds ?? 0,
  };
}

const statusTone: Record<string, string> = {
  ringing: 'border-amber-300 text-amber-700 dark:text-amber-300',
  active: 'border-emerald-300 text-emerald-700 dark:text-emerald-300',
  ended: 'border-border text-muted-foreground',
  missed: 'border-red-300 text-red-600 dark:text-red-400',
  failed: 'border-red-300 text-red-600 dark:text-red-400',
  cancelled: 'border-border text-muted-foreground',
};

const agentTone: Record<AgentStatus, string> = {
  available:
    'border-emerald-300 text-emerald-700 dark:text-emerald-300',
  busy: 'border-amber-300 text-amber-700 dark:text-amber-300',
  wrap_up: 'border-indigo-300 text-indigo-700 dark:text-indigo-300',
  break: 'border-border text-muted-foreground',
};

const presenceDot: Record<string, string> = {
  online: 'bg-emerald-500',
  away: 'bg-amber-400',
  offline: 'bg-muted-foreground/40',
};

const presenceText: Record<string, string> = {
  online: 'En línea',
  away: 'Ausente',
  offline: 'Desconectado',
};

const roleText: Record<string, string> = {
  owner: 'Dueño',
  admin: 'Admin',
  agent: 'Agente',
  viewer: 'Espectador',
};

const callEventText: Record<string, string> = {
  created: 'Llamada creada',
  inbound_created: 'Entrante recibida',
  claimed: 'Reclamada por un agente',
  answered: 'Contestada',
  ended: 'Finalizada',
  recording_ready: 'Grabación lista',
  recording_failed: 'Error de grabación',
  transcribed: 'Transcripción lista',
  transcription_failed: 'Error de transcripción',
  summarized: 'Resumen generado',
  disposition_set: 'Disposición guardada',
  evaluated: 'Evaluación de calidad',
  ai_evaluated: 'Evaluación con IA',
  queue_timeout: 'Retirada por espera máxima',
  skill_overflow: 'Desbordamiento por habilidad',
};

export default function TelefoniaPage() {
  const { isAdmin, accountRole } = useAuth();
  const {
    status,
    loading: statusLoading,
    phase,
    startCall,
    callable,
    setOpen,
    refresh,
  } = useTelephony();

  const [calls, setCalls] = useState<CallSession[]>([]);
  const [members, setMembers] = useState<AccountMember[]>([]);
  const [callsLoading, setCallsLoading] = useState(true);
  const [dial, setDial] = useState('');
  const [dialError, setDialError] = useState<string | null>(null);
  const [transcriptCall, setTranscriptCall] = useState<CallSession | null>(
    null
  );
  const [callEvents, setCallEvents] = useState<CallEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [transcribingId, setTranscribingId] = useState<string | null>(null);
  const [summarizingId, setSummarizingId] = useState<string | null>(null);
  const [evaluation, setEvaluation] = useState<CallEvaluation | null>(null);
  const [evaluationLoading, setEvaluationLoading] = useState(false);
  const [qaMigrationMissing, setQaMigrationMissing] = useState(false);
  const [aiEvaluation, setAiEvaluation] = useState<CallAiEvaluation | null>(
    null
  );
  const [aiEvaluating, setAiEvaluating] = useState(false);
  const [aiMigrationMissing, setAiMigrationMissing] = useState(false);
  const [qaScores, setQaScores] = useState<Record<string, number>>({});
  const [qaComments, setQaComments] = useState('');
  const [savingQa, setSavingQa] = useState(false);
  const [supervision, setSupervision] =
    useState<TelephonySupervision | null>(null);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [skillMember, setSkillMember] = useState<{
    user_id: string;
    name: string;
    skills: string[];
  } | null>(null);
  const [skillDraft, setSkillDraft] = useState('');
  const [savingSkills, setSavingSkills] = useState(false);

  const [form, setForm] = useState<ConfigForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const canSupervise = Boolean(isAdmin || accountRole === 'owner');

  const loadCalls = useCallback(async (silent = false) => {
    if (!silent) setCallsLoading(true);
    try {
      const res = await fetch('/api/telephony/calls?limit=50', {
        cache: 'no-store',
      });
      const body = (await res.json().catch(() => ({}))) as {
        calls?: CallSession[];
      };
      if (res.ok && body.calls) setCalls(body.calls);
    } catch {
      // Sin red: se conserva el historial anterior.
    } finally {
      if (!silent) setCallsLoading(false);
    }
  }, []);

  const loadMembers = useCallback(async () => {
    try {
      const res = await fetch('/api/account/members', { cache: 'no-store' });
      const body = (await res.json().catch(() => ({}))) as {
        members?: AccountMember[];
      };
      if (res.ok && body.members) setMembers(body.members);
    } catch {
      // El nombre del agente es cosmético.
    }
  }, []);

  const loadSupervision = useCallback(async () => {
    if (!canSupervise) return;
    try {
      const res = await fetch('/api/telephony/agents', { cache: 'no-store' });
      const body = (await res.json().catch(() => ({}))) as
        TelephonySupervision | { error?: string };
      if (res.ok && body && 'agents' in body) {
        setSupervision(body);
        setNowTick(Date.now());
      }
    } catch {
      // Sin red: se conserva la última foto del equipo.
    }
  }, [canSupervise]);

  const loadEvents = useCallback(async (callId: string) => {
    setEventsLoading(true);
    try {
      const res = await fetch(`/api/telephony/calls/${callId}`, {
        cache: 'no-store',
      });
      const body = (await res.json().catch(() => ({}))) as {
        call?: CallSession;
        events?: CallEvent[];
      };
      if (res.ok && body.events) setCallEvents(body.events);
      if (res.ok && body.call) setTranscriptCall(body.call);
    } catch {
      // El detalle se queda con lo que ya traía el historial.
    } finally {
      setEventsLoading(false);
    }
  }, []);

  const loadEvaluation = useCallback(async (callId: string) => {
    setEvaluationLoading(true);
    try {
      const res = await fetch(
        `/api/telephony/evaluations?callId=${encodeURIComponent(callId)}`,
        { cache: 'no-store' }
      );
      const body = (await res.json().catch(() => ({}))) as {
        evaluation?: CallEvaluation | null;
        migrationMissing?: boolean;
      };
      if (!res.ok) return;
      setQaMigrationMissing(Boolean(body.migrationMissing));
      const current = body.evaluation ?? null;
      setEvaluation(current);
      if (current) {
        setQaScores(
          Object.fromEntries(current.criteria.map((row) => [row.key, row.score]))
        );
        setQaComments(current.comments ?? '');
      }
    } catch {
      // Sin red: el detalle se abre sin la sección de calidad.
    } finally {
      setEvaluationLoading(false);
    }
  }, []);

  const loadAiEvaluation = useCallback(async (callId: string) => {
    try {
      const res = await fetch(
        `/api/telephony/calls/${encodeURIComponent(callId)}/ai-evaluate`,
        { cache: 'no-store' }
      );
      const body = (await res.json().catch(() => ({}))) as {
        evaluation?: CallAiEvaluation | null;
        migrationMissing?: boolean;
      };
      if (!res.ok) return;
      setAiMigrationMissing(Boolean(body.migrationMissing));
      setAiEvaluation(body.evaluation ?? null);
    } catch {
      // Sin red: la sección de IA se abre vacía.
    }
  }, []);

  const openCall = useCallback(
    (call: CallSession) => {
      setTranscriptCall(call);
      setCallEvents([]);
      setEvaluation(null);
      setQaScores({});
      setQaComments('');
      setAiEvaluation(null);
      void loadEvents(call.id);
      void loadEvaluation(call.id);
      void loadAiEvaluation(call.id);
    },
    [loadEvents, loadEvaluation, loadAiEvaluation]
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadCalls();
    void loadMembers();
    void loadSupervision();
  }, [loadCalls, loadMembers, loadSupervision]);

  // Refresco silencioso del historial: la transcripción automática y
  // las llamadas cerradas desde otra pestaña aparecen sin recargar.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      void loadCalls(true);
    }, 20_000);
    return () => clearInterval(timer);
  }, [loadCalls]);

  // La supervisión es una foto: se refresca cada 5 s mientras la
  // pestaña esté visible (igual que el sondeo del softphone).
  useEffect(() => {
    if (!canSupervise) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      void loadSupervision();
    }, 5000);
    return () => clearInterval(timer);
  }, [canSupervise, loadSupervision]);

  // Reloj para las duraciones de las llamadas en curso y la espera.
  const hasLiveCalls = Boolean(
    supervision?.queue.length ||
      supervision?.agents.some((agent) => agent.active_call)
  );
  useEffect(() => {
    if (!hasLiveCalls) return;
    const timer = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [hasLiveCalls]);

  // Al colgar, refrescar historial y estado.
  useEffect(() => {
    if (phase === 'idle') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void loadCalls();
      void loadSupervision();
    }
  }, [phase, loadCalls, loadSupervision]);

  // Prellenar el formulario cuando llega la configuración. El sondeo
  // de estado trae un objeto nuevo cada 5 s; el ref evita que el
  // formulario se reinicie mientras un admin está escribiendo.
  const appliedConfigKey = useRef<string | null>(null);
  const configKey = status?.config?.updated_at ?? status?.config?.id ?? 'none';
  useEffect(() => {
    if (appliedConfigKey.current === configKey) return;
    appliedConfigKey.current = configKey;
    setForm(formFromConfig(status?.config ?? null));
  }, [configKey, status?.config]);

  const memberName = useMemo(() => {
    const map = new Map(members.map((m) => [m.user_id, m.full_name]));
    return (userId: string | null) => (userId ? (map.get(userId) ?? '—') : '—');
  }, [members]);

  const metrics = useMemo(() => {
    const today = new Date().toDateString();
    const todays = calls.filter(
      (call) => new Date(call.started_at).toDateString() === today
    );
    const answered = todays.filter((call) => call.answered_at);
    const talk = answered.reduce(
      (total, call) => total + (call.duration_seconds ?? 0),
      0
    );
    return {
      total: todays.length,
      answered: answered.length,
      missed: todays.filter(
        (call) => call.status === 'missed' || call.status === 'failed'
      ).length,
      average: answered.length ? Math.round(talk / answered.length) : 0,
    };
  }, [calls]);

  const submitDial = async () => {
    setDialError(null);
    if (!normalizePhone(dial)) {
      setDialError('Escribe un número válido (0412… o +58…).');
      return;
    }
    const ok = await startCall(dial);
    if (ok) setDial('');
  };

  const saveConfig = async () => {
    setSaving(true);
    try {
      const inboundNumbers = form.inboundNumbers
        .split(/[,;\s]+/)
        .map((value) => value.trim())
        .filter(Boolean);
      const res = await fetch('/api/telephony/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: form.enabled,
          outboundCallerId: form.outboundCallerId.trim() || null,
          sipOutboundTrunkId: form.sipOutboundTrunkId.trim() || null,
          inboundNumbers,
          recordingEnabled: form.recordingEnabled,
          transcriptionEnabled: form.transcriptionEnabled,
          queueMaxWaitSeconds: form.queueMaxWaitSeconds,
          requiredSkills: form.requiredSkills,
          skillOverflowSeconds: form.skillOverflowSeconds,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        toast.error(body.error ?? 'No se pudo guardar la configuración.');
        return;
      }
      toast.success('Configuración de telefonía guardada.');
      await refresh();
    } finally {
      setSaving(false);
    }
  };

  const saveSkills = async () => {
    if (!skillMember) return;
    setSavingSkills(true);
    try {
      const skills = skillDraft
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      const res = await fetch(`/api/account/members/${skillMember.user_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentSkills: skills }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        agent_skills?: string[];
      };
      if (!res.ok) {
        toast.error(body.error ?? 'No se pudieron guardar las habilidades.');
        return;
      }
      toast.success('Habilidades guardadas.');
      setSkillMember(null);
      await loadSupervision();
    } finally {
      setSavingSkills(false);
    }
  };

  const transcribe = async (call: CallSession) => {
    setTranscribingId(call.id);
    try {
      const res = await fetch(`/api/telephony/calls/${call.id}/transcribe`, {
        method: 'POST',
      });
      const body = (await res.json().catch(() => ({}))) as {
        call?: CallSession;
        error?: string;
      };
      if (!res.ok || !body.call) {
        toast.error(body.error ?? 'No se pudo transcribir la llamada.');
        return;
      }
      setCalls((current) =>
        current.map((row) => (row.id === call.id ? body.call! : row))
      );
      toast.success('Transcripción lista.');
    } finally {
      setTranscribingId(null);
    }
  };

  const summarize = async (call: CallSession) => {
    setSummarizingId(call.id);
    try {
      const res = await fetch(`/api/telephony/calls/${call.id}/summary`, {
        method: 'POST',
      });
      const body = (await res.json().catch(() => ({}))) as {
        call?: CallSession;
        error?: string;
      };
      if (!res.ok || !body.call) {
        toast.error(body.error ?? 'No se pudo resumir la llamada.');
        return;
      }
      setCalls((current) =>
        current.map((row) => (row.id === call.id ? body.call! : row))
      );
      setTranscriptCall(body.call);
      void loadEvents(call.id);
      toast.success('Resumen listo.');
    } finally {
      setSummarizingId(null);
    }
  };

  const saveAiEvaluation = async () => {
    if (!transcriptCall) return;
    setAiEvaluating(true);
    try {
      const res = await fetch(
        `/api/telephony/calls/${transcriptCall.id}/ai-evaluate`,
        { method: 'POST' }
      );
      const body = (await res.json().catch(() => ({}))) as {
        evaluation?: CallAiEvaluation;
        error?: string;
      };
      if (!res.ok || !body.evaluation) {
        toast.error(body.error ?? 'No se pudo evaluar con IA.');
        return;
      }
      setAiEvaluation(body.evaluation);
      toast.success(`Nota de IA guardada: ${body.evaluation.score}/100.`);
      void loadEvents(transcriptCall.id);
    } finally {
      setAiEvaluating(false);
    }
  };

  const saveEvaluation = async () => {
    if (!transcriptCall) return;
    setSavingQa(true);
    try {
      const res = await fetch('/api/telephony/evaluations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callId: transcriptCall.id,
          criteria: qaScores,
          comments: qaComments.trim() || null,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        evaluation?: CallEvaluation;
        error?: string;
      };
      if (!res.ok || !body.evaluation) {
        toast.error(body.error ?? 'No se pudo guardar la evaluación.');
        return;
      }
      setEvaluation(body.evaluation);
      setQaScores(
        Object.fromEntries(
          body.evaluation.criteria.map((row) => [row.key, row.score])
        )
      );
      toast.success(`Evaluación guardada: ${body.evaluation.score}/100.`);
      void loadEvents(transcriptCall.id);
      void loadCalls(true);
    } finally {
      setSavingQa(false);
    }
  };

  const notReady = !statusLoading && status && !status.dialReady;
  const qaComplete = QA_CRITERIA.every(
    (criterion) => typeof qaScores[criterion.key] === 'number'
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-foreground text-lg font-semibold">
            Centro de llamadas
          </h2>
          <p className="text-muted-foreground mt-1 max-w-2xl text-sm">
            Marca desde el navegador, registra cada llamada como actividad de
            CRM y mide la operación. La voz viaja por LiveKit (open source) y la
            PSTN por tu troncal SIP.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canSupervise ? (
            <Button
              variant="outline"
              render={<Link href="/telefonia/reportes" />}
            >
              <BarChart3 className="mr-1.5 h-4 w-4" />
              Reportes
            </Button>
          ) : null}
          <Button
            onClick={() => setOpen(true)}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            <PhoneCall className="mr-1.5 h-4 w-4" />
            Abrir teléfono
          </Button>
        </div>
      </div>

      {notReady ? (
        <div className="flex items-start gap-3 rounded-xl border border-amber-300/60 bg-amber-50 p-4 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div className="space-y-1 text-sm">
            <p className="font-semibold">La telefonía aún no está operativa</p>
            <p>{status?.blockReason}</p>
            {status?.missing?.length ? (
              <p className="font-mono text-xs">
                Faltan: {status.missing.join(', ')}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Llamadas hoy"
          value={String(metrics.total)}
          icon={Phone}
        />
        <MetricCard
          title="Contestadas"
          value={String(metrics.answered)}
          icon={CheckCircle2}
        />
        <MetricCard
          title="Duración media"
          value={formatCallDuration(metrics.average)}
          icon={Clock}
        />
        <MetricCard
          title="Perdidas / fallidas"
          value={String(metrics.missed)}
          icon={PhoneMissed}
        />
      </div>

      {canSupervise ? (
        <Panel
          title="Supervisión del equipo"
          subtitle="Presencia, estado operativo y llamadas en curso. Solo admin+."
          actions={
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadSupervision()}
            >
              <Users className="mr-1 h-3.5 w-3.5" />
              Actualizar
            </Button>
          }
          bodyClassName="p-0"
        >
          {!supervision ? (
            <p className="text-muted-foreground p-5 text-sm">
              Cargando equipo…
            </p>
          ) : supervision.migrationMissing ? (
            <p className="text-muted-foreground p-5 text-sm">
              Aplica la migración 112 para ver el estado de los agentes y las
              llamadas en curso.
            </p>
          ) : (
            <>
              {supervision.queue.length > 0 ? (
                <div className="border-border border-b bg-amber-50/60 px-5 py-3 dark:bg-amber-950/20">
                  <p className="flex items-center gap-1.5 text-sm font-medium text-amber-800 dark:text-amber-200">
                    <PhoneIncoming className="h-4 w-4" />
                    En espera ({supervision.queue.length})
                  </p>
                  <ul className="mt-2 space-y-1">
                    {supervision.queue.map((item) => (
                      <li
                        key={item.id}
                        className="flex flex-wrap items-center justify-between gap-2 text-xs"
                      >
                        <span className="text-foreground">
                          {item.contact_name ||
                            formatPhoneDisplay(item.from_number) ||
                            'Número desconocido'}
                        </span>
                        <span className="text-muted-foreground">
                          esperando{' '}
                          {formatCallDuration(
                            Math.max(
                              0,
                              Math.floor(
                                (nowTick - new Date(item.started_at).getTime()) /
                                  1000
                              )
                            )
                          )}
                          {item.to_number
                            ? ` · marcó a ${formatPhoneDisplay(item.to_number)}`
                            : ''}
                        </span>
                        {item.required_skills.length > 0 ? (
                          <span className="inline-flex items-center gap-1">
                            <Badge
                              variant="outline"
                              className="text-[10px]"
                              title={`Requiere: ${item.required_skills.join(', ')}`}
                            >
                              {item.required_skills.join(' · ')}
                            </Badge>
                            {item.overflowed_at ? (
                              <Badge
                                variant="outline"
                                className="border-indigo-300 text-[10px] text-indigo-700 dark:text-indigo-300"
                                title="El requisito se levantó: cualquier agente disponible puede tomarla."
                              >
                                desbordada
                              </Badge>
                            ) : null}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Agente</TableHead>
                    <TableHead>Presencia</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Habilidades</TableHead>
                    <TableHead>Llamada en curso</TableHead>
                    <TableHead>Última conexión</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {supervision.agents.map((agent) => {
                    const call = agent.active_call;
                    const startIso = call?.answered_at ?? call?.started_at;
                    const seconds = startIso
                      ? Math.max(
                          0,
                          Math.floor(
                            (nowTick - new Date(startIso).getTime()) / 1000
                          )
                        )
                      : null;
                    return (
                      <TableRow key={agent.user_id}>
                        <TableCell>
                          <p className="text-foreground text-sm">
                            {agent.name}
                          </p>
                          <p className="text-muted-foreground text-[11px]">
                            {roleText[agent.role] ?? agent.role}
                          </p>
                        </TableCell>
                        <TableCell>
                          <span className="inline-flex items-center gap-1.5 text-xs">
                            <span
                              className={cn(
                                'h-2 w-2 rounded-full',
                                presenceDot[agent.presence]
                              )}
                            />
                            {presenceText[agent.presence] ?? agent.presence}
                          </span>
                        </TableCell>
                        <TableCell>
                          {agent.presence === 'offline' ? (
                            <span className="text-muted-foreground text-xs">
                              —
                            </span>
                          ) : (
                            <Badge
                              variant="outline"
                              className={cn(
                                'text-[10px]',
                                agentTone[agent.agent_status]
                              )}
                            >
                              {agentStatusLabel(agent.agent_status)}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          <div className="flex flex-wrap items-center gap-1">
                            {agent.skills.length > 0 ? (
                              agent.skills.map((skill) => (
                                <Badge
                                  key={skill}
                                  variant="outline"
                                  className="text-[10px]"
                                >
                                  {skill}
                                </Badge>
                              ))
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6"
                              title="Editar habilidades"
                              onClick={() => {
                                setSkillMember({
                                  user_id: agent.user_id,
                                  name: agent.name,
                                  skills: agent.skills,
                                });
                                setSkillDraft(agent.skills.join(', '));
                              }}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">
                          {call ? (
                            <span className="text-foreground inline-flex flex-wrap items-center gap-1">
                              {call.direction === 'inbound' ? (
                                <PhoneIncoming className="h-3.5 w-3.5" />
                              ) : (
                                <PhoneOutgoing className="h-3.5 w-3.5" />
                              )}
                              {formatPhoneDisplay(call.number) ||
                                call.number ||
                                '—'}
                              <span className="text-muted-foreground font-mono tabular-nums">
                                {call.status === 'ringing' && !call.answered_at
                                  ? 'sonando '
                                  : '· '}
                                {formatCallDuration(seconds)}
                              </span>
                            </span>
                          ) : (
                            <span className="text-muted-foreground">Libre</span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-[11px]">
                          {agent.last_seen_at
                            ? formatDistanceToNow(new Date(agent.last_seen_at), {
                                addSuffix: true,
                                locale: es,
                              })
                            : '—'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </>
          )}
        </Panel>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <Panel
          title="Historial de llamadas"
          subtitle="Últimas 50. El resultado se guarda también en Actividades y Métricas → Llamadas."
          actions={
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadCalls()}
              disabled={callsLoading}
            >
              {callsLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : null}
              Actualizar
            </Button>
          }
          bodyClassName="p-0"
        >
          {callsLoading && calls.length === 0 ? (
            <p className="text-muted-foreground p-5 text-sm">Cargando…</p>
          ) : calls.length === 0 ? (
            <div className="p-8 text-center">
              <Phone className="text-muted-foreground/60 mx-auto h-8 w-8" />
              <p className="text-foreground mt-2 text-sm font-medium">
                Todavía no hay llamadas
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                Marca desde el teléfono y aparecerán aquí con su resultado.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Dirección</TableHead>
                  <TableHead>Número</TableHead>
                  <TableHead>Agente</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Duración</TableHead>
                  <TableHead className="text-right">Transcripción</TableHead>
                  <TableHead className="text-right">Detalle</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {calls.map((call) => {
                  const other =
                    call.direction === 'inbound'
                      ? call.from_number
                      : call.to_number;
                  return (
                    <TableRow key={call.id}>
                      <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                        {format(new Date(call.started_at), 'dd/MM HH:mm')}
                      </TableCell>
                      <TableCell>
                        <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                          {call.direction === 'inbound' ? (
                            <PhoneIncoming className="h-3.5 w-3.5" />
                          ) : (
                            <PhoneOutgoing className="h-3.5 w-3.5" />
                          )}
                          {callDirectionLabel(call.direction)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="min-w-0">
                          <p className="text-foreground truncate text-sm">
                            {call.contact?.name ||
                              formatPhoneDisplay(other) ||
                              other ||
                              '—'}
                          </p>
                          {call.contact?.name && other ? (
                            <p className="text-muted-foreground truncate text-xs">
                              {formatPhoneDisplay(other)}
                            </p>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {memberName(call.agent_user_id)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-[10px]',
                            statusTone[call.status] ?? 'border-border'
                          )}
                          title={callResultLabel(
                            call.answered_at ? 'answered' : 'no_answer'
                          )}
                        >
                          {callSessionStatusLabel(call.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs tabular-nums">
                        {formatCallDuration(call.duration_seconds)}
                      </TableCell>
                      <TableCell className="text-right">
                        {call.transcript ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openCall(call)}
                          >
                            <FileText className="mr-1 h-3.5 w-3.5" />
                            Ver
                          </Button>
                        ) : call.recording_url ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={transcribingId === call.id}
                            onClick={() => void transcribe(call)}
                          >
                            {transcribingId === call.id ? (
                              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <FileText className="mr-1 h-3.5 w-3.5" />
                            )}
                            Transcribir
                          </Button>
                        ) : (
                          <span className="text-muted-foreground text-[11px]">
                            {call.recording_url === null &&
                            call.status === 'ended'
                              ? 'Sin grabación'
                              : '—'}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Ver detalle y bitácora"
                          onClick={() => openCall(call)}
                        >
                          <Info className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Panel>

        <div className="space-y-5">
          <Panel title="Marcar" subtitle="El audio se abre en el softphone.">
            <div className="space-y-2">
              <Label htmlFor="page-dial">Número</Label>
              <Input
                id="page-dial"
                type="tel"
                inputMode="tel"
                placeholder="0412 123 4567"
                value={dial}
                onChange={(event) => setDial(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void submitDial();
                  }
                }}
                disabled={!callable}
              />
              {dialError ? (
                <p className="text-xs text-red-600 dark:text-red-400">
                  {dialError}
                </p>
              ) : null}
              <Button
                className="bg-primary text-primary-foreground hover:bg-primary/90 w-full"
                onClick={() => void submitDial()}
                disabled={!callable || !dial.trim()}
              >
                <Phone className="mr-1.5 h-4 w-4" />
                Llamar
              </Button>
              <p className="text-muted-foreground text-[11px]">
                {callable
                  ? status?.callerId
                    ? `Sale como ${formatPhoneDisplay(status.callerId)}`
                    : 'Sale con el número de la troncal'
                  : (status?.blockReason ?? 'Telefonía no configurada.')}
              </p>
            </div>
          </Panel>

          <Panel
            title="Estado del servidor"
            subtitle="Variables de entorno de LiveKit."
          >
            <div className="space-y-2 text-xs">
              <StatusLine
                label="LiveKit"
                ok={Boolean(status?.ready)}
                detail={
                  status?.ready ? 'Credenciales presentes' : 'Sin configurar'
                }
              />
              <StatusLine
                label="Troncal SIP"
                ok={Boolean(status?.trunkConfigured)}
                detail={
                  status?.trunkConfigured
                    ? 'Saliente disponible'
                    : 'Falta LIVEKIT_SIP_TRUNK_ID'
                }
              />
              <StatusLine
                label="Grabación (Egress)"
                ok={Boolean(status?.recording.serverEnabled)}
                detail={
                  status?.recording.serverEnabled
                    ? 'Habilitada en el servidor'
                    : 'LIVEKIT_RECORDING_ENABLED apagado'
                }
              />
              <StatusLine
                label="Transcripción"
                ok={Boolean(status?.recording.transcriptionEnabled)}
                detail="Usa el proveedor de Ajustes → Asistente de IA"
              />
            </div>
          </Panel>
        </div>
      </div>

      {isAdmin || accountRole === 'owner' ? (
        <Panel
          title="Configuración del negocio"
          subtitle="Solo admin+. Los secretos de LiveKit viven en el servidor, nunca aquí."
          actions={
            <Button
              onClick={() => void saveConfig()}
              disabled={saving || Boolean(status?.migrationMissing)}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {saving ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-1.5 h-4 w-4" />
              )}
              Guardar
            </Button>
          }
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Telefonía activa</Label>
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.enabled}
                  onCheckedChange={(value) =>
                    setForm((current) => ({ ...current, enabled: !!value }))
                  }
                />
                <span className="text-muted-foreground text-xs">
                  Si se apaga, el softphone deja de marcar en este negocio.
                </span>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="caller-id">Número saliente (Caller ID)</Label>
              <Input
                id="caller-id"
                placeholder="+584121234567 (opcional)"
                value={form.outboundCallerId}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    outboundCallerId: event.target.value,
                  }))
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="trunk-id">
                Troncal SIP saliente (ID de LiveKit)
              </Label>
              <Input
                id="trunk-id"
                placeholder="ST_… (vacío = la del servidor)"
                value={form.sipOutboundTrunkId}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    sipOutboundTrunkId: event.target.value,
                  }))
                }
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="inbound">Números entrantes</Label>
              <Textarea
                id="inbound"
                rows={2}
                placeholder="+584121234567, +582121234567"
                value={form.inboundNumbers}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    inboundNumbers: event.target.value,
                  }))
                }
              />
              <p className="text-muted-foreground text-[11px]">
                Sepáralos con comas. El webhook usa el número marcado para
                asignar la llamada a este negocio.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Grabar llamadas</Label>
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.recordingEnabled}
                  disabled={!status?.recording.serverEnabled}
                  onCheckedChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      recordingEnabled: !!value,
                    }))
                  }
                />
                <span className="text-muted-foreground text-xs">
                  {status?.recording.serverEnabled
                    ? 'Egress graba solo audio al contestar.'
                    : 'El servidor no tiene Egress habilitado.'}
                </span>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Transcribir grabaciones</Label>
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.transcriptionEnabled}
                  onCheckedChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      transcriptionEnabled: !!value,
                    }))
                  }
                />
                <span className="text-muted-foreground text-xs">
                  Usa OpenAI, Groq o Gemini del Asistente de IA.
                </span>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="queue-max-wait">
                Espera máxima en cola (segundos)
              </Label>
              <Input
                id="queue-max-wait"
                type="number"
                min={0}
                max={3600}
                step={5}
                value={form.queueMaxWaitSeconds}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    queueMaxWaitSeconds: Number(event.target.value) || 0,
                  }))
                }
              />
              <p className="text-muted-foreground text-[11px]">
                0 = sin límite. Si una entrante supera este tiempo sonando,
                la cola la retira automáticamente.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="required-skills">
                Habilidades requeridas en la cola
              </Label>
              <Input
                id="required-skills"
                placeholder="ventas, soporte"
                value={form.requiredSkills}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    requiredSkills: event.target.value,
                  }))
                }
              />
              <p className="text-muted-foreground text-[11px]">
                Sepáralas con comas (máx. 8). Solo se ofrece la entrante a
                agentes que tengan todas. Vacío = entra cualquier agente.
                Asigna las habilidades de cada persona en la supervisión.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="skill-overflow">
                Desbordamiento por habilidad (segundos)
              </Label>
              <Input
                id="skill-overflow"
                type="number"
                min={0}
                max={3600}
                step={5}
                value={form.skillOverflowSeconds}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    skillOverflowSeconds: Number(event.target.value) || 0,
                  }))
                }
              />
              <p className="text-muted-foreground text-[11px]">
                0 = sin desbordamiento. Si nadie con las habilidades la toma en
                este tiempo, la llamada pasa a cualquier agente disponible.
              </p>
            </div>
          </div>

          {status?.migrationMissing ? (
            <p className="mt-4 rounded-lg border border-red-300/60 bg-red-50 p-3 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300">
              Falta aplicar <code>112_telephony.sql</code> en Supabase. Hasta
              entonces no se pueden guardar sesiones ni cambiar estados.
            </p>
          ) : null}
        </Panel>
      ) : null}

      <Panel
        title="Puesta en marcha"
        subtitle="Qué falta del lado de infraestructura (una sola vez por despliegue)."
      >
        <ol className="text-muted-foreground ml-4 list-decimal space-y-2 text-sm">
          <li>
            Levanta LiveKit (Docker o LiveKit Cloud) y define{' '}
            <code className="bg-muted rounded px-1 text-xs">LIVEKIT_URL</code>,{' '}
            <code className="bg-muted rounded px-1 text-xs">
              LIVEKIT_API_KEY
            </code>{' '}
            y{' '}
            <code className="bg-muted rounded px-1 text-xs">
              LIVEKIT_API_SECRET
            </code>{' '}
            en el servidor.
          </li>
          <li>
            Crea una troncal SIP saliente en LiveKit (Telnyx, Twilio, un
            operador local…) y copia su ID a{' '}
            <code className="bg-muted rounded px-1 text-xs">
              LIVEKIT_SIP_TRUNK_ID
            </code>{' '}
            o al campo de arriba.
          </li>
          <li>
            Apunta el webhook de LiveKit a{' '}
            <code className="bg-muted rounded px-1 text-xs">
              https://TU-DOMINIO/api/telephony/webhook
            </code>
            . Sin él, una pestaña cerrada no cierra la llamada.
          </li>
          <li>
            Para entrantes, crea una regla de despacho (individual) con prefijo
            de sala{' '}
            <code className="bg-muted rounded px-1 text-xs">crm-call-</code> y
            metadata{' '}
            <code className="bg-muted rounded px-1 text-xs">
              {`{"account_id":"…"}`}
            </code>{' '}
            y registra el número en “Números entrantes”. El softphone avisa
            cuando suena y el primer agente que contesta la reclama.
          </li>
          <li>
            Grabación: habilita Egress + almacenamiento S3/Supabase y{' '}
            <code className="bg-muted rounded px-1 text-xs">
              LIVEKIT_RECORDING_ENABLED=true
            </code>
            . Para transcribir, publica la base de las grabaciones en{' '}
            <code className="bg-muted rounded px-1 text-xs">
              TELEPHONY_RECORDINGS_PUBLIC_BASE_URL
            </code>
            .
          </li>
        </ol>
        <div className="border-border bg-muted/40 text-muted-foreground mt-4 flex items-start gap-2 rounded-lg border p-3 text-xs">
          <Server className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            La guía completa está en{' '}
            <code className="bg-background rounded px-1">
              docs/telefonia-livekit.md
            </code>
            . Este módulo no guarda secretos en la base de datos.
          </p>
        </div>
      </Panel>

      <Dialog
        open={Boolean(transcriptCall)}
        onOpenChange={(open) => {
          if (!open) {
            setTranscriptCall(null);
            setCallEvents([]);
            setEvaluation(null);
            setQaScores({});
            setQaComments('');
            setAiEvaluation(null);
          }
        }}
      >
        <DialogContent className="border-border bg-popover text-popover-foreground sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Detalle de la llamada</DialogTitle>
            <DialogDescription>
              {transcriptCall
                ? [
                    format(
                      new Date(transcriptCall.started_at),
                      'dd/MM/yyyy HH:mm'
                    ),
                    transcriptCall.direction === 'inbound'
                      ? 'Entrante'
                      : 'Saliente',
                    formatCallDuration(transcriptCall.duration_seconds),
                    transcriptCall.contact?.name,
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : ''}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-1">
            {transcriptCall?.recording_url ? (
              <div className="space-y-1">
                <p className="text-foreground text-xs font-medium">
                  Grabación
                </p>
                <audio
                  controls
                  preload="none"
                  src={transcriptCall.recording_url}
                  className="w-full"
                />
                <a
                  href={transcriptCall.recording_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary text-[11px] hover:underline"
                >
                  Abrir en otra pestaña
                </a>
              </div>
            ) : null}

            {transcriptCall?.transcript ? (
              <>
                {transcriptCall.ai_summary ? (
                  <div className="rounded-lg border border-emerald-300/60 bg-emerald-50/60 p-3 dark:bg-emerald-950/20">
                    <p className="text-foreground mb-1 flex items-center gap-1.5 text-xs font-medium">
                      <Sparkles className="h-3.5 w-3.5" />
                      Resumen con IA
                    </p>
                    <p className="text-foreground text-sm whitespace-pre-wrap">
                      {transcriptCall.ai_summary}
                    </p>
                  </div>
                ) : (
                  <div className="border-border flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
                    <p className="text-muted-foreground max-w-md text-xs">
                      Genera un resumen corto (motivo, acuerdos y siguiente
                      paso) con el Asistente de IA del negocio.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={summarizingId === transcriptCall.id}
                      onClick={() => void summarize(transcriptCall)}
                    >
                      {summarizingId === transcriptCall.id ? (
                        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="mr-1 h-3.5 w-3.5" />
                      )}
                      {summarizingId === transcriptCall.id
                        ? 'Generando…'
                        : 'Resumir'}
                    </Button>
                  </div>
                )}

                <div className="space-y-1">
                  <p className="text-foreground text-xs font-medium">
                    Transcripción
                  </p>
                  <div className="border-border bg-muted/30 text-foreground max-h-56 overflow-y-auto rounded-lg border p-3 text-sm whitespace-pre-wrap">
                    {transcriptCall.transcript}
                  </div>
                </div>
              </>
            ) : (
              <p className="text-muted-foreground text-xs">
                {transcriptCall?.recording_url
                  ? 'La grabación aún no tiene transcripción. Usa “Transcribir” en el historial.'
                  : 'Esta llamada no tiene grabación ni transcripción.'}
              </p>
            )}

            {canSupervise &&
            transcriptCall &&
            transcriptCall.answered_at &&
            isTerminalCallStatus(transcriptCall.status) ? (
              <div className="border-border space-y-2 rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-foreground flex items-center gap-1.5 text-xs font-medium">
                    <ClipboardCheck className="h-3.5 w-3.5" />
                    Evaluación de calidad
                  </p>
                  {evaluation ? (
                    <Badge
                      variant="outline"
                      className={cn(
                        'text-[10px]',
                        evaluation.score >= 80
                          ? 'border-emerald-300 text-emerald-700 dark:text-emerald-300'
                          : evaluation.score >= 60
                            ? 'border-amber-300 text-amber-700 dark:text-amber-300'
                            : 'border-red-300 text-red-600 dark:text-red-400'
                      )}
                    >
                      {evaluation.score}/100
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground text-[11px]">
                      Sin evaluar
                    </span>
                  )}
                </div>

                {evaluationLoading ? (
                  <p className="text-muted-foreground text-xs">Cargando…</p>
                ) : qaMigrationMissing ? (
                  <p className="text-muted-foreground text-xs">
                    Aplica la migración 114 en Supabase para evaluar la
                    calidad de las llamadas.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {QA_CRITERIA.map((criterion) => (
                      <div
                        key={criterion.key}
                        className="grid gap-1 sm:grid-cols-[1fr_5rem] sm:items-center"
                      >
                        <div>
                          <p className="text-foreground text-xs">
                            {criterion.label}
                          </p>
                          <p className="text-muted-foreground text-[10px]">
                            {criterion.hint}
                          </p>
                        </div>
                        <select
                          aria-label={criterion.label}
                          value={qaScores[criterion.key] ?? ''}
                          onChange={(event) => {
                            const value = event.target.value;
                            setQaScores((current) => {
                              const next = { ...current };
                              if (value === '') delete next[criterion.key];
                              else next[criterion.key] = Number(value);
                              return next;
                            });
                          }}
                          className="border-border bg-background text-foreground h-8 w-full rounded-md border px-2 text-sm"
                        >
                          <option value="">—</option>
                          {Array.from(
                            { length: QA_MAX_PER_CRITERION + 1 },
                            (_, score) => (
                              <option key={score} value={score}>
                                {score}
                              </option>
                            )
                          )}
                        </select>
                      </div>
                    ))}
                    <textarea
                      rows={2}
                      value={qaComments}
                      onChange={(event) =>
                        setQaComments(event.target.value.slice(0, 2000))
                      }
                      placeholder="Comentarios para el agente (opcional)"
                      className="border-border bg-background text-foreground w-full rounded-md border px-2 py-1.5 text-sm"
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-muted-foreground text-[11px]">
                        0 = no cumple · {QA_MAX_PER_CRITERION} = excelente
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!qaComplete || savingQa}
                        onClick={() => void saveEvaluation()}
                      >
                        {savingQa ? (
                          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <ClipboardCheck className="mr-1 h-3.5 w-3.5" />
                        )}
                        {evaluation ? 'Actualizar evaluación' : 'Guardar evaluación'}
                      </Button>
                    </div>
                  </div>
                )}

                {aiMigrationMissing ? null : (
                  <div className="border-border rounded-lg border border-dashed p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-foreground flex items-center gap-1.5 text-xs font-medium">
                        <Sparkles className="h-3.5 w-3.5" />
                        Nota automática de IA
                      </p>
                      <div className="flex items-center gap-2">
                        {aiEvaluation ? (
                          <Badge
                            variant="outline"
                            className={cn(
                              'text-[10px]',
                              aiEvaluation.score >= 80
                                ? 'border-emerald-300 text-emerald-700 dark:text-emerald-300'
                                : aiEvaluation.score >= 60
                                  ? 'border-amber-300 text-amber-700 dark:text-amber-300'
                                  : 'border-red-300 text-red-600 dark:text-red-400'
                            )}
                          >
                            {aiEvaluation.score}/100
                          </Badge>
                        ) : null}
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={
                            aiEvaluating || !transcriptCall?.transcript
                          }
                          onClick={() => void saveAiEvaluation()}
                        >
                          {aiEvaluating ? (
                            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Sparkles className="mr-1 h-3.5 w-3.5" />
                          )}
                          {aiEvaluation ? 'Regenerar' : 'Evaluar con IA'}
                        </Button>
                      </div>
                    </div>
                    {aiEvaluation?.summary ? (
                      <p className="text-muted-foreground mt-1 text-xs">
                        {aiEvaluation.summary}
                      </p>
                    ) : (
                      <p className="text-muted-foreground mt-1 text-[11px]">
                        {transcriptCall?.transcript
                          ? 'Genera una segunda opinión a partir de la transcripción, con la misma rúbrica.'
                          : 'Requiere una transcripción de la llamada.'}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ) : null}

            <div className="space-y-2">
              <p className="text-foreground flex items-center gap-1.5 text-xs font-medium">
                <Clock className="h-3.5 w-3.5" />
                Bitácora
              </p>
              {eventsLoading ? (
                <p className="text-muted-foreground text-xs">Cargando…</p>
              ) : callEvents.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  Sin eventos registrados.
                </p>
              ) : (
                <ol className="space-y-1.5">
                  {callEvents.map((event) => (
                    <li
                      key={event.id}
                      className="flex flex-wrap items-baseline gap-x-2 text-xs"
                    >
                      <span className="text-muted-foreground font-mono tabular-nums">
                        {format(new Date(event.created_at), 'HH:mm:ss')}
                      </span>
                      <span className="text-foreground">
                        {callEventText[event.type] ?? event.type}
                      </span>
                      {typeof event.payload?.message === 'string' ? (
                        <span className="text-muted-foreground truncate">
                          — {event.payload.message}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(skillMember)}
        onOpenChange={(open) => {
          if (!open) setSkillMember(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Habilidades del agente</DialogTitle>
            <DialogDescription>
              {skillMember?.name}. Sepáralas con comas (máx. 8). Una llamada
              que exija habilidades solo se le ofrece a quien las tenga todas;
              vacío = solo recibe las que no exigen nada o ya desbordaron.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="skills-draft">Habilidades</Label>
              <Input
                id="skills-draft"
                placeholder="ventas, cobranza"
                value={skillDraft}
                onChange={(event) => setSkillDraft(event.target.value)}
              />
            </div>
            <p className="text-muted-foreground text-[11px]">
              Se guardan en minúsculas y sin duplicados. El agente las recibe al
              instante; las llamadas que ya están sonando no cambian.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSkillMember(null)}
              disabled={savingSkills}
            >
              Cancelar
            </Button>
            <Button onClick={() => void saveSkills()} disabled={savingSkills}>
              {savingSkills ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="mr-1 h-3.5 w-3.5" />
              )}
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusLine({
  label,
  ok,
  detail,
}: {
  label: string;
  ok: boolean;
  detail: string;
}) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          'text-right text-[11px]',
          ok
            ? 'text-emerald-600 dark:text-emerald-400'
            : 'text-amber-600 dark:text-amber-400'
        )}
      >
        {ok ? 'Listo' : 'Pendiente'} · {detail}
      </span>
    </div>
  );
}
