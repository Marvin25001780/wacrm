import { describe, expect, it } from 'vitest';

import {
  formatPhoneDisplay,
  isDialablePhone,
  normalizePhone,
  phoneLookupKey,
  samePhone,
} from './phone';

describe('normalizePhone', () => {
  it('interpreta el formato local venezolano', () => {
    expect(normalizePhone('0412-123-4567')).toBe('+584121234567');
    expect(normalizePhone('04121234567')).toBe('+584121234567');
  });

  it('acepta E.164 y el prefijo internacional 00', () => {
    expect(normalizePhone('+58 412 123 4567')).toBe('+584121234567');
    expect(normalizePhone('00584121234567')).toBe('+584121234567');
  });

  it('rechaza números inválidos o vacíos', () => {
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('123')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(4121234567)).toBeNull();
  });

  it('isDialablePhone coincide con normalizePhone', () => {
    expect(isDialablePhone('0412 123 4567')).toBe(true);
    expect(isDialablePhone('no es un teléfono')).toBe(false);
  });
});

describe('samePhone', () => {
  it('compara el formato local con E.164', () => {
    expect(samePhone('04121234567', '+584121234567')).toBe(true);
    expect(samePhone('04121234567', '+584141234567')).toBe(false);
  });
});

describe('phoneLookupKey', () => {
  it('usa los últimos 7 dígitos', () => {
    expect(phoneLookupKey('+584121234567')).toBe('1234567');
    expect(phoneLookupKey('0412-123-4567')).toBe('1234567');
  });

  it('devuelve null si no hay dígitos suficientes', () => {
    expect(phoneLookupKey('123')).toBeNull();
    expect(phoneLookupKey(null)).toBeNull();
  });
});

describe('formatPhoneDisplay', () => {
  it('formatea en internacional y deja intacto lo no parseable', () => {
    expect(formatPhoneDisplay('+584121234567')).toContain('+58');
    expect(formatPhoneDisplay('extensión 12')).toBe('extensión 12');
    expect(formatPhoneDisplay(null)).toBe('');
  });
});
