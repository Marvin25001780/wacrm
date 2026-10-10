import { describe, expect, it } from 'vitest';

import {
  evoInstanceName,
  evoNumber,
  extractMessageId,
  extractQr,
  extractState,
  qrDataUri,
} from './evolution';

describe('evoInstanceName', () => {
  it('derives a stable, Evolution-safe name from the account id', () => {
    expect(evoInstanceName('fb676974-a2bc-45df-95ae-a75457d3c166')).toBe(
      'nexus-fb676974a2bc',
    );
  });

  it('is idempotent for an already-clean id', () => {
    expect(evoInstanceName('ABCDEF')).toBe('nexus-abcdef');
  });
});

describe('qrDataUri', () => {
  it('passes through an existing data URI', () => {
    const uri = 'data:image/png;base64,AAAA';
    expect(qrDataUri(uri)).toBe(uri);
  });

  it('wraps raw base64 into a PNG data URI', () => {
    expect(qrDataUri('AAAA')).toBe('data:image/png;base64,AAAA');
  });

  it('returns null for empty / non-string input', () => {
    expect(qrDataUri('')).toBeNull();
    expect(qrDataUri(null)).toBeNull();
    expect(qrDataUri(undefined)).toBeNull();
  });
});

describe('extractQr', () => {
  it('reads the v2 create/connect shape ({ qrcode: { base64, code } })', () => {
    const out = extractQr({ qrcode: { base64: 'BBBB', code: '2@abc' } });
    expect(out.qr).toBe('data:image/png;base64,BBBB');
    expect(out.code).toBe('2@abc');
  });

  it('reads the flat connect shape ({ base64, code })', () => {
    const out = extractQr({ base64: 'CCCC', code: 'pair-1' });
    expect(out.qr).toBe('data:image/png;base64,CCCC');
    expect(out.code).toBe('pair-1');
  });

  it('falls back to pairingCode when code is absent', () => {
    const out = extractQr({ qrcode: { base64: 'DDDD', pairingCode: 'ABCD-1234' } });
    expect(out.code).toBe('ABCD-1234');
  });

  it('returns nulls when there is no QR', () => {
    expect(extractQr({})).toEqual({ qr: null, code: null });
    expect(extractQr(null)).toEqual({ qr: null, code: null });
  });
});

describe('extractState', () => {
  it('normalizes the connectionState shape', () => {
    expect(extractState({ instance: { state: 'open' } })).toBe('open');
  });

  it('lowercases and reads a top-level state', () => {
    expect(extractState({ state: 'CONNECTING' })).toBe('connecting');
  });

  it('returns an empty string when absent', () => {
    expect(extractState(null)).toBe('');
    expect(extractState({})).toBe('');
  });
});

describe('extractMessageId', () => {
  it('reads key.id from a sendText response', () => {
    expect(extractMessageId({ key: { id: '3EB0ABC' } })).toBe('3EB0ABC');
  });

  it('falls back to id / messageId', () => {
    expect(extractMessageId({ id: 'x1' })).toBe('x1');
    expect(extractMessageId({ messageId: 'x2' })).toBe('x2');
    expect(extractMessageId({ ok: true })).toBeNull();
  });
});

describe('evoNumber', () => {
  it('keeps only digits (Evolution expects country code, no +)', () => {
    expect(evoNumber('+58 424-1234567')).toBe('584241234567');
  });
});
