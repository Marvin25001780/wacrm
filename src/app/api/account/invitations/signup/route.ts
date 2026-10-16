// ============================================================
// POST /api/account/invitations/signup
//
// Invite-only account creation. Public signups are disabled in
// Supabase, so an invited user cannot call the public `signUp()`
// endpoint. This route is the escape hatch: it validates the
// invite token, creates the user with the service-role key, signs
// the user in (so cookies are written), and redeems the invite
// atomically.
//
// Requirements for this to work:
//   - SUPABASE_SERVICE_ROLE_KEY must be set.
//   - The invite token must be valid, non-expired, and unredeemed.
//   - The email must not already belong to an existing user.
// ============================================================

import { NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

import { hashInviteToken } from "@/lib/auth/invitations";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

const RATE_LIMIT_KEY_PREFIX = "inviteSignup";

// Lazy-initialized to avoid build-time crash when env vars are missing.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null;
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _adminClient;
}

interface SignupBody {
  email?: unknown;
  password?: unknown;
  fullName?: unknown;
  inviteToken?: unknown;
}

export async function POST(request: Request) {
  // Rate limit by IP to prevent brute-force token/email probing.
  const clientIp =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const limit = checkRateLimit(
    `${RATE_LIMIT_KEY_PREFIX}:${clientIp}`,
    RATE_LIMITS.invitationPeek, // 30/min per IP — same shape as peek.
  );
  if (!limit.success) return rateLimitResponse(limit);

  const body = (await request.json().catch(() => null)) as SignupBody | null;

  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const fullName = typeof body?.fullName === "string" ? body.fullName.trim() : "";
  const inviteToken = typeof body?.inviteToken === "string" ? body.inviteToken.trim() : "";

  if (!email || !password || !fullName || !inviteToken) {
    return NextResponse.json(
      { error: "email, password, fullName, and inviteToken are required" },
      { status: 400 },
    );
  }

  if (password.length < 6) {
    return NextResponse.json(
      { error: "Password must be at least 6 characters" },
      { status: 400 },
    );
  }

  const tokenHash = hashInviteToken(inviteToken);

  // Validate the invite before doing any destructive work.
  const { data: invite, error: inviteError } = await supabaseAdmin()
    .from("account_invitations")
    .select("id, account_id, role, expires_at, accepted_at")
    .eq("token_hash", tokenHash)
    .single();

  if (inviteError || !invite) {
    return NextResponse.json(
      { error: "Invitation not found or invalid" },
      { status: 400 },
    );
  }

  if (invite.accepted_at) {
    return NextResponse.json(
      { error: "Invitation has already been used" },
      { status: 400 },
    );
  }

  if (new Date(invite.expires_at) < new Date()) {
    return NextResponse.json(
      { error: "Invitation has expired" },
      { status: 400 },
    );
  }

  // Create the user. Email is auto-confirmed because the invite
  // token itself is the authorization mechanism. If the email is
  // already registered, `createUser` will fail with a duplicate
  // error — we surface that as a 409 so the user can log in and
  // accept the invite from /join/<token> instead.
  const { data: createData, error: createError } = await supabaseAdmin()
    .auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });

  if (createError || !createData.user) {
    console.error("[invite signup] createUser error:", createError);
    const msg = createError?.message ?? "";
    const isDuplicate =
      /already (exists|registered|taken)|duplicate|user already|email address is already/i.test(msg);
    if (isDuplicate) {
      return NextResponse.json(
        { error: "Este correo ya está registrado. Iniciá sesión para aceptar la invitación." },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: msg || "No se pudo crear la cuenta" },
      { status: 500 },
    );
  }

  // Sign in as the new user so the cookie-based session is written.
  // `createClient()` from @/lib/supabase/server uses the anon key and
  // manages cookies; signInWithPassword works because the user exists.
  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (signInError) {
    console.error("[invite signup] signInWithPassword error:", signInError);
    return NextResponse.json(
      { error: "Account created but could not sign in. Please log in manually." },
      { status: 500 },
    );
  }

  // Redeem the invite. The caller is now authenticated as the new user.
  const { error: redeemError } = await supabase.rpc("redeem_invitation", {
    p_token_hash: tokenHash,
  });

  if (redeemError) {
    console.error("[invite signup] redeem_invitation error:", redeemError);
    return NextResponse.json(
      { error: "Account created but the invitation could not be redeemed. Please contact support." },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { success: true, accountId: invite.account_id, role: invite.role },
    { status: 201 },
  );
}
