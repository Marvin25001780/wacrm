'use client';

// ============================================================
// Telefonía — estado global del softphone.
//
// Mantiene una sola conexión WebRTC (LiveKit) por pestaña y la
// comparte con el encabezado, la ficha del contacto y el hilo de la
// bandeja. El audio remoto se adjunta a un contenedor oculto.
//
// Si el servidor no tiene LiveKit, el contexto queda en modo
// "no configurado" y la UI explica qué falta; no se simula nada.
// ============================================================

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { useAuth } from '@/hooks/use-auth';
import { formatCallDuration } from '@/lib/telephony/calls';
import { normalizePhone } from '@/lib/telephony/phone';
import type {
  AgentStatus,
  CallDisposition,
  CallSession,
  TelephonyStatus,
} from '@/types';
import type { Room } from 'livekit-client';

export type CallPhase =
  'idle' | 'connecting' | 'ringing' | 'active' | 'ending' | 'error';

export interface WrapUpState {
  call: CallSession;
  /** Segundos hablados de la llamada que se acaba de cerrar. */
  seconds: number;
}

interface StartCallOptions {
  contactId?: string | null;
  conversationId?: string | null;
  /** Contacto de campaña (migración 117) al que se marca. */
  campaignContactId?: string | null;
}

interface TelephonyContextValue {
  status: TelephonyStatus | null;
  loading: boolean;
  open: boolean;
  setOpen: (value: boolean) => void;
  phase: CallPhase;
  activeCall: CallSession | null;
  /** Entrante sonando, sin agente asignado. */
  incomingCall: CallSession | null;
  elapsed: number;
  elapsedLabel: string;
  muted: boolean;
  recording: boolean;
  error: string | null;
  notice: string | null;
  clearError: () => void;
  startCall: (to: string, options?: StartCallOptions) => Promise<boolean>;
  /** Contesta la entrante que está sonando (la reclama para este agente). */
  answerIncoming: () => Promise<boolean>;
  /** Rechaza la entrante sin asignarla. */
  declineIncoming: () => Promise<void>;
  hangup: () => Promise<void>;
  toggleMute: () => Promise<void>;
  setAgentStatus: (next: AgentStatus) => Promise<void>;
  /** Llamada recién cerrada pendiente de disposición y notas. */
  wrapUp: WrapUpState | null;
  saveWrapUp: (input: {
    disposition: CallDisposition;
    notes?: string | null;
  }) => Promise<boolean>;
  /** Cierra el cierre sin disposición y vuelve a disponible. */
  skipWrapUp: () => Promise<void>;
  refresh: () => Promise<void>;
  /** El negocio + el servidor pueden marcar ahora. */
  callable: boolean;
}

const TelephonyContext = createContext<TelephonyContextValue | null>(null);

/**
 * Identificador de esta pestaña. Sirve para no cerrar desde aquí una
 * llamada que está viva en otra pestaña del mismo agente: al recargar
 * esta pestaña su audio desaparece y la sesión huérfana se cierra,
 * pero una segunda pestaña no toca la llamada de la primera.
 */
const TAB_ID = (() => {
  if (typeof sessionStorage === 'undefined') return `ssr-${Date.now()}`;
  const key = 'crm_telephony_tab';
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `tab-${Date.now()}`;
  sessionStorage.setItem(key, id);
  return id;
})();

export function TelephonyProvider({ children }: { children: ReactNode }) {
  const { user, accountId, accountRole } = useAuth();

  const [status, setStatus] = useState<TelephonyStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<CallPhase>('idle');
  const [activeCall, setActiveCall] = useState<CallSession | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [muted, setMuted] = useState(false);
  const [recording, setRecording] = useState(false);
  const [wrapUp, setWrapUp] = useState<WrapUpState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const roomRef = useRef<Room | null>(null);
  const audioContainerRef = useRef<HTMLDivElement | null>(null);
  const activeCallRef = useRef<CallSession | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const answeredRef = useRef(false);
  const endedRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyCall = useCallback((call: CallSession | null) => {
    activeCallRef.current = call;
    setActiveCall(call);
  }, []);

  const cleanupRoom = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    const room = roomRef.current;
    roomRef.current = null;
    if (room) {
      room.removeAllListeners();
      room.disconnect();
    }
    audioContainerRef.current?.replaceChildren();
  }, []);

  const refresh = useCallback(async () => {
    if (!user) {
      setStatus(null);
      setLoading(false);
      return;
    }
    try {
      const res = await fetch('/api/telephony/status', { cache: 'no-store' });
      const body = (await res.json().catch(() => null)) as
        TelephonyStatus | { error?: string } | null;
      if (res.ok && body && 'ready' in body) {
        setStatus(body);
        // Si la pestaña se recargó en mitad de una llamada, el audio
        // ya no existe. Cerramos la sesión huérfana en vez de dejar
        // una llamada "activa" que nadie está atendiendo.
        if (body.activeCall && !roomRef.current) {
          const callTab =
            typeof body.activeCall.metadata?.tab_id === 'string'
              ? body.activeCall.metadata.tab_id
              : null;
          if (callTab !== TAB_ID) {
            // La llamada vive en otra pestaña: no la cerramos.
            setStatus(body);
            setLoading(false);
            return;
          }
          await fetch(`/api/telephony/calls/${body.activeCall.id}/end`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: 'agent_left' }),
          }).catch(() => undefined);
          setStatus({ ...body, activeCall: null });
        }
      }
    } catch {
      // Sin red: el panel muestra el último estado conocido.
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (accountRole === 'viewer') return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [accountRole, accountId, refresh]);

  // Cronómetro de la llamada activa.
  useEffect(() => {
    if (phase !== 'active') return;
    const tick = () => {
      if (startedAtRef.current) {
        setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [phase]);

  const endCall = useCallback(
    async (
      reason: 'hangup' | 'declined' | 'failed' | 'timeout' | 'agent_left'
    ) => {
      if (endedRef.current) return;
      endedRef.current = true;
      setPhase('ending');
      const endedCall = activeCallRef.current;
      const talkSeconds = startedAtRef.current
        ? Math.max(0, Math.floor((Date.now() - startedAtRef.current) / 1000))
        : 0;
      const wasAnswered = answeredRef.current;
      const id = endedCall?.id;
      cleanupRoom();
      if (id) {
        await fetch(`/api/telephony/calls/${id}/end`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason }),
        }).catch(() => undefined);
      }
      applyCall(null);
      setPhase('idle');
      setElapsed(0);
      setMuted(false);
      setRecording(false);
      startedAtRef.current = null;
      answeredRef.current = false;
      // El agente queda en "Cierre" hasta que clasifique la llamada.
      if (wasAnswered && endedCall) {
        setWrapUp({ call: endedCall, seconds: talkSeconds });
      }
      await refresh();
    },
    [applyCall, cleanupRoom, refresh]
  );

  const markAnswered = useCallback(async () => {
    if (answeredRef.current || endedRef.current) return;
    answeredRef.current = true;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    startedAtRef.current = Date.now();
    setPhase('active');
    setElapsed(0);

    const id = activeCallRef.current?.id;
    if (!id) return;
    try {
      const res = await fetch(`/api/telephony/calls/${id}/answer`, {
        method: 'POST',
      });
      const body = (await res.json().catch(() => ({}))) as {
        call?: CallSession;
        recording?: boolean;
        error?: string;
      };
      if (res.ok && body.call) {
        applyCall(body.call);
        setRecording(Boolean(body.recording));
      } else {
        setNotice(
          body.error ??
            'La llamada está en curso, pero no se pudo registrar la contestación.'
        );
      }
    } catch {
      setNotice(
        'La llamada está en curso, pero no se pudo registrar la contestación.'
      );
    }
  }, [applyCall]);

  /** Conecta el navegador a la sala y activa micrófono/audio remoto. */
  const joinRoom = useCallback(
    async (call: CallSession, token: string, url: string): Promise<boolean> => {
      applyCall(call);
      try {
        const { Room: LiveKitRoom, RoomEvent } = await import('livekit-client');
        const room = new LiveKitRoom({
          adaptiveStream: false,
          dynacast: false,
          audioCaptureDefaults: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        roomRef.current = room;

        room.on(RoomEvent.TrackSubscribed, (track) => {
          const element = track.attach();
          element.style.display = 'none';
          audioContainerRef.current?.appendChild(element);
        });
        room.on(RoomEvent.TrackUnsubscribed, (track) => {
          track.detach().forEach((element) => element.remove());
        });
        room.on(
          RoomEvent.ParticipantAttributesChanged,
          (_changed, participant) => {
            if (participant?.attributes?.['sip.callStatus'] === 'active') {
              void markAnswered();
            }
          }
        );
        room.on(RoomEvent.ParticipantDisconnected, (participant) => {
          if (
            participant?.attributes?.['sip.phoneNumber'] &&
            !endedRef.current
          ) {
            void endCall('hangup');
          }
        });
        room.on(RoomEvent.Disconnected, () => {
          if (!endedRef.current) void endCall('agent_left');
        });

        await room.connect(url, token);
        await room.startAudio().catch(() => undefined);
        await room.localParticipant.setMicrophoneEnabled(true);
        setMuted(false);
        setPhase('ringing');

        // La troncal pudo contestar antes de que terminara el connect.
        for (const participant of room.remoteParticipants.values()) {
          if (participant.attributes['sip.callStatus'] === 'active') {
            void markAnswered();
          }
        }

        timeoutRef.current = setTimeout(() => {
          if (!answeredRef.current && !endedRef.current) {
            void endCall('timeout');
          }
        }, 60_000);

        return true;
      } catch (err) {
        console.error('[telephony] no se pudo conectar a LiveKit:', err);
        setError(
          'No se pudo abrir el audio de la llamada. Revisa el micrófono y la conexión.'
        );
        setPhase('error');
        await endCall('failed');
        return false;
      }
    },
    [applyCall, endCall, markAnswered]
  );

  const startCall = useCallback(
    async (raw: string, options?: StartCallOptions): Promise<boolean> => {
      setError(null);
      setNotice(null);
      setWrapUp(null);
      setOpen(true);

      if (phase !== 'idle' && phase !== 'error') {
        setError('Ya hay una llamada en curso.');
        return false;
      }

      const to = normalizePhone(raw);
      if (!to) {
        setError('Número inválido. Usa formato local (0412…) o +58….');
        return false;
      }
      if (!status?.dialReady) {
        setError(status?.blockReason ?? 'La telefonía no está configurada.');
        return false;
      }

      setPhase('connecting');
      setElapsed(0);
      setMuted(false);
      setRecording(false);
      answeredRef.current = false;
      endedRef.current = false;
      startedAtRef.current = null;

      let payload: {
        call?: CallSession;
        token?: string;
        url?: string;
        error?: string;
      };
      try {
        const res = await fetch('/api/telephony/calls', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to,
            contactId: options?.contactId ?? undefined,
            conversationId: options?.conversationId ?? undefined,
            tabId: TAB_ID,
            campaignContactId: options?.campaignContactId ?? undefined,
          }),
        });
        payload = (await res.json().catch(() => ({}))) as typeof payload;
        if (!res.ok || !payload.call || !payload.token || !payload.url) {
          setError(payload.error ?? 'No se pudo iniciar la llamada.');
          setPhase('error');
          return false;
        }
      } catch {
        setError('Sin conexión con el servidor. No se pudo marcar.');
        setPhase('error');
        return false;
      }

      return joinRoom(payload.call, payload.token, payload.url);
    },
    [joinRoom, phase, status]
  );

  const incomingCall = status?.incomingCall ?? null;

  const answerIncoming = useCallback(async (): Promise<boolean> => {
    if (!incomingCall) return false;
    setError(null);
    setNotice(null);
    setOpen(true);

    if (phase !== 'idle' && phase !== 'error') {
      setError('Ya hay una llamada en curso.');
      return false;
    }

    setPhase('connecting');
    setElapsed(0);
    setMuted(false);
    setRecording(false);
    answeredRef.current = false;
    endedRef.current = false;
    startedAtRef.current = null;

    try {
      const res = await fetch(`/api/telephony/calls/${incomingCall.id}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tabId: TAB_ID }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        call?: CallSession;
        token?: string;
        url?: string;
        error?: string;
      };
      if (!res.ok || !body.call || !body.token || !body.url) {
        setError(body.error ?? 'No se pudo contestar la llamada.');
        setPhase('error');
        await refresh();
        return false;
      }
      return joinRoom(body.call, body.token, body.url);
    } catch {
      setError('Sin conexión con el servidor. No se pudo contestar.');
      setPhase('error');
      return false;
    }
  }, [incomingCall, joinRoom, phase, refresh]);

  const declineIncoming = useCallback(async () => {
    if (!incomingCall) return;
    try {
      await fetch(`/api/telephony/calls/${incomingCall.id}/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'declined' }),
      });
    } catch {
      // El refresco de abajo reconcilia el estado.
    } finally {
      await refresh();
    }
  }, [incomingCall, refresh]);

  useEffect(() => {
    if (!user || accountRole === 'viewer' || phase !== 'idle') return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      void refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [user, accountRole, phase, refresh]);

  const hangup = useCallback(async () => {
    await endCall('hangup');
  }, [endCall]);

  const toggleMute = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !muted;
    await room.localParticipant.setMicrophoneEnabled(!next);
    setMuted(next);
  }, [muted]);

  const setAgentStatus = useCallback(
    async (next: AgentStatus) => {
      setStatus((prev) => (prev ? { ...prev, agentStatus: next } : prev));
      try {
        const res = await fetch('/api/telephony/presence', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: next }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          setError(body.error ?? 'No se pudo cambiar el estado.');
          await refresh();
        }
      } catch {
        setError('Sin conexión: no se pudo cambiar el estado.');
        await refresh();
      }
    },
    [refresh]
  );

  /**
   * Guarda la disposición de la llamada recién cerrada y devuelve al
   * agente a "Disponible". Sin esto el agente se queda en Cierre y no
   * recibe llamadas nuevas.
   */
  const saveWrapUp = useCallback(
    async (input: { disposition: CallDisposition; notes?: string | null }) => {
      if (!wrapUp) return false;
      try {
        const res = await fetch(`/api/telephony/calls/${wrapUp.call.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            disposition: input.disposition,
            notes: input.notes ?? null,
          }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        if (!res.ok) {
          setError(body.error ?? 'No se pudo guardar el cierre.');
          return false;
        }
        setWrapUp(null);
        await setAgentStatus('available');
        await refresh();
        return true;
      } catch {
        setError('Sin conexión: no se pudo guardar el cierre.');
        return false;
      }
    },
    [wrapUp, setAgentStatus, refresh]
  );

  const skipWrapUp = useCallback(async () => {
    setWrapUp(null);
    await setAgentStatus('available');
  }, [setAgentStatus]);

  const callable = Boolean(
    accountRole &&
    accountRole !== 'viewer' &&
    status?.dialReady &&
    status?.enabled &&
    !status?.migrationMissing
  );

  const value = useMemo<TelephonyContextValue>(
    () => ({
      status,
      loading: accountRole === 'viewer' ? false : loading,
      open: open || Boolean(incomingCall),
      setOpen,
      phase,
      activeCall,
      elapsed,
      elapsedLabel: formatCallDuration(elapsed),
      muted,
      recording,
      error,
      notice,
      incomingCall,
      clearError: () => setError(null),
      startCall,
      answerIncoming,
      declineIncoming,
      hangup,
      toggleMute,
      setAgentStatus,
      wrapUp,
      saveWrapUp,
      skipWrapUp,
      refresh,
      callable,
    }),
    [
      status,
      loading,
      accountRole,
      open,
      phase,
      activeCall,
      elapsed,
      muted,
      recording,
      error,
      notice,
      incomingCall,
      startCall,
      answerIncoming,
      declineIncoming,
      hangup,
      toggleMute,
      setAgentStatus,
      wrapUp,
      saveWrapUp,
      skipWrapUp,
      refresh,
      callable,
    ]
  );

  return (
    <TelephonyContext.Provider value={value}>
      {children}
      {/* Audio remoto: LiveKit adjunta los <audio> aquí. */}
      <div ref={audioContainerRef} className="hidden" aria-hidden="true" />
    </TelephonyContext.Provider>
  );
}

export function useTelephony(): TelephonyContextValue {
  const ctx = useContext(TelephonyContext);
  if (!ctx) {
    throw new Error('useTelephony must be used inside TelephonyProvider');
  }
  return ctx;
}
