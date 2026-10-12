'use client'

// ============================================================
// Embedded Signup de Meta (WhatsApp Business Platform).
//
// Abre el popup oficial de Facebook para que el usuario elija su
// cuenta de WhatsApp Business y su número. El popup devuelve, por un
// lado, un `code` de un solo uso (en el callback de FB.login) y, por
// otro, un mensaje `WA_EMBEDDED_SIGNUP` con el `waba_id` y el
// `phone_number_id`. Ambos se entregan al servidor, que canjea el
// code por un token (el App Secret nunca toca el navegador) y guarda
// las credenciales.
//
// Se carga el SDK de Facebook bajo demanda (solo al abrir este paso):
// no queremos el script de Meta en el resto de la app.
// ============================================================

const FB_SDK_SRC = 'https://connect.facebook.net/en_US/sdk.js'
const FB_SDK_ID = 'facebook-jssdk'
const DEFAULT_GRAPH_VERSION = 'v21.0'

interface FbAuthResponse {
  code?: string
  accessToken?: string
}

interface FbLoginResponse {
  status?: string
  authResponse?: FbAuthResponse | null
}

interface FbApi {
  init: (params: {
    appId: string
    autoLogAppEvents?: boolean
    xfbml?: boolean
    version: string
  }) => void
  login: (
    callback: (response: FbLoginResponse) => void,
    options: Record<string, unknown>,
  ) => void
}

declare global {
  interface Window {
    FB?: FbApi
    fbAsyncInit?: () => void
  }
}

let sdkPromise: Promise<FbApi> | null = null
let sdkInitialized = false

function loadFacebookSdk(): Promise<FbApi> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('El SDK de Facebook solo carga en el navegador'))
  }
  if (window.FB) return Promise.resolve(window.FB)
  if (sdkPromise) return sdkPromise

  sdkPromise = new Promise<FbApi>((resolve, reject) => {
    const finish = () => {
      if (window.FB) resolve(window.FB)
      else reject(new Error('El SDK de Facebook no se inicializó'))
    }

    // El script pudo insertarse en un montaje previo (Fast Refresh).
    if (document.getElementById(FB_SDK_ID)) {
      const startedAt = Date.now()
      const poll = window.setInterval(() => {
        if (window.FB) {
          window.clearInterval(poll)
          finish()
        } else if (Date.now() - startedAt > 8000) {
          window.clearInterval(poll)
          sdkPromise = null
          reject(new Error('El SDK de Facebook tardó demasiado en cargar'))
        }
      }, 150)
      return
    }

    const script = document.createElement('script')
    script.id = FB_SDK_ID
    script.src = FB_SDK_SRC
    script.async = true
    script.onload = finish
    script.onerror = () => {
      sdkPromise = null
      reject(
        new Error('No se pudo cargar el SDK de Facebook (revisa bloqueadores de scripts)'),
      )
    }
    document.body.appendChild(script)
  })

  return sdkPromise
}

export async function initMetaSdk(
  appId: string,
  version: string = DEFAULT_GRAPH_VERSION,
): Promise<FbApi> {
  const FB = await loadFacebookSdk()
  if (!sdkInitialized) {
    FB.init({ appId, autoLogAppEvents: true, xfbml: false, version })
    sdkInitialized = true
  }
  return FB
}

/**
 * Precarga el SDK de Facebook. Llamar al abrir el paso "Continuar con
 * Facebook" para que, al pulsar el botón, la inicialización ya esté
 * hecha: así `FB.login` se ejecuta dentro de la activación del usuario
 * (solo microtasks) y el navegador no bloquea el popup como emergente.
 */
export async function preloadMetaSdk(
  appId: string,
  version?: string,
): Promise<void> {
  try {
    await initMetaSdk(appId, version)
  } catch {
    // El error real se mostrará al pulsar el botón.
  }
}

export interface EmbeddedSignupResult {
  code: string
  wabaId: string | null
  phoneNumberId: string | null
}

interface EmbeddedSignupMessageData {
  waba_id?: string | number
  phone_number_id?: string | number
}

interface EmbeddedSignupMessage {
  type?: string
  event?: string
  data?: EmbeddedSignupMessageData
}

export interface LaunchEmbeddedSignupArgs {
  appId: string
  configId: string
  version?: string
}

/**
 * Abre el flujo de Embedded Signup y resuelve con el `code` y los ids
 * de la WABA/número. Rechaza si el usuario cancela.
 */
export async function launchEmbeddedSignup(
  args: LaunchEmbeddedSignupArgs,
): Promise<EmbeddedSignupResult> {
  const FB = await initMetaSdk(args.appId, args.version)

  return new Promise<EmbeddedSignupResult>((resolve, reject) => {
    let code: string | null = null
    let wabaId: string | null = null
    let phoneNumberId: string | null = null
    let settled = false
    let graceTimer: number | null = null

    const cleanup = () => {
      window.removeEventListener('message', onMessage, false)
      if (graceTimer != null) {
        window.clearTimeout(graceTimer)
        graceTimer = null
      }
    }

    const complete = () => {
      if (settled || !code) return
      settled = true
      cleanup()
      resolve({ code, wabaId, phoneNumberId })
    }

    const scheduleComplete = () => {
      // El mensaje WA_EMBEDDED_SIGNUP (waba_id / phone_number_id) suele
      // llegar junto al code; damos un margen corto antes de resolver.
      if (graceTimer != null) window.clearTimeout(graceTimer)
      graceTimer = window.setTimeout(complete, 800)
    }

    function onMessage(event: MessageEvent) {
      if (!/^https:\/\/(www|web)\.facebook\.com$/.test(event.origin)) return
      let payload: EmbeddedSignupMessage | string = event.data as
        | EmbeddedSignupMessage
        | string
      if (typeof payload === 'string') {
        try {
          payload = JSON.parse(payload) as EmbeddedSignupMessage
        } catch {
          return
        }
      }
      if (payload?.type !== 'WA_EMBEDDED_SIGNUP') return
      const data = payload.data ?? {}
      if (data.waba_id != null) wabaId = String(data.waba_id)
      if (data.phone_number_id != null) {
        phoneNumberId = String(data.phone_number_id)
      }
      if (code && (wabaId || phoneNumberId)) complete()
    }

    window.addEventListener('message', onMessage, false)

    FB.login(
      (response) => {
        code = response.authResponse?.code ?? null
        if (!code) {
          if (!settled) {
            settled = true
            cleanup()
            reject(
              new Error('Cancelaste o no se completó la conexión con Facebook.'),
            )
          }
          return
        }
        scheduleComplete()
      },
      {
        config_id: args.configId,
        response_type: 'code',
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: 'whatsapp_business_app_onboarding',
          sessionInfoVersion: '3',
        },
      },
    )
  })
}
