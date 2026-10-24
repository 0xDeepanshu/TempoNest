'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('memberships', {
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
      role: {
        type: Sequelize.ENUM('OWNER', 'ADMIN', 'MANAGER', 'EMPLOYEE'),
        allowNull: false,
        defaultValue: 'EMPLOYEE',
      },
      status: {
        type: Sequelize.ENUM('ACTIVE', 'SUSPENDED', 'REMOVED'),
        allowNull: false,
        defaultValue: 'ACTIVE',
      },
      removed_at: {
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

    await queryInterface.addIndex('memberships', ['organization_id', 'user_id'], {
      name: 'memberships_organization_user_unique',
      unique: true,
    });
    await queryInterface.addIndex('memberships', ['organization_id', 'status'], {
      name: 'memberships_organization_status_idx',
    });
    await queryInterface.addIndex('memberships', ['user_id'], {
      name: 'memberships_user_idx',
    });
    await queryInterface.addIndex('memberships', ['organization_id', 'role'], {
      name: 'memberships_organization_role_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('memberships');
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_memberships_role"; DROP TYPE IF EXISTS "enum_memberships_status";',
    );
  },
};
