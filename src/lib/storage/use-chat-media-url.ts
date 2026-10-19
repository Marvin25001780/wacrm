"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  CHAT_MEDIA_BUCKET,
  chatMediaPathFromUrl,
} from "@/lib/storage/chat-media";

/**
 * Resuelve URLs del bucket privado `chat-media` a URLs firmadas.
 *
 * Desde la migración 065 el bucket ya no es público: un `<img src>` con la
 * URL guardada en `messages.media_url` devuelve 400. Este hook firma la
 * ruta con el cliente del usuario (la política SELECT de `storage.objects`
 * limita la firma a objetos de su cuenta) y cachea el resultado.
 *
 * Las URLs que no son del bucket (enlaces externos, `flow-media`) se
 * devuelven tal cual, así que los llamadores pueden usar el hook con
 * cualquier `media_url`.
 *
 * Las firmas se agrupan: todos los mensajes que se montan en el mismo
 * tick piden una sola llamada `createSignedUrls`.
 */

/** 1 hora; Meta también usa este TTL al enviar (ver send-message.ts). */
const TTL_SECONDS = 60 * 60;
/** Renueva 5 minutos antes de que caduque, para no enseñar un 400. */
const CACHE_MARGIN_MS = 5 * 60 * 1000;
/** Ventana de agrupación para no firmar de uno en uno. */
const BATCH_DELAY_MS = 10;

type Listener = (url: string | null) => void;

const cache = new Map<string, { url: string; expiresAt: number }>();
const listeners = new Map<string, Set<Listener>>();
const queued = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function cachedUrl(path: string): string | null {
  const hit = cache.get(path);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    cache.delete(path);
    return null;
  }
  return hit.url;
}

function notify(path: string, url: string | null) {
  const subs = listeners.get(path);
  listeners.delete(path);
  if (!subs) return;
  for (const listener of subs) listener(url);
}

function enqueue(path: string) {
  queued.add(path);
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, BATCH_DELAY_MS);
}

async function flush() {
  const paths = [...queued];
  queued.clear();
  if (paths.length === 0) return;

  const resolved = new Map<string, string | null>();
  try {
    const supabase = createClient();
    const { data, error } = await supabase.storage
      .from(CHAT_MEDIA_BUCKET)
      .createSignedUrls(paths, TTL_SECONDS);

    if (error || !data) throw error ?? new Error("No signed URLs returned");

    for (const row of data) {
      if (row.path) resolved.set(row.path, row.error ? null : row.signedUrl);
    }
  } catch (err) {
    console.error("[chat-media] no se pudieron firmar los adjuntos:", err);
    for (const path of paths) resolved.set(path, null);
  }

  for (const path of paths) {
    const url = resolved.get(path) ?? null;
    if (url) {
      cache.set(path, {
        url,
        expiresAt: Date.now() + TTL_SECONDS * 1000 - CACHE_MARGIN_MS,
      });
    }
    notify(path, url);
  }
}

interface State {
  /** Ruta a la que pertenece `url` (null = URL externa, no se firma). */
  path: string | null;
  url: string | null;
  loading: boolean;
}

/**
 * Devuelve la URL lista para usar en un `src`/`href`.
 *
 * - `loading` es true solo mientras se firma un objeto del bucket.
 * - `url` es null si la firma falló (objeto borrado o sin permiso); los
 *   llamadores deben mostrar el estado "no disponible".
 */
export function useChatMediaUrl(url: string | null | undefined): State {
  const path = chatMediaPathFromUrl(url);

  const [state, setState] = useState<State>(() => {
    if (!path) {
      return { path: null, url: url ?? null, loading: false };
    }
    const hit = cachedUrl(path);
    return { path, url: hit, loading: !hit };
  });

  useEffect(() => {
    if (!path) return;

    // Ya hay una firma vigente (el render la tomó de la caché): no hace
    // falta otra llamada.
    if (cachedUrl(path)) return;

    let active = true;
    const listener: Listener = (signed) => {
      if (active) setState({ path, url: signed, loading: false });
    };

    const subs = listeners.get(path) ?? new Set<Listener>();
    subs.add(listener);
    listeners.set(path, subs);
    enqueue(path);

    return () => {
      active = false;
      const current = listeners.get(path);
      current?.delete(listener);
      if (current && current.size === 0) listeners.delete(path);
    };
  }, [path]);

  // Si la URL cambió (otro mensaje / otro borrador), no devolver la firma
  // anterior mientras el efecto vuelve a firmar.
  if (state.path !== path) {
    if (!path) return { path: null, url: url ?? null, loading: false };
    const hit = cachedUrl(path);
    return { path, url: hit, loading: !hit };
  }

  // Otra instancia pudo firmar la misma ruta mientras esta mostraba
  // "no disponible": recoge la firma antes de rendirse.
  if (!state.url && path) {
    const hit = cachedUrl(path);
    if (hit) return { path, url: hit, loading: false };
  }

  return state;
}
