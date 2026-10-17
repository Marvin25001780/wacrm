export const metadata = {
  title: 'Política de Privacidad — NEXUS BPO',
  description: 'Política de privacidad de NEXUS BPO.',
};

export default function PrivacidadPage() {
  return (
    <main className="min-h-screen bg-surface px-6 py-16 text-on-surface">
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-6 text-3xl font-bold">Política de Privacidad</h1>
        <p className="mb-4 text-sm text-on-surface-variant">
          Última actualización: 17 de octubre de 2026.
        </p>

        <section className="space-y-6 text-sm leading-relaxed text-on-surface-variant">
          <p>
            <strong className="text-on-surface">REPRESENTACIONES J.J.D.C, CA</strong>{' '}
            (“NEXUS BPO”, “nosotros”, “nuestro”) opera la plataforma NEXUS BPO y se
            compromete a proteger la privacidad de los datos personales de sus usuarios
            y de los clientes finales que interactúan a través de nuestros canales.
          </p>

          <h2 className="text-lg font-semibold text-on-surface">1. Información que recopilamos</h2>
          <p>
            Recopilamos la información necesaria para prestar el servicio de atención al
            cliente y gestión de relaciones comerciales, incluyendo:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Datos de contacto: nombre, correo electrónico, número de teléfono.</li>
            <li>Historial de conversaciones de WhatsApp, Instagram, Facebook Messenger y otros canales.</li>
            <li>Información de la cuenta de usuario: nombre, correo, rol y configuraciones.</li>
            <li>Datos de uso de la plataforma con fines de mejora y soporte técnico.</li>
          </ul>

          <h2 className="text-lg font-semibold text-on-surface">2. Cómo usamos la información</h2>
          <p>Utilizamos la información para:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Proveer, operar y mantener la plataforma NEXUS BPO.</li>
            <li>Gestionar conversaciones y solicitudes de los clientes finales.</li>
            <li>Enviar notificaciones, alertas y comunicaciones relacionadas con el servicio.</li>
            <li>Mejorar la seguridad, el rendimiento y la experiencia de usuario.</li>
            <li>Cumplir con obligaciones legales y regulatorias aplicables.</li>
          </ul>

          <h2 className="text-lg font-semibold text-on-surface">3. Compartición de datos</h2>
          <p>
            No vendemos datos personales. Podemos compartir información únicamente con:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Proveedores de servicios tecnológicos esenciales (por ejemplo, Meta, Supabase, Vercel).</li>
            <li>Autoridades competentes cuando la ley lo exija.</li>
          </ul>

          <h2 className="text-lg font-semibold text-on-surface">4. Seguridad</h2>
          <p>
            Implementamos medidas técnicas y organizativas para proteger la información
            contra acceso no autorizado, alteración, divulgación o destrucción.
          </p>

          <h2 className="text-lg font-semibold text-on-surface">5. Derechos de los usuarios</h2>
          <p>
            Los usuarios pueden solicitar acceso, rectificación o eliminación de sus datos
            personales escribiendo a{' '}
            <a
              href="mailto:contacto@nexusbpo.space"
              className="text-primary underline"
            >
              contacto@nexusbpo.space
            </a>.
          </p>

          <h2 className="text-lg font-semibold text-on-surface">6. Cambios a esta política</h2>
          <p>
            Podemos actualizar esta política ocasionalmente. Cualquier cambio será publicado
            en esta página con la fecha de actualización correspondiente.
          </p>

          <h2 className="text-lg font-semibold text-on-surface">7. Contacto</h2>
          <p>
            Si tienes preguntas sobre esta política, contáctanos:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Correo: contacto@nexusbpo.space</li>
            <li>Teléfono: 0422 2433946</li>
            <li>
              Dirección: CTRA VIEJA DE LOS TEQUES CASA NRO 4 BARRIO MAMERA CARACAS
              DISTRITO CAPITAL ZONA POSTAL 1000
            </li>
          </ul>
        </section>
      </div>
    </main>
  );
}
