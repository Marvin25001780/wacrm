import { describe, expect, it } from 'vitest'

import { pickRelevantSources } from './knowledge'
import {
  parseAgentActions,
  parseAgentReply,
} from './agent-actions'
import { buildAgentSystemPrompt } from './agent-prompt'

const src = (title: string, content: string) => ({
  id: title,
  title,
  content,
  status: 'available',
})

describe('pickRelevantSources (A2)', () => {
  const sources = [
    src('Precios consulta', 'La consulta vale 30 USD y dura 30 minutos.'),
    src('Horarios', 'Abrimos de lunes a viernes de 8am a 5pm.'),
    src('Servicios', 'Consultas, odontología general, ortodoncia y limpieza.'),
  ]

  it('selecciona las fuentes relevantes, mejor puntuada primero', () => {
    const picked = pickRelevantSources(sources, '¿Cuánto vale la consulta?')
    expect(picked[0]?.title).toBe('Precios consulta')
  })

  it('ignora fuentes sin ninguna palabra del mensaje', () => {
    const picked = pickRelevantSources(sources, 'hola qué tal')
    expect(picked).toHaveLength(0)
  })

  it('respeta el tope de bloques (cap)', () => {
    const many = [...Array(10)].map((_, i) => src(`f${i}`, 'consulta consulta'))
    expect(pickRelevantSources(many, 'consulta')).toHaveLength(3)
  })

  it('compara sin acentos ni mayúsculas', () => {
    const picked = pickRelevantSources([src('Horarios', 'lunes a viernes 8am')], '¿Abren los LUNES?')
    expect(picked).toHaveLength(1)
  })

  it('sin mensaje útil no devuelve nada', () => {
    expect(pickRelevantSources(sources, 'ok')).toHaveLength(0)
  })
})

describe('protocolo de acciones (A3)', () => {
  const allowed = ['add_tag', 'close_conversation'] as const

  it('texto plano pasa sin acciones', () => {
    const r = parseAgentReply('Hola, valen 30 USD', [...allowed])
    expect(r).toEqual({ text: 'Hola, valen 30 USD', actions: [] })
  })

  it('extrae reply + actions de la envolvente JSON', () => {
    const raw = '{"reply": "Listo, te agrego", "actions": [{"type": "add_tag", "value": "VIP"}]}'
    const r = parseAgentReply(raw, [...allowed])
    expect(r.text).toBe('Listo, te agrego')
    expect(r.actions).toEqual([{ type: 'add_tag', value: 'VIP' }])
  })

  it('ignora acciones no permitidas por el modelo', () => {
    const r = parseAgentActions(
      [
        { type: 'add_tag', value: 'VIP' },
        { type: 'update_contact', value: { email: 'x@y.z' } },
        { type: 'no_existo', value: 1 },
      ],
      [...allowed]
    )
    expect(r).toEqual([{ type: 'add_tag', value: 'VIP' }])
  })

  it('JSON roto no pierde el mensaje', () => {
    const r = parseAgentReply('{"reply": "Hola", "actions": [', [...allowed])
    expect(r.actions).toHaveLength(0)
    expect(r.text).toContain('"reply"')
  })
})

describe('prompt A4 (avanzada)', () => {
  it('suma salida, calidad y toques con advanced', () => {
    const p = buildAgentSystemPrompt(
      { objective: 'vender', behavior: null, tone: null, prohibited_rules: null },
      {
        exit_message: 'Gracias por tu compra',
        response_quality: 'concise',
        max_reply_buttons: 3,
        max_reminders: 2,
        follow_up_delay_minutes: 30,
      }
    )
    expect(p).toContain('Objetivo:\nvender')
    expect(p).toContain('MUY conciso')
    expect(p).toContain('Gracias por tu compra')
    expect(p).toContain('hasta 3 opciones')
    expect(p).toContain('hasta 2 recordatorios')
  })

  it('toca solo tope de botones (sin recordatorios)', () => {
    const p = buildAgentSystemPrompt(
      { objective: null, behavior: null, tone: null, prohibited_rules: null },
      { exit_message: null, response_quality: 'balanced', max_reply_buttons: 1, max_reminders: 0, follow_up_delay_minutes: 30 }
    )
    expect(p).toContain('opción de respuesta')
    expect(p).not.toContain('recordatorio')
  })
})
