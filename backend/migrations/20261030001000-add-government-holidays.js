'use strict';

/**
 * Adds government holiday provenance and publication state to the existing
 * holiday calendar, plus the organization's government jurisdiction defaults.
 * Existing rows stay published manual holidays, so attendance and leave
 * calculations are unchanged until an organization imports and publishes
 * government holidays.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('leave_holidays', 'published', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    });
    await queryInterface.addColumn('leave_holidays', 'source', {
      type: Sequelize.STRING(24),
      allowNull: false,
      defaultValue: 'MANUAL',
    });
    await queryInterface.addColumn('leave_holidays', 'source_id', {
      type: Sequelize.STRING(120),
      allowNull: true,
    });
    await queryInterface.addColumn('leave_holidays', 'source_year', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
    await queryInterface.addColumn('leave_holidays', 'source_name', {
      type: Sequelize.STRING(200),
      allowNull: true,
    });
    await queryInterface.addColumn('leave_holidays', 'source_url', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
    await queryInterface.addColumn('leave_holidays', 'source_reference', {
      type: Sequelize.STRING(240),
      allowNull: true,
    });
    await queryInterface.addColumn('leave_holidays', 'jurisdiction_country', {
      type: Sequelize.STRING(8),
      allowNull: true,
    });
    await queryInterface.addColumn('leave_holidays', 'jurisdiction_region', {
      type: Sequelize.STRING(40),
      allowNull: true,
    });
    await queryInterface.addColumn('leave_holidays', 'imported_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });

    await queryInterface.addIndex(
      'leave_holidays',
      ['organization_id', 'source_id'],
      { name: 'leave_holidays_organization_source_unique', unique: true },
    );
    await queryInterface.addIndex('leave_holidays', ['organization_id', 'published'], {
      name: 'leave_holidays_organization_published_idx',
    });

    await queryInterface.addColumn('organization_holiday_settings', 'government_country', {
      type: Sequelize.STRING(8),
      allowNull: false,
      defaultValue: 'IN',
    });
    await queryInterface.addColumn('organization_holiday_settings', 'government_region', {
      type: Sequelize.STRING(40),
      allowNull: true,
    });
    await queryInterface.addColumn('organization_holiday_settings', 'government_year', {
      type: Sequelize.INTEGER,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('organization_holiday_settings', 'government_year');
    await queryInterface.removeColumn('organization_holiday_settings', 'government_region');
    await queryInterface.removeColumn('organization_holiday_settings', 'government_country');

    await queryInterface.removeIndex(
      'leave_holidays',
      'leave_holidays_organization_published_idx',
    );
    await queryInterface.removeIndex(
      'leave_holidays',
      'leave_holidays_organization_source_unique',
    );

    await queryInterface.removeColumn('leave_holidays', 'imported_at');
    await queryInterface.removeColumn('leave_holidays', 'jurisdiction_region');
    await queryInterface.removeColumn('leave_holidays', 'jurisdiction_country');
    await queryInterface.removeColumn('leave_holidays', 'source_reference');
    await queryInterface.removeColumn('leave_holidays', 'source_url');
    await queryInterface.removeColumn('leave_holidays', 'source_name');
    await queryInterface.removeColumn('leave_holidays', 'source_year');
    await queryInterface.removeColumn('leave_holidays', 'source_id');
    await queryInterface.removeColumn('leave_holidays', 'source');
    await queryInterface.removeColumn('leave_holidays', 'published');
  },
};
