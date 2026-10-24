'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('application_activities', {
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
      application_identifier: {
        type: Sequelize.STRING(200),
        allowNull: false,
      },
      application_name: {
        type: Sequelize.STRING(255),
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
      idempotency_key: {
        type: Sequelize.STRING(160),
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

    await queryInterface.addIndex('application_activities', ['desktop_agent_id', 'idempotency_key'], {
      name: 'application_activities_agent_key_unique',
      unique: true,
    });
    await queryInterface.addIndex('application_activities', ['organization_id', 'employee_id', 'started_at'], {
      name: 'application_activities_org_employee_started_idx',
    });
    await queryInterface.addIndex('application_activities', ['time_session_id', 'started_at'], {
      name: 'application_activities_session_started_idx',
    });
    await queryInterface.addIndex('application_activities', ['organization_id', 'started_at'], {
      name: 'application_activities_org_started_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('application_activities');
  },
};
