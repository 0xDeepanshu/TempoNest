import { Op, type Transaction } from 'sequelize';
import { config } from '../../config/env';
import {
  sequelize,
  IntegrationClient,
  IntegrationConnection,
  IntegrationCredential,
  IntegrationViewerLink,
  IntegrationViewerLinkRequest,
  Membership,
  Organization,
  User,
} from '../../database';
import { generateOpaqueToken, safeEqualStrings } from '../../utils/crypto';
import { AppError } from '../../utils/errors';
import { hasPermission } from '../memberships/permissions';
import { recordAuditEvent, type AuditContext } from '../screenshots/audit.service';
import { terminateActiveScreenLiveSessionsForIntegration } from '../screenshots/screenLive.service';
import { getOrCreateScreenshotPolicy } from '../screenshots/screenshotPolicy.service';
import { hashIntegrationValue, verifyPkceChallenge } from './integration.crypto';
import type { IntegrationContext } from '../../types/express';
import type { Membership as MembershipModel } from '../memberships/membership.model';
import type { Organization as OrganizationModel } from '../organizations/organization.model';
import type { IntegrationConnection as IntegrationConnectionModel } from './integrationConnection.model';
import type {
  IntegrationViewerLink as IntegrationViewerLinkModel,
  IntegrationViewerLinkRequest as IntegrationViewerLinkRequestModel,
} from './integrationViewerLink.model';

/** The approval link is short-lived and single-use. Completing the link must also happen inside it. */
export const VIEWER_LINK_REQUEST_TTL_SECONDS = 10 * 60;
const MAX_PENDING_REQUESTS_PER_CONNECTION = 20;
const LIVE_SCOPE = 'screens:live';

type Reason =
  | 'EXTERNAL_REVOKED'
  | 'OWNER_REVOKED'
  | 'RELINKED'
  | 'CONNECTION_CLOSED'
  | 'IDENTITY_NO_LONGER_ELIGIBLE';

function lockOption(transaction: Transaction | undefined) {
  return transaction ? { transaction, lock: transaction.LOCK.UPDATE } : {};
}

/**
 * Everything a WorkZen user must satisfy to be bound to, or to act through, an integration viewer
 * link. Used at approval, at completion and (by the live API) on every call, so a demotion, a
 * suspension or a policy change takes effect immediately. Only a built-in OWNER qualifies: Admins
 * and custom roles never do, even though they may manage the integration itself.
 */
export async function assertEligibleLinkOwner(options: {
  userId: string;
  organizationId: string;
  transaction?: Transaction;
}): Promise<{ membership: MembershipModel; organization: OrganizationModel }> {
  const { userId, organizationId, transaction } = options;
  const membership = await Membership.findOne({
    where: { userId, organizationId, status: 'ACTIVE' },
    include: [{ model: Organization, as: 'organization', required: true }],
    ...(transaction ? { transaction } : {}),
  });
  if (!membership || !membership.organization) {
    throw AppError.forbidden(
      'You are not an active member of this organization',
      'ORGANIZATION_ACCESS_DENIED',
    );
  }
  const organization = membership.organization;
  if (organization.deletedAt || organization.status !== 'ACTIVE') {
    throw AppError.forbidden('This organization is not available', 'ORGANIZATION_SUSPENDED');
  }
  if (membership.role !== 'OWNER') {
    throw AppError.forbidden(
      'Only a WorkZen owner can link a Flowtrium identity for live screens',
      'VIEWER_LINK_OWNER_REQUIRED',
    );
  }
  if (!hasPermission(membership.role, 'screenshot:live')) {
    throw AppError.forbidden('Your role cannot view live screens', 'PERMISSION_DENIED');
  }
  const policy = await getOrCreateScreenshotPolicy(organizationId, transaction);
  if (!policy.enabled) {
    throw AppError.forbidden(
      'Live screen viewing is disabled by this organization',
      'SCREEN_LIVE_POLICY_DISABLED',
    );
  }
  if (!policy.viewRoles.includes(membership.role) || !policy.requestRoles.includes(membership.role)) {
    throw AppError.forbidden(
      'The monitoring policy does not permit owners to view live screens',
      'SCREEN_LIVE_ROLE_NOT_ALLOWED',
    );
  }
  return { membership, organization };
}

/** The connection must be ACTIVE, its client enabled and a live credential must carry screens:live. */
async function assertConnectionAllowsLiveScreens(
  connectionId: string,
  transaction?: Transaction,
): Promise<IntegrationConnectionModel> {
  const connection = await IntegrationConnection.findByPk(connectionId, {
    include: [
      { model: IntegrationClient, as: 'client', required: true },
      { model: Organization, as: 'organization', required: true },
    ],
    ...(transaction ? { transaction } : {}),
  });
  if (!connection || connection.status !== 'ACTIVE') {
    throw AppError.forbidden('This integration is not connected', 'INTEGRATION_CONNECTION_INACTIVE');
  }
  if (connection.client?.status !== 'ACTIVE') {
    throw AppError.forbidden('This integration client is disabled', 'INTEGRATION_CLIENT_DISABLED');
  }
  const organization = connection.organization;
  if (!organization || organization.deletedAt || organization.status !== 'ACTIVE') {
    throw AppError.forbidden('This organization is not available', 'ORGANIZATION_SUSPENDED');
  }
  const credentials = await IntegrationCredential.findAll({
    where: { connectionId, revokedAt: null },
    attributes: ['id', 'scopes'],
    ...(transaction ? { transaction } : {}),
  });
  if (!credentials.some((credential) => credential.scopes.includes(LIVE_SCOPE))) {
    throw AppError.forbidden(
      'This connection was not granted live screen access',
      'INTEGRATION_SCOPE_DENIED',
    );
  }
  return connection;
}

export type ViewerLinkView = {
  id: string;
  externalUserId: string;
  externalUserLabel: string;
  status: 'ACTIVE' | 'REVOKED';
  linkedAt: string;
  revokedAt: string | null;
  workzenUser: { id: string; name: string } | null;
};

async function toLinkView(link: IntegrationViewerLinkModel): Promise<ViewerLinkView> {
  const user = await User.findByPk(link.workzenUserId, { attributes: ['id', 'name'] });
  return {
    id: link.id,
    externalUserId: link.externalUserId,
    externalUserLabel: link.externalUserLabel,
    status: link.status,
    linkedAt: link.linkedAt.toISOString(),
    revokedAt: link.revokedAt ? link.revokedAt.toISOString() : null,
    workzenUser: user ? { id: user.id, name: user.name } : null,
  };
}

/**
 * The nonce travels in the URL fragment. Browsers never send a fragment to the server, so it does not
 * reach access logs, proxies or Referer headers. The page script moves it out of the address bar and
 * posts it in a request body (see `openViewerLinkRequest`). Only the request id, which is not a secret,
 * is in the query string.
 */
function approvalUrl(requestId: string, nonce: string): string {
  const base = config.screenshots.publicBaseUrl;
  const url = new URL(`${base}${config.apiPrefix}/integrations/viewer-links/approve`);
  url.searchParams.set('request', requestId);
  url.hash = `n=${nonce}`;
  return url.toString();
}

async function auditRefusal(options: {
  organizationId: string;
  actorUserId?: string | null;
  requestId: string;
  reason: string;
  context?: AuditContext;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await recordAuditEvent(
      {
        organizationId: options.organizationId,
        actorUserId: options.actorUserId ?? null,
        action: 'INTEGRATION_VIEWER_LINK_REFUSED',
        entityType: 'INTEGRATION_VIEWER_LINK_REQUEST',
        entityId: options.requestId,
        metadata: { reason: options.reason, ...(options.metadata ?? {}) },
      },
      { context: options.context },
    );
  } catch {
    // An audit failure must not mask the authorization decision that was already made.
  }
}

/** Step 1, called by the integration with its own token: ask for a one-time approval link. */
export async function createViewerLinkRequest(options: {
  integration: IntegrationContext;
  externalUserId: string;
  externalUserLabel: string;
  externalOrganizationLabel: string;
  codeChallenge: string;
  context?: AuditContext;
}): Promise<{ requestId: string; approvalUrl: string; expiresAt: string }> {
  const { integration } = options;
  const connection = await assertConnectionAllowsLiveScreens(integration.connection.id);
  const now = new Date();

  const pending = await IntegrationViewerLinkRequest.count({
    where: {
      connectionId: connection.id,
      status: 'PENDING',
      expiresAt: { [Op.gt]: now },
    },
  });
  if (pending >= MAX_PENDING_REQUESTS_PER_CONNECTION) {
    throw AppError.tooManyRequests(
      'Too many pending link requests for this connection',
      'VIEWER_LINK_TOO_MANY_PENDING',
    );
  }

  const nonce = generateOpaqueToken();
  const expiresAt = new Date(now.getTime() + VIEWER_LINK_REQUEST_TTL_SECONDS * 1000);

  const request = await sequelize.transaction(async (transaction) => {
    // A new request for the same external user replaces any earlier unused one.
    await IntegrationViewerLinkRequest.update(
      { status: 'EXPIRED' },
      {
        where: {
          connectionId: connection.id,
          externalUserId: options.externalUserId,
          status: { [Op.in]: ['PENDING', 'APPROVED'] },
        },
        transaction,
      },
    );
    return IntegrationViewerLinkRequest.create(
      {
        connectionId: connection.id,
        organizationId: connection.organizationId,
        externalUserId: options.externalUserId,
        externalUserLabel: options.externalUserLabel,
        externalOrganizationLabel: options.externalOrganizationLabel,
        nonceHash: hashIntegrationValue(nonce),
        codeChallenge: options.codeChallenge,
        expiresAt,
      },
      { transaction },
    );
  });

  await recordAuditEvent(
    {
      organizationId: connection.organizationId,
      actorUserId: null,
      action: 'INTEGRATION_VIEWER_LINK_REQUESTED',
      entityType: 'INTEGRATION_VIEWER_LINK_REQUEST',
      entityId: request.id,
      metadata: {
        connectionId: connection.id,
        clientId: integration.client.clientId,
        externalOrganizationId: connection.externalOrganizationId,
        externalUserId: options.externalUserId,
      },
    },
    { context: options.context },
  );

  return {
    requestId: request.id,
    approvalUrl: approvalUrl(request.id, nonce),
    expiresAt: expiresAt.toISOString(),
  };
}

export type ApprovalPageData = {
  request: IntegrationViewerLinkRequestModel;
  workzenOrganizationName: string;
  clientName: string;
  externalOrganizationId: string;
};

/**
 * Opens the approval page. The nonce is compared as a hash, a non-pending, expired or unknown request
 * reads the same to the caller, and a fresh HTTP-only binding value replaces any earlier one so the
 * decision can only come from the browser that opened this link last.
 */
export async function openViewerLinkRequest(options: {
  requestId: string;
  nonce: string;
}): Promise<ApprovalPageData & { bindingToken: string }> {
  const request = await IntegrationViewerLinkRequest.findByPk(options.requestId);
  const suppliedHash = hashIntegrationValue(options.nonce);
  if (!request || !safeEqualStrings(suppliedHash, request.nonceHash)) {
    throw AppError.notFound('This link request was not found', 'VIEWER_LINK_REQUEST_NOT_FOUND');
  }
  await assertRequestPending(request);
  const connection = await assertConnectionAllowsLiveScreens(request.connectionId);

  // The nonce is spent by this exchange: the browser now holds the binding cookie, and the same nonce
  // can never open the request again. Overwriting its hash keeps the column unique and unguessable.
  const bindingToken = generateOpaqueToken();
  await request.update({
    browserBindingHash: hashIntegrationValue(bindingToken),
    nonceHash: hashIntegrationValue(`spent|${generateOpaqueToken()}`),
  });

  return {
    request,
    bindingToken,
    workzenOrganizationName: connection.organization!.name,
    clientName: connection.client!.name,
    externalOrganizationId: connection.externalOrganizationId,
  };
}

async function assertRequestPending(
  request: IntegrationViewerLinkRequestModel,
  transaction?: Transaction,
): Promise<void> {
  if (request.status === 'PENDING' && request.expiresAt.getTime() <= Date.now()) {
    await request.update({ status: 'EXPIRED' }, transaction ? { transaction } : {});
    throw AppError.gone('This link request has expired', 'VIEWER_LINK_REQUEST_EXPIRED');
  }
  if (request.status === 'EXPIRED') {
    throw AppError.gone('This link request has expired', 'VIEWER_LINK_REQUEST_EXPIRED');
  }
  if (request.status !== 'PENDING') {
    throw AppError.gone('This link request is no longer pending', 'VIEWER_LINK_REQUEST_USED');
  }
}

/** Data the approval page shows, recomputed from the stored request and the signed-in user. */
export async function loadApprovalContext(options: {
  requestId: string;
  rawBinding: string | undefined;
}): Promise<ApprovalPageData> {
  const request = await IntegrationViewerLinkRequest.findByPk(options.requestId);
  if (!request) {
    throw AppError.notFound('This link request was not found', 'VIEWER_LINK_REQUEST_NOT_FOUND');
  }
  assertBinding(request, options.rawBinding);
  await assertRequestPending(request);
  const connection = await assertConnectionAllowsLiveScreens(request.connectionId);
  return {
    request,
    workzenOrganizationName: connection.organization!.name,
    clientName: connection.client!.name,
    externalOrganizationId: connection.externalOrganizationId,
  };
}

function assertBinding(request: IntegrationViewerLinkRequestModel, rawBinding: string | undefined): void {
  if (
    !rawBinding ||
    !request.browserBindingHash ||
    !safeEqualStrings(hashIntegrationValue(rawBinding), request.browserBindingHash)
  ) {
    throw AppError.forbidden(
      'This approval was not started in this browser. Open the link from Flowtrium again.',
      'VIEWER_LINK_BINDING_INVALID',
    );
  }
}

/**
 * Step 2, in the WorkZen browser: the signed-in user approves or denies. The organization is fixed by
 * the request (never chosen in the browser) and the person must be an eligible OWNER of it. The row is
 * claimed under a lock so one request can be decided exactly once.
 */
export async function decideViewerLinkRequest(options: {
  requestId: string;
  rawBinding: string | undefined;
  userId: string;
  decision: 'approve' | 'deny';
  context?: AuditContext;
}): Promise<{ decision: 'APPROVED' | 'DENIED'; clientName: string }> {
  const { requestId, rawBinding, userId, decision, context } = options;
  const peek = await IntegrationViewerLinkRequest.findByPk(requestId);
  if (!peek) {
    throw AppError.notFound('This link request was not found', 'VIEWER_LINK_REQUEST_NOT_FOUND');
  }

  try {
    return await sequelize.transaction(async (transaction) => {
      const request = await IntegrationViewerLinkRequest.findByPk(requestId, lockOption(transaction));
      if (!request) {
        throw AppError.notFound('This link request was not found', 'VIEWER_LINK_REQUEST_NOT_FOUND');
      }
      assertBinding(request, rawBinding);
      await assertRequestPending(request, transaction);
      const connection = await assertConnectionAllowsLiveScreens(request.connectionId, transaction);

      if (decision === 'deny') {
        await request.update(
          { status: 'DENIED', decidedAt: new Date(), decidedByUserId: userId },
          { transaction },
        );
        await recordAuditEvent(
          {
            organizationId: request.organizationId,
            actorUserId: userId,
            action: 'INTEGRATION_VIEWER_LINK_DENIED',
            entityType: 'INTEGRATION_VIEWER_LINK_REQUEST',
            entityId: request.id,
            metadata: { externalUserId: request.externalUserId, connectionId: connection.id },
          },
          { transaction, context },
        );
        return { decision: 'DENIED' as const, clientName: connection.client!.name };
      }

      await assertEligibleLinkOwner({ userId, organizationId: request.organizationId, transaction });
      await request.update(
        { status: 'APPROVED', decidedAt: new Date(), decidedByUserId: userId },
        { transaction },
      );
      await recordAuditEvent(
        {
          organizationId: request.organizationId,
          actorUserId: userId,
          action: 'INTEGRATION_VIEWER_LINK_APPROVED',
          entityType: 'INTEGRATION_VIEWER_LINK_REQUEST',
          entityId: request.id,
          metadata: {
            externalUserId: request.externalUserId,
            externalUserLabel: request.externalUserLabel,
            externalOrganizationId: connection.externalOrganizationId,
            connectionId: connection.id,
          },
        },
        { transaction, context },
      );
      return { decision: 'APPROVED' as const, clientName: connection.client!.name };
    });
  } catch (error) {
    if (error instanceof AppError) {
      await auditRefusal({
        organizationId: peek.organizationId,
        actorUserId: userId,
        requestId,
        reason: error.code,
        context,
        metadata: { externalUserId: peek.externalUserId, decision },
      });
    }
    throw error;
  }
}

/**
 * Step 3, called by the integration with its own token and the PKCE verifier: activates the link.
 * Everything is rechecked, the approving user included, because time has passed since the approval.
 */
export async function completeViewerLinkRequest(options: {
  integration: IntegrationContext;
  requestId: string;
  codeVerifier: string;
  context?: AuditContext;
}): Promise<ViewerLinkView> {
  const { integration, requestId, codeVerifier, context } = options;
  let replaced: string[] = [];

  const link = await sequelize.transaction(async (transaction) => {
    const request = await IntegrationViewerLinkRequest.findByPk(requestId, lockOption(transaction));
    // A request that belongs to another connection reads exactly like an unknown one.
    if (!request || request.connectionId !== integration.connection.id) {
      throw AppError.notFound('This link request was not found', 'VIEWER_LINK_REQUEST_NOT_FOUND');
    }
    if (request.status === 'CONSUMED') {
      throw AppError.gone('This link request was already used', 'VIEWER_LINK_REQUEST_USED');
    }
    if (request.status === 'PENDING') {
      if (request.expiresAt.getTime() <= Date.now()) {
        await request.update({ status: 'EXPIRED' }, { transaction });
        throw AppError.gone('This link request has expired', 'VIEWER_LINK_REQUEST_EXPIRED');
      }
      throw AppError.conflict('This link request has not been approved yet', 'VIEWER_LINK_NOT_APPROVED');
    }
    if (request.status !== 'APPROVED') {
      throw AppError.gone('This link request is no longer valid', 'VIEWER_LINK_REQUEST_USED');
    }
    if (request.expiresAt.getTime() <= Date.now()) {
      await request.update({ status: 'EXPIRED' }, { transaction });
      throw AppError.gone('This link request has expired', 'VIEWER_LINK_REQUEST_EXPIRED');
    }
    if (!verifyPkceChallenge(codeVerifier, request.codeChallenge)) {
      // Not consumed: a wrong verifier must not let a third party burn the request.
      throw AppError.badRequest('The code verifier does not match', 'INVALID_CODE_VERIFIER');
    }

    const connection = await assertConnectionAllowsLiveScreens(request.connectionId, transaction);
    const approverId = request.decidedByUserId;
    if (!approverId) {
      throw AppError.conflict('This link request has not been approved yet', 'VIEWER_LINK_NOT_APPROVED');
    }
    await assertEligibleLinkOwner({
      userId: approverId,
      organizationId: request.organizationId,
      transaction,
    });

    const now = new Date();
    const existing = await IntegrationViewerLink.findAll({
      where: {
        connectionId: connection.id,
        status: 'ACTIVE',
        [Op.or]: [{ externalUserId: request.externalUserId }, { workzenUserId: approverId }],
      },
      ...lockOption(transaction),
    });
    for (const old of existing) {
      if (old.externalUserId !== request.externalUserId) {
        // This WorkZen owner is already bound to a different external user. Never silently re-bind.
        throw AppError.conflict(
          'This WorkZen owner is already linked to another Flowtrium account. Revoke that link first.',
          'WORKZEN_USER_ALREADY_LINKED',
        );
      }
      await old.update(
        { status: 'REVOKED', revokedAt: now, revokeReason: 'RELINKED' },
        { transaction },
      );
      replaced.push(old.id);
    }

    const created = await IntegrationViewerLink.create(
      {
        connectionId: connection.id,
        organizationId: request.organizationId,
        workzenUserId: approverId,
        externalUserId: request.externalUserId,
        externalUserLabel: request.externalUserLabel,
        requestId: request.id,
        linkedAt: now,
      },
      { transaction },
    );
    await request.update({ status: 'CONSUMED' }, { transaction });

    await recordAuditEvent(
      {
        organizationId: request.organizationId,
        actorUserId: approverId,
        action: 'INTEGRATION_VIEWER_LINK_ACTIVATED',
        entityType: 'INTEGRATION_VIEWER_LINK',
        entityId: created.id,
        metadata: {
          connectionId: connection.id,
          clientId: integration.client.clientId,
          externalOrganizationId: connection.externalOrganizationId,
          externalUserId: request.externalUserId,
          replacedLinkIds: replaced,
        },
      },
      { transaction, context },
    );
    return created;
  }).catch(async (error: unknown) => {
    if (error instanceof AppError) {
      await auditRefusal({
        organizationId: integration.connection.organizationId,
        requestId,
        reason: error.code,
        context,
        metadata: { connectionId: integration.connection.id, step: 'complete' },
      });
    }
    throw error;
  });

  // Sessions of a replaced link end after the new link is committed.
  for (const id of replaced) {
    await terminateActiveScreenLiveSessionsForIntegration(
      { integrationViewerLinkId: id },
      'VIEWER_LINK_REVOKED',
    );
  }
  replaced = [];
  return toLinkView(link);
}

export async function getViewerLinkStatus(options: {
  connectionId: string;
  externalUserId: string;
}): Promise<ViewerLinkView | null> {
  const link = await IntegrationViewerLink.findOne({
    where: {
      connectionId: options.connectionId,
      externalUserId: options.externalUserId,
      status: 'ACTIVE',
    },
  });
  return link ? toLinkView(link) : null;
}

/**
 * The per-request identity check used by every live-screen call: the external user must hold an ACTIVE
 * link on this connection, and the WorkZen user behind it must still be an eligible OWNER right now.
 * A link whose owner lost eligibility is revoked on the spot (and its sessions ended) rather than
 * left to look valid.
 */
export async function resolveVerifiedViewer(options: {
  connectionId: string;
  externalUserId: string;
  context?: AuditContext;
}): Promise<{ link: IntegrationViewerLinkModel; membership: MembershipModel; organization: OrganizationModel }> {
  const link = await IntegrationViewerLink.findOne({
    where: {
      connectionId: options.connectionId,
      externalUserId: options.externalUserId,
      status: 'ACTIVE',
    },
  });
  if (!link) {
    throw AppError.forbidden(
      'This Flowtrium account is not linked to a WorkZen owner',
      'VIEWER_LINK_REQUIRED',
    );
  }
  try {
    const { membership, organization } = await assertEligibleLinkOwner({
      userId: link.workzenUserId,
      organizationId: link.organizationId,
    });
    await assertConnectionAllowsLiveScreens(link.connectionId);
    return { link, membership, organization };
  } catch (error) {
    if (error instanceof AppError && error.code !== 'SCREEN_LIVE_POLICY_DISABLED') {
      // Policy being switched off is reversible and handled by the existing policy termination.
      // Losing the owner role, membership or the connection ends the link for good.
      await revokeViewerLinkById({
        linkId: link.id,
        reason: 'IDENTITY_NO_LONGER_ELIGIBLE',
        context: options.context,
      });
    }
    throw error;
  }
}

async function revokeLinkRow(options: {
  link: IntegrationViewerLinkModel;
  reason: Reason;
  revokedByUserId: string | null;
  transaction: Transaction;
}): Promise<void> {
  await options.link.update(
    {
      status: 'REVOKED',
      revokedAt: new Date(),
      revokedByUserId: options.revokedByUserId,
      revokeReason: options.reason,
    },
    { transaction: options.transaction },
  );
}

/** Revokes one link and immediately ends every live session that was started through it. */
export async function revokeViewerLinkById(options: {
  linkId: string;
  reason: Reason;
  organizationId?: string;
  revokedByUserId?: string | null;
  context?: AuditContext;
}): Promise<boolean> {
  const revoked = await sequelize.transaction(async (transaction) => {
    const link = await IntegrationViewerLink.findByPk(options.linkId, lockOption(transaction));
    if (!link || (options.organizationId && link.organizationId !== options.organizationId)) {
      throw AppError.notFound('Viewer link not found', 'VIEWER_LINK_NOT_FOUND');
    }
    if (link.status !== 'ACTIVE') return null;
    await revokeLinkRow({
      link,
      reason: options.reason,
      revokedByUserId: options.revokedByUserId ?? null,
      transaction,
    });
    await recordAuditEvent(
      {
        organizationId: link.organizationId,
        actorUserId: options.revokedByUserId ?? null,
        action: 'INTEGRATION_VIEWER_LINK_REVOKED',
        entityType: 'INTEGRATION_VIEWER_LINK',
        entityId: link.id,
        metadata: {
          reason: options.reason,
          connectionId: link.connectionId,
          externalUserId: link.externalUserId,
          workzenUserId: link.workzenUserId,
        },
      },
      { transaction, context: options.context },
    );
    return link;
  });
  if (!revoked) return false;
  await terminateActiveScreenLiveSessionsForIntegration(
    { integrationViewerLinkId: revoked.id },
    'VIEWER_LINK_REVOKED',
  );
  return true;
}

/** Called by the integration (DELETE) to unlink one of its own users. */
export async function revokeViewerLinkForExternalUser(options: {
  connectionId: string;
  externalUserId: string;
  context?: AuditContext;
}): Promise<boolean> {
  const link = await IntegrationViewerLink.findOne({
    where: {
      connectionId: options.connectionId,
      externalUserId: options.externalUserId,
      status: 'ACTIVE',
    },
    attributes: ['id'],
  });
  if (!link) return false;
  return revokeViewerLinkById({ linkId: link.id, reason: 'EXTERNAL_REVOKED', context: options.context });
}

export async function listViewerLinks(organizationId: string): Promise<ViewerLinkView[]> {
  const links = await IntegrationViewerLink.findAll({
    where: { organizationId },
    order: [['linkedAt', 'DESC']],
    limit: 200,
  });
  return Promise.all(links.map(toLinkView));
}

/**
 * Invalidates every link and unused request of a connection that is being disconnected or revoked.
 * Runs inside the caller's transaction. Sessions are ended afterwards by
 * `endIntegrationSessionsForConnection`, once the connection change has committed.
 */
export async function invalidateViewerLinksForConnection(options: {
  connectionId: string;
  transaction: Transaction;
}): Promise<void> {
  const { connectionId, transaction } = options;
  const now = new Date();
  await IntegrationViewerLink.update(
    { status: 'REVOKED', revokedAt: now, revokeReason: 'CONNECTION_CLOSED' },
    { where: { connectionId, status: 'ACTIVE' }, transaction },
  );
  await IntegrationViewerLinkRequest.update(
    { status: 'EXPIRED' },
    { where: { connectionId, status: { [Op.in]: ['PENDING', 'APPROVED'] } }, transaction },
  );
}

export async function endIntegrationSessionsForConnection(connectionId: string): Promise<number> {
  return terminateActiveScreenLiveSessionsForIntegration(
    { integrationConnectionId: connectionId },
    'INTEGRATION_DISCONNECTED',
  );
}
