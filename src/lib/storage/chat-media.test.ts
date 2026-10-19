import { describe, expect, it } from 'vitest';
import { chatMediaPathFromUrl, isChatMediaUrl } from './chat-media';

const BASE = 'https://abc.supabase.co/storage/v1';

describe('chatMediaPathFromUrl', () => {
  it('extrae la ruta de la forma pública que guarda la app', () => {
    expect(
      chatMediaPathFromUrl(
        `${BASE}/object/public/chat-media/account-111/1700-foto.jpg`
      )
    ).toBe('account-111/1700-foto.jpg');
  });

  it('extrae la ruta de una URL firmada y descarta el token', () => {
    expect(
      chatMediaPathFromUrl(
        `${BASE}/object/sign/chat-media/account-111/foto.jpg?token=abc.def`
      )
    ).toBe('account-111/foto.jpg');
  });

  it('extrae la ruta de la forma autenticada', () => {
    expect(
      chatMediaPathFromUrl(
        `${BASE}/object/authenticated/chat-media/account-111/audio.ogg`
      )
    ).toBe('account-111/audio.ogg');
  });

  it('decodifica caracteres escapados en la ruta', () => {
    expect(
      chatMediaPathFromUrl(
        `${BASE}/object/public/chat-media/account-1/mi%20foto.png`
      )
    ).toBe('account-1/mi foto.png');
  });

  it('ignora otros buckets y enlaces externos', () => {
    expect(
      chatMediaPathFromUrl(`${BASE}/object/public/flow-media/account-1/x.png`)
    ).toBeNull();
    expect(chatMediaPathFromUrl('https://example.com/foto.jpg')).toBeNull();
  });

  it('tolera valores vacíos', () => {
    expect(chatMediaPathFromUrl(null)).toBeNull();
    expect(chatMediaPathFromUrl(undefined)).toBeNull();
    expect(chatMediaPathFromUrl('')).toBeNull();
    expect(chatMediaPathFromUrl(`${BASE}/object/public/chat-media/`)).toBeNull();
  });
});

describe('isChatMediaUrl', () => {
  it('distingue adjuntos del bucket privado', () => {
    expect(
      isChatMediaUrl(`${BASE}/object/public/chat-media/account-1/x.pdf`)
    ).toBe(true);
    expect(
      isChatMediaUrl(`${BASE}/object/public/flow-media/account-1/x.pdf`)
    ).toBe(false);
  });
});
