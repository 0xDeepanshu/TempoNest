'use strict';

/**
 * Adds opt-in scheduled screenshot capture.
 *
 * Forward-only: it only adds scheduling columns to the existing
 * `employee_monitoring_policies` table. Scheduled capture is disabled and any
 * capture slot is cleared for every existing employee, so upgrading a populated
 * database never starts automatic screenshots. General monitoring (manual
 * requests and live viewing) and the organization-wide screenshot policy are
 * left exactly as they were.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('employee_monitoring_policies', 'scheduled_capture_enabled', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
    await queryInterface.addColumn('employee_monitoring_policies', 'capture_interval_minutes', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 30,
    });
    await queryInterface.addColumn('employee_monitoring_policies', 'next_capture_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });
    await queryInterface.addColumn('employee_monitoring_policies', 'last_capture_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });

    // Explicit backfill: existing employees must remain on "Never" even if a
    // previous build left a pending slot behind.
    await queryInterface.sequelize.query(
      `UPDATE employee_monitoring_policies
       SET scheduled_capture_enabled = false,
           next_capture_at = NULL`,
    );

    await queryInterface.addIndex(
      'employee_monitoring_policies',
      ['scheduled_capture_enabled', 'enabled', 'next_capture_at'],
      { name: 'employee_monitoring_policies_due_idx' },
    );
  },

  async down(queryInterface) {
    await queryInterface.removeIndex(
      'employee_monitoring_policies',
      'employee_monitoring_policies_due_idx',
    );
    await queryInterface.removeColumn('employee_monitoring_policies', 'last_capture_at');
    await queryInterface.removeColumn('employee_monitoring_policies', 'next_capture_at');
    await queryInterface.removeColumn('employee_monitoring_policies', 'capture_interval_minutes');
    await queryInterface.removeColumn('employee_monitoring_policies', 'scheduled_capture_enabled');
  },
};
