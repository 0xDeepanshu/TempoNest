'use strict';

/**
 * Flexible leave policy + credit tranche accounting.
 *
 * Every new policy column defaults to the behaviour that existed before this
 * migration, so no existing balance, request, or ledger row changes meaning:
 *  - carry_forward_enabled mirrors `carry_forward_allowance > 0`
 *  - carry_forward_expiry_months stays NULL (carried credits never expire)
 *  - reset_period = CUSTOM keeps the existing month/day balance period
 *  - monthly usage limits and per-application caps stay disabled
 *
 * `leave_credit_tranches` and `leave_request_credit_allocations` are a
 * projection of the existing append-only ledger. They record which credit a
 * request reserved or consumed and when that credit expires; they are never a
 * second source of truth for the aggregate balance.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const dialect = queryInterface.sequelize.getDialect();

    await queryInterface.addColumn('leave_policies', 'carry_forward_enabled', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    await queryInterface.addColumn('leave_policies', 'carry_forward_expiry_months', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('leave_policies', 'carry_forward_order', {
      type: Sequelize.STRING(30),
      allowNull: false,
      defaultValue: 'EXPIRY_FIRST',
    });
    await queryInterface.addColumn('leave_policies', 'reset_period', {
      type: Sequelize.STRING(30),
      allowNull: false,
      defaultValue: 'CUSTOM',
    });
    await queryInterface.addColumn('leave_policies', 'max_credits_per_application', {
      type: Sequelize.DECIMAL(8, 2),
      allowNull: true,
    });
    await queryInterface.addColumn('leave_policies', 'monthly_usage_limit_enabled', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    await queryInterface.addColumn('leave_policies', 'monthly_usage_limit', {
      type: Sequelize.DECIMAL(8, 2),
      allowNull: true,
    });

    // Preserve the pre-migration carry-forward behaviour row by row.
    await queryInterface.sequelize.query(
      'UPDATE leave_policies SET carry_forward_enabled = TRUE WHERE carry_forward_allowance > 0',
    );

    await queryInterface.addColumn('leave_balances', 'expired_balance', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    });

    await queryInterface.addColumn('leave_ledger_entries', 'expired_delta', {
      type: Sequelize.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0,
    });

    if (dialect === 'postgres') {
      await queryInterface.sequelize.query(
        `ALTER TYPE "enum_leave_ledger_entries_kind" ADD VALUE IF NOT EXISTS 'EXPIRY'`,
      );
    }

    await queryInterface.createTable('leave_credit_tranches', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      organization_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'organizations', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      employee_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      leave_type_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'leave_types', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      balance_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'leave_balances', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      source_kind: {
        type: Sequelize.STRING(30),
        allowNull: false,
      },
      source_ledger_entry_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'leave_ledger_entries', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      period_allocated: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      allocated: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
      },
      consumed: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
      },
      reserved: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
      },
      expired: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
      },
      expires_at: {
        type: Sequelize.DATEONLY,
        allowNull: true,
      },
      expiry_reason: {
        type: Sequelize.STRING(30),
        allowNull: false,
        defaultValue: 'NONE',
      },
      metadata: {
        type: Sequelize.JSONB,
        allowNull: true,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('NOW()'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('NOW()'),
      },
    });

    await queryInterface.addIndex('leave_credit_tranches', ['source_ledger_entry_id'], {
      name: 'leave_credit_tranches_source_ledger_unique',
      unique: true,
    });
    await queryInterface.addIndex('leave_credit_tranches', ['balance_id'], {
      name: 'leave_credit_tranches_balance_idx',
    });
    await queryInterface.addIndex(
      'leave_credit_tranches',
      ['organization_id', 'employee_id', 'leave_type_id', 'expires_at'],
      { name: 'leave_credit_tranches_expiry_idx' },
    );

    await queryInterface.createTable('leave_request_credit_allocations', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      organization_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'organizations', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      request_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'leave_requests', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      tranche_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'leave_credit_tranches', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      reserved_units: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
      },
      consumed_units: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
      },
      restored_units: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('NOW()'),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('NOW()'),
      },
    });

    await queryInterface.addIndex(
      'leave_request_credit_allocations',
      ['request_id', 'tranche_id'],
      { name: 'leave_request_credit_allocations_request_tranche_unique', unique: true },
    );
    await queryInterface.addIndex('leave_request_credit_allocations', ['tranche_id'], {
      name: 'leave_request_credit_allocations_tranche_idx',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('leave_request_credit_allocations');
    await queryInterface.dropTable('leave_credit_tranches');
    await queryInterface.removeColumn('leave_ledger_entries', 'expired_delta');
    await queryInterface.removeColumn('leave_balances', 'expired_balance');
    await queryInterface.removeColumn('leave_policies', 'monthly_usage_limit');
    await queryInterface.removeColumn('leave_policies', 'monthly_usage_limit_enabled');
    await queryInterface.removeColumn('leave_policies', 'max_credits_per_application');
    await queryInterface.removeColumn('leave_policies', 'reset_period');
    await queryInterface.removeColumn('leave_policies', 'carry_forward_order');
    await queryInterface.removeColumn('leave_policies', 'carry_forward_expiry_months');
    await queryInterface.removeColumn('leave_policies', 'carry_forward_enabled');
    // PostgreSQL cannot remove a value from an enum type; leaving EXPIRY in
    // place is harmless because no remaining code writes it.
    if (queryInterface.sequelize.getDialect() !== 'postgres') {
      await queryInterface.sequelize.query('SELECT 1');
    }
  },
};
