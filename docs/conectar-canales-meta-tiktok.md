# Conectar los canales Meta (Instagram / Facebook) y TikTok

Guía paso a paso para producción (`https://nexusbpo.space`). Los secretos
(`META_APP_SECRET`, `TIKTOK_CLIENT_SECRET`) van **solo** en Vercel
(server-side); nunca al navegador ni al repositorio.

- Callback de Meta:   `https://nexusbpo.space/api/channels/meta/oauth/callback`
- Callback de TikTok: `https://nexusbpo.space/api/channels/tiktok/oauth/callback`

El CRM usa dos flujos distintos:
- **Meta**: Facebook Login clásico + Messenger + Instagram (scopes
  `pages_show_list`, `pages_messaging`, `pages_manage_metadata`,
  `instagram_basic`, `instagram_manage_messages`, `business_management`).
- **TikTok**: Login Kit (`user.info.basic`), solo lectura hasta ser
  partner aprobado de su Business Messaging API.

---

## Parte A — Meta (Instagram + Facebook Messenger)

### Requisitos previos
- Cuenta de Facebook personal que administra la **Página de Facebook**
  de la empresa.
- Una **Página de Facebook** de la empresa.
- (Para Instagram) una cuenta de **Instagram profesional** (Business o
  Creator) **vinculada a esa Página**.
- Ser **administrador** de la Página.

### A.1 Crear la app
1. Entra a https://developers.facebook.com/ e inicia sesión; si es la
   primera vez, pulsa **Comenzar / Get Started** y verifica tu cuenta.
2. Arriba a la derecha: **Mis apps → Crear app**.
3. Rellena:
   - **Nombre de la app**: `NEXUS CRM` (o el que quieras).
   - **Correo de contacto**.
   - Caso de uso: **Otro (Other)** → Siguiente.
   - Tipo de app: **Empresa (Business)** → Siguiente.
   - Si aparece, selecciona tu **cartera comercial (Business portfolio)**.
4. Se abre el panel de la app.

### A.2 Agregar los productos
En el menú izquierdo, sección **Productos**, agrega y configura:
1. **Facebook Login** → *Configurar*.
2. **Messenger** → *Configurar* → vincula la **Página de Facebook**.
3. **Instagram** → *Configurar* → conecta la **cuenta IG profesional**.

> Usamos el flujo **"Instagram API with Facebook Login"**, no el de
> "Instagram Login" (ese usa otros scopes y no encaja con este CRM).

### A.3 Registrar la URI de redirección (crítico)
1. Menú izquierdo → **Facebook Login → Configuración (Settings)**.
2. En **Client OAuth Settings → Valid OAuth Redirect URIs** pega:
   ```
   https://nexusbpo.space/api/channels/meta/oauth/callback
   ```
   (Opcional, para desarrollo local:
   `http://localhost:3000/api/channels/meta/oauth/callback`)
3. **Guardar cambios**.

### A.4 Copiar App ID y App Secret
1. Menú izquierdo → **Configuración de la app → Básica**.
2. Copia:
   - **Identificador de la app** → `App ID`
   - **Clave secreta de la app** → `App Secret` (pulsa *Mostrar*).

### A.5 (Opcional, avanzado) Facebook Login for Business
Si quieres usar un **Configuration ID** en vez de pedir scopes sueltos:
- Menú izquierdo → **Facebook Login for Business → Configuraciones** →
  crea una configuración y copia su ID → será
  `NEXT_PUBLIC_META_IG_CONFIG_ID`.
- Si lo dejas vacío, el CRM pide los scopes clásicos (recomendado para
  empezar).

### A.6 Modo de la app (Desarrollo vs En vivo)
- Interruptor superior **Desarrollo / En vivo**.
- En **Desarrollo** funciona con **tu propia** Página/cuenta (eres
  admin/tester) — suficiente para probar.
- Para usarlo con cuentas de clientes externos: ponla en **En vivo** y
  solicita **Revisión de la app (App Review)** con acceso avanzado para
  `pages_messaging`, `pages_manage_metadata`, `instagram_basic`,
  `instagram_manage_messages`, `business_management`.

### A.7 Configurar los webhooks (crítico)

Conectar la página por OAuth **no** activa la entrega de mensajes. Faltan
dos cosas, y sin ellas el canal aparece "conectado" pero no llega nada.

1. **En el CRM**: `Canales → Facebook → Activar entrega`. Eso suscribe la
   página a la app (`POST /{page-id}/subscribed_apps`). El botón
   `Diagnóstico` debe mostrar `messages` en "Campos suscritos" y la misma
   app en "Apps suscritas" y "App del CRM".
2. **En Meta**: `Casos de uso → Configuración de la API de Messenger →
   1. Configurar webhooks`. Pega la **Callback URL** y el **Verify Token**
   que muestra el diálogo del canal y pulsa **Verificar y guardar**.
   Después, en **Campos del webhook**, pulsa **Suscribirse** en:
   - `messages`
   - `messaging_postbacks`
   - `message_reactions`
   - `messaging_optins`

Sin el paso 2 todos los campos aparecen como "No suscritos" y Meta no
envía ningún evento, aunque la verificación de la URL sea correcta.

**Probar que quedó bien:** en la fila `messages` pulsa **Probar → Enviar a
mi servidor**. Meta debe responder "Se probó correctamente"; en Vercel
aparece `[meta-webhook] sample received`. Luego envía un mensaje real
desde otra cuenta.

**Modo de la app:** en **Desarrollo**, o publicada pero sin la revisión
aprobada, solo se entregan mensajes de personas con rol en la app
(administradores, desarrolladores, testers). Para clientes reales hay que
aprobar `pages_messaging`.

---

## Parte B — TikTok (Login Kit)

### B.1 Crear la app
1. Entra a https://developers.tiktok.com/ e inicia sesión.
2. Arriba a la derecha → **Manage apps → Create app**.
3. Rellena nombre y categoría. En los productos/capacidades marca
   **Login Kit**.
4. En **Redirect URI** registra:
   ```
   https://nexusbpo.space/api/channels/tiktok/oauth/callback
   ```
5. En **Scopes** añade `user.info.basic` (nombre + avatar; es el único
   que TikTok concede sin pre-aprobación).
6. Guarda los cambios.

### B.2 Copiar Client Key y Client Secret
- En la página de tu app copia:
  - **Client Key** (público)
  - **Client Secret** (privado)

### B.3 Estado de la app
- Recién creada queda en modo **desarrollo**: puedes autorizar con tu
  propia cuenta de TikTok.
- Para uso general, envíala a **revisión**.
- **DMs**: la mensajería (`message.list.*`) exige ser **partner aprobado**
  de la Business Messaging API; no está en el portal estándar. Hasta
  entonces el canal TikTok es **solo lectura**.

---

## Parte C — Variables de entorno en Vercel

Dashboard de Vercel → tu proyecto → **Settings → Environment Variables**
→ pestaña **Production** → añade una por una:

| Variable | Valor | Dónde se obtiene |
|---|---|---|
| `META_APP_ID` | App ID | Meta → Configuración de la app → Básica |
| `META_APP_SECRET` | App Secret | Meta → Configuración de la app → Básica |
| `NEXT_PUBLIC_META_APP_ID` | El mismo App ID | (igual que `META_APP_ID`) |
| `NEXT_PUBLIC_META_IG_CONFIG_ID` | *opcional* | Facebook Login for Business → Configuraciones |
| `NEXT_PUBLIC_TIKTOK_CLIENT_KEY` | Client Key | TikTok → tu app |
| `TIKTOK_CLIENT_SECRET` | Client Secret | TikTok → tu app |
| `TIKTOK_SCOPES` | `user.info.basic` *(opcional)* | Fijo |

> **`NEXT_PUBLIC_*` se incrustan en el build** → después de guardar,
> **vuelve a desplegar** (Deployments → `...` → **Redeploy**).

---

## Parte D — Verificación

1. Haz **Redeploy** en Vercel y espera a que termine.
2. Entra a `https://nexusbpo.space/channels` con un usuario **admin**.
3. Pulsa **Conectar** en **Instagram** → se abre el diálogo de Meta →
   autoriza → vuelve a `/channels` y queda conectado.
4. Repite con **Facebook** y con **TikTok**.
5. Abre la **Bandeja de entrada**:
   - El **selector de canal** (junto al nombre) debe listar IG/FB con la
     fecha del último mensaje por medio.
   - Envía un mensaje de prueba por Instagram/Facebook y confirma que
     llega.

## Errores típicos
- `?meta=error&reason=config` → falta `META_APP_ID`/`META_APP_SECRET`.
- `?meta=error&reason=state` → permiso expirado o la URI de redirección
  no coincide exactamente con la registrada en A.3.
- `?tiktok=error&reason=config` → falta
  `NEXT_PUBLIC_TIKTOK_CLIENT_KEY`/`TIKTOK_CLIENT_SECRET`.

## Seguridad
- App Secret y Client Secret **solo** en Vercel (server-side).
- Nunca subas `.env`/`.env.local` al repositorio.
- Puedes rotar los secretos en cualquier momento regenerándolos en la
  consola y actualizando la variable en Vercel.
