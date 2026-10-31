'use strict';

/**
 * Organization-scoped desktop tracking policy. A row is created lazily with
 * privacy-preserving defaults; the absence of a row is treated as the default
 * policy by the application. Disabling app tracking never deletes history.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('organization_tracking_settings', {
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
      app_tracking_enabled: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      idle_detection_enabled: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      idle_threshold_minutes: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 5,
      },
      productivity_classification_enabled: {
        type: Sequelize.BOOLEAN,
        allowNull: false,
        defaultValue: true,
      },
      activity_retention_days: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 90,
      },
      policy_version: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
      policy_updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('NOW()'),
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

    await queryInterface.addIndex('organization_tracking_settings', ['organization_id'], {
      name: 'organization_tracking_settings_org_unique',
      unique: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('organization_tracking_settings');
  },
};
