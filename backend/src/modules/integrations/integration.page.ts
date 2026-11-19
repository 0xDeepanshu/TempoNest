import { INTEGRATION_SCOPE_DESCRIPTIONS, type IntegrationScope } from './integration.constants';
import type { IntegrationAuthorizationRequest } from './integrationAuthorizationRequest.model';
import type { IntegrationClient } from './integrationClient.model';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>${escapeHtml(title)} · WorkZen</title>
  <style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100vh; display: grid; place-items: center;
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      background: #f4f5f7; color: #1c2430; padding: 24px;
    }
    .card {
      width: 100%; max-width: 440px; background: #fff; border-radius: 14px;
      border: 1px solid #e2e6ec; box-shadow: 0 12px 32px rgba(20, 32, 50, .08);
      padding: 28px;
    }
    h1 { font-size: 1.25rem; margin: 0 0 6px; }
    p { line-height: 1.5; margin: 0 0 16px; color: #46536a; font-size: .95rem; }
    .brand { font-weight: 700; letter-spacing: .02em; color: #2f5bea; margin-bottom: 18px; }
    label { display: block; font-size: .85rem; font-weight: 600; margin: 14px 0 6px; }
    input[type=email], input[type=password] {
      width: 100%; padding: 10px 12px; border: 1px solid #cbd3df; border-radius: 8px;
      font-size: 1rem; background: #fff; color: inherit;
    }
    .actions { display: flex; gap: 10px; margin-top: 22px; }
    button {
      flex: 1; padding: 11px 14px; border-radius: 9px; border: 1px solid transparent;
      font-weight: 600; font-size: .95rem; cursor: pointer;
    }
    .primary { background: #2f5bea; color: #fff; }
    .secondary { background: #fff; color: #34415a; border-color: #cbd3df; }
    .danger { background: #fff; color: #a32020; border-color: #e3b4b4; }
    .scopes { margin: 0; padding: 0; list-style: none; }
    .scopes li { border: 1px solid #e2e6ec; border-radius: 9px; padding: 10px 12px; margin-bottom: 8px; }
    .scopes strong { font-size: .9rem; }
    .scopes span { display: block; color: #5b6880; font-size: .82rem; margin-top: 2px; }
    .meta { background: #f7f9fc; border-radius: 9px; padding: 12px; font-size: .85rem; color: #46536a; }
    .meta code { color: #1c2430; word-break: break-all; }
    .error { background: #fdf1f1; border: 1px solid #f0c9c9; color: #8a1f1f; padding: 10px 12px; border-radius: 8px; font-size: .88rem; }
    .footer { margin-top: 18px; font-size: .75rem; color: #7a869c; line-height: 1.45; }
  </style>
</head>
<body>
  <main class="card">
    <div class="brand">WorkZen</div>
    ${body}
  </main>
</body>
</html>`;
}

export function renderLoginPage(options: {
  request: IntegrationAuthorizationRequest;
  client: IntegrationClient;
  csrfToken: string;
  error?: string;
}): string {
  const { request, client, csrfToken, error } = options;
  return layout(
    'Connect an integration',
    `<h1>Sign in to connect ${escapeHtml(client.name)}</h1>
     <p>${escapeHtml(client.name)} is requesting read-only attendance access. Sign in to a WorkZen account that can manage integrations for your organization.</p>
     ${error ? `<div class="error" role="alert">${escapeHtml(error)}</div>` : ''}
     <form method="post" action="/api/v1/integrations/oauth/authorize/login" autocomplete="on">
       <input type="hidden" name="authorization_request_id" value="${escapeHtml(request.id)}">
       <input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}">
       <label for="email">Email</label>
       <input id="email" name="email" type="email" required autocomplete="username">
       <label for="password">Password</label>
       <input id="password" name="password" type="password" required autocomplete="current-password">
       <div class="actions">
         <button class="primary" type="submit">Sign in</button>
       </div>
     </form>
     <p class="footer">This page is served by WorkZen. Your Flowtrium password is never used here, and WorkZen never shares your session cookie with ${escapeHtml(client.name)}.</p>`,
  );
}

export function renderConsentPage(options: {
  request: IntegrationAuthorizationRequest;
  client: IntegrationClient;
  userEmail: string;
  csrfToken: string | null;
  organizations: { id: string; name: string }[];
  error?: string;
}): string {
  const { request, client, userEmail, csrfToken, organizations, error } = options;
  const scopes = request.scopes
    .filter((scope): scope is IntegrationScope => scope in INTEGRATION_SCOPE_DESCRIPTIONS)
    .map(
      (scope) =>
        `<li><strong>${escapeHtml(scope)}</strong><span>${escapeHtml(
          INTEGRATION_SCOPE_DESCRIPTIONS[scope],
        )}</span></li>`,
    )
    .join('');

  const organizationField =
    organizations.length === 1
      ? `<input type="hidden" name="organization_id" value="${escapeHtml(
          organizations[0]!.id,
        )}"><div class="meta">Connecting <strong>${escapeHtml(
          organizations[0]!.name,
        )}</strong></div>`
      : `<label for="organization_id">Organization</label>
         <select id="organization_id" name="organization_id" required>
           ${organizations
             .map(
               (organization) =>
                 `<option value="${escapeHtml(organization.id)}">${escapeHtml(
                   organization.name,
                 )}</option>`,
             )
             .join('')}
         </select>`;

  const csrfField = csrfToken
    ? `<input type="hidden" name="_csrf" value="${escapeHtml(csrfToken)}">`
    : '';

  return layout(
    'Approve connection',
    `<h1>Connect ${escapeHtml(client.name)}</h1>
     <p>Signed in as <strong>${escapeHtml(userEmail)}</strong>. ${escapeHtml(
       client.name,
     )} will be able to read attendance data for employees you explicitly map. It cannot change attendance, users, roles or monitoring settings.</p>
     ${error ? `<div class="error" role="alert">${escapeHtml(error)}</div>` : ''}
     <div class="meta">Redirects to <code>${escapeHtml(
       new URL(request.redirectUri).host,
     )}</code></div>
     <h2 style="font-size:.95rem;margin:18px 0 8px;">Requested access</h2>
     <ul class="scopes">${scopes}</ul>
     <form method="post" action="/api/v1/integrations/oauth/authorize/decision">
       ${csrfField}
       <input type="hidden" name="authorization_request_id" value="${escapeHtml(request.id)}">
       ${organizationField}
       <div class="actions">
         <button class="secondary" type="submit" name="decision" value="deny">Deny</button>
         <button class="primary" type="submit" name="decision" value="approve">Approve</button>
       </div>
     </form>
     <p class="footer">You can disconnect this integration at any time from the organization's integration settings. Redirecting back to ${escapeHtml(
       new URL(request.redirectUri).host,
     )} after your decision.</p>`,
  );
}

export function renderErrorPage(options: { title: string; message: string }): string {
  return layout(
    options.title,
    `<h1>${escapeHtml(options.title)}</h1>
     <p>${escapeHtml(options.message)}</p>
     <p class="footer">No changes were made. You can close this window and try again from ${escapeHtml(
       'the application',
     )}.</p>`,
  );
}
