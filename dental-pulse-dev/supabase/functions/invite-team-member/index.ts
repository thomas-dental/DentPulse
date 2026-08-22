import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import nodemailer from "npm:nodemailer@6.9.7";

const SMTP_HOST = Deno.env.get("MAIL_HOST") || "smtp.gmail.com";
const SMTP_PORT = parseInt(Deno.env.get("MAIL_PORT") || "587");
const SMTP_USER = Deno.env.get("MAIL_USERNAME") || "";
const SMTP_PASSWORD = Deno.env.get("MAIL_PASSWORD") || "";
const SMTP_FROM_EMAIL = Deno.env.get("MAIL_FROM_ADDRESS") || SMTP_USER;
const SMTP_FROM_NAME = Deno.env.get("MAIL_FROM_NAME") || "DentPulse";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CENTRAL_AUTH_BASE_URL = Deno.env.get("CENTRAL_AUTH_BASE_URL") || "";
const PASSWORD_SYNC_SECRET = Deno.env.get("PASSWORD_SYNC_SECRET") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface InviteRequest {
  email: string;
  name: string;
  role_type: string;
  app_role: string; // 'owner' | 'admin' | 'member' — for user_roles table
  custom_role_id?: string; // UUID of custom_roles row — links permissions
  location_ids?: string[]; // array of practice_location IDs (multi-location)
  organization_id: string;
  organization_name: string;
  inviter_name: string;
  app_url: string;
  specialization?: string;
}

// Always return 200 with { success, error? } so supabase.functions.invoke
// puts the body in `data` (not buried inside FunctionsHttpError).
function jsonOk(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function generatePassword(length = 12): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%&*";
  const all = upper + lower + digits + symbols;
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  const pw = [
    upper[arr[0] % upper.length],
    lower[arr[1] % lower.length],
    digits[arr[2] % digits.length],
    symbols[arr[3] % symbols.length],
  ];
  for (let i = 4; i < length; i++) pw.push(all[arr[i] % all.length]);
  for (let i = pw.length - 1; i > 0; i--) {
    const j = arr[i] % (i + 1);
    [pw[i], pw[j]] = [pw[j], pw[i]];
  }
  return pw.join("");
}

function generateEmailHtml(data: {
  inviterName: string;
  organizationName: string;
  roleName: string;
  inviteLink: string;
  email: string;
  password: string;
  isExistingUser: boolean;
}): string {
  const credentialsBlock = data.isExistingUser
    ? `<p style="margin: 0 0 24px; color: #4b5563; font-size: 15px; line-height: 1.6;">
        You already have a DentPulse account. Click below to sign in and join the organization.
      </p>`
    : `<div style="background-color: #f8f5ff; border: 1px solid #e9e0ff; border-radius: 8px; padding: 20px; margin: 0 0 24px;">
        <p style="margin: 0 0 12px; color: #111827; font-size: 14px; font-weight: 600;">Your login credentials:</p>
        <table style="width: 100%;">
          <tr>
            <td style="padding: 4px 0; color: #6b7280; font-size: 14px; width: 80px;">Email:</td>
            <td style="padding: 4px 0; color: #111827; font-size: 14px; font-weight: 500;">${data.email}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; color: #6b7280; font-size: 14px;">Password:</td>
            <td style="padding: 4px 0; color: #111827; font-size: 14px; font-family: monospace; font-weight: 500; letter-spacing: 0.5px;">${data.password}</td>
          </tr>
        </table>
        <p style="margin: 12px 0 0; color: #9ca3af; font-size: 12px;">We recommend changing your password after your first login.</p>
      </div>`;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:40px 20px;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,0.07);">
<tr><td style="background:linear-gradient(135deg,#6d28d9,#7c3aed);padding:32px 40px;text-align:center;">
<h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">DentPulse</h1></td></tr>
<tr><td style="padding:40px;">
<h2 style="margin:0 0 16px;color:#111827;font-size:20px;font-weight:600;">You've been invited!</h2>
<p style="margin:0 0 20px;color:#4b5563;font-size:15px;line-height:1.6;">
<strong>${data.inviterName}</strong> has invited you to join <strong>${data.organizationName}</strong> on DentPulse as a <strong>${data.roleName}</strong>.</p>
${credentialsBlock}
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:8px 0 32px;">
<a href="${data.inviteLink}" style="display:inline-block;background:linear-gradient(135deg,#6d28d9,#7c3aed);color:#ffffff;text-decoration:none;padding:14px 40px;border-radius:8px;font-size:15px;font-weight:600;">
${data.isExistingUser ? "Sign In &amp; Join" : "Accept Invitation"}</a></td></tr></table>
<p style="margin:0 0 8px;color:#6b7280;font-size:13px;">Or copy and paste this link:</p>
<p style="margin:0 0 24px;color:#7c3aed;font-size:13px;word-break:break-all;">${data.inviteLink}</p>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
<p style="margin:0;color:#9ca3af;font-size:12px;">This invitation expires in 7 days.</p>
</td></tr>
<tr><td style="background-color:#f9fafb;padding:20px 40px;text-align:center;border-top:1px solid #e5e7eb;">
<p style="margin:0;color:#9ca3af;font-size:12px;">Sent by DentPulse</p></td></tr>
</table></td></tr></table></body></html>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader)
      return jsonOk({ success: false, error: "Missing authorization header" });

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const jwt = authHeader.replace("Bearer ", "");
    const {
      data: { user: caller },
      error: authError,
    } = await supabaseAdmin.auth.getUser(jwt);
    if (authError || !caller)
      return jsonOk({ success: false, error: "Invalid or expired token" });

    const body: InviteRequest = await req.json();
    const {
      email,
      name,
      role_type,
      app_role,
      custom_role_id,
      location_ids,
      organization_id,
      organization_name,
      inviter_name,
      app_url,
      specialization,
    } = body;

    if (!email || !name || !role_type || !organization_id) {
      return jsonOk({
        success: false,
        error: "Please fill in all required fields (name, email, role).",
      });
    }

    const emailLower = email.toLowerCase().trim();

    // Verify caller is owner
    const { data: callerRole } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .eq("organization_id", organization_id)
      .single();

    if (callerRole?.role !== "owner") {
      return jsonOk({
        success: false,
        error: "Only organization owners can send invitations.",
      });
    }

    // Check if already a team member in this org
    const { data: existingMember } = await supabaseAdmin
      .from("team_members")
      .select("id, invite_status")
      .eq("organization_id", organization_id)
      .eq("email", emailLower)
      .in("invite_status", ["pending", "accepted", "active"])
      .maybeSingle();

    if (existingMember) {
      const msg =
        existingMember.invite_status === "pending"
          ? "An invitation is already pending for this email. Cancel it first to resend."
          : "This person is already a team member.";
      return jsonOk({ success: false, error: msg });
    }

    // ── Create or detect auth user ─────────────────────────────
    let isExistingUser = false;
    let authUserId: string | null = null;
    let generatedPassword = generatePassword(12);

    // Try creating the user. If already exists, catch and handle.
    const { data: newUser, error: createError } =
      await supabaseAdmin.auth.admin.createUser({
        email: emailLower,
        password: generatedPassword,
        email_confirm: true,
        user_metadata: { full_name: name },
      });

    if (createError) {
      const errMsg = (createError.message || "").toLowerCase();
      if (
        errMsg.includes("already") ||
        errMsg.includes("registered") ||
        errMsg.includes("exists")
      ) {
        // Existing user — don't expose their password
        isExistingUser = true;
        generatedPassword = "";

        // Find existing user ID by querying auth.users via RPC or getUserById
        // Use a simple approach: query profiles table by email
        const { data: profileRow } = await supabaseAdmin
          .from("profiles")
          .select("user_id")
          .eq("email", emailLower)
          .maybeSingle();

        authUserId = profileRow?.user_id || null;
        console.log(
          `[invite-team-member] Existing user: ${emailLower} (user_id: ${authUserId})`,
        );
      } else {
        console.error("[invite-team-member] createUser error:", createError);
        return jsonOk({
          success: false,
          error: `Failed to create account: ${createError.message}`,
        });
      }
    } else {
      authUserId = newUser.user.id;
      console.log(
        `[invite-team-member] New user created: ${emailLower} (id: ${authUserId})`,
      );
    }

    // ── Look up practice_id for this org ──────────────────────────
    let practiceId: string | null = null;
    const { data: practiceRow } = await supabaseAdmin
      .from("practices")
      .select("id")
      .eq("organization_id", organization_id)
      .limit(1)
      .maybeSingle();
    if (practiceRow) practiceId = practiceRow.id;

    // ── Create team_members record ──────────────────────────────
    const { data: member, error: insertError } = await supabaseAdmin
      .from("team_members")
      .insert({
        organization_id,
        name,
        email: emailLower,
        role_type,
        specialization: specialization || null,
        practice_id: practiceId,
        invite_status: "pending",
        invited_by: caller.id,
        user_id: authUserId,
        invite_expires_at: new Date(
          Date.now() + 7 * 24 * 60 * 60 * 1000,
        ).toISOString(),
      })
      .select("id, invite_token")
      .single();

    if (insertError) {
      console.error("[invite-team-member] Insert error:", insertError);
      return jsonOk({
        success: false,
        error: `Failed to create invitation: ${insertError.message}`,
      });
    }

    // ── Create user_role + set profile org (so user goes to dashboard, not onboarding) ──
    if (authUserId) {
      const permRole =
        app_role === "owner" || app_role === "admin" || app_role === "member"
          ? app_role
          : "member";

      // Check if user_role already exists
      const { data: existingRole } = await supabaseAdmin
        .from("user_roles")
        .select("id")
        .eq("user_id", authUserId)
        .eq("organization_id", organization_id)
        .maybeSingle();

      if (!existingRole) {
        const { error: roleErr } = await supabaseAdmin
          .from("user_roles")
          .insert({
            user_id: authUserId,
            organization_id,
            role: permRole,
            custom_role_id: custom_role_id || null,
          });
        if (roleErr)
          console.error(
            "[invite-team-member] user_role insert error:",
            roleErr,
          );
        else
          console.log(
            `[invite-team-member] user_role created: ${authUserId} → ${organization_id} (${permRole}, custom_role: ${custom_role_id})`,
          );
      }

      // Set current_organization_id on profile — only if not already set (don't overwrite for multi-org users).
      // Use upsert for new profiles, but preserve existing org if already set.
      const { data: existingProfile } = await supabaseAdmin
        .from("profiles")
        .select("current_organization_id")
        .eq("user_id", authUserId)
        .maybeSingle();

      if (!existingProfile) {
        // No profile yet — create it
        await supabaseAdmin
          .from("profiles")
          .insert({
            user_id: authUserId,
            current_organization_id: organization_id,
            email: emailLower,
            full_name: name,
          });
      } else if (!existingProfile.current_organization_id) {
        // Profile exists but no org set — set it
        await supabaseAdmin
          .from("profiles")
          .update({ current_organization_id: organization_id })
          .eq("user_id", authUserId);
      }
      // If profile already has an org, leave it — user can switch via org switcher
    }

    // ── Create provider records if practice role is not "Other" ──
    // One provider per location (or one with null location if none selected)
    const nonProviderRoles = ["other", "receptionist", "practice manager"];
    if (!nonProviderRoles.includes(role_type.toLowerCase())) {
      const locs =
        location_ids && location_ids.length > 0 ? location_ids : [null];

      for (const locId of locs) {
        // Check if provider already exists for this email + location
        let existingQuery = supabaseAdmin
          .from("providers")
          .select("id")
          .eq("organization_id", organization_id)
          .eq("email", emailLower);
        if (locId) existingQuery = existingQuery.eq("location_id", locId);

        const { data: existingProvider } = await existingQuery.maybeSingle();

        if (!existingProvider) {
          const { error: providerErr } = await supabaseAdmin
            .from("providers")
            .insert({
              organization_id,
              name,
              email: emailLower,
              provider_role: role_type,
              location_id: locId,
              is_active: true,
              user_id: authUserId,
            });
          if (providerErr) {
            console.error(
              "[invite-team-member] Provider insert error:",
              providerErr,
            );
          } else {
            console.log(
              `[invite-team-member] Provider created: ${name} (${role_type}) at ${locId}`,
            );
          }
        }
      }
    }

    // ── Send email ──────────────────────────────────────────────
    const inviteLink = `${app_url}/invite/${member.invite_token}`;

    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
    });

    const emailHtml = generateEmailHtml({
      inviterName: inviter_name,
      organizationName: organization_name,
      roleName: role_type,
      inviteLink,
      email: emailLower,
      password: generatedPassword,
      isExistingUser,
    });

    await transporter.sendMail({
      from: `"${SMTP_FROM_NAME}" <${SMTP_FROM_EMAIL}>`,
      to: emailLower,
      subject: `${inviter_name} invited you to join ${organization_name} on DentPulse`,
      html: emailHtml,
    });

    console.log(
      `[invite-team-member] Email sent to ${emailLower} (existing: ${isExistingUser})`,
    );

    if (CENTRAL_AUTH_BASE_URL && PASSWORD_SYNC_SECRET && authUserId) {
      const adminRoles = ["owner", "admin"];
      const roleMapping = adminRoles.includes(app_role) ? "admin" : "member";
      const nameParts = (name || "").trim().split(" ");

      // Look up custom_role_name if custom_role_id was provided
      let customRoleName: string | null = null;
      if (custom_role_id) {
        const { data: roleData } = await supabaseAdmin
          .from("custom_roles")
          .select("name")
          .eq("id", custom_role_id)
          .maybeSingle();
        customRoleName = roleData?.name || null;
      }

      fetch(`${CENTRAL_AUTH_BASE_URL}/auth/register-user`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": PASSWORD_SYNC_SECRET,
        },
        body: JSON.stringify({
          email: emailLower,
          first_name: nameParts[0] || null,
          last_name: nameParts.slice(1).join(" ") || null,
          full_name: name || null,
          phone: null,
          password: generatedPassword || null,
          platform: "dentalpulse",
          platform_user_id: authUserId,
          tenant_name: organization_name || null,
          tenant_id: organization_id || null,
          role: roleMapping,
          role_type: role_type || null,
          custom_role_name: customRoleName,
        }),
      })
        .then((r) => r.json().catch(() => ({})))
        .then(async (data) => {
          const centralAuthId = data?.data?.user_id;
          console.log(
            `[invite-team-member] Central Auth sync done for ${emailLower}: central_auth_id=${centralAuthId}`,
          );
          // Store universal ID in profiles table
          if (centralAuthId && authUserId) {
            await supabaseAdmin
              .from("profiles")
              .update({ central_auth_id: centralAuthId })
              .eq("user_id", authUserId)
              .is("central_auth_id", null);
          }
        })
        .catch((err) =>
          console.error(
            `[invite-team-member] Central Auth sync error for ${emailLower}:`,
            err.message,
          ),
        );
    }

    return jsonOk({
      success: true,
      member_id: member.id,
      auth_user_id: authUserId,
      is_existing_user: isExistingUser,
      generated_password: isExistingUser ? null : generatedPassword,
      message: `Invitation sent to ${emailLower}`,
    });
  } catch (err) {
    console.error("[invite-team-member] Unhandled error:", err);
    return jsonOk({
      success: false,
      error: `Something went wrong: ${err.message}`,
    });
  }
});
