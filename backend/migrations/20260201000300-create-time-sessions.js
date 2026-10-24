'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('time_sessions', {
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
        allowNull: true,
        references: { model: 'desktop_agents', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      started_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      ended_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      status: {
        type: Sequelize.ENUM('ACTIVE', 'ON_BREAK', 'STOPPED'),
        allowNull: false,
        defaultValue: 'ACTIVE',
      },
      source: {
        type: Sequelize.ENUM('ONLINE', 'OFFLINE'),
        allowNull: false,
        defaultValue: 'ONLINE',
      },
      last_heartbeat_at: {
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

    // Partial unique indexes permit exactly one open session per employee and
    // per agent while retaining full historical sessions.
    await queryInterface.addIndex('time_sessions', ['employee_id'], {
      name: 'time_sessions_active_employee_unique',
      unique: true,
      where: { ended_at: null },
    });
    await queryInterface.addIndex('time_sessions', ['desktop_agent_id'], {
      name: 'time_sessions_active_agent_unique',
      unique: true,
      where: { ended_at: null },
    });
    await queryInterface.addIndex('time_sessions', ['organization_id', 'employee_id', 'started_at'], {
      name: 'time_sessions_org_employee_started_idx',
    });
    await queryInterface.addIndex('time_sessions', ['organization_id', 'started_at'], {
      name: 'time_sessions_org_started_idx',
    });
    await queryInterface.addIndex('time_sessions', ['desktop_agent_id', 'started_at'], {
      name: 'time_sessions_agent_started_idx',
    });
    await queryInterface.addIndex('time_sessions', ['last_heartbeat_at'], {
      name: 'time_sessions_heartbeat_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('time_sessions');
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_time_sessions_status"; DROP TYPE IF EXISTS "enum_time_sessions_source";',
    );
  },
};
