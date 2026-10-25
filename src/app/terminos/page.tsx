export const metadata = {
  title: 'Términos de Servicio — NEXUS BPO',
  description: 'Términos de servicio de NEXUS BPO.',
};

export default function TerminosPage() {
  return (
    <main className="min-h-screen bg-surface px-6 py-16 text-on-surface">
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-6 text-3xl font-bold">Términos de Servicio</h1>
        <p className="mb-4 text-sm text-on-surface-variant">
          Última actualización: 24 de octubre de 2026.
        </p>

        <section className="space-y-6 text-sm leading-relaxed text-on-surface-variant">
          <p>
            Estos términos regulan el uso de la plataforma NEXUS BPO, operada por{' '}
            <strong className="text-on-surface">REPRESENTACIONES J.J.D.C, CA</strong>{' '}
            (“NEXUS BPO”, “nosotros”, “nuestro”). Al acceder o usar la plataforma aceptas
            estos términos. Si no estás de acuerdo, no uses el servicio.
          </p>

          <h2 className="text-lg font-semibold text-on-surface">1. Descripción del servicio</h2>
          <p>
            NEXUS BPO es una plataforma de gestión de atención al cliente y comunicación
            multicanal, que incluye mensajería por WhatsApp, Instagram, Facebook Messenger y
            otros canales, agentes de inteligencia artificial, gestión de contactos, flujos
            automatizados y módulos de cobranza.
          </p>

          <h2 className="text-lg font-semibold text-on-surface">2. Cuentas y acceso</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>Eres responsable de la confidencialidad de tus credenciales de acceso.</li>
            <li>Debes proporcionar información veraz y mantenerla actualizada.</li>
            <li>
              Eres responsable de las acciones realizadas con tu cuenta y de los usuarios
              que invites a tu organización.
            </li>
          </ul>

          <h2 className="text-lg font-semibold text-on-surface">3. Uso aceptable</h2>
          <p>Te comprometes a no usar la plataforma para:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Enviar spam, mensajes no solicitados o contenido engañoso.</li>
            <li>Violar las políticas de WhatsApp Business, Meta u otros canales conectados.</li>
            <li>Tratar datos personales sin una base legal adecuada o sin el consentimiento requerido.</li>
            <li>Hostigar, amenazar o presionar indebidamente a deudores o clientes.</li>
            <li>Intentar vulnerar la seguridad, acceder a datos de terceros o interferir con el servicio.</li>
          </ul>

          <h2 className="text-lg font-semibold text-on-surface">4. Contenido y datos de clientes</h2>
          <p>
            Tú conservas la titularidad de los datos y conversaciones que cargas o generas en
            la plataforma. Nos autorizas a procesarlos únicamente para prestar el servicio,
            conforme a nuestra{' '}
            <a href="/privacidad" className="text-primary underline">
              Política de Privacidad
            </a>
            . Eres responsable de contar con la base legal y los consentimientos necesarios
            para los datos de tus clientes.
          </p>

          <h2 className="text-lg font-semibold text-on-surface">5. Inteligencia artificial</h2>
          <p>
            Las respuestas generadas por agentes de IA son automatizadas y pueden contener
            errores. Eres responsable de supervisar su configuración y de las respuestas que
            se envíen a tus clientes.
          </p>

          <h2 className="text-lg font-semibold text-on-surface">6. Disponibilidad y cambios</h2>
          <p>
            Hacemos esfuerzos razonables para mantener el servicio disponible, pero no
            garantizamos operación ininterrumpida. Podemos modificar, suspender o descontinuar
            funciones, notificando los cambios relevantes cuando sea posible.
          </p>

          <h2 className="text-lg font-semibold text-on-surface">7. Suspensión y terminación</h2>
          <p>
            Podemos suspender o cancelar el acceso si se incumplen estos términos o si el uso
            pone en riesgo la seguridad de la plataforma, de otros usuarios o de terceros.
          </p>

          <h2 className="text-lg font-semibold text-on-surface">8. Limitación de responsabilidad</h2>
          <p>
            En la medida permitida por la ley, NEXUS BPO no será responsable por daños
            indirectos, lucro cesante o pérdida de datos derivados del uso o la imposibilidad
            de uso del servicio. Las copias de seguridad y la exportación de datos son
            responsabilidad compartida y deben gestionarse por la organización cliente.
          </p>

          <h2 className="text-lg font-semibold text-on-surface">9. Ley aplicable</h2>
          <p>
            Estos términos se rigen por las leyes de la República Bolivariana de Venezuela.
            Cualquier controversia se someterá a los tribunales competentes de Caracas.
          </p>

          <h2 className="text-lg font-semibold text-on-surface">10. Contacto</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Correo:{' '}
              <a href="mailto:contacto@nexusbpo.space" className="text-primary underline">
                contacto@nexusbpo.space
              </a>
            </li>
            <li>Teléfono: 0422 2433946</li>
            <li>
              Dirección: CTRA VIEJA DE LOS TEQUES CASA NRO 4 BARRIO MAMERA CARACAS DISTRITO
              CAPITAL ZONA POSTAL 1000
            </li>
          </ul>
        </section>
      </div>
    </main>
  );
}
