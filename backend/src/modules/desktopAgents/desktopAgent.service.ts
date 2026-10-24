import type { NextFunction, Request, Response } from 'express';
import { Op } from 'sequelize';
import { sequelize, Break, DesktopAgent, Organization, TimeSession, User } from '../../database';
import { config } from '../../config/env';
import { generateOpaqueToken, hashOpaqueToken, safeEqualStrings } from '../../utils/crypto';
import { AppError } from '../../utils/errors';
import { paginate } from '../../utils/pagination';
import { hasPermission } from '../memberships/permissions';
import { serializeByKey } from '../../utils/serialize';
import { agentHub } from '../../realtime/agentHub';
import { toDesktopAgentSummary } from './desktopAgent.mapper';
import type { RegisterAgentInput } from './desktopAgent.schemas';
import type { DesktopAgent as DesktopAgentModel } from './desktopAgent.model';

const AGENT_KEY_PREFIX = 'tna_';

function issueAgentKey(): { key: string; hash: string } {
  const key = `${AGENT_KEY_PREFIX}${generateOpaqueToken()}`;
  return { key, hash: hashOpaqueToken(key, config.auth.tokenPepper) };
}

export async function touchAgent(agent: DesktopAgentModel, now = new Date()): Promise<void> {
  if (agent.lastSeenAt && now.getTime() - agent.lastSeenAt.getTime() < 5_000) return;
  agent.lastSeenAt = now;
  await agent.update({ lastSeenAt: now });
}

export async function registerDesktopAgent(
  userId: string,
  organizationId: string,
  input: RegisterAgentInput,
): Promise<{ agent: DesktopAgentModel; agentKey: string; rotated: boolean }> {
  const existing = await DesktopAgent.findOne({
    where: { organizationId, userId, deviceIdentifier: input.deviceId },
  });

  if (existing?.revokedAt) {
    throw AppError.conflict(
      'This device registration has been revoked and cannot be reused. Register a new device or contact an administrator.',
      'AGENT_REVOKED',
    );
  }

  // Device provenance is fixed once the device identity exists. Key rotation
  // must not turn a mobile device into an Electron screenshot target, or vice versa.
  if (existing && input.clientType && input.clientType !== existing.clientType) {
    throw AppError.conflict(
      'This device is already registered with a different client type',
      'AGENT_CLIENT_TYPE_MISMATCH',
    );
  }

  const { key, hash } = issueAgentKey();
  const metadata = {
    name: input.name,
    platform: input.platform ?? null,
    osVersion: input.osVersion ?? null,
    appVersion: input.appVersion ?? null,
    clientType: existing?.clientType ?? input.clientType ?? 'ELECTRON',
    agentKeyHash: hash,
  };

  if (existing) {
    // Re-registering the same device (reinstall, key rotation) invalidates the
    // old key. Previous sessions remain attributable to the same agent row.
    await existing.update(metadata);
    agentHub.closeAgent(existing.id, 4001, 'AGENT_CREDENTIALS_ROTATED');
    return { agent: existing, agentKey: key, rotated: true };
  }

  const agent = await DesktopAgent.create({
    organizationId,
    userId,
    deviceIdentifier: input.deviceId,
    ...metadata,
  });
  return { agent, agentKey: key, rotated: false };
}

export async function authenticateAgent(agentId: string, agentKey: string) {
  const agent = await DesktopAgent.findOne({ where: { id: agentId } });
  if (!agent) {
    throw AppError.unauthorized('Agent credentials are invalid', 'AGENT_CREDENTIALS_INVALID');
  }

  const presentedHash = hashOpaqueToken(agentKey, config.auth.tokenPepper);
  if (!safeEqualStrings(agent.agentKeyHash, presentedHash)) {
    throw AppError.unauthorized('Agent credentials are invalid', 'AGENT_CREDENTIALS_INVALID');
  }

  if (agent.revokedAt) {
    throw AppError.forbidden('This desktop agent has been revoked', 'AGENT_REVOKED');
  }

  await touchAgent(agent);
  const withRelations = await DesktopAgent.findByPk(agent.id, {
    include: [
      { model: Organization, as: 'organization' },
      { model: User, as: 'user' },
    ],
  });

  return withRelations ?? agent;
}

/**
 * Validates X-Agent-Id/X-Agent-Key against the authenticated user and the
 * organization in the route. All time/activity writes require this binding;
 * the caller cannot select another employee or device.
 */
export async function requireDesktopAgent(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const auth = req.auth;
    const organization = req.organization;
    if (!auth || !organization) {
      return next(AppError.unauthorized('Authentication required', 'UNAUTHENTICATED'));
    }

    const agentId = req.get('x-agent-id')?.trim();
    const agentKey = req.get('x-agent-key');
    if (!agentId || !agentKey) {
      return next(
        AppError.unauthorized(
          'Desktop agent credentials are required (X-Agent-Id and X-Agent-Key)',
          'AGENT_AUTH_REQUIRED',
        ),
      );
    }

    const agent = await DesktopAgent.findOne({
      where: { id: agentId, organizationId: organization.organization.id, userId: auth.user.id },
    });

    if (!agent) {
      return next(AppError.unauthorized('Desktop agent credentials are invalid', 'AGENT_CREDENTIALS_INVALID'));
    }

    if (!safeEqualStrings(agent.agentKeyHash, hashOpaqueToken(agentKey, config.auth.tokenPepper))) {
      return next(AppError.unauthorized('Desktop agent credentials are invalid', 'AGENT_CREDENTIALS_INVALID'));
    }

    if (agent.revokedAt) {
      return next(AppError.forbidden('This desktop agent has been revoked', 'AGENT_REVOKED'));
    }

    await touchAgent(agent);
    req.desktopAgent = agent;
    next();
  } catch (error) {
    next(error);
  }
}

export async function listDesktopAgents(
  organizationId: string,
  actorUserId: string,
  actorRole: Parameters<typeof hasPermission>[0],
  query: { page: number; limit: number; userId?: string; status: 'ACTIVE' | 'REVOKED' | 'ALL' },
) {
  const where: Record<string, unknown> = { organizationId };

  if (actorRole === 'EMPLOYEE') {
    where.userId = actorUserId;
  } else if (query.userId) {
    where.userId = query.userId;
  }

  if (query.status === 'ACTIVE') where.revokedAt = null;
  if (query.status === 'REVOKED') where.revokedAt = { [Op.ne]: null };

  const result = await DesktopAgent.findAndCountAll({
    where,
    include: [{ model: User, as: 'user', required: false }],
    order: [
      ['lastSeenAt', 'DESC'],
      ['createdAt', 'DESC'],
      ['id', 'ASC'],
    ],
    limit: query.limit,
    offset: (query.page - 1) * query.limit,
  });

  return paginate(
    result.rows.map((agent) => toDesktopAgentSummary(agent)),
    result.count,
    query.page,
    query.limit,
  );
}

export async function revokeDesktopAgent(
  agentId: string,
  organizationId: string,
  actor: { userId: string; role: Parameters<typeof hasPermission>[0] },
): Promise<{ agent: DesktopAgentModel; stoppedSessionIds: string[]; alreadyRevoked: boolean }> {
  const agent = await DesktopAgent.findOne({ where: { id: agentId, organizationId } });
  if (!agent) {
    throw AppError.notFound('Desktop agent not found', 'AGENT_NOT_FOUND');
  }

  const ownDevice = agent.userId === actor.userId;
  if (!ownDevice && !hasPermission(actor.role, 'agent:revoke')) {
    throw AppError.forbidden('Your role cannot revoke this device', 'PERMISSION_DENIED');
  }

  if (agent.revokedAt) {
    agentHub.closeAgent(agent.id, 4003, 'Agent revoked');
    return { agent, stoppedSessionIds: [], alreadyRevoked: true };
  }

  let now = new Date();
  const stoppedSessionIds: string[] = [];

  await serializeByKey(`employee:${agent.userId}`, () => {
    now = new Date();
    return sequelize.transaction(async (transaction) => {
      const activeSessions = await TimeSession.findAll({
        where: { desktopAgentId: agent.id, endedAt: null },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      for (const session of activeSessions) {
        await Break.update(
          { endedAt: now, status: 'ENDED' },
          { where: { timeSessionId: session.id, endedAt: null }, transaction },
        );
        await session.update(
          { endedAt: now, status: 'STOPPED', lastHeartbeatAt: now },
          { transaction },
        );
        stoppedSessionIds.push(session.id);
      }

      await agent.update({ revokedAt: now }, { transaction });
    });
  });

  // Live sockets are process-local; durable denial is enforced by revoked_at.
  agentHub.publishToAgent(agent.id, {
    type: 'agent.revoked',
    serverTime: now.toISOString(),
  });
  agentHub.closeAgent(agent.id, 4003, 'Agent revoked');

  for (const sessionId of stoppedSessionIds) {
    agentHub.publishToAgent(agent.id, {
      type: 'session.updated',
      serverTime: now.toISOString(),
      session: { id: sessionId, status: 'STOPPED', endedAt: now.toISOString() },
    });
  }

  return { agent, stoppedSessionIds, alreadyRevoked: false };
}
