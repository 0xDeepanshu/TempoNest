'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('desktop_agents', 'client_type', {
      type: Sequelize.ENUM('ELECTRON', 'MOBILE'),
      allowNull: false,
      defaultValue: 'ELECTRON',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('desktop_agents', 'client_type');
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_desktop_agents_client_type";',
    );
  },
};
