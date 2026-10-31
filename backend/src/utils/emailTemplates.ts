export type EmailTemplate = {
  subject: string;
  html: string;
  text: string;
};

export type InvitationEmailInput = {
  organizationName: string;
  invitedEmail: string;
  roleLabel: string;
  inviterName?: string | null;
  acceptUrl: string;
  expiresAt: Date;
};

export type PasswordResetEmailInput = {
  name: string;
  resetUrl: string;
  expiresAt: Date;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatExpiry(expiresAt: Date): string {
  return expiresAt.toUTCString();
}

function layout(options: {
  preheader: string;
  heading: string;
  bodyHtml: string;
  actionLabel: string;
  actionUrl: string;
  expiryText: string;
  footerHtml: string;
}): string {
  const { preheader, heading, bodyHtml, actionLabel, actionUrl, expiryText, footerHtml } = options;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(heading)}</title>
  </head>
  <body style="margin:0;padding:0;background:#f5f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1c1917;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f4;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e7e5e4;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="padding:24px 28px;border-bottom:1px solid #e7e5e4;background:#ffffff;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="width:36px;height:36px;background:#1c1917;border-radius:8px;color:#ffffff;font-size:16px;font-weight:600;text-align:center;vertical-align:middle;">T</td>
                    <td style="padding-left:12px;">
                      <div style="font-size:15px;font-weight:600;letter-spacing:-0.01em;">TempoNest</div>
                      <div style="font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:#78716c;">Work portal</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;">
                <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;letter-spacing:-0.02em;">${escapeHtml(heading)}</h1>
                <div style="font-size:14px;line-height:1.65;color:#44403c;">${bodyHtml}</div>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
                  <tr>
                    <td style="border-radius:8px;background:#1c1917;">
                      <a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:12px 20px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">${escapeHtml(actionLabel)}</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 8px;font-size:12px;line-height:1.6;color:#78716c;">
                  This link expires on <strong style="color:#44403c;">${escapeHtml(expiryText)}</strong>.
                </p>
                <p style="margin:0;font-size:12px;line-height:1.6;color:#78716c;">
                  If the button does not work, copy this address into your browser:<br />
                  <span style="word-break:break-all;color:#44403c;">${escapeHtml(actionUrl)}</span>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px;border-top:1px solid #e7e5e4;background:#fafaf9;font-size:11px;line-height:1.6;color:#78716c;">
                ${footerHtml}
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0;font-size:11px;color:#a8a29e;">TempoNest · Attendance and team time</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function invitationEmail(input: InvitationEmailInput): EmailTemplate {
  const organization = escapeHtml(input.organizationName);
  const inviter = input.inviterName ? escapeHtml(input.inviterName) : 'An administrator';
  const role = escapeHtml(input.roleLabel);
  const expiry = formatExpiry(input.expiresAt);

  const bodyHtml = `
    <p style="margin:0 0 12px;">${inviter} invited you to join <strong>${organization}</strong> on TempoNest.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;border:1px solid #e7e5e4;border-radius:8px;background:#fafaf9;">
      <tr>
        <td style="padding:12px 16px;font-size:13px;color:#78716c;width:42%;">Organization</td>
        <td style="padding:12px 16px;font-size:13px;font-weight:600;color:#1c1917;">${organization}</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;font-size:13px;color:#78716c;border-top:1px solid #e7e5e4;">Invited email</td>
        <td style="padding:12px 16px;font-size:13px;font-weight:600;color:#1c1917;border-top:1px solid #e7e5e4;">${escapeHtml(input.invitedEmail)}</td>
      </tr>
      <tr>
        <td style="padding:12px 16px;font-size:13px;color:#78716c;border-top:1px solid #e7e5e4;">Assigned role</td>
        <td style="padding:12px 16px;font-size:13px;font-weight:600;color:#1c1917;border-top:1px solid #e7e5e4;">${role}</td>
      </tr>
    </table>
    <p style="margin:0;">Choose a password to activate your account. Your role is set by the organization and cannot be changed during onboarding.</p>
  `;

  const text = [
    `${inviter} invited you to join ${input.organizationName} on TempoNest.`,
    '',
    `Organization: ${input.organizationName}`,
    `Invited email: ${input.invitedEmail}`,
    `Assigned role: ${input.roleLabel}`,
    '',
    `Accept the invitation: ${input.acceptUrl}`,
    `This link expires on ${expiry}.`,
    '',
    'Your role is set by the organization and cannot be changed during onboarding.',
  ].join('\n');

  return {
    subject: `You're invited to join ${input.organizationName} on TempoNest`,
    html: layout({
      preheader: `Join ${input.organizationName} on TempoNest`,
      heading: `Join ${input.organizationName}`,
      bodyHtml,
      actionLabel: 'Accept invitation',
      actionUrl: input.acceptUrl,
      expiryText: expiry,
      footerHtml:
        'You received this e-mail because an administrator invited this address. If you were not expecting it, you can ignore this message and the invitation will expire.',
    }),
    text,
  };
}

export function passwordResetEmail(input: PasswordResetEmailInput): EmailTemplate {
  const name = input.name ? escapeHtml(input.name) : 'there';
  const expiry = formatExpiry(input.expiresAt);

  const bodyHtml = `
    <p style="margin:0 0 12px;">Hi ${name},</p>
    <p style="margin:0 0 12px;">We received a request to reset the password for your TempoNest account. Choose a new password to continue using your account.</p>
    <p style="margin:0;">This single-use link expires on <strong>${escapeHtml(expiry)}</strong>. Existing sign-ins are revoked once the password changes.</p>
  `;

  const text = [
    `Hi ${input.name || 'there'},`,
    '',
    'We received a request to reset the password for your TempoNest account.',
    '',
    `Reset your password: ${input.resetUrl}`,
    `This single-use link expires on ${expiry}.`,
    'Existing sign-ins are revoked once the password changes.',
    '',
    'If you did not request this, you can ignore this e-mail. Your password will not change.',
  ].join('\n');

  return {
    subject: 'Reset your TempoNest password',
    html: layout({
      preheader: 'Reset your TempoNest password',
      heading: 'Reset your password',
      bodyHtml,
      actionLabel: 'Reset password',
      actionUrl: input.resetUrl,
      expiryText: expiry,
      footerHtml:
        'Security notice: TempoNest will never ask for your password by e-mail. If you did not request this reset, ignore this message and consider telling your administrator.',
    }),
    text,
  };
}
