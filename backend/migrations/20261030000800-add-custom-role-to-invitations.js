'use strict';

/**
 * Invitations may target an onboarding-eligible custom role. Such invitations
 * keep the EMPLOYEE base role and only carry the custom role reference, so an
 * invited person can never gain administrative capabilities.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('invitations', 'custom_role_id', {
      type: Sequelize.UUID,
      allowNull: true,
      references: { model: 'custom_roles', key: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    });
    await queryInterface.addIndex('invitations', ['custom_role_id'], {
      name: 'invitations_custom_role_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('invitations', 'invitations_custom_role_idx');
    await queryInterface.removeColumn('invitations', 'custom_role_id');
  },
};
