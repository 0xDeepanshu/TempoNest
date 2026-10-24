'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('screenshot_policy_acknowledgements', {
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
      policy_version: {
        type: Sequelize.STRING(64),
        allowNull: false,
      },
      acknowledged_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('NOW()'),
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

    await queryInterface.addIndex(
      'screenshot_policy_acknowledgements',
      ['organization_id', 'employee_id', 'policy_version'],
      {
        name: 'screenshot_ack_org_employee_version_unique',
        unique: true,
      },
    );
    await queryInterface.addIndex(
      'screenshot_policy_acknowledgements',
      ['organization_id', 'employee_id'],
      {
        name: 'screenshot_ack_org_employee_idx',
      },
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('screenshot_policy_acknowledgements');
  },
};
