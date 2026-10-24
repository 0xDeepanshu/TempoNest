'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('breaks', {
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
      time_session_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'time_sessions', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      started_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      ended_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      status: {
        type: Sequelize.ENUM('ACTIVE', 'ENDED'),
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

    await queryInterface.addIndex('breaks', ['time_session_id'], {
      name: 'breaks_active_session_unique',
      unique: true,
      where: { ended_at: null },
    });
    await queryInterface.addIndex('breaks', ['time_session_id', 'started_at'], {
      name: 'breaks_session_started_idx',
    });
    await queryInterface.addIndex('breaks', ['organization_id', 'started_at'], {
      name: 'breaks_org_started_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('breaks');
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_breaks_status";');
  },
};
