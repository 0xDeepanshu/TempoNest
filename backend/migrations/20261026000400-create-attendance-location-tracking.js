'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('attendance_location_samples', {
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
      desktop_agent_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'desktop_agents', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      time_session_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'time_sessions', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      client_sample_id: {
        type: Sequelize.UUID,
        allowNull: false,
      },
      latitude: {
        type: Sequelize.DOUBLE,
        allowNull: false,
      },
      longitude: {
        type: Sequelize.DOUBLE,
        allowNull: false,
      },
      accuracy_meters: {
        type: Sequelize.DOUBLE,
        allowNull: false,
      },
      captured_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      received_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      source: {
        type: Sequelize.STRING(16),
        allowNull: false,
        defaultValue: 'UNKNOWN',
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
      'attendance_location_samples',
      ['time_session_id', 'client_sample_id'],
      { name: 'attendance_location_samples_client_unique', unique: true },
    );
    await queryInterface.addIndex(
      'attendance_location_samples',
      ['organization_id', 'time_session_id', 'captured_at'],
      { name: 'attendance_location_samples_session_time_idx' },
    );
    await queryInterface.addIndex(
      'attendance_location_samples',
      ['organization_id', 'captured_at'],
      { name: 'attendance_location_samples_org_time_idx' },
    );

    await queryInterface.createTable('attendance_location_tracking', {
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
      desktop_agent_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'desktop_agents', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      time_session_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'time_sessions', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      status: {
        type: Sequelize.ENUM('ACTIVE', 'PAUSED', 'STOPPED'),
        allowNull: false,
      },
      reason: {
        type: Sequelize.STRING(40),
        allowNull: true,
      },
      permission: {
        type: Sequelize.ENUM('ALWAYS', 'FOREGROUND_ONLY', 'DENIED', 'UNKNOWN'),
        allowNull: false,
        defaultValue: 'UNKNOWN',
      },
      background_allowed: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      last_sample_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      last_reported_at: {
        type: Sequelize.DATE,
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

    await queryInterface.addIndex(
      'attendance_location_tracking',
      ['time_session_id'],
      { name: 'attendance_location_tracking_session_unique', unique: true },
    );
    await queryInterface.addIndex(
      'attendance_location_tracking',
      ['organization_id', 'updated_at'],
      { name: 'attendance_location_tracking_org_updated_idx' },
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('attendance_location_tracking');
    await queryInterface.dropTable('attendance_location_samples');
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_attendance_location_tracking_status"',
    );
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_attendance_location_tracking_permission"',
    );
  },
};
