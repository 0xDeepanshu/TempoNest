'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('audit_events', {
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
      actor_user_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      target_employee_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      action: {
        type: Sequelize.STRING(64),
        allowNull: false,
      },
      entity_type: {
        type: Sequelize.STRING(40),
        allowNull: false,
        defaultValue: 'SCREENSHOT_REQUEST',
      },
      entity_id: {
        type: Sequelize.UUID,
        allowNull: true,
      },
      screenshot_request_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'screenshot_requests', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      screenshot_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'screenshots', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      metadata: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: {},
      },
      ip_address: {
        type: Sequelize.STRING(64),
        allowNull: true,
      },
      user_agent: {
        type: Sequelize.STRING(512),
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

    await queryInterface.addIndex('audit_events', ['organization_id', 'created_at'], {
      name: 'audit_events_org_created_idx',
    });
    await queryInterface.addIndex('audit_events', ['organization_id', 'action'], {
      name: 'audit_events_org_action_idx',
    });
    await queryInterface.addIndex('audit_events', ['screenshot_request_id'], {
      name: 'audit_events_request_idx',
    });
    await queryInterface.addIndex('audit_events', ['screenshot_id'], {
      name: 'audit_events_screenshot_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('audit_events');
  },
};
