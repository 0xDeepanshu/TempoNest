'use strict';

/**
 * Organization-specific customization of the built-in MANAGER role. One
 * override per organization; the absence of a row means "use the built-in
 * MANAGER defaults". The role itself stays the MANAGER enum value and is never
 * converted into a custom role.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('manager_role_overrides', {
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
        defaultValue: 'ORGANIZATION',
      },
      updated_by_user_id: {
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

    await queryInterface.addIndex('manager_role_overrides', ['organization_id'], {
      name: 'manager_role_overrides_org_unique',
      unique: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('manager_role_overrides');
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_manager_role_overrides_data_scope";',
    );
  },
};
