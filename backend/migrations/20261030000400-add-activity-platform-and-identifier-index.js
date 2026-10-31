'use strict';

/**
 * Records the operating-system platform reported with foreground events and
 * supports organization-wide application discovery for classification.
 * Both changes are additive and safe to roll back.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('application_activities', 'platform', {
      type: Sequelize.STRING(40),
      allowNull: true,
    });
    await queryInterface.addIndex(
      'application_activities',
      ['organization_id', 'application_identifier'],
      { name: 'application_activities_org_identifier_idx' },
    );
  },

  async down(queryInterface) {
    await queryInterface.removeIndex(
      'application_activities',
      'application_activities_org_identifier_idx',
    );
    await queryInterface.removeColumn('application_activities', 'platform');
  },
};
