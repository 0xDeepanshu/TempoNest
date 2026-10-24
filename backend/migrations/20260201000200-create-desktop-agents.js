'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('desktop_agents', {
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
      user_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      device_identifier: {
        type: Sequelize.STRING(160),
        allowNull: false,
      },
      name: {
        type: Sequelize.STRING(120),
        allowNull: false,
      },
      platform: {
        type: Sequelize.STRING(40),
        allowNull: true,
      },
      os_version: {
        type: Sequelize.STRING(80),
        allowNull: true,
      },
      app_version: {
        type: Sequelize.STRING(40),
        allowNull: true,
      },
      agent_key_hash: {
        type: Sequelize.STRING(64),
        allowNull: false,
      },
      last_seen_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      last_connected_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      last_disconnected_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      revoked_at: {
        type: Sequelize.DATE,
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

    await queryInterface.addIndex('desktop_agents', ['organization_id', 'user_id', 'device_identifier'], {
      name: 'desktop_agents_org_user_device_unique',
      unique: true,
    });
    await queryInterface.addIndex('desktop_agents', ['organization_id', 'user_id'], {
      name: 'desktop_agents_org_user_idx',
    });
    await queryInterface.addIndex('desktop_agents', ['organization_id', 'revoked_at'], {
      name: 'desktop_agents_org_revoked_idx',
    });
    await queryInterface.addIndex('desktop_agents', ['last_seen_at'], {
      name: 'desktop_agents_last_seen_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('desktop_agents');
  },
};
