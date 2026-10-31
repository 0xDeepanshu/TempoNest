'use strict';

/**
 * Organization-scoped custom roles. Built-in roles remain the authorization
 * backbone; a recognized membership may additionally point at one custom role.
 * Names are unique per organization after case-insensitive normalization.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('custom_roles', {
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
      name: {
        type: Sequelize.STRING(80),
        allowNull: false,
      },
      name_normalized: {
        type: Sequelize.STRING(80),
        allowNull: false,
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      permissions: {
        type: Sequelize.JSON,
        allowNull: false,
        defaultValue: Sequelize.literal("'[]'::json"),
      },
      data_scope: {
        type: Sequelize.ENUM('SELF', 'ORGANIZATION'),
        allowNull: false,
        defaultValue: 'SELF',
      },
      created_by_user_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
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

    await queryInterface.addIndex('custom_roles', ['organization_id', 'name_normalized'], {
      name: 'custom_roles_org_name_unique',
      unique: true,
    });
    await queryInterface.addIndex('custom_roles', ['organization_id', 'created_at'], {
      name: 'custom_roles_org_created_idx',
    });

    await queryInterface.addColumn('memberships', 'custom_role_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'custom_roles', key: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    });
    await queryInterface.addIndex('memberships', ['custom_role_id'], {
      name: 'memberships_custom_role_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('memberships', 'memberships_custom_role_idx');
    await queryInterface.removeColumn('memberships', 'custom_role_id');
    await queryInterface.dropTable('custom_roles');
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_custom_roles_data_scope";',
    );
  },
};
