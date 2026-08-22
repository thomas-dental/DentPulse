const express = require('express');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const syncAuthMiddleware = require('../middleware/syncAuth');
const { supabaseAdmin } = require('../config/supabase');

const router = express.Router();

// ─── Password Generation (same algorithm as Edge Function) ───────────────────
function generatePassword(length = 12) {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%&*';
  const all = upper + lower + digits + symbols;
  const arr = crypto.randomBytes(length);
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
  return pw.join('');
}

// ─── Email HTML Template (same as Edge Function) ─────────────────────────────
function generateEmailHtml({ inviterName, organizationName, roleName, inviteLink, email, password, isExistingUser }) {
  const credentialsBlock = isExistingUser
    ? `<p style="margin: 0 0 24px; color: #4b5563; font-size: 15px; line-height: 1.6;">
        You already have a DentPulse account. Click below to sign in and join the organization.
      </p>`
    : `<div style="background-color: #f8f5ff; border: 1px solid #e9e0ff; border-radius: 8px; padding: 20px; margin: 0 0 24px;">
        <p style="margin: 0 0 12px; color: #111827; font-size: 14px; font-weight: 600;">Your login credentials:</p>
        <table style="width: 100%;">
          <tr>
            <td style="padding: 4px 0; color: #6b7280; font-size: 14px; width: 80px;">Email:</td>
            <td style="padding: 4px 0; color: #111827; font-size: 14px; font-weight: 500;">${email}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; color: #6b7280; font-size: 14px;">Password:</td>
            <td style="padding: 4px 0; color: #111827; font-size: 14px; font-family: monospace; font-weight: 500; letter-spacing: 0.5px;">${password}</td>
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
<strong>${inviterName}</strong> has invited you to join <strong>${organizationName}</strong> on DentPulse as a <strong>${roleName}</strong>.</p>
${credentialsBlock}
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:8px 0 32px;">
<a href="${inviteLink}" style="display:inline-block;background:linear-gradient(135deg,#6d28d9,#7c3aed);color:#ffffff;text-decoration:none;padding:14px 40px;border-radius:8px;font-size:15px;font-weight:600;">
${isExistingUser ? 'Sign In &amp; Join' : 'Accept Invitation'}</a></td></tr></table>
<p style="margin:0 0 8px;color:#6b7280;font-size:13px;">Or copy and paste this link:</p>
<p style="margin:0 0 24px;color:#7c3aed;font-size:13px;word-break:break-all;">${inviteLink}</p>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
<p style="margin:0;color:#9ca3af;font-size:12px;">This invitation expires in 7 days.</p>
</td></tr>
<tr><td style="background-color:#f9fafb;padding:20px 40px;text-align:center;border-top:1px solid #e5e7eb;">
<p style="margin:0;color:#9ca3af;font-size:12px;">Sent by DentPulse</p></td></tr>
</table></td></tr></table></body></html>`;
}

// ─── Create Nodemailer Transporter ───────────────────────────────────────────
function createMailTransporter() {
  const host = process.env.MAIL_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.MAIL_PORT || '587');
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: {
      user: process.env.MAIL_USERNAME || '',
      pass: process.env.MAIL_PASSWORD || '',
    },
  });
}

// ─── Sync to Central Auth (fire-and-forget) ──────────────────────────────────
function syncToCentralAuth({ email, name, password, authUserId, organizationName, organizationId, appRole, roleType, customRoleName, customRoleId }) {
  const baseUrl = process.env.CENTRAL_AUTH_BASE_URL;
  const apiKey = process.env.PASSWORD_SYNC_SECRET;
  if (!baseUrl || !apiKey) return;

  const adminRoles = ['owner', 'admin'];
  const roleMapping = adminRoles.includes(appRole) ? 'admin' : 'member';
  const nameParts = (name || '').trim().split(' ');

  fetch(`${baseUrl}/auth/register-user`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify({
      email: email.toLowerCase().trim(),
      first_name: nameParts[0] || null,
      last_name: nameParts.slice(1).join(' ') || null,
      full_name: name || null,
      phone: null,
      password: password || null,
      platform: 'dentalpulse',
      platform_user_id: authUserId || null,
      tenant_name: organizationName || null,
      tenant_id: organizationId || null,
      role: roleMapping,
      role_type: roleType || null,
      custom_role_name: customRoleName || null,
      source_role_id: customRoleId || null,
    }),
  })
    .then(r => r.json().catch(() => ({})))
    .then(data => {
      const centralAuthId = data?.data?.user_id;
      console.log(`[batch-invite] Central Auth sync done for ${email}: central_auth_id=${centralAuthId || 'n/a'}`);
      // Store universal ID in profiles table
      if (centralAuthId && authUserId) {
        supabaseAdmin
          .from('profiles')
          .update({ central_auth_id: centralAuthId })
          .eq('user_id', authUserId)
          .is('central_auth_id', null)
          .then(() => {})
          .catch(err => console.error(`[batch-invite] Failed to store central_auth_id for ${email}:`, err.message));
      }
    })
    .catch(err => console.error(`[batch-invite] Central Auth sync error for ${email}:`, err.message));
}

// ─── POST /api/team/batch-invite ─────────────────────────────────────────────
router.post('/batch-invite', syncAuthMiddleware, async (req, res) => {
  try {
    const { organization_id, organization_name, inviter_name, app_url, members } = req.body;

    // Validate required fields
    if (!organization_id || !members || !Array.isArray(members) || members.length === 0) {
      return res.status(400).json({ success: false, error: 'organization_id and members array are required' });
    }

    // Verify caller is org owner
    const { data: callerRole } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', req.user.id)
      .eq('organization_id', organization_id)
      .single();

    if (!callerRole || callerRole.role !== 'owner') {
      return res.status(403).json({ success: false, error: 'Only organization owners can invite team members' });
    }

    // Create mail transporter once for all emails
    const transporter = createMailTransporter();
    const fromName = process.env.MAIL_FROM_NAME || 'DentPulse';
    const fromEmail = process.env.MAIL_FROM_ADDRESS || process.env.MAIL_USERNAME || '';

    const results = [];

    // Process each member SEQUENTIALLY to avoid race conditions
    for (const member of members) {
      const { email, name, role_type, app_role, custom_role_id, location_ids, specialization } = member;

      if (!email || !name) {
        results.push({ email: email || 'unknown', success: false, error: 'email and name are required' });
        continue;
      }

      const emailLower = email.toLowerCase().trim();

      try {
        // ── Step 1: Check if already a team member ──────────────────
        const { data: existingMember } = await supabaseAdmin
          .from('team_members')
          .select('id, invite_status')
          .eq('organization_id', organization_id)
          .eq('email', emailLower)
          .in('invite_status', ['pending', 'accepted', 'active'])
          .maybeSingle();

        if (existingMember) {
          results.push({ email: emailLower, success: false, error: 'Already invited or is a team member' });
          continue;
        }

        // ── Step 2: Create or detect Supabase auth user ─────────────
        let isExistingUser = false;
        let authUserId = null;
        let generatedPassword = generatePassword(12);

        const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
          email: emailLower,
          password: generatedPassword,
          email_confirm: true,
          user_metadata: { full_name: name },
        });

        if (createError) {
          const errMsg = (createError.message || '').toLowerCase();
          if (errMsg.includes('already') || errMsg.includes('registered') || errMsg.includes('exists')) {
            isExistingUser = true;
            generatedPassword = '';

            // Find existing user ID from profiles
            const { data: profileRow } = await supabaseAdmin
              .from('profiles')
              .select('user_id')
              .eq('email', emailLower)
              .maybeSingle();

            authUserId = profileRow?.user_id || null;

            if (!authUserId) {
              // Try to get from auth.users via listUsers
              const { data: listData } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1 });
              // Fallback: we'll still create team_members without user_id linkage
            }
          } else {
            results.push({ email: emailLower, success: false, error: `Failed to create account: ${createError.message}` });
            continue;
          }
        } else {
          authUserId = newUser.user.id;
        }

        // ── Step 3: Insert team_members record ──────────────────────
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

        const { data: teamMember, error: tmError } = await supabaseAdmin
          .from('team_members')
          .insert({
            organization_id,
            name,
            email: emailLower,
            role_type: role_type || null,
            specialization: specialization || null,
            invite_status: 'pending',
            invited_by: req.user.id,
            user_id: authUserId,
            invite_expires_at: expiresAt,
          })
          .select('id, invite_token')
          .single();

        if (tmError) {
          results.push({ email: emailLower, success: false, error: `Failed to create invitation: ${tmError.message}` });
          continue;
        }

        // ── Step 4: Create user_roles ───────────────────────────────
        if (authUserId) {
          const permRole = app_role === 'owner' ? 'owner' : (app_role === 'admin' ? 'admin' : 'member');

          // Check if role already exists
          const { data: existingRole } = await supabaseAdmin
            .from('user_roles')
            .select('id')
            .eq('user_id', authUserId)
            .eq('organization_id', organization_id)
            .maybeSingle();

          if (!existingRole) {
            await supabaseAdmin
              .from('user_roles')
              .insert({
                user_id: authUserId,
                organization_id,
                role: permRole,
                custom_role_id: custom_role_id || null,
              });
          }
        }

        // ── Step 5: Upsert profile ──────────────────────────────────
        if (authUserId) {
          const { data: existingProfile } = await supabaseAdmin
            .from('profiles')
            .select('id, current_organization_id')
            .eq('id', authUserId)
            .maybeSingle();

          if (!existingProfile) {
            // Create profile
            await supabaseAdmin
              .from('profiles')
              .insert({
                id: authUserId,
                user_id: authUserId,
                email: emailLower,
                full_name: name,
                current_organization_id: organization_id,
              });
          } else if (!existingProfile.current_organization_id) {
            // Set org if not already set
            await supabaseAdmin
              .from('profiles')
              .update({ current_organization_id: organization_id })
              .eq('id', authUserId);
          }
        }

        // ── Step 6: Create providers ────────────────────────────────
        const nonProviderRoles = ['other', 'receptionist', 'practice manager'];
        if (!nonProviderRoles.includes((role_type || '').toLowerCase())) {
          const locations = (location_ids && location_ids.length > 0) ? location_ids : [null];

          for (const locationId of locations) {
            // Check if provider already exists
            const matchQuery = supabaseAdmin
              .from('providers')
              .select('id')
              .eq('organization_id', organization_id)
              .eq('email', emailLower);

            if (locationId) {
              matchQuery.eq('location_id', locationId);
            }

            const { data: existingProvider } = await matchQuery.maybeSingle();

            if (!existingProvider) {
              await supabaseAdmin
                .from('providers')
                .insert({
                  organization_id,
                  name,
                  email: emailLower,
                  provider_role: role_type || 'Other',
                  location_id: locationId,
                  user_id: authUserId,
                  is_active: true,
                });
            }
          }
        }

        // ── Step 7: Send invitation email ───────────────────────────
        if (teamMember.invite_token) {
          const inviteLink = `${app_url || 'http://localhost:5173'}/invite/${teamMember.invite_token}`;
          const emailHtml = generateEmailHtml({
            inviterName: inviter_name || 'Your team admin',
            organizationName: organization_name || 'your organization',
            roleName: role_type || 'Team Member',
            inviteLink,
            email: emailLower,
            password: generatedPassword,
            isExistingUser,
          });

          try {
            await transporter.sendMail({
              from: `"${fromName}" <${fromEmail}>`,
              to: emailLower,
              subject: `${inviter_name || 'Your admin'} invited you to join ${organization_name || 'the team'} on DentPulse`,
              html: emailHtml,
            });
            console.log(`[batch-invite] Email sent to ${emailLower}`);
          } catch (emailErr) {
            console.error(`[batch-invite] Email failed for ${emailLower}:`, emailErr.message);
            // Don't fail the member — invite token exists, can resend later
          }
        }

        // ── Step 8: Central Auth sync (fire-and-forget) ─────────────
        // Look up custom role name for Central Auth
        let customRoleName = null;
        if (custom_role_id) {
          const { data: roleData } = await supabaseAdmin
            .from('custom_roles')
            .select('name')
            .eq('id', custom_role_id)
            .maybeSingle();
          customRoleName = roleData?.name || null;
        }

        syncToCentralAuth({
          email: emailLower,
          name,
          password: generatedPassword || null,
          authUserId,
          organizationName: organization_name,
          organizationId: organization_id,
          appRole: app_role || 'member',
          roleType: role_type,
          customRoleName,
          customRoleId: custom_role_id || null,
        });

        results.push({
          email: emailLower,
          success: true,
          member_id: teamMember.id,
          auth_user_id: authUserId,
          is_existing_user: isExistingUser,
        });

        console.log(`[batch-invite] ✓ ${emailLower} (${isExistingUser ? 'existing' : 'new'} user)`);

      } catch (memberErr) {
        console.error(`[batch-invite] ✗ ${emailLower}:`, memberErr.message);
        results.push({ email: emailLower, success: false, error: memberErr.message });
      }
    }

    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    console.log(`[batch-invite] Complete: ${succeeded} succeeded, ${failed} failed out of ${results.length} total`);

    return res.json({
      success: true,
      summary: { total: results.length, succeeded, failed },
      results,
    });

  } catch (err) {
    console.error('[batch-invite] Fatal error:', err.message);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;
