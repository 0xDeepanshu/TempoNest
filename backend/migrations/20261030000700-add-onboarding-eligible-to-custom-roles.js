'use strict';

/**
 * Marks custom roles that may be selected when onboarding a new employee.
 * Only roles explicitly opted in by an owner/administrator can be used by
 * people holding the delegated `member:onboard` permission.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('custom_roles', 'onboarding_eligible', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('custom_roles', 'onboarding_eligible');
  },
};
