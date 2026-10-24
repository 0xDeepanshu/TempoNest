'use strict';

/**
 * Organizations report in their own IANA timezone. Timestamps remain stored in
 * UTC; reporting converts local date boundaries to UTC instants.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('organizations', 'timezone', {
      type: Sequelize.STRING(64),
      allowNull: false,
      defaultValue: 'UTC',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('organizations', 'timezone');
  },
};
