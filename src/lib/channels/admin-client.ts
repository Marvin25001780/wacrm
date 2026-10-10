import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Lazy, shared service-role client for the public Evolution webhook.
// Mirrors src/lib/webchat/admin-client.ts — the inbound webhook has no
// `auth.uid()`, so it resolves the channel by its (unguessable) id and
// writes through the service role.
let _adminClient: SupabaseClient | null = null

export function channelsAdmin(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
  }
  return _adminClient
}
