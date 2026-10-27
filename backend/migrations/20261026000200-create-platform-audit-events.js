'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('platform_audit_events', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      actor_user_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      target_organization_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'organizations', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      target_organization_name: {
        type: Sequelize.STRING(120),
        allowNull: false,
      },
      action: {
        type: Sequelize.STRING(64),
        allowNull: false,
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

    await queryInterface.addIndex(
      'platform_audit_events',
      ['target_organization_id', 'created_at'],
      { name: 'platform_audit_events_org_created_idx' },
    );
    await queryInterface.addIndex(
      'platform_audit_events',
      ['actor_user_id', 'created_at'],
      { name: 'platform_audit_events_actor_created_idx' },
    );
    await queryInterface.addIndex(
      'platform_audit_events',
      ['action', 'created_at'],
      { name: 'platform_audit_events_action_created_idx' },
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('platform_audit_events');
  },
};
