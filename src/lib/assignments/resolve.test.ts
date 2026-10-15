// Tests del resolver de asignación. La parte pura (`pickRule`,
// `chooseLeastLoaded`) se prueba sin Supabase; el I/O se cubre en
// integración.

import { describe, expect, it } from 'vitest';

import { chooseLeastLoaded, pickRule, type AssignmentRuleRow } from './resolve';

function rule(partial: Partial<AssignmentRuleRow>): AssignmentRuleRow {
  return {
    id: 'r',
    channel: null,
    team_id: null,
    group_id: null,
    strategy: 'round_robin',
    target_profile_id: null,
    priority: 0,
    ...partial,
  };
}

describe('pickRule', () => {
  it('returns null with no rules', () => {
    expect(pickRule([], 'whatsapp')).toBeNull();
  });

  it('matches a channel-agnostic rule for any channel', () => {
    const r = rule({ id: 'a', channel: null });
    expect(pickRule([r], 'whatsapp')?.id).toBe('a');
    expect(pickRule([r], null)?.id).toBe('a');
  });

  it('matches a channel-specific rule only for that channel', () => {
    const r = rule({ id: 'a', channel: 'whatsapp' });
    expect(pickRule([r], 'whatsapp')?.id).toBe('a');
    expect(pickRule([r], 'webchat')).toBeNull();
    // Canal desconocido → una regla específica NO aplica.
    expect(pickRule([r], null)).toBeNull();
  });

  it('prefers the rule that appears first (already in priority order)', () => {
    const rules = [rule({ id: 'high' }), rule({ id: 'low' })];
    expect(pickRule(rules, 'whatsapp')?.id).toBe('high');
  });

  it('skips non-matching rules and finds a later match', () => {
    const rules = [rule({ id: 'ig', channel: 'instagram' }), rule({ id: 'any' })];
    expect(pickRule(rules, 'webchat')?.id).toBe('any');
  });
});

describe('chooseLeastLoaded', () => {
  it('returns null with no candidates', () => {
    expect(chooseLeastLoaded([])).toBeNull();
  });

  it('picks the candidate with the fewest open conversations', () => {
    expect(
      chooseLeastLoaded([
        { id: 'a', load: 3 },
        { id: 'b', load: 1 },
        { id: 'c', load: 2 },
      ]),
    ).toBe('b');
  });

  it('breaks ties by ascending id, independent of order', () => {
    expect(
      chooseLeastLoaded([
        { id: 'b', load: 0 },
        { id: 'a', load: 0 },
      ]),
    ).toBe('a');
    expect(
      chooseLeastLoaded([
        { id: 'a', load: 0 },
        { id: 'b', load: 0 },
      ]),
    ).toBe('a');
  });
});
