'use strict';

/**
 * Binds the Flowtrium organization to the browser authorization attempt so the
 * code exchange cannot link a different external organization than the one the
 * WorkZen administrator approved. Forward-only and additive.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn(
      'integration_authorization_requests',
      'external_organization_id',
      {
        type: Sequelize.STRING(200),
        allowNull: true,
      },
    );
  },

  async down(queryInterface) {
    await queryInterface.removeColumn(
      'integration_authorization_requests',
      'external_organization_id',
    );
  },
};
