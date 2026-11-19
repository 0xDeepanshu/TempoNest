'use strict';

/**
 * Half-day requests were always accepted, so the column defaults to true and
 * existing leave types keep their current behaviour. Organizations can now
 * turn half days off per leave type without touching stored requests.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('leave_types', 'allow_half_day', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('leave_types', 'allow_half_day');
  },
};
