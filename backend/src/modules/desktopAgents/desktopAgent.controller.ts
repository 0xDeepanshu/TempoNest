import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  authenticateAgent,
  listDesktopAgents,
  registerDesktopAgent,
  revokeDesktopAgent,
} from './desktopAgent.service';
import { toDesktopAgentSummary } from './desktopAgent.mapper';
import type { AuthenticateAgentInput, RegisterAgentInput } from './desktopAgent.schemas';

export const register = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as RegisterAgentInput;
  const { agent, agentKey, rotated } = await registerDesktopAgent(
    req.auth!.user.id,
    req.organization!.organization.id,
    input,
  );

  res.status(rotated ? 200 : 201).json({
    data: {
      agent: toDesktopAgentSummary(agent),
      agentKey,
      rotated,
      notice: 'Store agentKey securely. It is shown only in this response.',
    },
  });
});

export const authenticate = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as AuthenticateAgentInput;
  const agent = await authenticateAgent(input.agentId, input.agentKey);

  res.status(200).json({
    data: {
      agent: toDesktopAgentSummary(agent),
      organization: agent.organization
        ? {
            id: agent.organization.id,
            name: agent.organization.name,
            timezone: agent.organization.timezone,
            status: agent.organization.status,
          }
        : null,
      user: agent.user
        ? { id: agent.user.id, name: agent.user.name, email: agent.user.email }
        : null,
      serverTime: new Date().toISOString(),
    },
  });
});

export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as unknown as {
    page: number;
    limit: number;
    userId?: string;
    status: 'ACTIVE' | 'REVOKED' | 'ALL';
  };
  const result = await listDesktopAgents(
    req.organization!.organization.id,
    req.auth!.user.id,
    req.organization!.effective,
    query,
  );

  res.status(200).json({ ...result, serverTime: new Date().toISOString() });
});

export const revoke = asyncHandler(async (req: Request, res: Response) => {
  const result = await revokeDesktopAgent(req.params.agentId!, req.organization!.organization.id, {
    userId: req.auth!.user.id,
    role: req.organization!.effective,
  });

  res.status(200).json({
    data: {
      agent: toDesktopAgentSummary(result.agent),
      stoppedSessionIds: result.stoppedSessionIds,
      alreadyRevoked: result.alreadyRevoked,
    },
  });
});
