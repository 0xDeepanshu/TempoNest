'use strict';

/**
 * Extends the existing leave_holidays calendar with categories, half-days,
 * descriptions, and employee applicability, and adds the organization-level
 * holiday settings row. All changes are additive and existing rows keep their
 * current meaning (organization-wide full-day company holidays).
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.removeIndex('leave_holidays', 'leave_holidays_organization_date_unique');

    await queryInterface.addColumn('leave_holidays', 'category', {
      type: Sequelize.STRING(24),
      allowNull: false,
      defaultValue: 'COMPANY',
    });
    await queryInterface.addColumn('leave_holidays', 'duration', {
      type: Sequelize.STRING(16),
      allowNull: false,
      defaultValue: 'FULL_DAY',
    });
    await queryInterface.addColumn('leave_holidays', 'description', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
    await queryInterface.addColumn('leave_holidays', 'applies_to_all', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    });
    await queryInterface.addColumn('leave_holidays', 'applicable_employee_ids', {
      type: Sequelize.JSON,
      allowNull: false,
      defaultValue: Sequelize.literal("'[]'::json"),
    });
    await queryInterface.addColumn('leave_holidays', 'department_ids', {
      type: Sequelize.JSON,
      allowNull: false,
      defaultValue: Sequelize.literal("'[]'::json"),
    });
    await queryInterface.addColumn('leave_holidays', 'location_ids', {
      type: Sequelize.JSON,
      allowNull: false,
      defaultValue: Sequelize.literal("'[]'::json"),
    });
    await queryInterface.addColumn('leave_holidays', 'created_by_user_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    });
    await queryInterface.addColumn('leave_holidays', 'updated_by_user_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'users', key: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    });

    await queryInterface.addIndex('leave_holidays', ['organization_id', 'holiday_date'], {
      name: 'leave_holidays_organization_date_idx',
    });
    await queryInterface.addIndex('leave_holidays', ['organization_id', 'category'], {
      name: 'leave_holidays_organization_category_idx',
    });
    await queryInterface.addIndex('leave_holidays', ['organization_id', 'applies_to_all'], {
      name: 'leave_holidays_organization_applies_idx',
    });

    await queryInterface.createTable('organization_holiday_settings', {
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
      enabled: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      optional_holidays_enabled: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      allow_half_day_holidays: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      default_calendar_year: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      default_applicability: {
        type: Sequelize.STRING(24),
        allowNull: false,
        defaultValue: 'ORGANIZATION',
      },
      working_days: {
        type: Sequelize.JSON,
        allowNull: false,
        defaultValue: Sequelize.literal("'[1,2,3,4,5]'::json"),
      },
      updated_by_user_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
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
      'organization_holiday_settings',
      ['organization_id'],
      { name: 'organization_holiday_settings_org_unique', unique: true },
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('organization_holiday_settings');

    await queryInterface.removeIndex('leave_holidays', 'leave_holidays_organization_applies_idx');
    await queryInterface.removeIndex('leave_holidays', 'leave_holidays_organization_category_idx');
    await queryInterface.removeIndex('leave_holidays', 'leave_holidays_organization_date_idx');

    await queryInterface.removeColumn('leave_holidays', 'updated_by_user_id');
    await queryInterface.removeColumn('leave_holidays', 'created_by_user_id');
    await queryInterface.removeColumn('leave_holidays', 'location_ids');
    await queryInterface.removeColumn('leave_holidays', 'department_ids');
    await queryInterface.removeColumn('leave_holidays', 'applicable_employee_ids');
    await queryInterface.removeColumn('leave_holidays', 'applies_to_all');
    await queryInterface.removeColumn('leave_holidays', 'description');
    await queryInterface.removeColumn('leave_holidays', 'duration');
    await queryInterface.removeColumn('leave_holidays', 'category');

    await queryInterface.addIndex('leave_holidays', ['organization_id', 'holiday_date'], {
      name: 'leave_holidays_organization_date_unique',
      unique: true,
    });
  },
};
