import { NextResponse } from 'next/server';

import { toErrorResponse } from '@/lib/auth/account';
import { TelephonyNotConfiguredError } from './livekit';

/** Mapea los errores de telefonía a respuestas HTTP claras. */
export function telephonyErrorResponse(err: unknown): NextResponse {
  if (err instanceof TelephonyNotConfiguredError) {
    return NextResponse.json(
      { error: err.message, missing: err.missing },
      { status: err.status }
    );
  }
  return toErrorResponse(err);
}
