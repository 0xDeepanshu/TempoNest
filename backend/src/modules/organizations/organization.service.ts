import { Op, UniqueConstraintError } from 'sequelize';
import { randomBytes } from 'node:crypto';
import { sequelize, Membership, Organization } from '../../database';
import { AppError } from '../../utils/errors';
import { slugify, slugWithSuffix } from '../../utils/slug';
import { toOrganizationSummary } from '../memberships/membership.mapper';
import type { Membership as MembershipModel } from '../memberships/membership.model';
import type { Organization as OrganizationModel } from './organization.model';
import type { CreateOrganizationInput } from './organization.schemas';

export async function createOrganization(
  userId: string,
  input: CreateOrganizationInput,
): Promise<{ organization: OrganizationModel; membership: MembershipModel }> {
  const baseSlug = slugify(input.name);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug =
      attempt === 0 ? baseSlug : slugWithSuffix(baseSlug, randomBytes(4).toString('hex'));

    try {
      return await sequelize.transaction(async (transaction) => {
        const organization = await Organization.create(
          {
            name: input.name.trim(),
            slug,
            status: 'ACTIVE',
            timezone: input.timezone ?? 'UTC',
          },
          { transaction },
        );

        // The creator is always the initial OWNER. This is never client-selectable.
        const membership = await Membership.create(
          {
            organizationId: organization.id,
            userId,
            role: 'OWNER',
            status: 'ACTIVE',
          },
          { transaction },
        );

        return { organization, membership };
      });
    } catch (error) {
      // Another organization took the slug concurrently; retry with a suffix.
      if (error instanceof UniqueConstraintError && attempt < 4) continue;
      throw error;
    }
  }

  throw AppError.conflict('Could not allocate a unique organization slug', 'SLUG_CONFLICT');
}

export async function listOrganizationsForUser(userId: string) {
  const memberships = await Membership.findAll({
    where: { userId, status: { [Op.in]: ['ACTIVE', 'SUSPENDED'] } },
    include: [{ model: Organization, as: 'organization', required: true }],
    order: [
      ['createdAt', 'ASC'],
      ['id', 'ASC'],
    ],
  });

  return memberships.map((membership) => ({
    ...toOrganizationSummary(membership.organization!),
    membership: {
      id: membership.id,
      role: membership.role,
      status: membership.status,
    },
  }));
}

export async function getOrganizationDetails(organization: OrganizationModel, membership: MembershipModel) {
  const memberCount = await Membership.count({
    where: { organizationId: organization.id, status: 'ACTIVE' },
  });

  return {
    organization: toOrganizationSummary(organization),
    membership: {
      id: membership.id,
      role: membership.role,
      status: membership.status,
    },
    memberCount,
  };
}

export async function updateOrganization(
  organization: OrganizationModel,
  input: { name?: string; timezone?: string },
): Promise<OrganizationModel> {
  await organization.update({
    ...(input.name !== undefined ? { name: input.name.trim() } : {}),
    ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
  });
  return organization;
}
