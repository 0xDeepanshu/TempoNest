'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('screen_live_sessions', {
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
      started_by_user_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      status: {
        type: Sequelize.STRING(16),
        allowNull: false,
        defaultValue: 'ACTIVE',
      },
      started_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      expires_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      ended_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      termination_reason: {
        type: Sequelize.STRING(64),
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

    // At most one live session per employee; multiple viewers share it.
    await queryInterface.addIndex('screen_live_sessions', ['organization_id', 'employee_id'], {
      name: 'screen_live_sessions_active_employee_unique',
      unique: true,
      where: { status: 'ACTIVE' },
    });
    await queryInterface.addIndex(
      'screen_live_sessions',
      ['organization_id', 'status', 'expires_at'],
      { name: 'screen_live_sessions_org_status_expires_idx' },
    );
    await queryInterface.addIndex('screen_live_sessions', ['desktop_agent_id', 'status'], {
      name: 'screen_live_sessions_agent_status_idx',
    });
    await queryInterface.addIndex(
      'screen_live_sessions',
      ['organization_id', 'employee_id', 'started_at'],
      { name: 'screen_live_sessions_employee_started_idx' },
    );

    await queryInterface.createTable('screen_live_viewers', {
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
      screen_live_session_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'screen_live_sessions', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      user_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      ticket_hash: {
        type: Sequelize.STRING(64),
        allowNull: true,
      },
      ticket_expires_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      joined_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      left_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      last_seen_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      disconnected_reason: {
        type: Sequelize.STRING(64),
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

    await queryInterface.addIndex('screen_live_viewers', ['screen_live_session_id'], {
      name: 'screen_live_viewers_session_idx',
    });
    await queryInterface.addIndex('screen_live_viewers', ['ticket_hash'], {
      name: 'screen_live_viewers_ticket_unique',
      unique: true,
    });
    await queryInterface.addIndex('screen_live_viewers', ['organization_id', 'user_id'], {
      name: 'screen_live_viewers_org_user_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('screen_live_viewers');
    await queryInterface.dropTable('screen_live_sessions');
  },
};
