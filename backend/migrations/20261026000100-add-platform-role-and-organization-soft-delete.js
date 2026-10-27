'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Raw DDL avoids Sequelize's DO-block enum creation, which requires PL/pgSQL
    // and fails where host application-control policy blocks plpgsql.dll.
    await queryInterface.sequelize.query(
      `CREATE TYPE "enum_users_platform_role" AS ENUM ('SUPERADMIN')`,
    );
    await queryInterface.sequelize.query(
      `ALTER TABLE "users" ADD COLUMN "platform_role" "enum_users_platform_role"`,
    );

    await queryInterface.addColumn('organizations', 'deleted_at', {
      type: Sequelize.DATE,
      allowNull: true,
    });

    await queryInterface.addIndex('organizations', ['deleted_at'], {
      name: 'organizations_deleted_at_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('organizations', 'organizations_deleted_at_idx');
    await queryInterface.removeColumn('organizations', 'deleted_at');
    await queryInterface.removeColumn('users', 'platform_role');

    if (queryInterface.sequelize.getDialect() === 'postgres') {
      await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_users_platform_role";');
    }
  },
};
