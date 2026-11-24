import type { Request, Response } from 'express';
import { config } from '../../config/env';
import { CSRF_COOKIE, setAuthCookies } from '../../utils/cookies';
import { hashOpaqueToken, safeEqualStrings } from '../../utils/crypto';
import { normalizeEmail } from '../../utils/email';
import { AppError } from '../../utils/errors';
import { asyncHandler } from '../../utils/asyncHandler';
import { loginUser } from '../auth/auth.service';
import { integrationAuditContext } from './integration.http';
import {
  renderErrorPage,
  renderViewerLinkConsentPage,
  renderViewerLinkDonePage,
  renderViewerLinkLoginPage,
  renderViewerLinkShellPage,
  VIEWER_LINK_SCRIPT,
  type ViewerLinkPageDetails,
} from './integration.page';
import {
  viewerLinkApproveQuerySchema,
  viewerLinkDecisionBodySchema,
  viewerLinkLoginBodySchema,
  viewerLinkOpenBodySchema,
} from './integration.schemas';
import {
  assertEligibleLinkOwner,
  completeViewerLinkRequest,
  createViewerLinkRequest,
  decideViewerLinkRequest,
  getViewerLinkStatus,
  listViewerLinks,
  loadApprovalContext,
  openViewerLinkRequest,
  revokeViewerLinkById,
  revokeViewerLinkForExternalUser,
  type ApprovalPageData,
} from './integration.viewerLink.service';

// --- Hosted approval pages (WorkZen browser) ----------------------------------------------------

const BINDING_COOKIE = 'tn_viewer_link_binding';

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
    path: '/api/v1/integrations/viewer-links',
  };
}

function bindingFrom(req: Request): string | undefined {
  const value: unknown = req.cookies?.[BINDING_COOKIE];
  return typeof value === 'string' ? value : undefined;
}

/** Login CSRF for the hosted form: an HMAC over the request id and the HTTP-only binding value. */
function loginCsrfToken(requestId: string, rawBinding: string): string {
  return hashOpaqueToken(`viewer-link-login-csrf|${requestId}|${rawBinding}`, config.auth.tokenPepper);
}

function detailsFrom(data: ApprovalPageData): ViewerLinkPageDetails {
  return {
    clientName: data.clientName,
    workzenOrganizationName: data.workzenOrganizationName,
    externalOrganizationLabel: data.request.externalOrganizationLabel,
    externalOrganizationId: data.externalOrganizationId,
    externalUserLabel: data.request.externalUserLabel,
    externalUserId: data.request.externalUserId,
    expiresAt: data.request.expiresAt,
  };
}

function errorStatus(error: unknown): number {
  return error instanceof AppError ? error.statusCode : 400;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof AppError ? error.message : fallback;
}

/** Shows the consent page, or the exact reason this person cannot approve. */
async function renderConsentOrReason(options: {
  res: Response;
  data: ApprovalPageData;
  userId: string;
  userName: string;
  userEmail: string;
  csrfToken: string | null;
}): Promise<void> {
  const { res, data, userId, userName, userEmail, csrfToken } = options;
  try {
    await assertEligibleLinkOwner({ userId, organizationId: data.request.organizationId });
  } catch (error) {
    sendHtml(
      res,
      403,
      renderErrorPage({
        title: 'This account cannot approve the link',
        message: errorMessage(error, 'This account cannot approve the link.'),
      }),
    );
    return;
  }
  sendHtml(
    res,
    200,
    renderViewerLinkConsentPage({
      requestId: data.request.id,
      details: detailsFrom(data),
      userName,
      userEmail,
      csrfToken,
    }),
  );
}

const SCRIPT_PATH = `${config.apiPrefix}/integrations/viewer-links/approve.js`;

/** Static, secret-free script that exchanges the fragment nonce for the real approval page. */
export const viewerLinkApproveScript = asyncHandler(async (_req: Request, res: Response) => {
  res.status(200);
  res.set({
    'Content-Type': 'application/javascript; charset=utf-8',
    'Cache-Control': 'public, max-age=300',
    'X-Content-Type-Options': 'nosniff',
  });
  res.send(VIEWER_LINK_SCRIPT);
});

/**
 * GET: the page the approval link opens. It contains no secret and reads no nonce, so a query string
 * (which is what access logs and Referer headers can contain) never carries anything usable.
 */
export const viewerLinkApprovePage = asyncHandler(async (req: Request, res: Response) => {
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
  const parsed = viewerLinkApproveQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    sendHtml(
      res,
      400,
      renderErrorPage({ title: 'Invalid link', message: 'This approval link is not valid.' }),
    );
    return;
  }
  sendHtml(res, 200, renderViewerLinkShellPage({ requestId: parsed.data.request, scriptPath: SCRIPT_PATH }));
});

/** POST: exchanges the one-time nonce (request body, never URL) and opens the sign-in or consent page. */
export const viewerLinkOpen = asyncHandler(async (req: Request, res: Response) => {
  if (!config.integrations.enabled || !config.integrations.liveScreensEnabled) {
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
  const parsed = viewerLinkOpenBodySchema.safeParse(req.body);
  if (!parsed.success) {
    sendHtml(
      res,
      400,
      renderErrorPage({ title: 'Invalid link', message: 'This approval link is not valid.' }),
    );
    return;
  }

  let opened;
  try {
    opened = await openViewerLinkRequest({ requestId: parsed.data.request_id, nonce: parsed.data.nonce });
  } catch (error) {
    sendHtml(
      res,
      errorStatus(error),
      renderErrorPage({
        title: 'This link cannot be used',
        message: errorMessage(error, 'This approval link cannot be used.'),
      }),
    );
    return;
  }

  res.cookie(BINDING_COOKIE, opened.bindingToken, {
    ...bindingCookieOptions(),
    maxAge: Math.max(1, opened.request.expiresAt.getTime() - Date.now()),
  });

  if (!req.auth) {
    sendHtml(
      res,
      200,
      renderViewerLinkLoginPage({
        requestId: opened.request.id,
        details: detailsFrom(opened),
        csrfToken: loginCsrfToken(opened.request.id, opened.bindingToken),
      }),
    );
    return;
  }
  const csrfCookie: unknown = req.cookies?.[CSRF_COOKIE];
  await renderConsentOrReason({
    res,
    data: opened,
    userId: req.auth.user.id,
    userName: req.auth.user.name,
    userEmail: req.auth.user.email,
    csrfToken: typeof csrfCookie === 'string' ? csrfCookie : null,
  });
});

export const viewerLinkLogin = asyncHandler(async (req: Request, res: Response) => {
  const parsed = viewerLinkLoginBodySchema.safeParse(req.body);
  if (!parsed.success) {
    sendHtml(
      res,
      400,
      renderErrorPage({ title: 'Invalid sign-in request', message: 'The sign-in form was not valid.' }),
    );
    return;
  }

  const binding = bindingFrom(req);
  const expectedCsrf = binding ? loginCsrfToken(parsed.data.request_id, binding) : null;
  if (!expectedCsrf || !safeEqualStrings(expectedCsrf, parsed.data._csrf)) {
    sendHtml(
      res,
      403,
      renderErrorPage({
        title: 'Sign-in form expired',
        message: 'Open the link from Flowtrium again.',
      }),
    );
    return;
  }

  let data: ApprovalPageData;
  try {
    data = await loadApprovalContext({ requestId: parsed.data.request_id, rawBinding: binding });
  } catch (error) {
    sendHtml(
      res,
      errorStatus(error),
      renderErrorPage({
        title: 'This link cannot be used',
        message: errorMessage(error, 'This approval link cannot be used.'),
      }),
    );
    return;
  }

  try {
    const result = await loginUser(
      { email: normalizeEmail(parsed.data.email), password: parsed.data.password, client: 'browser' },
      req,
    );
    setAuthCookies(res, {
      accessToken: result.issued.accessToken,
      refreshToken: result.issued.refreshToken,
      csrfToken: result.issued.csrfToken,
      accessExpiresAt: result.issued.accessExpiresAt,
      refreshExpiresAt: result.issued.refreshExpiresAt,
    });
    await renderConsentOrReason({
      res,
      data,
      userId: result.user.id,
      userName: result.user.name,
      userEmail: result.user.email,
      csrfToken: result.issued.csrfToken,
    });
  } catch (error) {
    sendHtml(
      res,
      error instanceof AppError && error.statusCode === 429 ? 429 : 401,
      renderViewerLinkLoginPage({
        requestId: data.request.id,
        details: detailsFrom(data),
        csrfToken: expectedCsrf,
        error: errorMessage(error, 'Sign-in failed. Check your credentials.'),
      }),
    );
  }
});

export const viewerLinkDecision = asyncHandler(async (req: Request, res: Response) => {
  if (!req.auth) {
    sendHtml(
      res,
      400,
      renderErrorPage({
        title: 'Decision could not be recorded',
        message: 'Your session has expired. Open the link from Flowtrium again.',
      }),
    );
    return;
  }
  const parsed = viewerLinkDecisionBodySchema.safeParse(req.body);
  if (!parsed.success) {
    sendHtml(
      res,
      400,
      renderErrorPage({ title: 'Decision could not be recorded', message: 'The form was not valid.' }),
    );
    return;
  }
  try {
    // The person is always the signed-in session. No user id or role is read from the form.
    const result = await decideViewerLinkRequest({
      requestId: parsed.data.request_id,
      rawBinding: bindingFrom(req),
      userId: req.auth.user.id,
      decision: parsed.data.decision,
      context: integrationAuditContext(req),
    });
    res.clearCookie(BINDING_COOKIE, bindingCookieOptions());
    sendHtml(
      res,
      200,
      renderViewerLinkDonePage({
        clientName: result.clientName,
        approved: result.decision === 'APPROVED',
      }),
    );
  } catch (error) {
    sendHtml(
      res,
      errorStatus(error),
      renderErrorPage({
        title: 'Authorization failed',
        message: errorMessage(error, 'Unable to record the decision.'),
      }),
    );
  }
});

// --- Integration API (/integration/v1, integration token with screens:live) --------------------

export const createViewerLinkRequestHandler = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as {
    externalUserId: string;
    externalUserLabel: string;
    externalOrganizationLabel: string;
    codeChallenge: string;
  };
  const result = await createViewerLinkRequest({
    integration: req.integration!,
    ...body,
    context: integrationAuditContext(req),
  });
  res.set('Cache-Control', 'no-store');
  res.status(201).json({ data: result });
});

export const completeViewerLinkRequestHandler = asyncHandler(async (req: Request, res: Response) => {
  const link = await completeViewerLinkRequest({
    integration: req.integration!,
    requestId: req.params.requestId!,
    codeVerifier: (req.body as { codeVerifier: string }).codeVerifier,
    context: integrationAuditContext(req),
  });
  res.set('Cache-Control', 'no-store');
  res.status(200).json({ data: link });
});

export const getViewerLinkStatusHandler = asyncHandler(async (req: Request, res: Response) => {
  const link = await getViewerLinkStatus({
    connectionId: req.integration!.connection.id,
    externalUserId: req.params.externalUserId!,
  });
  res.set('Cache-Control', 'no-store');
  res.status(200).json({ data: { linked: link !== null, link } });
});

export const revokeViewerLinkHandler = asyncHandler(async (req: Request, res: Response) => {
  const revoked = await revokeViewerLinkForExternalUser({
    connectionId: req.integration!.connection.id,
    externalUserId: req.params.externalUserId!,
    context: integrationAuditContext(req),
  });
  res.status(200).json({ data: { revoked } });
});

// --- WorkZen management (signed-in owner/admin with integration:manage) -------------------------

export const listViewerLinksHandler = asyncHandler(async (req: Request, res: Response) => {
  const links = await listViewerLinks(req.organization!.organization.id);
  res.status(200).json({ data: links });
});

/** Revoking only removes access, so an admin who manages the integration may do it too. */
export const revokeViewerLinkByManagerHandler = asyncHandler(async (req: Request, res: Response) => {
  const revoked = await revokeViewerLinkById({
    linkId: req.params.linkId!,
    organizationId: req.organization!.organization.id,
    reason: 'OWNER_REVOKED',
    revokedByUserId: req.auth!.user.id,
    context: integrationAuditContext(req),
  });
  res.status(200).json({ data: { revoked } });
});
