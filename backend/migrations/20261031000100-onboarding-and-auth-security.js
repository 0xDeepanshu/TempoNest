'use strict';

/**
 * Invitations now carry the invited person's display name so the account can
 * be created during onboarding. Users gain per-account brute-force counter
 * fields; these complement (not replace) the per-IP login rate limiter.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('invitations', 'name', {
      type: Sequelize.STRING(120),
      allowNull: true,
    });

    await queryInterface.addColumn('users', 'failed_login_attempts', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0,
    });

    await queryInterface.addColumn('users', 'locked_until', {
      type: Sequelize.DATE,
      allowNull: true,
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('users', 'locked_until');
    await queryInterface.removeColumn('users', 'failed_login_attempts');
    await queryInterface.removeColumn('invitations', 'name');
  },
};
