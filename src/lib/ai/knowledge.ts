// ============================================================
// Conocimiento del agente (A2) — carga + recuperación.
//
// Modelo simple que funciona con CUALQUIER proveedor de IA sin
// configuración extra: las fuentes y Q&A viven en la base y se
// inyectan en el prompt las MÁS RELEVANTES para el mensaje del
// cliente (puntuación por palabras clave sobre título + contenido,
// sin acentos y sin distinguir mayúsculas).
//
// Upgrade documentado: cuando el volumen lo pida, migrar la
// recuperación a pgvector (embeddings por chunk). La interfaz de este
// módulo (devolver bloques de texto) no cambia.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'

interface SourceRow {
  id: string
  title: string
  content: string
  status: string
}

interface AccessRow {
  source_id: string
}

/** Quita acentos y baja a minúsculas para poder comparar "México" con "mexico". */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

/** Palabras "útiles" del mensaje del cliente. */
function tokenize(text: string): string[] {
  return normalize(text)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3)
}

/** Fuentes que este agente tiene ACTIVADAS (toggle de la UI). */
async function loadAgentSourceIds(
  db: SupabaseClient,
  agentId: string
): Promise<Set<string> | null> {
  const { data, error } = await db
    .from('ai_agent_source_access')
    .select('source_id')
    .eq('agent_id', agentId)

  if (error) {
    console.error('[knowledge] access load failed:', error.message)
    // null = no sabemos: por seguridad el agente NO lee fuentes.
    return null
  }
  return new Set((data as AccessRow[]).map((r) => r.source_id))
}

/**
 * Elige las fuentes más relevantes para el texto del cliente y las
 * devuelve como bloques de prompt. Cap por fuente (los prompts se
 * cobran por token): 1500 caracteres por bloque, 3 bloques.
 */
export function pickRelevantSources(
  sources: SourceRow[],
  userText: string,
  cap = 3
): SourceRow[] {
  const tokens = tokenize(userText)
  if (tokens.length === 0) return []

  const scored = sources.map((s) => {
    const title = normalize(s.title)
    const content = normalize(s.content)
    let score = 0
    for (const t of tokens) {
      if (title.includes(t)) score += 3
      if (content.includes(t)) score += 1
    }
    return { source: s, score }
  })

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, cap)
    .map((s) => s.source)
}

export interface AgentKnowledge {
  /** Bloques de fuente seleccionados (ya formateados). */
  blocks: string[]
  /** Q&A de la cuenta, en el idioma en que están escritas. */
  qa: { question: string; answer: string }[]
  /** true si la fuente activada del agente cargó (o si no tenía accesos). */
  loaded: boolean
}

const MAX_SOURCE_CHARS = 1500

/**
 * Carga el conocimiento del agente: las fuentes con acceso activado
 * (recortadas a lo relevante para `userText`) + las Q&A de la cuenta.
 * Nunca lanza: un fallo deja el agente sin conocimiento pero
 * respondiendo, y avisa por consola.
 */
export async function loadAgentKnowledge(
  db: SupabaseClient,
  accountId: string,
  agentId: string,
  userText: string
): Promise<AgentKnowledge> {
  try {
    const accessIds = await loadAgentSourceIds(db, agentId)
    if (accessIds === null) {
      return { blocks: [], qa: [], loaded: false }
    }
    if (accessIds.size === 0) {
      // El admin aún no activó fuentes para este agente: es un estado
      // válido (y distinto de "no se pudo leer").
      const { data: qaRows } = await db
        .from('ai_qa_pairs')
        .select('question, answer')
        .eq('account_id', accountId)
      return {
        blocks: [],
        qa: ((qaRows ?? []) as { question: string; answer: string }[]),
        loaded: true,
      }
    }

    const { data, error } = await db
      .from('ai_knowledge_sources')
      .select('id, title, content, status')
      .in('id', [...accessIds])
      .eq('status', 'available')
    if (error) throw new Error(error.message)

    const sources = (data ?? []) as SourceRow[]
    const picked = pickRelevantSources(sources, userText)
    const blocks = picked.map((s) =>
      `## ${s.title}\n${s.content.slice(0, MAX_SOURCE_CHARS)}`
    )

    const { data: qaRows, error: qaErr } = await db
      .from('ai_qa_pairs')
      .select('question, answer')
      .eq('account_id', accountId)
    if (qaErr) throw new Error(qaErr.message)

    return {
      blocks,
      qa: ((qaRows ?? []) as { question: string; answer: string }[]),
      loaded: true,
    }
  } catch (err) {
    console.error('[knowledge] load failed:', err)
    return { blocks: [], qa: [], loaded: false }
  }
}
