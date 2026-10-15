import { describe, expect, it } from 'vitest';

import { chooseLeastLoaded } from './resolve';

describe('chooseLeastLoaded', () => {
  it('returns null with no candidates', () => {
    expect(chooseLeastLoaded([])).toBeNull();
  });

  it('returns the only candidate', () => {
    expect(chooseLeastLoaded([{ id: 'a', load: 7 }])).toBe('a');
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

  it('breaks ties deterministically by id', () => {
    expect(
      chooseLeastLoaded([
        { id: 'z', load: 1 },
        { id: 'b', load: 1 },
        { id: 'm', load: 1 },
      ]),
    ).toBe('b');
  });

  it('is stable regardless of input order', () => {
    const a = chooseLeastLoaded([
      { id: 'b', load: 0 },
      { id: 'a', load: 0 },
    ]);
    const b = chooseLeastLoaded([
      { id: 'a', load: 0 },
      { id: 'b', load: 0 },
    ]);
    expect(a).toBe('a');
    expect(b).toBe('a');
  });
});
