import { describe, expect, it } from 'vitest';

import {
  attemptsLabel,
  campaignContactStatusLabel,
  campaignOutcomeLabel,
  campaignProgress,
  campaignStatusLabel,
  isCampaignOpen,
} from './campaigns';

describe('campañas (124)', () => {
  it('resume la cola y calcula el avance', () => {
    const progress = campaignProgress([
      { status: 'pending' },
      { status: 'pending' },
      { status: 'dialing' },
      { status: 'called' },
      { status: 'exhausted' },
    ]);

    expect(progress).toMatchObject({
      total: 5,
      pending: 2,
      dialing: 1,
      called: 1,
      exhausted: 1,
      closed: 2,
      percent: 40,
      hasWork: true,
    });
  });

  it('sin contactos no divide por cero', () => {
    expect(campaignProgress([])).toEqual({
      total: 0,
      pending: 0,
      dialing: 0,
      called: 0,
      exhausted: 0,
      closed: 0,
      percent: 0,
      hasWork: false,
    });
    expect(campaignProgress(null).percent).toBe(0);
  });

  it('una campaña terminada no tiene trabajo pendiente', () => {
    const done = campaignProgress([{ status: 'called' }, { status: 'exhausted' }]);
    expect(done.hasWork).toBe(false);
    expect(done.percent).toBe(100);
  });

  it('solo la campaña activa admite siguiente contacto', () => {
    expect(isCampaignOpen('active')).toBe(true);
    expect(isCampaignOpen('paused')).toBe(false);
    expect(isCampaignOpen('completed')).toBe(false);
    expect(isCampaignOpen(null)).toBe(false);
  });

  it('muestra intentos solo cuando hubo alguno', () => {
    expect(attemptsLabel({ attempts: 0, maxAttempts: 3 })).toBeNull();
    expect(attemptsLabel({ attempts: 1, maxAttempts: 3 })).toBe('1/3');
    expect(attemptsLabel({ attempts: 3, maxAttempts: 3 })).toBe('3/3');
    // Nunca muestra un tope menor que el intento real.
    expect(attemptsLabel({ attempts: 4, maxAttempts: 0 })).toBe('4/1');
  });

  it('traduce estados y resultados, y respeta valores desconocidos', () => {
    expect(campaignStatusLabel('active')).toBe('Activa');
    expect(campaignStatusLabel('paused')).toBe('Pausada');
    expect(campaignStatusLabel('completed')).toBe('Completada');
    expect(campaignStatusLabel('otro')).toBe('otro');
    expect(campaignStatusLabel(null)).toBe('');

    expect(campaignContactStatusLabel('pending')).toBe('Pendiente');
    expect(campaignContactStatusLabel('dialing')).toBe('Marcando');
    expect(campaignContactStatusLabel('called')).toBe('Contactado');
    expect(campaignContactStatusLabel('exhausted')).toBe('Sin intentos');

    expect(campaignOutcomeLabel('answered')).toBe('Contestó');
    expect(campaignOutcomeLabel('missed')).toBe('No contestó');
    expect(campaignOutcomeLabel('unknown')).toBe('Sin dato');
    expect(campaignOutcomeLabel(null)).toBe('');
  });
});
