import { describe, expect, it } from 'vitest';

import {
  normalizeIntegrationUrl,
  normalizeProjectKey,
  publicOpenreplayConfig,
  toClientView,
  type ExternalIntegrations,
} from './external';
import { basicAuthHeader, listmonkUrl, subscribeToFirstList } from './listmonk';
import {
  buildVoiceSummaryPayload,
  voiceSummaryUrl,
  type VoiceSummaryCall,
} from './voicesummary';

describe('normalizeIntegrationUrl', () => {
  it('recorta espacios y la barra final', () => {
    expect(normalizeIntegrationUrl('  https://listmonk.local/  ')).toBe(
      'https://listmonk.local',
    );
  });

  it('acepta HTTP para servicios en la red interna', () => {
    expect(normalizeIntegrationUrl('http://10.0.0.5:9000')).toBe(
      'http://10.0.0.5:9000',
    );
  });

  it('rechaza esquemas y valores que no son URL', () => {
    expect(normalizeIntegrationUrl('ftp://listmonk.local')).toBeNull();
    expect(normalizeIntegrationUrl('listmonk.local')).toBeNull();
    expect(normalizeIntegrationUrl('')).toBeNull();
    expect(normalizeIntegrationUrl(null)).toBeNull();
  });
});

describe('normalizeProjectKey', () => {
  it('exige una key no vacía', () => {
    expect(normalizeProjectKey('  abc123  ')).toBe('abc123');
    expect(normalizeProjectKey('   ')).toBeNull();
    expect(normalizeProjectKey(42)).toBeNull();
  });
});

describe('vista pública de OpenReplay', () => {
  const base: ExternalIntegrations = {
    openreplay: { enabled: true, url: 'https://or.local', projectKey: 'pk' },
    listmonk: { enabled: false, url: null, user: null, token: null, listId: null },
    voicesummary: { enabled: false, url: null, token: null },
  };

  it('solo se activa con URL y project key', () => {
    expect(publicOpenreplayConfig(base)).toEqual({
      enabled: true,
      url: 'https://or.local',
      projectKey: 'pk',
    });
    expect(
      publicOpenreplayConfig({
        ...base,
        openreplay: { enabled: true, url: null, projectKey: 'pk' },
      }).enabled,
    ).toBe(false);
  });

  it('sin fila devuelve todo apagado', () => {
    expect(publicOpenreplayConfig(null)).toEqual({
      enabled: false,
      url: null,
      projectKey: null,
    });
  });
});

describe('toClientView', () => {
  it('nunca expone los tokens, solo has_token', () => {
    const view = toClientView(
      {
        openreplay: { enabled: false, url: 'https://or.local', projectKey: 'pk' },
        listmonk: {
          enabled: true,
          url: 'https://lm.local',
          user: 'api',
          token: 'descifrado',
          listId: 3,
        },
        voicesummary: { enabled: true, url: 'https://vs.local', token: 'x' },
      },
      { listmonk_token: 'cifrado', voicesummary_token: null },
    );

    expect(view.listmonk.has_token).toBe(true);
    expect(view.voicesummary.has_token).toBe(false);
    expect(JSON.stringify(view)).not.toContain('descifrado');
    expect(view.listmonk.list_id).toBe(3);
  });

  it('sin fila reporta configured=false y campos vacíos', () => {
    const view = toClientView(null, null);
    expect(view.configured).toBe(false);
    expect(view.openreplay.url).toBe('');
    expect(view.listmonk.has_token).toBe(false);
  });
});

describe('listmonkUrl', () => {
  it('une base y ruta sin duplicar barras', () => {
    expect(listmonkUrl('https://lm.local/', '/api/health')).toBe(
      'https://lm.local/api/health',
    );
    expect(listmonkUrl('https://lm.local', 'api/health')).toBe(
      'https://lm.local/api/health',
    );
  });

  it('construye autenticación básica usuario:token', () => {
    expect(basicAuthHeader('api', 'secreto')).toBe(
      `Basic ${Buffer.from('api:secreto').toString('base64')}`,
    );
  });

  it('no llama a la red si el email no es válido', async () => {
    const result = await subscribeToFirstList(
      { url: 'https://lm.local', user: 'api', token: 'x' },
      { email: 'sin-arroba', name: null, listId: 1 },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('email');
  });
});

describe('VoiceSummary', () => {
  const call: VoiceSummaryCall = {
    id: 'call-1',
    transcript: 'Agente: hola\nCliente: quiero pagar mañana.',
    recordingUrl: 'https://cdn.local/call-1.ogg',
    startedAt: '2026-11-24T15:00:00.000Z',
    contactName: 'Ana Pérez',
    direction: 'outbound',
    agentName: 'Luis',
  };

  it('arma el cuerpo que espera POST /api/calls/', () => {
    const payload = buildVoiceSummaryPayload(call);
    expect(payload).not.toBeNull();
    expect(payload?.call_id).toBe('call-1');
    expect(payload?.audio_file_url).toBe('https://cdn.local/call-1.ogg');
    expect(payload?.transcript.text).toContain('quiero pagar');
    expect(payload?.transcript.turns[0].content).toContain('quiero pagar');
    expect(payload?.call_context).toContain('saliente');
    expect(payload?.call_context).toContain('Ana Pérez');
    expect(payload?.timestamp).toBe(call.startedAt);
  });

  it('no inventa un envío sin grabación o sin transcripción', () => {
    expect(buildVoiceSummaryPayload({ ...call, recordingUrl: null })).toBeNull();
    expect(buildVoiceSummaryPayload({ ...call, transcript: '   ' })).toBeNull();
  });

  it('recorta transcripciones enormes antes de mandarlas al LLM', () => {
    const long = 'x'.repeat(50_000);
    const payload = buildVoiceSummaryPayload({ ...call, transcript: long });
    expect(payload?.transcript.text).toHaveLength(40_000);
    expect(payload?.transcript.truncated).toBe(true);
  });

  it('normaliza la URL base de la API', () => {
    expect(voiceSummaryUrl('https://vs.local/')).toBe('https://vs.local/api/calls/');
  });
});
