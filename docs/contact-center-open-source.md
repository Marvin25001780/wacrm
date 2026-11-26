# Contact center open source: qué integramos y por qué

> Objetivo: **CRM + CCaaS + WEM + IA** en un solo producto, apoyado en
> repositorios open source en lugar de reinventar la media, la voz o el
> BI. Regla de oro: no copiamos código GPL/AGPL dentro de la app; los
> proyectos con esas licencias se usan como **servicio externo** y se
> integran por API.

## 1. Arquitectura elegida

```
                     ┌──────────────────────────────┐
   WhatsApp / Email  │  CRM + bandeja (Next.js)     │
   Instagram / FB    │  contactos, pipeline, POS    │
                     │  IA de texto,QA,reportes     │
                     └──────────────┬───────────────┘
                                    │ API + webhooks
                     ┌──────────────▼───────────────┐
   PSTN / SIP  ─────▶│  LiveKit (Apache-2.0)        │
                     │  SFU WebRTC + SIP + Egress   │
                     └──────────────┬───────────────┘
                                    │ Agentes de voz (fase IA)
                     ┌──────────────▼───────────────┐
                     │  LiveKit Agents / Pipecat    │
                     │  STT → LLM → TTS, handoff    │
                     └──────────────────────────────┘
```

- **CCaaS (voz)**: LiveKit server + SIP + Egress. Ya integrado.
- **CRM**: el CRM existente (contacts, inbox, pipeline, POS).
- **WEM**: se construye nativo sobre `call_sessions` (reportes,
  disposiciones, wrap-up, QA). No se vendoriza un WEM completo.
- **IA**: el proveedor del negocio (OpenAI, Anthropic, Gemini, DeepSeek,
  Groq) para texto; transcripción con OpenAI/Groq/Gemini; resumen por
  llamada; y en el futuro agentes de voz sobre LiveKit Agents.

## 2. Repositorios evaluados

| Proyecto | Licencia | Rol | Decisión |
| --- | --- | --- | --- |
| [livekit/livekit](https://github.com/livekit/livekit) | Apache-2.0 | Servidor WebRTC/SFU | **Integrado** como servicio (media + SIP). |
| [livekit/sip](https://github.com/livekit/sip) | Apache-2.0 | Puerta SIP ↔ WebRTC | **Integrado** vía troncal SIP del operador. |
| [livekit/egress](https://github.com/livekit/egress) | Apache-2.0 | Grabación de salas | **Integrado** (grabación de audio). |
| [livekit/agents](https://github.com/livekit/agents) | Apache-2.0 (modelos de turno con licencia aparte) | Agentes de voz IA | **Siguiente fase**: contestador/IVR con IA. Requiere servidor LiveKit. |
| [pipecat-ai/pipecat](https://github.com/pipecat-ai/pipecat) | BSD-2-Clause | Pipeline STT→LLM→TTS | **Alternativa** si se necesita un pipeline Python propio; no se integra ahora para no duplicar la capa de agentes. |
| [chatwoot/chatwoot](https://github.com/chatwoot/chatwoot) | MIT | Bandeja omnicanal | **Enlace externo**: el CRM ya tiene bandeja propia y no duplica conversaciones. Se conserva la URL del helpdesk en Ajustes → Integraciones. |
| [Metabase](https://github.com/metabase/metabase) | AGPL-3.0 | BI/dashboards | **No se integra embebido** (AGPL + peso). Reportes nativos en `/telefonia/reportes`. |
| [Apache Superset](https://github.com/apache/superset) | Apache-2.0 | BI | **Opcional a futuro** para analítica avanzada externa, no para el producto. |
| [Asterisk](https://github.com/asterisk/asterisk) | GPL-2.0 | PBX/SIP | **No se copia**. Si un operador lo exige, se usa como troncal externa. |
| [FreeSWITCH](https://github.com/signalwire/freeswitch) | MPL-2.0 | PBX/SIP | **No se copia**; misma razón que Asterisk. |
| [OMniLeads](https://github.com/omnicode/omnileads) | GPL-3.0 | Contact center completo | **No se vendoriza** (GPL + stack Python/Django separado). Se toman ideas de ACD y campañas. |
| [openreplay/openreplay](https://github.com/openreplay/openreplay) | AGPL-3.0 (tracker MIT) | Grabación de sesiones del CRM | **Integrado por SDK**: el tracker oficial se carga solo si el negocio lo activa. |
| [knadh/listmonk](https://github.com/knadh/listmonk) | AGPL-3.0 | Listas y boletines de correo | **Integrado por API** (Basic Auth): suscribe contactos con email. |
| [DrDroidLab/voicesummary](https://github.com/DrDroidLab/voicesummary) | MIT | Analítica de transcripciones | **Integrado por API**: push automático al transcribir y botón manual. |

## 3. Qué está integrado hoy

1. **Softphone WebRTC** con `livekit-client` y tokens de corta duración.
2. **Salientes por SIP** con `livekit-server-sdk` (`SipClient`).
3. **Entrantes** por número marcado o metadata de regla de despacho,
   con claim atómico entre agentes.
4. **Grabación** con Egress y **transcripción** con el proveedor de IA.
5. **Resumen IA** por llamada.
6. **Supervisión** en vivo y **reportes** de operación (día/hora/agente/
   disposición) en hora de Caracas.
7. **Cierre de llamada** con disposición y notas (wrap-up).
8. **QA de llamadas** (WEM): rúbrica de cinco criterios, puntaje 0–100,
   comentarios y reporte de calidad por agente.
9. **QA automática con IA**: segunda opinión sobre la transcripción,
   con la misma rúbrica y validación del JSON en el servidor.
10. **ACD v1**: espera máxima en cola por negocio, barrido perezoso,
    timeout de la entrante y liberación de sala.
11. **Campañas salientes**: lista por campaña, cola con reclamo
    atómico del siguiente contacto, reservas con vencimiento, intentos
    por contacto y cierre automático de la campaña (117 y 124).
12. **ACD v2**: habilidades por agente, requisito por cola y
    desbordamiento local por habilidad.
13. **WEM**: turnos semanales, bitácora de estados con motivo de pausa,
    adherencia al turno, ocupación y cumplimiento de pausas programadas.
14. **Devoluciones de llamadas perdidas**: cola compartida, reclamo
    atómico, altas manuales y vínculo con la saliente.
15. **Transferencias internas**: pasar la llamada a otro agente o
    devolverla a la cola, con timbre, tope de rebotes y retorno
    automático si nadie contesta. La sala de LiveKit no se cierra.
16. **Operación en vivo con SLA**: cola con espera real, agentes con
    tiempo en su estado, transferencias sin aceptar y alertas (fuera de
    SLA, por vencer, pausas y cierres largos). Sin migración: lee lo que
    ya existe.
17. **Reportes de devoluciones y SLA**: tiempo de respuesta y de
    resolución, tasa de recuperación, cumplimiento del objetivo de
    primera respuesta y desglose por agente. Tampoco necesita migración:
    agrega la 122 en el reporte que ya existía.
18. **Exportación a CSV**: llamadas, devoluciones, agentes y resumen del
    periodo en archivos para Excel (separador `;`, BOM UTF-8, hora de
    Venezuela). Sin migración: el servidor arma el archivo con un tope
    de 20 000 filas y avisa si se cortó.
19. **Integraciones externas por negocio** (migración 132): OpenReplay
    para grabar sesiones del CRM, Listmonk para suscribir contactos con
    email y VoiceSummary para analizar transcripciones. Tokens cifrados,
    todo opcional y con prueba de conexión. Ver
    `docs/integraciones-externas.md`.

Nada de eso copia código de terceros: se usan SDKs Apache-2.0 y APIs.

## 4. Siguientes fases (sin credenciales externas)

| Fase | Qué se construye | Depende de |
| --- | --- | --- |
| WEM 1 | **QA de llamadas**: rúbrica fija, puntaje por agente y reporte. | Nada (datos propios). ✅ Hecho (migración 114). |
| CCaaS 1 | **ACD**: prioridad, habilidades, tiempo de timbrado y overflow. | LiveKit + troncal para probar de verdad. ✅ Parcial: espera máxima, timeout, prioridad/FIFO (116 y 118) y habilidades con desbordamiento por habilidad (119) listos; faltan prioridad por despacho avanzada y overflow a número externo (requiere transferencia SIP). |
| CCaaS 2 | **Campañas salientes** (preview/progresivo) con lista y ritmo. | Troncal SIP. ✅ Casi hecho: cola con siguiente contacto, reservas, intentos por contacto y cierre automático (migración 124). Falta el fan-out automático y la voz real. |
| CCaaS 3 | **Devoluciones de llamadas perdidas**: cola compartida, reclamo atómico, altas manuales y vínculo con la saliente. | Nada (datos propios). ✅ Hecho (migración 122); reportes de respuesta, recuperación y SLA en el bloque 125. |
| CCaaS 4 | **Transferencias internas**: agente→agente, devolución a la cola, timbre y tope de rebotes. | LiveKit + troncal para probar la voz; la lógica y la UI ya existen. ✅ Hecho (migración 123). |
| CCaaS 5 | **Operación en vivo con SLA**: cola, espera máxima, agentes por estado, transferencias y alertas. | Nada (datos propios). ✅ Hecho (bloque 124, sin migración). |
| IA 1 | **Agente de voz** (IVR/contestador) con LiveKit Agents. | Servidor LiveKit + API keys de STT/LLM/TTS. |
| WEM 2 | **Adherencia**: horarios, pausas y cumplimiento. | Datos de presencia (ya existen). ✅ Hecho (migraciones 120 y 121): turnos, motivos de pausa, adherencia, ocupación y cumplimiento de pausas programadas. |
| IA 2 | **QA automática**: puntuar la transcripción con el LLM y comparar con el humano. | Transcripciones + proveedor de IA. ✅ Hecho (migración 115); comparativa humano vs IA en reportes. |

## 5. Reglas de integración

- **Licencias**: solo Apache-2.0, MIT y BSD dentro del árbol del CRM.
  GPL/AGPL se consumen como servicio o se descartan.
- **Sin secretos en la base**: las claves de LiveKit viven en variables
  de entorno del despliegue; por negocio solo se guarda configuración
  no secreta (`telephony_config`).
- **Sin datos inventados**: si falta una credencial o un servidor, la UI
  lo dice y bloquea la acción; no hay modo demo.
- **Una fuente de verdad**: `call_sessions` + `call_events`; las
  actividades de CRM se derivan de ahí para no duplicar métricas.
- **Multi-negocio**: todo se filtra por `account_id` y RLS; los números
  entrantes no se comparten entre negocios.
