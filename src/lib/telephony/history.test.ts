import { describe, expect, it } from 'vitest';

import {
  hasHistoryFilters,
  historyFromIso,
  historyQuery,
  historySearchTerms,
  isPhoneOnlySearch,
  parseHistoryFilters,
} from './history';

const NOW = new Date('2026-11-19T15:00:00Z').getTime(); // 11:00 en Caracas

const defaults = {
  q: '',
  direction: '' as const,
  status: '' as const,
  disposition: '' as const,
  agent: '',
  days: 30,
  limit: 25,
  offset: 0,
};

describe('historial de llamadas (filtros)', () => {
  it('sin parámetros usa la ventana por defecto', () => {
    expect(parseHistoryFilters(new URLSearchParams())).toEqual(defaults);
  });

  it('valida cada filtro y cae al valor seguro', () => {
    const filters = parseHistoryFilters(
      new URLSearchParams({
        q: '  Ana  ',
        direction: 'inbound',
        status: 'missed',
        disposition: 'sale',
        agent: '11111111-1111-1111-1111-111111111111',
        days: '7',
        limit: '100',
        offset: '50',
      })
    );
    expect(filters).toMatchObject({
      q: 'Ana',
      direction: 'inbound',
      status: 'missed',
      disposition: 'sale',
      agent: '11111111-1111-1111-1111-111111111111',
      days: 7,
      limit: 100,
      offset: 50,
    });

    const invalid = parseHistoryFilters(
      new URLSearchParams({
        direction: 'hacia-afuera',
        status: 'sonando',
        disposition: 'otra',
        agent: 'no-es-uuid',
        days: '12',
        limit: '1000',
        offset: '-5',
      })
    );
    expect(invalid).toEqual(defaults);
  });

  it('recorta la búsqueda y acepta "todo el historial"', () => {
    const filters = parseHistoryFilters(
      new URLSearchParams({ q: 'x'.repeat(200), days: '0', limit: '50' })
    );
    expect(filters.q).toHaveLength(60);
    expect(filters.days).toBe(0);
    expect(filters.limit).toBe(50);
  });

  it('calcula el inicio de la ventana en hora de Venezuela', () => {
    expect(historyFromIso(0, NOW)).toBeNull();
    expect(historyFromIso(-3, NOW)).toBeNull();
    // 1 día = hoy a las 00:00 de Caracas.
    expect(historyFromIso(1, NOW)).toBe('2026-11-19T04:00:00.000Z');
    // 7 días = seis días atrás a las 00:00.
    expect(historyFromIso(7, NOW)).toBe('2026-11-13T04:00:00.000Z');
  });

  it('arma la query y detecta filtros activos', () => {
    const query = historyQuery({
      q: 'Ana',
      direction: 'outbound',
      status: '',
      disposition: '',
      agent: '',
      days: 7,
      limit: 50,
      offset: 25,
    });
    expect(query).toBe('q=Ana&direction=outbound&days=7&limit=50&offset=25');

    expect(hasHistoryFilters(defaults)).toBe(false);
    expect(hasHistoryFilters({ ...defaults, q: 'Ana' })).toBe(true);
    expect(hasHistoryFilters({ ...defaults, days: 90 })).toBe(true);
  });

  it('separa número y nombre en la búsqueda', () => {
    expect(historySearchTerms('+58 412-1234567')).toEqual({
      phoneKey: '1234567',
      text: '+58 412-1234567',
    });
    expect(historySearchTerms('04121234567')).toEqual({
      phoneKey: '1234567',
      text: '04121234567',
    });
    expect(historySearchTerms('Ana')).toEqual({ phoneKey: null, text: 'Ana' });
    expect(historySearchTerms('   ')).toEqual({ phoneKey: null, text: '' });

    expect(isPhoneOnlySearch('0412-1234567')).toBe(true);
    expect(isPhoneOnlySearch('+58 412 1234567')).toBe(true);
    expect(isPhoneOnlySearch('Ana')).toBe(false);
    expect(isPhoneOnlySearch('')).toBe(false);
  });
});
