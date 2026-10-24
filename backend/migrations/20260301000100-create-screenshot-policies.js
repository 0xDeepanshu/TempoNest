'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('screenshot_policies', {
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
      enabled: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      request_roles: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: Sequelize.literal(`'["OWNER","ADMIN"]'::jsonb`),
      },
      view_roles: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: Sequelize.literal(`'["OWNER","ADMIN"]'::jsonb`),
      },
      request_cooldown_seconds: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 5,
      },
      retention_days: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 30,
      },
      audit_retention_days: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 365,
      },
      employee_acknowledgement_required: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      disclosure_version: {
        type: Sequelize.STRING(64),
        allowNull: false,
        defaultValue: 'v1',
      },
      disclosure_text: {
        type: Sequelize.TEXT,
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

    await queryInterface.addIndex('screenshot_policies', ['organization_id'], {
      name: 'screenshot_policies_org_unique',
      unique: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('screenshot_policies');
  },
};
