import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  listAccountWabas,
  resolveWhatsappConfig,
  resolveWhatsappConfigForWaba,
} from './config';

// The helpers only use `from().select().eq()` and await the builder.
function makeDb(rows: Record<string, unknown>[], error: { message: string } | null = null) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    then: (resolve: (v: unknown) => unknown) =>
      resolve({ data: error ? null : rows, error }),
  };
  return { from: () => builder } as unknown as SupabaseClient;
}

const line = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  account_id: 'acct',
  phone_number_id: `pn-${id}`,
  waba_id: 'waba-1',
  access_token: 'enc',
  is_default: false,
  created_at: '2026-01-01T00:00:00Z',
  ...extra,
});

describe('resolveWhatsappConfig', () => {
  const rows = [
    line('ventas', { is_default: true, created_at: '2026-02-01T00:00:00Z' }),
    line('soporte', { created_at: '2026-01-01T00:00:00Z' }),
  ];

  it("uses the thread's own line when it exists", async () => {
    const { data } = await resolveWhatsappConfig(makeDb(rows), 'acct', 'soporte');
    expect(data?.id).toBe('soporte');
  });

  it('falls back to the default line without a preferred one', async () => {
    const { data } = await resolveWhatsappConfig(makeDb(rows), 'acct');
    expect(data?.id).toBe('ventas');
  });

  it("falls back to the default when the thread's line is gone", async () => {
    const { data } = await resolveWhatsappConfig(makeDb(rows), 'acct', 'borrada');
    expect(data?.id).toBe('ventas');
  });

  it('picks the oldest line when none is marked default', async () => {
    const noDefault = rows.map((r) => ({ ...r, is_default: false }));
    const { data } = await resolveWhatsappConfig(makeDb(noDefault), 'acct');
    expect(data?.id).toBe('soporte');
  });

  it('returns null (not an error) when the account has no line', async () => {
    const result = await resolveWhatsappConfig(makeDb([]), 'acct');
    expect(result).toEqual({ data: null, error: null });
  });

  it('surfaces a DB error instead of guessing a line', async () => {
    const result = await resolveWhatsappConfig(makeDb([], { message: 'boom' }), 'acct');
    expect(result).toEqual({ data: null, error: 'boom' });
  });
});

describe('templates by WABA', () => {
  const rows = [
    line('a', { is_default: true, waba_id: 'waba-1' }),
    line('b', { waba_id: 'waba-2', created_at: '2026-03-01T00:00:00Z' }),
    line('c', { waba_id: 'waba-2', created_at: '2026-02-01T00:00:00Z' }),
  ];

  it("uses a line of the template's WABA", async () => {
    const { data } = await resolveWhatsappConfigForWaba(makeDb(rows), 'acct', 'waba-2');
    expect(data?.waba_id).toBe('waba-2');
  });

  it('falls back to the default line for an unknown WABA', async () => {
    const { data } = await resolveWhatsappConfigForWaba(makeDb(rows), 'acct', 'waba-x');
    expect(data?.id).toBe('a');
  });

  it('lists each WABA once, the default line first', async () => {
    const { data } = await listAccountWabas(makeDb(rows), 'acct');
    expect(data.map((r) => `${r.waba_id}:${r.id}`)).toEqual(['waba-1:a', 'waba-2:c']);
  });
});
