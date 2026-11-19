import type { Request, Response } from 'express';
import { config } from '../../config/env';
import { CSRF_COOKIE, setAuthCookies } from '../../utils/cookies';
import { hashOpaqueToken, safeEqualStrings } from '../../utils/crypto';
import { normalizeEmail } from '../../utils/email';
import { AppError } from '../../utils/errors';
import { asyncHandler } from '../../utils/asyncHandler';
import { getClientIp, getUserAgent } from '../../utils/pagination';
import { loginUser } from '../auth/auth.service';
import {
  approveAuthorizationRequest,
  createAuthorizationRequest,
  denyAuthorizationRequest,
  exchangeAuthorizationCode,
  listConnectableOrganizations,
  loadBindingRequest,
  revokeIntegrationToken,
  rotateRefreshToken,
  toTokenResponse,
} from './integration.oauth.service';
import {
  renderConsentPage,
  renderErrorPage,
  renderLoginPage,
} from './integration.page';
import {
  oauthAuthorizeQuerySchema,
  oauthDecisionBodySchema,
  oauthLoginBodySchema,
  oauthRevokeBodySchema,
  oauthTokenBodySchema,
} from './integration.schemas';
import type { AuditContext } from '../screenshots/audit.service';

/**
 * Content-Security-Policy for the consent page. It matches the default policy except form-action, which
 * also allows the origin of the partner's registered redirect URI. The consent form redirects there
 * after approval, and Chrome checks that redirect against form-action.
 */
function consentFormActionCsp(redirectUri: string): string {
  const redirectOrigin = new URL(redirectUri).origin;
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "font-src 'self' https: data:",
    `form-action 'self' ${redirectOrigin}`,
    "frame-ancestors 'self'",
    "img-src 'self' data:",
    "object-src 'none'",
    "script-src 'self'",
    "script-src-attr 'none'",
    "style-src 'self' https: 'unsafe-inline'",
    'upgrade-insecure-requests',
  ].join('; ');
}

function sendHtml(res: Response, status: number, html: string): void {
  res.status(status);
  res.set({
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    Pragma: 'no-cache',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
  });
  res.send(html);
}

function bindingCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.auth.cookie.secure,
    domain: config.auth.cookie.domain,
    path: '/api/v1/integrations',
  };
}

function auditContext(req: Request): AuditContext {
  return { ipAddress: getClientIp(req), userAgent: getUserAgent(req) };
}

function bindingFrom(req: Request): string | undefined {
  const value: unknown = req.cookies?.[config.integrations.bindingCookie];
  return typeof value === 'string' ? value : undefined;
}

/**
 * CSRF token for the hosted sign-in form. It is an HMAC, keyed with the server's token pepper, over the
 * authorisation request id and the HTTP-only binding cookie value. Nothing is stored, so it needs no
 * session. Only a page served to this browser can know it, because a cross-site page cannot read the
 * binding cookie or the form. It is not a session token: the consent form still uses the session CSRF
 * token, and the two derivations are different.
 */
function hostedLoginCsrfToken(requestId: string, rawBinding: string): string {
  return hashOpaqueToken(`hosted-login-csrf|${requestId}|${rawBinding}`, config.auth.tokenPepper);
}

/**
 * Entry point of the hosted OAuth authorization flow. Always renders HTML: the
 * redirect URI is owned by the partner and never used for local error display.
 */
export const authorize = asyncHandler(async (req: Request, res: Response) => {
  if (!config.integrations.enabled) {
    sendHtml(
      res,
      404,
      renderErrorPage({
        title: 'Integration is not enabled',
        message: 'This WorkZen deployment has not enabled partner integrations.',
      }),
    );
    return;
  }

  const parsed = oauthAuthorizeQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    sendHtml(
      res,
      400,
      renderErrorPage({
        title: 'Invalid authorization request',
        message: parsed.error.issues.map((issue) => issue.message).join('. '),
      }),
    );
    return;
  }

  let created;
  try {
    created = await createAuthorizationRequest({
      clientId: parsed.data.client_id,
      redirectUri: parsed.data.redirect_uri,
      scope: parsed.data.scope,
      state: parsed.data.state,
      codeChallenge: parsed.data.code_challenge,
      externalOrganizationId: parsed.data.external_organization_id,
    });
  } catch (error) {
    const message = error instanceof AppError ? error.message : 'Unable to start authorization';
    sendHtml(res, 400, renderErrorPage({ title: 'Authorization could not start', message }));
    return;
  }

  res.cookie(config.integrations.bindingCookie, created.bindingToken, {
    ...bindingCookieOptions(),
    maxAge: config.integrations.authRequestTtlSeconds * 1000,
  });

  if (!req.auth) {
    sendHtml(
      res,
      200,
      renderLoginPage({
        request: created.request,
        client: created.client,
        csrfToken: hostedLoginCsrfToken(created.request.id, created.bindingToken),
      }),
    );
    return;
  }

  const organizations = await listConnectableOrganizations(req.auth.user.id);
  if (organizations.length === 0) {
    sendHtml(
      res,
      403,
      renderErrorPage({
        title: 'No eligible organization',
        message:
          'You must be an owner or admin of an active WorkZen organization to connect an integration.',
      }),
    );
    return;
  }

  const csrfToken: unknown = req.cookies?.[CSRF_COOKIE];
  res.set('Content-Security-Policy', consentFormActionCsp(created.request.redirectUri));
  sendHtml(
    res,
    200,
    renderConsentPage({
      request: created.request,
      client: created.client,
      userEmail: req.auth.user.email,
      csrfToken: typeof csrfToken === 'string' ? csrfToken : null,
      organizations,
    }),
  );
});

/** Hosted-page login. Reuses the existing WorkZen credential check verbatim. */
export const authorizeLogin = asyncHandler(async (req: Request, res: Response) => {
  const parsed = oauthLoginBodySchema.safeParse(req.body);
  if (!parsed.success) {
    sendHtml(
      res,
      400,
      renderErrorPage({
        title: 'Invalid sign-in request',
        message: parsed.error.issues.map((issue) => issue.message).join('. '),
      }),
    );
    return;
  }

  // Login CSRF check. It runs before any password is read, and a mismatch changes nothing.
  const binding = bindingFrom(req);
  const expectedCsrf = binding
    ? hostedLoginCsrfToken(parsed.data.authorization_request_id, binding)
    : null;
  if (!expectedCsrf || !safeEqualStrings(expectedCsrf, parsed.data._csrf)) {
    sendHtml(
      res,
      403,
      renderErrorPage({
        title: 'Sign-in form expired',
        message: 'Reload the page and sign in again.',
      }),
    );
    return;
  }

  let loaded;
  try {
    loaded = await loadBindingRequest(parsed.data.authorization_request_id, bindingFrom(req));
  } catch (error) {
    const message = error instanceof AppError ? error.message : 'Unable to resume authorization';
    sendHtml(res, 400, renderErrorPage({ title: 'Authorization expired', message }));
    return;
  }

  try {
    const result = await loginUser(
      {
        email: normalizeEmail(parsed.data.email),
        password: parsed.data.password,
        client: 'browser',
      },
      req,
    );

    setAuthCookies(res, {
      accessToken: result.issued.accessToken,
      refreshToken: result.issued.refreshToken,
      csrfToken: result.issued.csrfToken,
      accessExpiresAt: result.issued.accessExpiresAt,
      refreshExpiresAt: result.issued.refreshExpiresAt,
    });

    const organizations = await listConnectableOrganizations(result.user.id);
    if (organizations.length === 0) {
      sendHtml(
        res,
        403,
        renderErrorPage({
          title: 'No eligible organization',
          message:
            'You must be an owner or admin of an active WorkZen organization to connect an integration.',
        }),
      );
      return;
    }

    res.set('Content-Security-Policy', consentFormActionCsp(loaded.request.redirectUri));
    sendHtml(
      res,
      200,
      renderConsentPage({
        request: loaded.request,
        client: loaded.client,
        userEmail: result.user.email,
        csrfToken: result.issued.csrfToken,
        organizations,
      }),
    );
  } catch (error) {
    const message =
      error instanceof AppError ? error.message : 'Sign-in failed. Check your credentials.';
    sendHtml(
      res,
      error instanceof AppError && error.statusCode === 429 ? 429 : 401,
      renderLoginPage({
        request: loaded.request,
        client: loaded.client,
        csrfToken: expectedCsrf,
        error: message,
      }),
    );
  }
});

export const authorizeDecision = asyncHandler(async (req: Request, res: Response) => {
  if (!req.auth) {
    sendHtml(
      res,
      400,
      renderErrorPage({
        title: 'Decision could not be recorded',
        message: 'Your session has expired. Start the connection again from Flowtrium.',
      }),
    );
    return;
  }

  const parsed = oauthDecisionBodySchema.safeParse(req.body);
  if (!parsed.success) {
    sendHtml(
      res,
      400,
      renderErrorPage({
        title: 'Decision could not be recorded',
        message: parsed.error.issues.map((issue) => issue.message).join('. '),
      }),
    );
    return;
  }

  let loaded;
  try {
    loaded = await loadBindingRequest(parsed.data.authorization_request_id, bindingFrom(req));
  } catch (error) {
    const message = error instanceof AppError ? error.message : 'Unable to resume authorization';
    sendHtml(res, 400, renderErrorPage({ title: 'Authorization expired', message }));
    return;
  }

  try {
    if (parsed.data.decision === 'approve') {
      const result = await approveAuthorizationRequest({
        request: loaded.request,
        userId: req.auth.user.id,
        organizationId: parsed.data.organization_id,
        context: auditContext(req),
      });
      res.clearCookie(config.integrations.bindingCookie, bindingCookieOptions());
      res.redirect(302, result.redirectUrl);
      return;
    }

    const result = await denyAuthorizationRequest({
      request: loaded.request,
      userId: req.auth.user.id,
      organizationId: parsed.data.organization_id,
      context: auditContext(req),
    });
    res.clearCookie(config.integrations.bindingCookie, bindingCookieOptions());
    res.redirect(302, result.redirectUrl);
  } catch (error) {
    const message = error instanceof AppError ? error.message : 'Unable to complete authorization';
    sendHtml(res, 400, renderErrorPage({ title: 'Authorization failed', message }));
  }
});

export const token = asyncHandler(async (req: Request, res: Response) => {
  const parsed = oauthTokenBodySchema.safeParse(req.body);
  if (!parsed.success) {
    throw AppError.badRequest(
      parsed.error.issues.map((issue) => issue.message).join('. '),
      'INVALID_REQUEST',
    );
  }

  if (parsed.data.grant_type === 'authorization_code') {
    const issued = await exchangeAuthorizationCode({
      body: parsed.data,
      context: auditContext(req),
    });
    res.set('Cache-Control', 'no-store');
    res.status(200).json(toTokenResponse(issued));
    return;
  }

  const issued = await rotateRefreshToken({ body: parsed.data });
  res.set('Cache-Control', 'no-store');
  res.status(200).json(toTokenResponse(issued));
});

export const revoke = asyncHandler(async (req: Request, res: Response) => {
  const parsed = oauthRevokeBodySchema.safeParse(req.body);
  if (!parsed.success) {
    throw AppError.badRequest(
      parsed.error.issues.map((issue) => issue.message).join('. '),
      'INVALID_REQUEST',
    );
  }
  await revokeIntegrationToken({ body: parsed.data });
  res.status(200).json({ data: { revoked: true } });
});
