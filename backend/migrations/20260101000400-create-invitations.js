'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('invitations', {
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
      email: {
        type: Sequelize.STRING(254),
        allowNull: false,
      },
      role: {
        type: Sequelize.ENUM('ADMIN', 'MANAGER', 'EMPLOYEE'),
        allowNull: false,
        defaultValue: 'EMPLOYEE',
      },
      token_hash: {
        type: Sequelize.STRING(64),
        allowNull: false,
      },
      inviter_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      expires_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      accepted_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      accepted_by_user_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
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

    await queryInterface.addIndex('invitations', ['token_hash'], {
      name: 'invitations_token_hash_unique',
      unique: true,
    });
    await queryInterface.addIndex('invitations', ['organization_id', 'email'], {
      name: 'invitations_organization_email_idx',
    });
    await queryInterface.addIndex('invitations', ['expires_at'], {
      name: 'invitations_expires_at_idx',
    });

    // At most one live (neither accepted nor revoked) invitation per e-mail and
    // organization. The service revokes stale invitations before creating one.
    await queryInterface.sequelize.query(
      `CREATE UNIQUE INDEX invitations_pending_unique
       ON invitations (organization_id, email)
       WHERE accepted_at IS NULL AND revoked_at IS NULL;`,
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('invitations');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_invitations_role";');
  },
};
