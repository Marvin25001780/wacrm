import { LegalNav } from "@/components/legal/legal-shell";

export const metadata = {
  title: 'Eliminación de datos — NEXUS BPO',
  description:
    'Cómo solicitar la eliminación de tus datos en NEXUS BPO y en las integraciones con Meta.',
};

export default function EliminacionDeDatosPage() {
  return (
    <main className="min-h-screen bg-surface px-6 py-16 text-on-surface">
      <div className="mx-auto max-w-3xl">
        <LegalNav current="/eliminacion-de-datos" />
        <h1 className="mb-6 text-3xl font-bold">Eliminación de datos</h1>
        <p className="mb-4 text-sm text-on-surface-variant">
          Última actualización: 25 de octubre de 2026.
        </p>

        <section className="space-y-6 text-sm leading-relaxed text-on-surface-variant">
          <p>
            <strong className="text-on-surface">REPRESENTACIONES J.J.D.C, CA</strong>{' '}
            (“NEXUS BPO”) opera la plataforma NEXUS BPO. Esta página explica cómo
            solicitar la eliminación de los datos asociados a tu cuenta y a las
            integraciones con Meta (Facebook, Instagram y WhatsApp).
          </p>

          <h2 className="text-lg font-semibold text-on-surface">
            1. Si eres usuario de la plataforma
          </h2>
          <p>
            Escribe a{' '}
            <a href="mailto:contacto@nexusbpo.space" className="text-primary underline">
              contacto@nexusbpo.space
            </a>{' '}
            desde el correo de tu cuenta, con el asunto “Eliminación de datos”.
            Incluye el nombre de tu organización y el correo de tu usuario.
          </p>
          <p>
            Eliminaremos los datos de tu cuenta y de tu organización en un plazo
            máximo de 30 días, salvo la información que debamos conservar por
            obligaciones legales o contables.
          </p>

          <h2 className="text-lg font-semibold text-on-surface">
            2. Si conectaste Facebook, Instagram o WhatsApp
          </h2>
          <p>
            Al conectar una cuenta de Meta autorizas a NEXUS BPO a acceder a los
            datos que indicaste al aceptar los permisos. Puedes revocar ese acceso
            en cualquier momento desde Meta:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Entra a{' '}
              <a
                href="https://www.facebook.com/settings?tab=applications"
                className="text-primary underline"
                target="_blank"
                rel="noreferrer"
              >
                Configuración de Facebook → Aplicaciones y sitios web
              </a>
              .
            </li>
            <li>Busca la aplicación “nexus crm” o “NEXUS BPO”.</li>
            <li>Pulsa “Eliminar” para quitar el acceso.</li>
          </ul>
          <p>
            Al revocar el permiso dejamos de recibir nuevos datos de esa cuenta.
            Para eliminar también el historial ya almacenado (contactos,
            conversaciones y mensajes), escríbenos a{' '}
            <a href="mailto:contacto@nexusbpo.space" className="text-primary underline">
              contacto@nexusbpo.space
            </a>{' '}
            indicando la página o cuenta de Instagram y la organización a la que
            pertenece.
          </p>

          <h2 className="text-lg font-semibold text-on-surface">
            3. Si eres cliente final de una empresa que usa NEXUS BPO
          </h2>
          <p>
            Los datos de conversaciones y cobranza pertenecen a la empresa con la
            que tienes la relación comercial. Dirige tu solicitud a esa empresa,
            que es la responsable de tus datos. Si nos escribes, te orientaremos y
            canalizaremos la solicitud al cliente correspondiente.
          </p>

          <h2 className="text-lg font-semibold text-on-surface">4. Contacto</h2>
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
