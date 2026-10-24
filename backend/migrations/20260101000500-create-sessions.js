'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('sessions', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      user_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      access_token_hash: {
        type: Sequelize.STRING(64),
        allowNull: false,
      },
      access_expires_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      refresh_token_hash: {
        type: Sequelize.STRING(64),
        allowNull: false,
      },
      previous_refresh_token_hash: {
        type: Sequelize.STRING(64),
        allowNull: true,
      },
      refresh_expires_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      csrf_token_hash: {
        type: Sequelize.STRING(64),
        allowNull: false,
      },
      user_agent: {
        type: Sequelize.STRING(512),
        allowNull: true,
      },
      ip_address: {
        type: Sequelize.STRING(45),
        allowNull: true,
      },
      last_used_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('NOW()'),
      },
      rotated_at: {
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

    await queryInterface.addIndex('sessions', ['access_token_hash'], {
      name: 'sessions_access_token_hash_unique',
      unique: true,
    });
    await queryInterface.addIndex('sessions', ['refresh_token_hash'], {
      name: 'sessions_refresh_token_hash_unique',
      unique: true,
    });
    await queryInterface.addIndex('sessions', ['user_id'], {
      name: 'sessions_user_idx',
    });
    await queryInterface.addIndex('sessions', ['previous_refresh_token_hash'], {
      name: 'sessions_previous_refresh_idx',
    });
    await queryInterface.addIndex('sessions', ['refresh_expires_at'], {
      name: 'sessions_refresh_expires_idx',
    });
    await queryInterface.addIndex('sessions', ['revoked_at'], {
      name: 'sessions_revoked_at_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('sessions');
  },
};
