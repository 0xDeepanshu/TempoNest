import { DataTypes, Model, type Optional, type Sequelize } from 'sequelize';
import { generateUuid } from '../../utils/crypto';
import type { Organization } from '../organizations/organization.model';
import type { LeaveCreditTranche } from './leaveCreditTranche.model';
import type { LeaveRequest } from './leaveRequest.model';

export interface LeaveRequestCreditAllocationAttributes {
  id: string;
  organizationId: string;
  requestId: string;
  trancheId: string;
  reservedUnits: number;
  consumedUnits: number;
  restoredUnits: number;
  createdAt: Date;
  updatedAt: Date;
}

export type LeaveRequestCreditAllocationCreationAttributes = Optional<
  LeaveRequestCreditAllocationAttributes,
  | 'id'
  | 'reservedUnits'
  | 'consumedUnits'
  | 'restoredUnits'
  | 'createdAt'
  | 'updatedAt'
>;

/**
 * Exact tranche-level allocation for one leave request. This is what makes
 * approval, rejection, cancellation and restoration deterministic: the same
 * credits that were reserved are the credits that are consumed or released.
 */
export class LeaveRequestCreditAllocation
  extends Model<
    LeaveRequestCreditAllocationAttributes,
    LeaveRequestCreditAllocationCreationAttributes
  >
  implements LeaveRequestCreditAllocationAttributes
{
  declare id: string;
  declare organizationId: string;
  declare requestId: string;
  declare trancheId: string;
  declare reservedUnits: number;
  declare consumedUnits: number;
  declare restoredUnits: number;
  declare createdAt: Date;
  declare updatedAt: Date;

  declare organization?: Organization;
  declare request?: LeaveRequest;
  declare tranche?: LeaveCreditTranche;
}

export function initLeaveRequestCreditAllocation(
  sequelize: Sequelize,
): typeof LeaveRequestCreditAllocation {
  LeaveRequestCreditAllocation.init(
    {
      id: {
        type: DataTypes.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: () => generateUuid(),
      },
      organizationId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'organization_id',
        references: { model: 'organizations', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      requestId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'request_id',
        references: { model: 'leave_requests', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      trancheId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'tranche_id',
        references: { model: 'leave_credit_tranches', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      reservedUnits: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        field: 'reserved_units',
        defaultValue: 0,
      },
      consumedUnits: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        field: 'consumed_units',
        defaultValue: 0,
      },
      restoredUnits: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        field: 'restored_units',
        defaultValue: 0,
      },
      createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
      },
    },
    {
      sequelize,
      modelName: 'LeaveRequestCreditAllocation',
      tableName: 'leave_request_credit_allocations',
      underscored: true,
      timestamps: true,
      indexes: [
        {
          name: 'leave_request_credit_allocations_request_tranche_unique',
          unique: true,
          fields: ['request_id', 'tranche_id'],
        },
        {
          name: 'leave_request_credit_allocations_tranche_idx',
          fields: ['tranche_id'],
        },
      ],
    },
  );

  return LeaveRequestCreditAllocation;
}
