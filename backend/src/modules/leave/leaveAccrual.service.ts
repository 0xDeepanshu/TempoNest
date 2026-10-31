import {
  LeavePolicy,
  LeaveType,
  Membership,
  Organization,
  User,
  sequelize,
} from '../../database';
import { logger } from '../../config/logger';
import { balancePeriodFor, localDate } from './leaveCalendar';
import { ensureBalance, withTransactionRetry } from './leaveBalance.service';

const MEMBERSHIP_BATCH_SIZE = 200;

export type LeaveAccrualSweepSummary = {
  organizations: number;
  employeesProcessed: number;
  balancesChecked: number;
  failures: number;
  durationMs: number;
};

/**
 * Materializes the current balance period for every active employee and active
 * balance-based leave type. `ensureBalance` writes only scheduled credits that
 * are due, keys every grant by organization/employee/type/month, and is safe to
 * run concurrently: a losing worker retries the transaction and then sees the
 * winner's ledger row.
 */
export async function runLeaveAccrualSweep(
  options: { now?: Date; organizationId?: string } = {},
): Promise<LeaveAccrualSweepSummary> {
  const startedAt = Date.now();
  const now = options.now ?? new Date();

  const organizations = await Organization.findAll({
    where: {
      status: 'ACTIVE',
      deletedAt: null,
      ...(options.organizationId ? { id: options.organizationId } : {}),
    },
    attributes: ['id', 'name', 'timezone'],
    order: [['createdAt', 'ASC']],
  });

  let employeesProcessed = 0;
  let balancesChecked = 0;
  let failures = 0;

  for (const organization of organizations) {
    const types = await LeaveType.findAll({
      where: {
        organizationId: organization.id,
        isActive: true,
        requiresBalance: true,
      },
      include: [
        { model: LeavePolicy, as: 'policy', required: true, where: { isActive: true } },
      ],
      order: [['name', 'ASC']],
    });
    if (types.length === 0) continue;

    const today = localDate(now, organization.timezone);
    const periods = new Map(
      types.map((type) => [
        type.id,
        balancePeriodFor(today, type.policy!, organization.timezone),
      ]),
    );

    let offset = 0;
    for (;;) {
      const memberships = await Membership.findAll({
        where: { organizationId: organization.id, status: 'ACTIVE' },
        include: [
          {
            model: User,
            as: 'user',
            required: true,
            where: { status: 'ACTIVE' },
            attributes: ['id'],
          },
        ],
        attributes: ['userId'],
        order: [
          ['createdAt', 'ASC'],
          ['userId', 'ASC'],
        ],
        limit: MEMBERSHIP_BATCH_SIZE,
        offset,
      });
      if (memberships.length === 0) break;

      for (const membership of memberships) {
        try {
          await withTransactionRetry(() =>
            sequelize.transaction(async (transaction) => {
              for (const type of types) {
                const period = periods.get(type.id)!;
                await ensureBalance({
                  organization,
                  employeeId: membership.userId,
                  type,
                  policy: type.policy!,
                  periodStart: period.periodStart,
                  periodEnd: period.periodEnd,
                  transaction,
                  now,
                });
              }
            }),
          );
          employeesProcessed += 1;
          balancesChecked += types.length;
        } catch (error) {
          failures += 1;
          logger.error(
            { err: error, organizationId: organization.id, employeeId: membership.userId },
            'leave accrual sweep failed for employee',
          );
        }
      }

      offset += memberships.length;
      if (memberships.length < MEMBERSHIP_BATCH_SIZE) break;
    }
  }

  return {
    organizations: organizations.length,
    employeesProcessed,
    balancesChecked,
    failures,
    durationMs: Date.now() - startedAt,
  };
}
