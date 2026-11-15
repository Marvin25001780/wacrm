# Telefonía (contact center de voz) con LiveKit

> Módulo `/telefonia` + softphone flotante. La voz viaja por **LiveKit**
> (Apache-2.0) y la PSTN por la **troncal SIP** del operador. Este CRM
> guarda estado, historial, grabación y transcripción; no transporta audio.

## 1. Arquitectura

```
Navegador (agente)  ──WebRTC──▶  LiveKit (media)  ──SIP──▶  Troncal / PSTN
        │                              │
        │ API Next.js                  │ webhook firmado
        ▼                              ▼
   call_sessions / call_events   /api/telephony/webhook
        │                              │
        └──── activities (type='call') ┘  → /metrics/llamadas
```

- **Next.js** crea la sesión (`call_sessions`), emite un token de
  LiveKit de corta duración y ordena marcar por SIP.
- **LiveKit** hace de SFU/WebRTC y de pasarela SIP. No copiamos código
  GPL/AGPL: es un servicio externo con licencia Apache-2.0.
- Al contestar, el navegador avisa a `/answer`; al colgar (o si se cae
  la pestaña), el webhook `room_finished` cierra la sesión y escribe la
  **actividad de CRM** que alimenta Métricas → Llamadas.

### Tablas (migraciones 112 y 113)

| Tabla                          | Para qué                                                                                                        |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `telephony_config`             | Ajustes por negocio: activo, caller ID, troncal, números entrantes, grabación, transcripción. **Sin secretos.** |
| `call_sessions`                | Una fila por llamada: dirección, estado, tiempos, agente, contacto, grabación, transcripción, resumen IA y cierre (disposición/notas). |
| `call_events`                  | Bitácora append-only (creada, contestada, grabación lista, cerrada, disposición…).                              |
| `call_evaluations`             | QA de la llamada (migración 114): puntaje 0–100, rúbrica y comentarios del supervisor.                         |
| `call_ai_evaluations`          | QA automática con IA (migración 115): nota, rúbrica, proveedor/modelo y feedback.                               || `member_presence.agent_status` | Disponibilidad operativa: `available`, `busy`, `wrap_up`, `break`.                                              |

RLS: cualquier miembro lee; agente+ crea y cierra sus llamadas; admin+
puede cerrar cualquiera. El estado de agente se cambia solo por RPC
(`set_agent_status`), que deriva la cuenta de la sesión.

La **migración 113** añade el cierre de llamada: `disposition`, `notes` y
`wrap_up_completed_at` en `call_sessions`, con una lista fija de
resultados (`sale`, `quote`, `support`, `complaint`, `follow_up`,
`not_interested`, `wrong_number`, `other`) que vive en
`src/types/index.ts`. No es una tabla configurable por negocio.

La **migración 114** añade `call_evaluations`: una evaluación por
llamada con rúbrica fija de cinco criterios (saludo, identificación,
escucha, resolución y cierre), cada uno de 0 a 5. El puntaje 0–100 se
calcula en el servidor (`src/lib/telephony/qa.ts`) y solo admin+ puede
escribirlo.

La **migración 115** añade `call_ai_evaluations`: una segunda opinión
generada con el proveedor de IA del negocio sobre la transcripción. El
JSON del modelo se valida y se recalcula en el servidor
(`src/lib/telephony/ai-qa.ts`); no se guarda nada que el modelo no haya
devuelto por criterio.

## 2. Variables de entorno

Solo en el servidor. Si faltan, la UI muestra la lista y **no permite
marcar** (no hay modo demo).

```env
LIVEKIT_URL=wss://tu-proyecto.livekit.cloud
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...
# Troncal saliente por defecto (se puede sobrescribir por negocio)
LIVEKIT_SIP_TRUNK_ID=ST_...
# Grabación (Egress). Requiere almacenamiento configurado en LiveKit.
LIVEKIT_RECORDING_ENABLED=false
# Base pública para descargar/transcribir la grabación
TELEPHONY_RECORDINGS_PUBLIC_BASE_URL=https://.../storage/v1/object/public/recordings
```

`LIVEKIT_URL` acepta `https://` (se normaliza a `wss://`) o `wss://`.
El API secret nunca se envía al navegador ni se guarda en Supabase.

## 3. Puesta en marcha (una vez por despliegue)

### 3.1 Levantar LiveKit

- **LiveKit Cloud**: crea un proyecto y copia URL + API key/secret.
- **Self-hosted**: sigue `livekit-server` (Docker o binario). Para
  probar en local: `livekit-server --dev` (claves de desarrollo).

### 3.2 Crear la troncal SIP saliente

En el panel de LiveKit o por API (`SipClient.createSipOutboundTrunk`).
Necesitas los datos del operador: host SIP, usuario/contraseña o IP
autorizada, y el número saliente (DID). Copia el ID (`ST_…`) a
`LIVEKIT_SIP_TRUNK_ID` o al campo de Configuración → Telefonía.

### 3.3 Webhook

Configura el webhook de LiveKit en:

```
https://TU-DOMINIO/api/telephony/webhook
```

La ruta verifica la firma con `LIVEKIT_API_SECRET`. Sin webhook, una
pestaña cerrada no cierra la llamada (queda “activa” hasta que el
agente vuelva a entrar y el softphone la cierre como `agent_left`).

Eventos usados: `participant_joined`, `participant_left`,
`room_finished`, `egress_ended`. Las salas que no empiezan por
`crm-call-` se ignoran.

### 3.4 Llamadas entrantes

Dos formas de asignar la llamada a un negocio:

1. **Por número marcado** (recomendado): guarda el DID en
   Configuración → Telefonía → “Números entrantes”. El webhook busca
   ese número en `telephony_config.inbound_numbers` y etiqueta la
   sesión con el `account_id` del negocio.
2. **Por metadata de la regla de despacho**: crea una regla
   `individual` con `roomPrefix: "crm-call-"` y
   `metadata: {"account_id":"<uuid>"}`. El prefijo es obligatorio:
   el webhook ignora las salas que no empiezan por `crm-call-`.

Un número entrante pertenece a **un solo negocio** (la app rechaza
duplicados al guardar). Si no se resuelve el negocio, la llamada no se
registra y se deja un aviso en el log del servidor.

Cuando entra una llamada:

1. El webhook crea la sesión (`ringing`, sin agente).
2. El softphone de los agentes **disponibles** consulta el estado cada
   5 s y muestra el aviso de **Llamada entrante** con el
   número/contacto. En pausa, cierre u ocupado la cola no suena.
3. El primero que pulsa **Contestar** la reclama
   (`POST /calls/[id]/claim`, gana quien actualice primero) y entra a
   la sala; LiveKit contesta la troncal y la sesión pasa a `active`.
   Si el agente no está `available`, el claim responde 409.
4. **Rechazar** la cierra como `cancelled` sin asignarla. Si nadie
   contesta, queda como `missed` cuando el cliente cuelga.

## 4. Grabación y transcripción

### Grabación (opcional)

1. Configura un destino de Egress en LiveKit (S3, GCS, Azure o disco).
2. Define `LIVEKIT_RECORDING_ENABLED=true`.
3. En Configuración → Telefonía activa “Grabar llamadas”.

La grabación arranca al contestar (`/answer`) y se detiene al colgar.
Egress deja el archivo en el almacenamiento; con
`TELEPHONY_RECORDINGS_PUBLIC_BASE_URL` la app construye una URL
descargable. Sin esa base la grabación se guarda, pero no se puede
transcribir desde la UI.

### Transcripción

Usa el proveedor de **Ajustes → Asistente de IA** (OpenAI, Groq o
Gemini). Anthropic y DeepSeek no ofrecen endpoint de audio. El botón
“Transcribir” del historial descarga la grabación (máx. 24 MB) y la
manda al proveedor; el texto queda en `call_sessions.transcript`.

Con **Transcribir grabaciones** activo y
`TELEPHONY_RECORDINGS_PUBLIC_BASE_URL` definida, la transcripción es
automática: el webhook `egress_ended` la lanza en segundo plano
(después de responder a LiveKit) y el historial la muestra al
refrescarse. El botón manual queda como reintento si el proveedor
falló. Si el interruptor está apagado, no se transcribe nada solo.

### Resumen con IA

Con la llamada transcrita, **Ver → Resumir** pide al proveedor de IA
del negocio un resumen corto en cuatro líneas (resumen, motivo,
acuerdos y siguiente paso) y lo guarda en `call_sessions.ai_summary`.
El prompt prohíbe inventar datos: lo que no está en la transcripción
se marca como “No se indicó”. Es idempotente — una llamada se resume
una sola vez — y consume tokens del mismo proveedor que el asistente;
requiere el interruptor maestro de **Ajustes → Asistente de IA**.

## 5. Operación diaria

- El botón de teléfono del encabezado abre el softphone; también hay
  botón de llamada en la ficha del contacto y en la cabecera del hilo.
- Estados del agente: **Disponible**, **Ocupado**, **Cierre** y
  **Pausa**. Al marcar pasa a Ocupado; al colgar pasa a Cierre
  (wrap-up) y queda bloqueado para nuevas llamadas hasta que guarda la
  disposición u omite el cierre; entonces vuelve a Disponible.
- **Cierre (wrap-up)**: al colgar el softphone pide una disposición
  (venta, cotización, soporte, reclamo, seguimiento, no interesado,
  número equivocado u otro) y notas opcionales. Se guarda con
  `PATCH /api/telephony/calls/[id]`; `wrap_up_completed_at` es lo que
  permite medir el tiempo de cierre. Omitir vuelve a Disponible sin
  clasificar la llamada.
- Solo los agentes `available` reciben y pueden reclamar entrantes; el
  resto sigue viendo el historial y puede marcar salientes.
- Cada llamada cerrada crea una actividad `type='call'` con dirección,
  resultado y duración. Por eso `/metrics/llamadas` sigue funcionando
  sin cambios.
- El botón **Detalle** del historial abre la llamada con reproductor
  de la grabación, resumen IA, transcripción y bitácora de eventos
  (`call_events`) en orden cronológico.
- Las llamadas entrantes sin agente no crean actividad (no hay a quién
  asignarlas); sí quedan en `call_sessions` como `missed`.
- **Supervisión** (admin+): el panel de `/telefonia` muestra cada
  agente con su presencia (heartbeat), su estado operativo, la llamada
  que tiene en curso con cronómetro y la cola de entrantes sin
  reclamar con su tiempo de espera. Se refresca cada 5 s; es solo
  lectura.
- **Reportes** (admin+): `/telefonia/reportes` con ventana de 7, 30 o
  90 días. Muestra volumen, contestadas, perdidas/nivel de servicio,
  abandono, espera media, duración media, tiempo de cierre,
  grabaciones/transcripciones, barras por día y por hora (hora de
  Caracas), tabla por agente y resultados por disposición. La API
  (`GET /api/telephony/reports?days=N`) devuelve como máximo 5 000
  llamadas y avisa cuando la ventana se truncó.
- **Calidad (QA)** (admin+): en el detalle de una llamada contestada y
  cerrada, el supervisor puntúa cinco criterios de 0 a 5 y deja
  comentarios. El puntaje 0–100 aparece en el detalle, en la bitácora
  (`evaluated`) y en la columna QA de los reportes, junto con la
  cobertura (evaluadas / contestadas).
- **QA automática con IA** (admin+): con la llamada transcrita, el
  botón **Evaluar con IA** pide al proveedor del negocio una nota por
  criterio y un feedback corto. Se guarda aparte de la nota humana, se
  puede regenerar y deja un evento `ai_evaluated`. Sirve para priorizar
  qué llamadas revisar, no para sustituir al supervisor.

### Permisos

| Rol           | Puede                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------- |
| Viewer        | Ver historial y configuración (solo lectura).                                                  |
| Agent         | Marcar, contestar/cerrar sus llamadas, transcribir, resumir y cambiar su estado.                |
| Admin / Owner | Todo lo anterior + cerrar llamadas ajenas + supervisión + reportes + evaluar calidad + configuración. |

## 6. Límites y aspectos legales (Venezuela)

- **Consentimiento de grabación**: avisa al cliente (“esta llamada
  puede ser grabada”) y revisa con un abogado local la base legal y el
  tiempo de conservación. La app no reproduce el aviso por ti.
- **Numeración y portabilidad**: la habilitación de DID, numeración
  local y portabilidad depende de tu operador; no es algo que la app
  pueda resolver.
- **STIR/SHAKEN** no aplica a la PSTN venezolana; el “Caller ID” puede
  mostrarse distinto según el operador.
- **Conectividad variable**: si el agente pierde internet, la llamada
  SIP puede seguir viva del lado de la troncal. Define con tu operador
  el fallback (callback/PSTN) y revisa el costo por minuto.
- **Datos personales**: la grabación y la transcripción son datos del
  cliente. Aplica la misma política de retención que el resto del CRM.
- **WhatsApp sigue mandando** en Venezuela: la voz es un canal
  complementario, no el principal.

## 7. Diagnóstico

| Síntoma                                          | Causa probable                                                                         |
| ------------------------------------------------ | -------------------------------------------------------------------------------------- |
| “El servidor no tiene LiveKit configurado”       | Faltan `LIVEKIT_URL`, `LIVEKIT_API_KEY` o `LIVEKIT_API_SECRET`.                        |
| “Falta la troncal SIP saliente”                  | No hay `LIVEKIT_SIP_TRUNK_ID` ni troncal por negocio.                                  |
| “Falta aplicar la migración 112”                 | Ejecuta `PROD_UPDATE_112.sql` en Supabase.                                             |
| Marca pero no suena                              | Troncal mal configurada, número no permitido o firewall SIP. Revisa el log de LiveKit. |
| La llamada queda “activa” tras cerrar la pestaña | Webhook no configurado o apuntando a otro dominio.                                     |
| “No se pudo descargar la grabación”              | Egress sin almacenamiento o `TELEPHONY_RECORDINGS_PUBLIC_BASE_URL` incorrecta.         |
| “El negocio no tiene proveedor de transcripción” | Configura OpenAI/Groq/Gemini en Ajustes → Asistente de IA.                             |
| “El asistente de IA no está configurado”         | El interruptor maestro del Asistente de IA está apagado o no hay API key guardada.     |
| “Ponte Disponible para contestar llamadas”       | El agente está en pausa/cierre/ocupado; cambia de estado en el softphone.              |
| “Solo se evalúan llamadas contestadas y cerradas” | La llamada sigue sonando/activa o nunca se contestó.                                  |

## 8. API

| Método    | Ruta                                   | Uso                                  |
| --------- | -------------------------------------- | ------------------------------------ |
| GET       | `/api/telephony/status`                | Estado del softphone (sin secretos). |
| GET/POST  | `/api/telephony/calls`                 | Historial / iniciar saliente.        |
| GET       | `/api/telephony/calls/[id]`            | Detalle + bitácora de eventos.       |
| PATCH     | `/api/telephony/calls/[id]`            | Disposición y notas del cierre.      |
| POST      | `/api/telephony/calls/[id]/answer`     | Contestada (arranca grabación).      |
| POST      | `/api/telephony/calls/[id]/claim`      | Reclamar una entrante que suena.     |
| POST      | `/api/telephony/calls/[id]/end`        | Colgar / rechazar (crea actividad).  |
| POST      | `/api/telephony/calls/[id]/transcribe` | Transcribir grabación.               |
| POST      | `/api/telephony/calls/[id]/summary`    | Resumen IA de una llamada transcrita. |
| GET       | `/api/telephony/agents`                | Supervisión del equipo (admin+).     |
| GET       | `/api/telephony/reports`               | Reportes de operación (admin+).      |
| GET/POST  | `/api/telephony/evaluations`           | QA de llamadas (POST admin+).        |
| GET/POST  | `/api/telephony/calls/[id]/ai-evaluate` | QA automática con IA (POST admin+). |
| GET/PATCH | `/api/telephony/config`                | Configuración por negocio (admin+).  |
| POST      | `/api/telephony/presence`              | Estado del agente.                   |
| POST      | `/api/telephony/webhook`               | Eventos de LiveKit (firma).          |
