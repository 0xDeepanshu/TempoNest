'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto";');

    await queryInterface.createTable('organizations', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      name: {
        type: Sequelize.STRING(120),
        allowNull: false,
      },
      slug: {
        type: Sequelize.STRING(140),
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM('ACTIVE', 'SUSPENDED'),
        allowNull: false,
        defaultValue: 'ACTIVE',
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

    await queryInterface.addIndex('organizations', ['slug'], {
      name: 'organizations_slug_unique',
      unique: true,
    });
    await queryInterface.addIndex('organizations', ['status'], {
      name: 'organizations_status_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('organizations');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_organizations_status";');
  },
};
