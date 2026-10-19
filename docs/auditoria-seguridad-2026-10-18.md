# Auditoría de seguridad y funcionamiento — 2026-10-18

**Modo:** solo lectura en la revisión original. **Estado (2026-10-18):** S1, S2, S3, S13 y S17 remediados en la rama local `fix/auditoria-tanda-1` (**sin fusionar ni desplegar**) y **validados en dev**; S17 y S18 se descubrieron durante la validación de la tanda 1. S18 queda como decisión de producto. El resto sigue pendiente.
**Método:** revisión del esquema/migraciones, rutas de `/api`, middleware, políticas RLS, almacenamiento, dependencias (`npm audit`) e historial de git.
**Alcance:** todo el CRM. No es una auditoría exhaustiva línea a línea; es una revisión dirigida a los puntos donde este tipo de app suele fallar (multi-tenant, webhooks, secretos, almacenamiento, abuso de recursos).

---

## 0. Resumen ejecutivo

| ID | Severidad | Hallazgo | Esfuerzo de arreglo |
|---|---|---|---|
| S1 | 🔴 **Crítico** | Next.js 16.2.6 con CVEs críticos (hay fix en 16.4.2) | Bajo (1-2 h) |
| S2 | 🔴 **Crítico** | `chat-media` es un bucket **público**: fotos/documentos/audios de clientes sin autenticación | Medio |
| S3 | 🟠 **Alto** | `profiles_update` permite autoascenso de rol y cambio de espacio — ✅ **remediado** (066) | Bajo |
| S4 | 🟠 **Alto (a verificar)** | `Cache-Control` público en páginas autenticadas (posible caché compartida en CDN) | Bajo (verificar) |
| S5 | 🟡 Medio | SSRF en "Probar conexión" de canales (URL del admin sin allowlist) | Bajo |
| S6 | 🟡 Medio | Automatizaciones filtradas por `user_id` (no por cuenta) → invisibles para compañeros | Bajo |
| S7 | 🟡 Medio | Deduplicación de Evolution sin `account_id` → puede descartar mensajes de otro tenant | Bajo |
| S8 | 🟡 Medio | Rate limiting en memoria → inútil en Vercel multi-instancia | Medio |
| S9 | 🟡 Medio | Invitación: enumeración de correos, carrera con el mismo token, contraseña mínimo 6 | Bajo |
| S10 | 🟡 Medio | Sin timeout en llamadas a Meta / Evolution | Bajo |
| S11 | 🟢 Bajo | Ventana de 24 h solo validada en la UI, no en el servidor | Bajo |
| S12 | 🟢 Bajo | `ENCRYPTION_KEY` sin validar al arranque | Bajo |
| S13 | 🟢 Bajo | `shadcn` (CLI) como dependencia de producción | Muy bajo |
| S14 | 🟢 Bajo | CSP en modo `Report-Only` (no bloquea) | Bajo |
| S15 | 🟢 Bajo | `whatsapp_config.user_id` con `ON DELETE CASCADE` | Bajo |
| S16 | 🟢 Bajo | Plantillas únicas por `user_id` en vez de por cuenta/WABA | Bajo |
| S17 | 🟡 Medio | Borrar una cuenta falla si tiene filas auditadas (el trigger de auditoría rompe el `ON DELETE CASCADE`) — ✅ **remediado** (066) | Bajo |
| S18 | 🟢 Bajo | `accounts.owner_user_id` es `ON DELETE RESTRICT` → borrar al propietario devuelve un 500 opaco | Bajo |

S1, S2 y S3 son los que yo arreglaría **antes** de abrir el CRM a clientes externos.

**Remediado en esta tanda:** S1 (Next 16.4.2; `npm audit --omit=dev` → 0 vulnerabilidades), S2 (bucket privado + URLs firmadas; **migración 065 aplicada y validada en dev**) y S13 (`shadcn` a `devDependencies`). La validación en dev además destapó S17 y S18 (borrado de cuentas/usuarios).

**Remediado en la fase 1 de multipertenencia (migración 066, aplicada y validada en dev):** S3 (trigger `protect_profile_tenancy`) y S17 (`audit_row()` ya no falla al borrar en cascada).

---

## 1. Hallazgos detallados

### S1 — Next.js 16.2.6 con vulnerabilidades críticas

**Evidencia:** `npm audit --omit=dev` → `next` **critical** (fix disponible: `16.4.2`, sin cambio de major). Afecta también a `postcss` y `sharp`, que se resuelven con el mismo upgrade.

Los CVEs incluyen bypass de middleware/proxy, SSRF en Server Actions y en rewrites, ejecución remota de código en servidores Windows, DoS en la API de optimización de imágenes y cache poisoning.

**Impacto práctico:** el CRM está publicado (Vercel). Aunque varios CVEs son de self-hosting, el bypass de middleware y el SSRF sí aplican a un despliegue estándar. La capa de datos sigue protegida por RLS (un visitante sin sesión no obtiene filas), así que el riesgo real es de **defensa en profundidad**: no conviene que la única barrera de las páginas sea el middleware ni exponer endpoints que asumen "nadie llega aquí sin pasar por el middleware".

**Recomendación:** subir a `next@16.4.2` + `eslint-config-next` a la misma versión, construir y probar login/inbox/webhooks. Después, `npm audit --omit=dev` debe quedar limpio de `next`, `postcss` y `sharp`.

**Estado:** ✅ **remediado.** `next` y `eslint-config-next` en `16.4.2`; `npm audit --omit=dev` → **0 vulnerabilidades**; `typecheck`, 647 pruebas y `next build` en verde. La actualización de `eslint-config-next` activa reglas nuevas del React Compiler que destapan errores preexistentes (77 fuera de `chatwoot/`); no bloquean el build y quedan como deuda aparte.

---

### S2 — El bucket `chat-media` es público

**Evidencia:**
- `supabase/migrations/023_chat_media.sql:38-43` → `'chat-media', public = TRUE`.
- `supabase/migrations/063_whatsapp_media_mirror.sql:23-26` → lo vuelve a declarar `TRUE`.
- `src/lib/storage/upload-media.ts:120` y `src/lib/whatsapp/mirror-inbound-media.ts:231` usan `getPublicUrl(...)`.

**Impacto práctico:** todo lo que un cliente manda por WhatsApp (fotos, contratos, cédulas, audios) se copia a un bucket **sin autorización**. Cualquiera con la URL lo abre, sin cuenta ni sesión. Esas URLs viajan en el HTML, en el historial del navegador, en logs y en cualquier reenvío. En un CRM de atención al cliente esto es una fuga de datos personales.

Comparación: el bucket `attachments` ya hace lo correcto (`035_attachments.sql:28` → privado + `createSignedUrl`). El patrón existe; solo no se aplicó a `chat-media`.

**Recomendación:** pasar `chat-media` a privado, servir con `createSignedUrl` (p. ej. 60 s, como ya hacen `attachments` y `timeline`) y decidir qué hacer con las URLs ya guardadas en `messages.media_url`. `profile-avatars`, `contact-avatars` y `flow-media` pueden seguir públicos: no contienen conversaciones.

**Estado:** ✅ **remediado y validado en dev.**

- `supabase/migrations/065_chat_media_private.sql`: `public = false` + política SELECT limitada a la carpeta `account-<id>` del usuario.
- `src/lib/storage/chat-media.ts`: extrae la ruta de la URL guardada y firma (1 h) con el cliente que corresponda.
- `src/lib/storage/use-chat-media-url.ts`: hook del inbox; firma en lote (`createSignedUrls`) y cachea ~55 min. Lo usan `message-bubble` y la vista previa del compositor.
- `send-message.ts`: firma la URL **solo para el envío** (Meta/Evolution no envían cookies); la fila guarda la URL lógica, así que no hay backfill.
- API pública (`GET /api/v1/conversations/{id}/messages`): devuelve URLs firmadas de 24 h en lote.
- Imágenes de muestra de plantillas: pasan a `flow-media` (público), porque Meta las descarga durante la revisión.
- **Orden de despliegue:** primero el código (funciona también con el bucket aún público), después la migración. Al revés, los adjuntos dan 400 hasta que la app nueva esté arriba.
- **Validación en dev (migración 065 ya aplicada):**

| Prueba | Resultado |
|---|---|
| `storage.buckets.public` para `chat-media` | `false` ✅ |
| URL pública sin sesión | **400** bloqueada ✅ |
| Firmar como anónimo | **400** denegada ✅ |
| Firmar como usuario de la cuenta (RLS) | **200** permitida ✅ |
| Abrir la URL firmada sin sesión | **200** ✅ |
| Inbox: adjunto entrante y saliente se ven | ✅ (captura revisada) |
| Panel Red del inbox | `POST /storage/v1/object/sign/chat-media` + `GET` del objeto firmado ✅ |
| API pública `GET /api/v1/conversations/{id}/messages` | `media_url` **firmada**, y la URL entregada abre con 200 ✅ |

  El usuario, la conversación y el objeto de prueba se crearon solo para esto y se borraron al terminar (verificado: 0 filas y 0 usuarios restantes).

---

### Fase 1 — multipertenencia (migración 066)

`supabase/migrations/066_account_members.sql`: `account_members(user_id, account_id, role)` pasa a ser la fuente de verdad de la pertenencia; `profiles.account_id` / `profiles.account_role` quedan como **cuenta activa**; `is_account_member` mantiene firma y semántica leyendo la tabla nueva (ninguna política de dominio cambia). Añade `switch_active_account` y `create_workspace` (solo admin+), cierra S3 con `protect_profile_tenancy` y arregla S17 en `audit_row()`. Diseño completo en `docs/diseno-multiespacio-y-varios-numeros.md`.

| Prueba | Resultado |
|---|---|
| Aplicada en dev (SQL Editor) | `Success. No rows returned` ✅ |
| Arnés PGlite (Postgres real, migraciones 001/017/018/019/041 + 066) | **60/60 PASS**, idempotencia OK, rollback **7/7 PASS** ✅ |
| Service role en dev: tabla, backfill, 1 owner por cuenta, 7 funciones nuevas, trigger | **13/13 PASS** ✅ |
| 2 sesiones reales: canje de invitación → **2 membresías** (no se muda de cuenta), la cuenta propia sigue existiendo | ✅ |
| RLS con sesión real: se ve lo de la cuenta **activa**, no lo de la otra | ✅ |
| `switch_active_account` cambia lo visible; una cuenta ajena → `42501` | ✅ |
| S3 desde el navegador (sesión de `agent`): autoascenso a `owner` y cambio de `account_id` | **403 / `42501`** ✅ |
| `create_workspace` con rol `agent` | **42501** ✅ |
| UI: al cambiar de espacio, la barra lateral y la lista de contactos cambian | ✅ (captura revisada) |
| S17: borrar una cuenta con contactos auditados | **200** (antes 409 / `23503`) ✅ |

  Los 2 usuarios, sus cuentas, contactos, invitación y registros de auditoría de la prueba se borraron al terminar (verificado: 0 filas).

---

### S3 — `profiles_update` permite autoascenso

**Evidencia:** `supabase/migrations/017_account_sharing.sql:614-616`:

```sql
CREATE POLICY profiles_update ON profiles FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

No restringe columnas. Un usuario autenticado puede hacer `PATCH /profiles` (cliente de navegador) y cambiar su `account_role` a `owner` o su `account_id` a otra cuenta.

**Impacto práctico:** hoy, un `agent` puede convertirse en `owner`. Con el diseño de multipertenencia (que usa `account_id` como conmutador de espacio) sería además un salto entre negocios.

**Recomendación:** el trigger + `set_config('app.tenancy_write')` que ya está en `docs/diseno-multiespacio-y-varios-numeros.md` §2.4. Alternativa: `REVOKE UPDATE` + `GRANT UPDATE (columnas de autoedición)`. Conviene hacerlo **antes** de la fase de multipertenencia.

**Estado:** ✅ **remediado y validado en dev** (migración 066, `protect_profile_tenancy`).

- Cualquier `UPDATE` a `profiles.account_id` o `profiles.account_role` aborta con `42501` salvo que la transacción active `set_config('app.tenancy_write','on',true)`. Las RPC de pertenencia (`set_member_role`, `remove_account_member`, `transfer_account_ownership`, `redeem_invitation`, `switch_active_account`, `create_workspace`) lo activan dentro de su propia transacción.
- Se comprobó desde el **cliente de navegador** (sesión real de un `agent`): `PATCH /profiles` con `account_role: 'owner'` → **403 / `42501`**; con `account_id` de otra cuenta → **403**.
- Efecto secundario a tener en cuenta: el trigger también bloquea el cambio a mano **desde el SQL Editor**; para una corrección manual hay que ejecutar `select set_config('app.tenancy_write','on',true);` en la misma transacción.

---

### S4 — CSP y caché: dos ajustes de cabeceras (uno a verificar)

**4a. `Cache-Control` público en rutas autenticadas — a verificar.**
`next.config.ts:111-119` aplica a todo lo que no sea `_next/static`, `_next/image` o `api`:

```
Cache-Control: public, max-age=0, s-maxage=300, stale-while-revalidate=86400
```

El comentario asume que Next.js/auth sobrescriben con `private`/`no-store` en las páginas por usuario. **Hay que confirmarlo en el CDN**, porque si no se sobrescribe, `/inbox` podría servirse desde caché a otro usuario.

**Cómo verificarlo (30 s, sin riesgo):** con sesión iniciada, abrir DevTools → Network → recargar `/inbox` → mirar la respuesta del documento:
- `cache-control` debe contener `private` o `no-store`, y
- `x-vercel-cache` debería ser `MISS`/`BYPASS` (no `HIT`).

Si sale `public` + `HIT`, es grave: cambiar la regla a excluir las rutas del dashboard o dejar que Next emita la cabecera.

**4b. CSP en `Report-Only`** (`next.config.ts:36`): no protege, solo avisa. Es una decisión consciente y documentada; se puede endurecer cuando la consola esté limpia.

---

### S5 — SSRF en "Probar conexión"

**Evidencia:** `src/app/api/channels/[channel]/test/route.ts:63-88` hace `fetch(config.base_url)` con la URL que escribe el admin, sin validar el destino. Lo mismo aplica a cualquier llamada a Evolution/Chatwoot con `base_url`.

**Impacto práctico:** en modo SaaS, un admin de un cliente puede apuntar `base_url` a `http://169.254.169.254/...` o a un servicio interno y usar el servidor como proxy (SSRF ciego: solo devuelve `ok`/`status`, pero permite escanear la red interna y, en algunos clouds, leer metadata).

El repo **ya tiene** la defensa: `src/lib/webhooks/ssrf.ts` (`isDeliverableUrl`, con tests para `127.0.0.1`, `169.254.169.254`, `::1`, solo `https`).

**Recomendación:** reutilizar `isDeliverableUrl` en el alta de `base_url` y en cada petición (resolver DNS y bloquear rangos privados, no solo la cadena).

---

### S6 — Automatizaciones por usuario, no por cuenta

**Evidencia:**
- `src/app/api/automations/[id]/route.ts:35` y `:135` → `.eq('user_id', user.id)`
- `src/app/api/automations/[id]/duplicate/route.ts:21`

**Impacto práctico:** si dos personas comparten espacio, la segunda **no ve ni edita** las automatizaciones de la primera (404). No es un agujero de seguridad (el `user_id` es más restrictivo), pero rompe la promesa de "cuenta compartida" y confunde. La tabla ya tiene `account_id` desde 017; el resto de rutas ya migró.

**Recomendación:** filtrar por `account_id` (y dejar que RLS aplique el rol). Revisar también `automations/route.ts` (lista) para que no filtre por autor.

---

### S7 — Deduplicación de Evolution sin tenant

**Evidencia:** `src/app/api/webhooks/evolution/[id]/route.ts:170-178`:

```ts
const { data: dup } = await admin
  .from('messages').select('id').eq('message_id', waMessageId).maybeSingle()
if (dup) return NextResponse.json({ duplicate: true })
```

No filtra por cuenta ni conversación. Los IDs de Baileys/Evolution **no son globales**, así que dos instancias pueden repetir un ID.

**Impacto práctico:** un mensaje legítimo se descarta como "duplicado" porque otro tenant tiene ese mismo ID. Además `maybeSingle()` devuelve error si hay más de una fila, y el código lo ignora (sigue adelante).

**Recomendación:** filtrar por la conversación (`conversation_id`) o confiar en el índice único `(conversation_id, message_id)` de `061_whatsapp_reliability.sql:27` y tratar el `23505` como duplicado (patrón que ya usa el webhook de Cloud API).

---

### S8 — Rate limiting en memoria

**Evidencia:** `src/lib/rate-limit.ts:1-21` (lo dice el propio archivo): `Map` por proceso; en Vercel cada instancia/región tiene su contador.

**Impacto práctico:** los límites de envío, difusión, API pública, webchat y login son **evadibles** abriendo concurrencia (cada petición puede caer en una instancia distinta). El límite sigue sirviendo como freno básico, no como control real.

**Recomendación:** mover a Upstash Redis / Vercel KV manteniendo la misma firma (`checkRateLimit`, `rateLimitResponse`). No requiere tocar los 30+ call sites.

---

### S9 — Invitaciones: enumeración, carrera y contraseña débil

**Evidencia:** `src/app/api/account/invitations/signup/route.ts`
- `:72-77` → mínimo 6 caracteres.
- `:122-131` → 409 "Este correo ya está registrado" → **enumera correos**.
- `:82-107` → comprueba `accepted_at` y luego, más abajo, crea el usuario: dos peticiones simultáneas con el mismo token pueden pasar ambas (no hay `UPDATE ... WHERE accepted_at IS NULL` atómico).

**Impacto práctico:** un atacante puede descubrir qué correos tienen cuenta; dos pestañas pueden crear dos usuarios con una sola invitación; y 6 caracteres es flojo para un CRM con datos de clientes.

**Recomendación:** respuesta genérica ("Si el correo es válido, te enviamos un enlace"), marcar la invitación como aceptada con un `UPDATE` condicional antes de crear el usuario, mínimo 10 caracteres y rate limit por IP.

---

### S10 — Sin timeouts en llamadas a Meta / Evolution

**Evidencia:** no hay `AbortSignal` en `src/lib/whatsapp/*` (todas las llamadas a Graph API) ni en `src/lib/channels/evolution.ts:45`.

**Impacto práctico:** si Meta o la instancia de Evolution no responden, la función serverless se queda colgada hasta el límite de la plataforma. En el webhook, eso retrasa el `after()` y puede provocar reintentos de Meta. En el envío, el usuario ve un spinner largo.

**Recomendación:** `AbortSignal.timeout(10_000)` en un wrapper común (el test de canales ya usa 8 s), y mapear el timeout a un error claro.

---

### S11 — Ventana de 24 h solo en la UI

**Evidencia:** `src/components/inbox/message-composer.tsx:167` y `:444` bloquean el texto libre fuera de la ventana; `src/lib/whatsapp/send-message.ts` no valida nada.

**Impacto práctico:** Meta rechaza el envío igualmente (error 131047), pero el error que ve el usuario es genérico. Un cliente de la API pública (`/api/v1/messages`) recibe un error menos claro que el que podría darse.

**Recomendación:** validar en el core y devolver "usa una plantilla para reabrir la conversación".

---

### S12 — `ENCRYPTION_KEY` sin validación

**Evidencia:** `src/lib/whatsapp/encryption.ts:29` → `process.env.ENCRYPTION_KEY!` (non-null assertion). Si falta o no son 32 bytes hex, el error aparece en la primera operación, no al arrancar.

**Impacto práctico:** un despliegue con la variable mal puesta arranca "bien" y falla al conectar/leer tokens. Y una rotación de clave invalida todos los tokens guardados (el GET de config ya lo detecta, pero conviene que sea explícito).

**Recomendación:** validar en un módulo de entorno (fail-fast con mensaje claro) y documentar el procedimiento de rotación.

---

### S13 — `shadcn` como dependencia de producción

**Evidencia:** `package.json:59` → `"shadcn": "^4.11.0"` en `dependencies`. Es una CLI de desarrollo.

**Impacto práctico:** arrastra `fast-glob`, `ts-morph`, `micromatch`, `braces` al árbol de producción (la mitad del ruido de `npm audit`) y engorda la imagen de despliegue.

**Recomendación:** mover a `devDependencies`. Es un cambio de una línea.

**Estado:** ✅ **remediado.** Movido a `devDependencies`; `npm audit --omit=dev` queda en 0.

---

### S14 — CSP en `Report-Only`

Ya descrito en S4b. Sin acción urgente.

### S15 — `whatsapp_config.user_id` con `ON DELETE CASCADE`

`001_initial_schema.sql:192`. Si se borra el usuario que conectó el número, se borra la configuración (y el token). Ya está contemplado en el diseño de multi-número (§3.2): `ON DELETE SET NULL`.

### S16 — Plantillas únicas por usuario

`014_message_templates_meta_integration.sql:190` → `UNIQUE(user_id, name, language)`. En una cuenta compartida, dos personas pueden crear la misma plantilla duplicada, y el índice no protege el caso real (por cuenta/WABA). Ya está en el diseño (§3.2, fase 3).

### S17 — Borrar una cuenta con datos auditados falla

**Evidencia (reproducido en dev durante la validación de la tanda 1):** el trigger genérico de `041_audit_log.sql:117-138` está enganchado a `contacts`, `tags`, `custom_fields`, `pipelines`, `message_templates`, `api_keys`, `whatsapp_config`, etc., como `AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW`, e inserta en `audit_logs` con `account_id = OLD.account_id`. Como `audit_logs.account_id` referencia `accounts(id) ON DELETE CASCADE` (`041:28`), al borrar la cuenta los borrados en cascada de las tablas hijas disparan el trigger **cuando la fila de `accounts` ya no existe** → violación de FK `23503` y **toda la operación aborta**:

```
DELETE /rest/v1/accounts?id=eq.<account> → HTTP 409
{"code":"23503","message":"insert or update on table \"audit_logs\" violates foreign key constraint \"audit_logs_account_id_fkey\""}
```

En el mismo caso, borrar primero las filas hijas a mano y después la cuenta sí funciona.

**Impacto:** en el modelo multi-negocio de la fase 1, **no se puede dar de baja a un cliente** (eliminar su espacio de trabajo) si tiene contactos u otra fila auditada. Tampoco se puede cumplir una petición de borrado de datos de forma limpia. Es un bloqueo funcional directo sobre el objetivo que perseguimos.

**Recomendación (1 línea, sin tocar nada más):** en `audit_row()`, saltar la inserción si la cuenta ya no existe:

```sql
IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = acct) THEN
  RETURN COALESCE(NEW, OLD);
END IF;
```

Así los borrados en cascada no intentan auditar contra una cuenta extinta, y el `ON DELETE CASCADE` de `audit_logs` limpia el historial.

**Estado:** ✅ **remediado y validado en dev** (migración 066): `audit_row()` captura `foreign_key_violation` y descarta la entrada de auditoría en vez de abortar la operación.

- Verificado en dev: `DELETE /rest/v1/accounts?id=eq.<cuenta>` con contactos auditados dentro → **200** (antes `409 / 23503`). Habilita dar de baja un espacio de trabajo completo.

### S18 — `accounts.owner_user_id` bloquea borrar al propietario

**Evidencia (reproducido en dev):** `017_account_sharing.sql:66` →

```sql
owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
```

`DELETE /auth/v1/admin/users/{id}` sobre el propietario devuelve **HTTP 500** con `23503`:

```
{"code":"23503","message":"update or delete on table \"users\" violates foreign key constraint \"accounts_owner_user_id_fkey\""}
```

**Impacto:** borrar un usuario dueño de un espacio de trabajo no es posible (ni desde el panel ni con la service role) salvo transfiriendo la propiedad antes. El `RESTRICT` es una decisión defendible, pero (a) el flujo de "transferir propiedad + borrar usuario" no está documentado ni automatizado, y (b) el error que ve quien lo intenta es un 500 opaco, no un mensaje claro.

**Recomendación:** decidir la política en la fase 1: si el borrado de usuarios debe funcionar, añadir el flujo explícito (transferir propiedad → borrar) y devolver un error legible; si no, documentarlo. No hace falta cambiar la FK.

**Estado:** pendiente (decisión de producto).

---

## 2. Lo que ya está bien (baseline)

Para que la lista anterior no dé una impresión equivocada:

- **Firmas de webhook fail-closed**: `verifyMetaWebhookSignature` rechaza todo si falta `META_APP_SECRET` (`webhook-signature.ts:15-46`), comparación en tiempo constante y cuerpo crudo. Evolution valida `apikey` contra el secreto cifrado del canal.
- **OAuth con `state` firmado + cookie HttpOnly** (Meta y TikTok), con expiración de 10 min.
- **Claves API**: hash (no se guardan en claro), scopes, `last_used`, rate limit y cuenta derivada de la clave (`api-context.ts`).
- **Crons protegidos** con `AUTOMATION_CRON_SECRET` y `timingSafeEqual`.
- **SSRF ya resuelto en webhooks salientes** (`lib/webhooks/ssrf.ts`, con tests).
- **RSS/RLS**: todas las tablas de dominio revisadas tienen `ENABLE ROW LEVEL SECURITY` y políticas por `is_account_member(...)`; el único `WITH CHECK (true)` histórico (`messages`, 001:185) fue reemplazado en 017.
- **Cifrado AES-256-GCM con auth tag** para tokens de WhatsApp/SMS/canales, con compatibilidad de lectura para el formato CBC antiguo.
- **Cabeceras**: HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` (micrófono solo same-origin).
- **`.env.local` ignorado** y **sin secretos en el historial de git** (verificado).
- **`attachments`** privado con URLs firmadas: el patrón correcto ya existe en el repo.
- Sin `dangerouslySetInnerHTML` con contenido de usuario (solo el script de tema y la config de Tailwind).

---

## 3. Plan sugerido (por tandas)

**Tanda 1 — antes de abrir a clientes (medio día)** — ✅ **hecha** (S1, S2, S13) y S3/S17 resueltos en la fase 1 (066).
1. S1: `next@16.4.2` + `eslint-config-next`; build + pruebas. ✅
2. S2: `chat-media` privado + `createSignedUrl` + migrar `media_url`. ✅ (065)
3. S3: trigger `protect_profile_tenancy` (encaja con la fase 1 del diseño). ✅ (066)
4. S4a: verificar `Cache-Control` con DevTools; corregir si sale `HIT`. ⏳ pendiente de verificación en el navegador

**Tanda 2 — calidad multi-tenant (1 día)**
5. S6 (automatizaciones por cuenta), S7 (dedupe Evolution), S10 (timeouts).
6. S9 (invitaciones), S5 (SSRF en canales).
7. S13 (mover `shadcn` a dev).

**Tanda 3 — endurecimiento (cuando toque)**
8. S8 (Redis), S11, S12, S14, y S15/S16 dentro de la fase de multi-número.

---

## 4. Verificaciones que puedes correr tú (solo lectura)

```sql
-- Buckets públicos y su tamaño real
SELECT id, public FROM storage.buckets ORDER BY public DESC, id;

-- Tablas sin RLS (debe devolver 0 filas)
SELECT c.relname
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity;

-- Políticas permisivas que queden
SELECT schemaname, tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE qual = 'true' OR with_check = 'true';
```

```powershell
npm audit --omit=dev
```

Y en el navegador (con sesión): `/inbox` → Network → `cache-control` y `x-vercel-cache` del documento.

---

## 5. Lo que **no** cubre esta auditoría

- Pruebas de penetración activas (no se hicieron ataques ni fuzzing).
- Revisión línea a línea de las 289 sentencias `CREATE POLICY` (se revisó el patrón y las excepciones).
- Dependencias de infraestructura (Vercel, Supabase, DNS, correo).
- Cumplimiento legal (GDPR/ley de datos) más allá de la exposición técnica de S2.
- Rendimiento bajo carga (no se hicieron pruebas de estrés).
