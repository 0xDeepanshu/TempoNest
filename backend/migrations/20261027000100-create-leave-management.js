'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('leave_types', {
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
      name: {
        type: Sequelize.STRING(120),
        allowNull: false,
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      is_paid: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      requires_balance: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      allow_negative_balance: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      max_consecutive_days: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      min_notice_days: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      requires_documentation: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      allow_approved_cancellation: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      cancellation_requires_approval: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
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

    await queryInterface.addIndex('leave_types', ['organization_id', 'name'], {
      name: 'leave_types_organization_name_unique',
      unique: true,
    });
    await queryInterface.addIndex('leave_types', ['organization_id', 'is_active'], {
      name: 'leave_types_organization_active_idx',
    });

    await queryInterface.createTable('leave_policies', {
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
      leave_type_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'leave_types', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      initial_entitlement: {
        type: Sequelize.DECIMAL(8, 2),
        allowNull: false,
        defaultValue: 0,
      },
      accrual_frequency: {
        type: Sequelize.ENUM('NONE', 'MONTHLY', 'QUARTERLY', 'ANNUAL'),
        allowNull: false,
        defaultValue: 'NONE',
      },
      accrual_amount: {
        type: Sequelize.DECIMAL(8, 2),
        allowNull: false,
        defaultValue: 0,
      },
      balance_period_start_month: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
      balance_period_start_day: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
      carry_forward_allowance: {
        type: Sequelize.DECIMAL(8, 2),
        allowNull: false,
        defaultValue: 0,
      },
      max_balance: {
        type: Sequelize.DECIMAL(8, 2),
        allowNull: true,
      },
      prorate_initial_entitlement: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      working_days: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: [1, 2, 3, 4, 5],
      },
      is_active: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
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

    await queryInterface.addIndex('leave_policies', ['organization_id', 'leave_type_id'], {
      name: 'leave_policies_organization_type_unique',
      unique: true,
    });
    await queryInterface.addIndex('leave_policies', ['leave_type_id'], {
      name: 'leave_policies_leave_type_idx',
    });

    await queryInterface.createTable('leave_holidays', {
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
      holiday_date: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      name: {
        type: Sequelize.STRING(120),
        allowNull: false,
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

    await queryInterface.addIndex('leave_holidays', ['organization_id', 'holiday_date'], {
      name: 'leave_holidays_organization_date_unique',
      unique: true,
    });

    await queryInterface.createTable('leave_balances', {
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
      period_start: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      period_end: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      entitled_balance: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
      },
      accrued_balance: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
      },
      adjustment_balance: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
      },
      carried_forward_balance: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
      },
      approved_consumed: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
      },
      pending_reserved: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
      },
      available_balance: {
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
      'leave_balances',
      ['organization_id', 'employee_id', 'leave_type_id', 'period_start'],
      { name: 'leave_balances_employee_type_period_unique', unique: true },
    );
    await queryInterface.addIndex('leave_balances', ['organization_id', 'period_start'], {
      name: 'leave_balances_organization_period_idx',
    });
    await queryInterface.addIndex('leave_balances', ['employee_id'], {
      name: 'leave_balances_employee_idx',
    });

    await queryInterface.createTable('leave_requests', {
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
      start_date: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      end_date: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      start_half_day: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      end_half_day: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      units: {
        type: Sequelize.DECIMAL(8, 2),
        allowNull: false,
      },
      charged_dates: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      balance_period_start: {
        type: Sequelize.DATEONLY,
        allowNull: true,
      },
      reason: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      documentation_reference: {
        type: Sequelize.STRING(500),
        allowNull: true,
      },
      status: {
        type: Sequelize.ENUM(
          'PENDING',
          'APPROVED',
          'REJECTED',
          'CANCELLED',
          'CANCELLATION_REQUESTED',
        ),
        allowNull: false,
        defaultValue: 'PENDING',
      },
      idempotency_key: {
        type: Sequelize.STRING(128),
        allowNull: true,
      },
      submitted_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      reviewed_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      reviewed_by_user_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      reviewer_note: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      rejection_reason: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      cancellation_requested_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      cancelled_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      cancelled_by_user_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      cancellation_reason: {
        type: Sequelize.TEXT,
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

    await queryInterface.addIndex('leave_requests', ['organization_id', 'employee_id', 'status'], {
      name: 'leave_requests_org_employee_status_idx',
    });
    await queryInterface.addIndex('leave_requests', ['organization_id', 'status'], {
      name: 'leave_requests_org_status_idx',
    });
    await queryInterface.addIndex('leave_requests', ['organization_id', 'start_date', 'end_date'], {
      name: 'leave_requests_org_dates_idx',
    });
    await queryInterface.addIndex('leave_requests', ['employee_id', 'leave_type_id'], {
      name: 'leave_requests_employee_type_idx',
    });
    await queryInterface.addIndex(
      'leave_requests',
      ['organization_id', 'employee_id', 'idempotency_key'],
      { name: 'leave_requests_idempotency_unique', unique: true },
    );

    await queryInterface.createTable('leave_ledger_entries', {
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
      balance_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'leave_balances', key: 'id' },
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
      leave_request_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'leave_requests', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      kind: {
        type: Sequelize.ENUM(
          'INITIAL_ENTITLEMENT',
          'ACCRUAL',
          'CARRY_FORWARD',
          'ADJUSTMENT',
          'RESERVATION',
          'RESERVATION_RELEASE',
          'CONSUMPTION',
          'CONSUMPTION_RESTORE',
        ),
        allowNull: false,
      },
      entitled_delta: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
      },
      accrued_delta: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
      },
      adjustment_delta: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
      },
      carried_forward_delta: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
      },
      reserved_delta: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
      },
      consumed_delta: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
      },
      available_delta: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
      },
      balance_after: {
        type: Sequelize.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0,
      },
      reason: {
        type: Sequelize.STRING(500),
        allowNull: true,
      },
      idempotency_key: {
        type: Sequelize.STRING(128),
        allowNull: true,
      },
      actor_user_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
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

    await queryInterface.addIndex('leave_ledger_entries', ['balance_id', 'idempotency_key'], {
      name: 'leave_ledger_balance_key_unique',
      unique: true,
    });
    await queryInterface.addIndex('leave_ledger_entries', ['balance_id', 'created_at'], {
      name: 'leave_ledger_balance_created_idx',
    });
    await queryInterface.addIndex(
      'leave_ledger_entries',
      ['organization_id', 'employee_id', 'created_at'],
      { name: 'leave_ledger_org_employee_idx' },
    );
    await queryInterface.addIndex('leave_ledger_entries', ['leave_request_id'], {
      name: 'leave_ledger_request_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('leave_ledger_entries');
    await queryInterface.dropTable('leave_requests');
    await queryInterface.dropTable('leave_balances');
    await queryInterface.dropTable('leave_holidays');
    await queryInterface.dropTable('leave_policies');
    await queryInterface.dropTable('leave_types');
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_leave_ledger_entries_kind"; DROP TYPE IF EXISTS "enum_leave_requests_status"; DROP TYPE IF EXISTS "enum_leave_policies_accrual_frequency";',
    );
  },
};
