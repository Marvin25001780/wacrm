# WhatsApp en la consola de cobranza (bloque 127)

## Qué resuelve

El gestor llamaba desde la consola, pero para escribir por WhatsApp tenía que
salir a otra pestaña (o al teléfono) y luego volver a registrar la gestión. Ese
viaje rompía el flujo y dejaba conversaciones sin trazabilidad.

Este bloque mete WhatsApp dentro de la ficha del deudor, reutilizando el mismo
camino de envío del inbox. **No hay una segunda implementación de Meta.**

## Piezas

### Migración `127_collection_whatsapp.sql`

| Objeto | Para qué |
|---|---|
| `collection_phone_digits(text)` | Normaliza a dígitos, igual que `normalizePhone()` del frontend. |
| `collection_whatsapp_target(deudor)` | Contacto vinculado, hilo de WhatsApp, teléfono local y E.164, línea configurada/conectada, último mensaje y no leídos. |
| `collection_whatsapp_thread(deudor, límite)` | Últimos mensajes en orden cronológico (tope 1–50). |
| `idx_messages_conversation_recent` | Leer el hilo sin ordenar toda la tabla. |

`collection_whatsapp_target` vincula el contacto por teléfono si el deudor aún
no lo tiene:

1. Compara `contacts.phone_normalized` exacto contra los dígitos del deudor.
2. Si no hay match, compara los **últimos 10 dígitos**, para tolerar el 0 de
   marcación nacional (`0414…` vs `58414…`).
3. Si encuentra contacto, guarda `collection_debtors.contact_id`.

No crea contactos ni conversaciones: eso ocurre al enviar el primer mensaje
(`resolveConversationByPhone`), para que abrir una ficha nunca deje filas
vacías.

El teléfono se devuelve en dos formas:

- `phone`: tal como está guardado.
- `phone_e164`: normalizado. Venezuela convierte `04141234567`, `4141234567`
  y `584141234567` en `+584141234567`. Otros países respetan el número tal cual,
  sin inventar prefijos.

### API

`GET /api/cobranza/whatsapp?debtor_id=…`

- `target`: fila del RPC 127.
- `messages`: últimos 30 mensajes del hilo.
- `templates`: plantillas con `status = 'APPROVED'` del negocio.
- `templatesError`: se informa si el catálogo no se pudo leer; no se finge una
  lista vacía.

`POST /api/cobranza/whatsapp`

```json
{
  "debtor_id": "uuid",
  "message_type": "text",
  "content_text": "Hola…"
}
```

```json
{
  "debtor_id": "uuid",
  "message_type": "template",
  "template_name": "recordatorio_pago",
  "template_params": ["Juan", "50,00", "25/11/2026"]
}
```

Reglas que aplica el servidor:

- Valida pertenencia por RPC (`SECURITY DEFINER`) y vuelve a comprobar
  `account_id`.
- Exige teléfono válido y línea configurada.
- **Texto libre solo dentro de la ventana de 24 h** del último mensaje del
  deudor. Fuera de ella responde `409` con `code: "window_closed"` y sugiere
  plantilla, en vez de dejar que Meta devuelva el error 131047.
- La plantilla se busca por `account_id`, nombre y `status = 'APPROVED'`; el
  idioma sale de la fila, no del navegador.
- Cuenta las variables `{{n}}` del cuerpo y exige un valor para cada una.
- Envía con `sendMessageToConversation`, el mismo núcleo del inbox: valida,
  habla con Meta, persiste en `messages` y pausa flujos activos.
- Si el deudor no tenía contacto, `resolveConversationByPhone` lo crea y el
  `contact_id` queda guardado en el deudor.

### UI (`src/components/collections/whatsapp-panel.tsx`)

Dentro de `/cobranza/consola`, debajo de las métricas del deudor:

- Hilo con burbujas (deudor a la izquierda, negocio a la derecha), hora y estado
  (`Enviado`, `Entregado`, `Leído`, `Falló`).
- Indicador de la ventana: “Quedan 5 h 12 min” o “Ventana cerrada”.
- Pestaña **Texto** (se bloquea fuera de ventana) y **Plantilla** (selector de
  aprobadas + campos para cada variable + vista previa).
- Avisos reales: línea no configurada, línea desconectada, catálogo ilegible.
- Al enviar, la consola pone el **canal de la gestión en `whatsapp`**; el agente
  elige la tipificación y guarda. No se inventa una gestión automática: el
  mensaje queda en `messages` y la conclusión humana en `collection_actions`.

## Límites de la v1

- Solo texto y plantillas; sin imágenes, audio ni documentos desde la consola.
- Las plantillas con encabezado de texto variable o botones URL con variable
  no se listan: requieren un formulario adicional. Las de encabezado fijo,
  imagen o video sí se pueden enviar.
- No hay bandeja unificada de cobranza: el hilo vive en la ficha del deudor.
  La bandeja general (`/inbox`) sigue siendo el lugar para conversaciones que
  no son de cobranza.
- El estado de la línea se muestra, pero no bloquea el envío si figura
  desconectada: se avisa y Meta decide.

## Prueba real

1. Aplicar `PROD_UPDATE_127.sql` y verificar:

```sql
begin;
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', (select user_id from profiles
             where account_role in ('owner','admin') order by created_at limit 1),
    'role', 'authenticated'
  )::text,
  true
);
with d as (select id from collection_debtors order by created_at desc limit 1)
select * from d cross join lateral collection_whatsapp_target(d.id) t;
rollback;
```

2. En `/cobranza/consola`, elegir un deudor con teléfono.
3. **Sin conversación previa**: la pestaña Texto debe estar bloqueada y el envío
   debe salir por Plantilla.
4. Enviar una plantilla aprobada; el hilo debe mostrar el mensaje con estado
   `Enviado`/`Entregado` y el canal de la gestión debe quedar en `whatsapp`.
5. Pedirle al deudor que responda; al recargar, la ventana debe abrirse y el
   texto libre habilitarse.
6. Intentar texto libre con otro deudor que nunca escribió: el servidor debe
   responder `409 window_closed` y la UI mostrarlo.
7. Guardar la gestión: debe quedar en `collection_actions` con
   `channel = 'whatsapp'` y la tipificación elegida.

## Rollback

```sql
DROP INDEX IF EXISTS public.idx_messages_conversation_recent;
DROP FUNCTION IF EXISTS public.collection_whatsapp_thread(UUID, INT);
DROP FUNCTION IF EXISTS public.collection_whatsapp_target(UUID);
DROP FUNCTION IF EXISTS public.collection_phone_digits(TEXT);
NOTIFY pgrst, 'reload schema';
```

El código tolera la ausencia de los RPC: la API responde `409` con
`migration: "127"` y el panel muestra el error en vez de romper la consola.
