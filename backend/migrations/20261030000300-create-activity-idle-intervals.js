'use strict';

/**
 * Server-validated idle intervals reported by the desktop agent. Only idle
 * periods are stored; active time is derived from session time minus breaks
 * and idle time so the same time is never counted twice.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('activity_idle_intervals', {
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
      time_session_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'time_sessions', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      desktop_agent_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'desktop_agents', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      idempotency_key: {
        type: Sequelize.STRING(160),
        allowNull: false,
      },
      started_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      ended_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      duration_seconds: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      threshold_seconds: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      platform: {
        type: Sequelize.STRING(40),
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

    await queryInterface.addIndex('activity_idle_intervals', ['desktop_agent_id', 'idempotency_key'], {
      name: 'activity_idle_intervals_agent_key_unique',
      unique: true,
    });
    await queryInterface.addIndex(
      'activity_idle_intervals',
      ['organization_id', 'employee_id', 'started_at'],
      { name: 'activity_idle_intervals_org_employee_started_idx' },
    );
    await queryInterface.addIndex('activity_idle_intervals', ['time_session_id', 'started_at'], {
      name: 'activity_idle_intervals_session_started_idx',
    });
    await queryInterface.addIndex('activity_idle_intervals', ['organization_id', 'started_at'], {
      name: 'activity_idle_intervals_org_started_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('activity_idle_intervals');
  },
};
