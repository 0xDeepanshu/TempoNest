'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('agent_sync_events', {
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
      event_id: {
        type: Sequelize.STRING(160),
        allowNull: false,
      },
      event_type: {
        type: Sequelize.ENUM('SESSION_START', 'SESSION_STOP', 'BREAK_START', 'BREAK_END'),
        allowNull: false,
      },
      occurred_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM('APPLIED', 'CONFLICT'),
        allowNull: false,
      },
      conflict_code: {
        type: Sequelize.STRING(80),
        allowNull: true,
      },
      message: {
        type: Sequelize.STRING(500),
        allowNull: true,
      },
      result: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: {},
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

    await queryInterface.addIndex('agent_sync_events', ['desktop_agent_id', 'event_id'], {
      name: 'agent_sync_events_agent_event_unique',
      unique: true,
    });
    await queryInterface.addIndex('agent_sync_events', ['organization_id', 'occurred_at'], {
      name: 'agent_sync_events_org_occurred_idx',
    });
    await queryInterface.addIndex('agent_sync_events', ['employee_id', 'occurred_at'], {
      name: 'agent_sync_events_employee_occurred_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('agent_sync_events');
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_agent_sync_events_event_type"; DROP TYPE IF EXISTS "enum_agent_sync_events_status";',
    );
  },
};
