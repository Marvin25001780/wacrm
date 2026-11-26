# Integraciones externas: OpenReplay, Listmonk y VoiceSummary

> Tres servicios autoalojados que el CRM consume **por API o con su SDK
> oficial**. No se copia su código dentro del repositorio; cada negocio
> decide si los activa y con qué URL. Migración: **132**.

## 1. Resumen

| Servicio | Licencia | Qué aporta | Cómo se integra |
| --- | --- | --- | --- |
| [OpenReplay](https://github.com/openreplay/openreplay) | AGPL-3.0 (tracker MIT) | Grabación y reproducción de sesiones del CRM | `@openreplay/tracker` en el navegador, solo si el negocio lo activa |
| [Listmonk](https://github.com/knadh/listmonk) | AGPL-3.0 | Listas y boletines de correo | API HTTP con Basic Auth (`usuario:token`) |
| [VoiceSummary](https://github.com/DrDroidLab/voicesummary) | MIT | Analítica de transcripciones de llamadas con IA | `POST /api/calls/` con transcripción + URL del audio |

Todo es opcional. Sin fila en `external_integrations` o con
`*_enabled = false`, el CRM no hace ninguna llamada externa.

## 2. Dónde se configura

**Ajustes → Integraciones → Servicios autoalojados**. Solo admin/owner.
Cada tarjeta guarda su propia sección (`/api/integrations/external`) y
tiene su botón **Probar conexión**.

Los tokens son **write-only**:

- el formulario los envía una sola vez;
- el servidor los cifra con AES-256-GCM (mismo módulo que WhatsApp/IA);
- la API solo devuelve `has_token`, nunca el valor.

## 3. OpenReplay

### Qué hace

Graba la sesión del agente en el CRM (clics, navegación, consola y
errores) para reproducir incidencias. No graba audio de llamadas ni
contenido de conversaciones por sí solo: es la pantalla del CRM.

### Puesta en marcha

1. Despliega OpenReplay en un subdominio propio (Docker Compose del
   proyecto; requiere PostgreSQL, Redis, ClickHouse y el ingest).
2. En OpenReplay: **Preferences → Projects**, crea el proyecto y copia
   la **project key**.
3. En el CRM: activa la tarjeta, escribe la URL base
   (`https://openreplay.midominio.com`) y la project key. Guarda.
4. Recarga el CRM. El tracker apunta a:

   ```
   <URL base>/ingest
   ```

   (OpenReplay self-hosted publica el ingest en esa ruta).

### Notas técnicas

- El componente `src/components/integrations/openreplay-tracker.tsx`
  pide la configuración pública a
  `/api/integrations/external/openreplay` (valida sesión y cuenta; lee
  la fila con service role porque un agente no puede ver la tabla).
- El import del tracker es dinámico y hay un guard de módulo: React
  estricto no inicia dos sesiones.
- Si el CSP de `next.config.ts` deja de ser `Report-Only` y se aplica,
  hay que agregar el host de OpenReplay a `connect-src` (y a
  `script-src` si se sirve el tracker desde ese host).
- La project key viaja al navegador por diseño del tracker; no es un
  secreto de API.

## 4. Listmonk

### Qué hace

Sincroniza los contactos del CRM **que tengan email** con una lista de
Listmonk. Sirve para boletines, avisos y campañas de correo.

### Puesta en marcha

1. Despliega Listmonk y crea la lista de destino.
2. En Listmonk: **Admin → Users**, crea un usuario de API (rol API) y
   genera su token. Ese par va en Basic Auth.
3. En el CRM: activa la tarjeta, escribe URL, usuario, token y guarda.
4. Pulsa **Ver listas** y elige la lista de destino. Guarda otra vez.
5. Pulsa **Vista previa** para ver cuántos contactos se suscribirían.
   Nada se envía hasta pulsar **Confirmar**.

### Comportamiento

- Lote máximo: **200 contactos** por ejecución, 4 llamadas en paralelo.
  Si hay más, se procesa el lote más reciente y se avisa; se puede
  repetir.
- Deduplica por email antes de llamar a Listmonk.
- `POST /api/subscribers` crea el suscriptor con `status: enabled` y
  `preconfirm_subscriptions: true`. Si Listmonk responde **409**
  (email existente), se busca el id con
  `GET /api/subscribers?query=subscribers.email = '...'` y se agrega a
  la lista con `PUT /api/subscribers/lists`.
- El resultado muestra creados, agregados y fallidos (con el primer
  error). Es idempotente: repetir no duplica suscriptores.

### Rutas

| Ruta | Uso |
| --- | --- |
| `GET /api/integrations/external/listmonk/lists` | Listas disponibles |
| `POST /api/integrations/external/listmonk/subscribe` | Vista previa (`dryRun:true`) o suscripción real |

## 5. VoiceSummary

### Qué hace

Recibe la transcripción y el audio de una llamada y los analiza con IA
(resumen, resultado, calidad, extracción). El CRM no duplica esa
analítica: empuja la llamada y enlaza al servicio.

### Puesta en marcha

1. Despliega VoiceSummary con su configuración (base de datos, S3/MinIO
   para el audio y la API key del proveedor de IA que uses).
2. En el CRM: activa la tarjeta y escribe la URL base
   (`https://voicesummary.midominio.com`). Si tu despliegue exige token,
   escríbelo; se envía como `Authorization: Bearer <token>`.
3. Guarda y pulsa **Probar conexión**.
4. Haz una llamada de prueba con grabación y transcripción.

### Cuándo se envía

- **Automático**: al guardar una transcripción
  (`src/lib/telephony/transcribe-call.ts`) se intenta el push. Si falla,
  la transcripción igual queda guardada y se registra el aviso en el
  servidor.
- **Manual**: en **Telefonía → historial → diálogo de la llamada**,
  botón **Enviar a VoiceSummary**. Sirve para reintentar o para
  llamadas anteriores a la integración.

### Cuerpo enviado

```json
{
  "call_id": "<uuid de call_sessions>",
  "transcript": {
    "turns": [{ "role": "call", "content": "texto..." }],
    "text": "texto...",
    "truncated": true
  },
  "audio_file_url": "https://.../grabacion.ogg",
  "call_context": "Llamada saliente con Ana Pérez, atendida por Luis.",
  "timestamp": "2026-11-24T15:00:00.000Z"
}
```

Reglas:

- Sin grabación **no se envía**: la API de VoiceSummary exige
  `audio_file_url` y el CRM no inventa una.
- Sin transcripción tampoco.
- El texto se recorta a **40 000 caracteres** antes de mandarlo al LLM
  (`truncated: true`).
- Un **409** de VoiceSummary se interpreta como “ya estaba enviado” y se
  muestra como éxito idempotente.

## 6. Seguridad y multi-negocio

- `external_integrations` tiene una fila por `account_id` y RLS solo
  para admin/owner (`is_account_member(account_id, 'admin')`; el owner
  entra por ranking).
- Las rutas usan `requireRole('admin')` salvo el push de VoiceSummary
  (agente) y la config pública de OpenReplay (cualquier miembro), que
  validan la cuenta antes de leer con service role.
- Las URLs se normalizan y deben empezar por `http://` o `https://`.
  Se acepta HTTP porque estos servicios suelen correr en red interna;
  en producción usa HTTPS.
- El endpoint de prueba **no acepta URLs del cuerpo**: solo prueba lo
  que ya guardó un admin, para no convertir el CRM en un escáner de la
  red interna.

## 7. Verificación

1. Aplica `PROD_UPDATE_132.sql` en Supabase (producción).
2. Entra como admin → Ajustes → Integraciones. Las tres tarjetas deben
   aparecer sin el aviso de “falta la migración”.
3. OpenReplay: guarda, recarga y confirma en el dashboard de OpenReplay
   que aparece una sesión nueva.
4. Listmonk: guarda, **Ver listas**, elige una, **Vista previa** y
   confirma. Revisa en Listmonk que los suscriptores estén en la lista.
5. VoiceSummary: haz una llamada con grabación, transcribe y revisa que
   la llamada aparezca en VoiceSummary; prueba también el botón manual.
6. Si algo falla, el mensaje de la UI indica qué falta (URL, token,
   lista o servicio caído). No hay modo demo ni datos simulados.

## 8. Pendiente para probar en producción

- OpenReplay, Listmonk y VoiceSummary necesitan **despliegue propio** y
  credenciales/URLs reales del negocio.
- Sin servidor LiveKit + troncal SIP no se puede validar la llamada
  completa; el push de VoiceSummary sí se puede probar con una llamada
  manual que tenga grabación.
