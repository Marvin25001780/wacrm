# Correo con Mailflare dentro del CRM

El módulo **Correo** del CRM muestra, lee, responde y envía correos usando
[**Mailflare**](https://github.com/hieunc229/mailflare) como servidor de correo
autoalojado. No se copia código de Mailflare: el CRM habla con su **API**, igual
que hace con WhatsApp.

- Módulo dentro del CRM: `/email`.
- Configuración: **Ajustes → Correo** (`/settings?tab=email`).
- Código: `src/lib/email/mailflare.ts` y `src/app/api/email/*`.

> Mailflare es AGPL-3.0. Por eso se integra por API y no se importa su código en
> el CRM.

---

## 1. Qué hace la integración

| Acción en el CRM | Llamada a Mailflare |
| --- | --- |
| Listar la bandeja, buscar y filtrar | `GET /api/v1/messages?limit=&q=&direction=&mailboxId=` |
| Leer un correo | el listado ya devuelve `textBody` / `htmlBody` |
| Marcar como leído | JMAP `Email/set` con `keywords/$seen` |
| Descubrir buzones | JMAP `Mailbox/get` |
| Descubrir direcciones de envío | JMAP `Identity/get` |
| Enviar o responder | `POST /api/v1/send` |

La **API key se guarda cifrada** (AES-256-GCM con `ENCRYPTION_KEY`) en la tabla
`email_config`, una fila por cuenta. Nunca se devuelve al navegador y sólo la
describen las rutas de API con la sesión del usuario.

No hacen falta variables de entorno nuevas: la URL y la key se configuran desde
la interfaz, por cuenta.

---

## 2. Requisitos antes de conectar

1. Una cuenta de **Cloudflare** con el dominio que vas a usar.
2. Un plan de Workers que permita **Email Sending** (el envío de correo de
   Cloudflare es de pago).
3. `ENCRYPTION_KEY` configurada en el CRM. Ya es obligatoria para WhatsApp e IA;
   si el CRM ya guarda esas claves, no hay que tocar nada.

---

## 3. Desplegar Mailflare (una sola vez)

### 3.1 Crear el token de Cloudflare (`CF_TOKEN`)

En Cloudflare: **Manage Account → Account API Tokens → Create Token**.

1. En el ámbito del token elige **Specified Domains** para los dominios que vas
   a conectar y da estos permisos:
   - **DNS & Zones → DNS → Edit** (permite reemplazar los MX que estorban).
   - **DNS & Zones → Zone → Read**.
   - **DNS & Zones → Zone Settings → Edit**.
   - **Email & Messaging → Email Routing Rules → Edit**.
2. Si Mailflare va a enviar correo, agrega otra política con **Entire Account**
   y el permiso:
   - **Email & Messaging → Email Sending → Edit**.
3. En **Compute → Email Service → Email Sending**, activa el servicio y
   incorpora el dominio.
4. Copia sólo el **secreto** del token. No incluyas la palabra `Bearer` ni el ID
   del token.

El token debe pertenecer a la **misma cuenta** que los dominios.

### 3.2 Desplegar el Worker

1. Abre <https://github.com/hieunc229/mailflare> y pulsa **Deploy to Cloudflare**.
2. Elige la cuenta que tiene tu dominio.
3. El nombre de la app debe ser **exactamente `mailflare`**. No lo cambies.
4. Cuando Cloudflare pida las variables o secretos del Worker, carga el
   `CF_TOKEN` del paso anterior.
5. Espera a que termine el despliegue.

### 3.3 Terminar la instalación

1. Abre la URL del Worker.
2. Entra a `/setup` si no te lleva solo.
3. Deja que Mailflare verifique Cloudflare e inicialice la base de datos.
4. Crea la **primera cuenta de administrador**.

### 3.4 Conectar el dominio y crear el primer buzón

1. En Mailflare, conecta un dominio que ya use Cloudflare DNS en la misma cuenta.
2. Mailflare configura Email Routing y, si está disponible, Email Sending.
3. Elige la dirección del primer buzón y termina el asistente.
4. Abre la bandeja y envíate un correo de prueba.

Para más dominios: **Admin → Domains → New domain**.

### 3.5 Crear la API key para el CRM

En Mailflare: **Ajustes → API keys → Create key**.

- Nombre sugerido: `NEXUS CRM`.
- Permisos: **`read`**, **`send`** y **`jmap`**.
- Copia la key en ese momento: no se vuelve a mostrar.

> Las *admin keys* de Mailflare no sirven para leer ni enviar correo. Usa una key
> normal con los tres permisos.

---

## 4. Conectar el CRM

1. Entra a **Ajustes → Correo**.
2. Pega la **URL de Mailflare** (por ejemplo
   `https://mailflare.tu-dominio.com`, sin barra final).
3. Pega la **API key**.
4. Pulsa **Probar conexión**. Debe responder con la lista de buzones.
5. Elige el **buzón** y la **dirección de envío** (o deja “Automática”).
6. Opcional: nombre del remitente y firma. La firma se añade en el servidor al
   enviar.
7. Guarda.

Si la prueba falla:

| Mensaje | Causa probable |
| --- | --- |
| `Mailflare rechazó la API key` | Key mal copiada, revocada o sin scope `jmap`. |
| `La API key no tiene permiso para esta acción` | Falta `read`, `send` o `jmap`. |
| `No se pudo contactar a Mailflare` | URL incorrecta, Worker caído o DNS sin propagar. |
| `Mailflare tardó demasiado` | Worker/D1 lento o URL apuntando a otro sitio. |
| `No hay una dirección de envío configurada` | La key no ve identidades: revisa el buzón y su permiso. |

---

## 5. Uso diario

- **Correo** aparece en la navegación principal para agentes y superiores.
- La lista muestra recibidos y enviados; el filtro superior separa ambos y
  permite elegir buzón.
- Al abrir un correo se marca como leído en Mailflare.
- **Responder** conserva el asunto (`Re:`), el `In-Reply-To` y la cadena de
  `References` para que el hilo no se rompa.
- **Nuevo correo** envía desde el buzón configurado y añade la firma.
- El HTML se muestra en un `iframe` con `sandbox` (sin scripts) para que un
  correo malicioso no ejecute código dentro del CRM.

Lo que **no** hace todavía, para no prometer de más:

- Adjuntos (la API los admite; el compositor aún no los sube).
- Carpetas, etiquetas, destacados, borradores y programación de envíos.
- Sincronización en tiempo real: la bandeja se refresca con **Actualizar** o al
  enviar.
- Copia del correo en el timeline del contacto.

---

## 6. Puesta en producción

1. Aplica la migración `107_email_config.sql` en Supabase.
2. Despliega el CRM.
3. Conecta el correo desde **Ajustes → Correo** con la cuenta administradora.
4. Envía un correo de prueba a una dirección externa y respóndelo desde fuera
   para confirmar recepción, envío y marcado de leído.

La integración es **por cuenta**: cada negocio del CRM conecta su propio
Mailflare, su propia key y su propio buzón.

---

## 7. Referencias

- Repositorio: <https://github.com/hieunc229/mailflare>
- Despliegue: <https://github.com/hieunc229/mailflare/blob/main/docs/deployment.md>
- API: <https://github.com/hieunc229/mailflare/blob/main/docs/api.md>
