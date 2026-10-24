'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('screenshots', {
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
        allowNull: true,
        references: { model: 'time_sessions', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      screenshot_request_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'screenshot_requests', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      requesting_admin_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      captured_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      storage_key: {
        type: Sequelize.STRING(512),
        allowNull: false,
      },
      content_type: {
        type: Sequelize.STRING(64),
        allowNull: false,
      },
      file_size_bytes: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      retention_expires_at: {
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

    await queryInterface.addIndex('screenshots', ['screenshot_request_id'], {
      name: 'screenshots_request_unique',
      unique: true,
    });
    await queryInterface.addIndex('screenshots', ['storage_key'], {
      name: 'screenshots_storage_key_unique',
      unique: true,
    });
    await queryInterface.addIndex('screenshots', ['organization_id', 'employee_id', 'captured_at'], {
      name: 'screenshots_org_employee_captured_idx',
    });
    await queryInterface.addIndex('screenshots', ['organization_id', 'retention_expires_at'], {
      name: 'screenshots_org_retention_idx',
    });
    await queryInterface.addIndex('screenshots', ['retention_expires_at'], {
      name: 'screenshots_retention_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('screenshots');
  },
};
