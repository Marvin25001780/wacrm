import { describe, expect, it } from 'vitest';

import {
  canSendFreeText,
  fillTemplatePreview,
  formatWindowLeft,
  lastInboundAt,
  messagePreview,
  messageStatusLabel,
  serviceWindow,
  templateSupportsSimpleSend,
  templateVariableCount,
  type CollectionWhatsappMessage,
  type CollectionWhatsappTarget,
  type CollectionWhatsappTemplate,
} from './whatsapp';

const NOW = Date.parse('2026-11-20T15:00:00.000Z');

function message(
  patch: Partial<CollectionWhatsappMessage> = {}
): CollectionWhatsappMessage {
  return {
    message_id: 'm1',
    sender_type: 'customer',
    content_type: 'text',
    content_text: 'Hola',
    media_url: null,
    template_name: null,
    status: 'delivered',
    created_at: '2026-11-20T14:00:00.000Z',
    ...patch,
  };
}

function target(
  patch: Partial<CollectionWhatsappTarget> = {}
): CollectionWhatsappTarget {
  return {
    debtor_id: 'd1',
    account_id: 'a1',
    contact_id: null,
    conversation_id: null,
    display_name: 'Juan Pérez',
    phone: '04141234567',
    phone_e164: '+584141234567',
    country: 'VE',
    whatsapp_configured: true,
    whatsapp_connected: true,
    last_message_at: null,
    last_message_text: null,
    last_message_sender: null,
    unread_count: 0,
    ...patch,
  };
}

function template(
  patch: Partial<CollectionWhatsappTemplate> = {}
): CollectionWhatsappTemplate {
  return {
    id: 't1',
    name: 'recordatorio_pago',
    language: 'es',
    category: 'Utility',
    header_type: null,
    header_content: null,
    body_text: 'Hola {{1}}, tu cuota de {{2}} vence el {{3}}.',
    status: 'APPROVED',
    ...patch,
  };
}

describe('ventana de servicio de 24 h', () => {
  it('abre con un mensaje del deudor dentro de las últimas 24 h', () => {
    const window = serviceWindow([message()], NOW);
    expect(window.open).toBe(true);
    expect(window.remainingMinutes).toBe(23 * 60);
    expect(window.expiresAt).toBe('2026-11-21T14:00:00.000Z');
  });

  it('cierra pasadas 24 h sin mensaje del deudor', () => {
    const window = serviceWindow(
      [message({ created_at: '2026-11-19T10:00:00.000Z' })],
      NOW
    );
    expect(window.open).toBe(false);
    expect(window.remainingMinutes).toBe(0);
  });

  it('sin mensaje entrante no hay ventana (el primer envío es plantilla)', () => {
    const window = serviceWindow(
      [message({ sender_type: 'agent', created_at: '2026-11-20T14:30:00.000Z' })],
      NOW
    );
    expect(window.open).toBe(false);
  });

  it('toma el mensaje entrante más reciente, no el último de la lista', () => {
    const messages = [
      message({ message_id: 'a', created_at: '2026-11-20T10:00:00.000Z' }),
      message({ message_id: 'b', created_at: '2026-11-20T13:00:00.000Z' }),
      message({
        message_id: 'c',
        sender_type: 'agent',
        created_at: '2026-11-20T14:00:00.000Z',
      }),
    ];
    expect(lastInboundAt(messages)).toBe('2026-11-20T13:00:00.000Z');
  });

  it('resume el tiempo restante en horas y minutos', () => {
    expect(
      formatWindowLeft({ open: true, remainingMinutes: 312, expiresAt: null })
    ).toBe('Quedan 5 h 12 min');
    expect(
      formatWindowLeft({ open: false, remainingMinutes: 0, expiresAt: null })
    ).toBe('Ventana cerrada');
  });
});

describe('plantillas', () => {
  it('cuenta las variables por el índice más alto', () => {
    expect(templateVariableCount('Hola {{1}}')).toBe(1);
    expect(templateVariableCount('{{1}} y {{3}}')).toBe(3);
    expect(templateVariableCount('sin variables')).toBe(0);
  });

  it('rellena la vista previa y deja el marcador si falta el valor', () => {
    expect(
      fillTemplatePreview(template().body_text, ['Juan', '50,00'])
    ).toBe('Hola Juan, tu cuota de 50,00 vence el {{3}}.');
  });

  it('descarta plantillas con encabezado de texto variable', () => {
    expect(templateSupportsSimpleSend(template())).toBe(true);
    expect(
      templateSupportsSimpleSend(
        template({ header_type: 'text', header_content: 'Cliente {{1}}' })
      )
    ).toBe(false);
  });
});

describe('envío y presentación', () => {
  it('solo permite texto libre con línea, teléfono y ventana abierta', () => {
    const open = { open: true, remainingMinutes: 60, expiresAt: null };
    const closed = { open: false, remainingMinutes: 0, expiresAt: null };
    expect(canSendFreeText(target(), open)).toBe(true);
    expect(canSendFreeText(target(), closed)).toBe(false);
    expect(canSendFreeText(target({ phone_e164: null }), open)).toBe(false);
    expect(canSendFreeText(target({ whatsapp_configured: false }), open)).toBe(
      false
    );
    expect(canSendFreeText(null, open)).toBe(false);
  });

  it('traduce estados y contenido sin inventar texto', () => {
    expect(messageStatusLabel('delivered')).toBe('Entregado');
    expect(messageStatusLabel('failed')).toBe('Falló');
    expect(messageStatusLabel('otro')).toBe('otro');
    expect(
      messagePreview(
        message({
          content_type: 'audio',
          content_text: null,
          template_name: null,
        })
      )
    ).toBe('Audio');
    expect(
      messagePreview(
        message({
          content_type: 'template',
          content_text: null,
          template_name: 'recordatorio_pago',
        })
      )
    ).toBe('Plantilla: recordatorio_pago');
  });
});
