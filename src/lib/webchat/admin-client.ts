import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Service-role client for the PUBLIC webchat endpoints. The widget is
// embedded on third-party sites and has no `auth.uid()`, so reads of the
// widget config and writes of captured leads must bypass RLS.
// Mirrors src/lib/ai/admin-client.ts.
let _adminClient: SupabaseClient | null = null;

export function webchatAdmin(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _adminClient;
}
