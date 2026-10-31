'use strict';

/**
 * Organization-scoped application catalog. Rows are populated only by explicit
 * administrator action. Observed applications without a row are reported as
 * UNCLASSIFIED at query time; they are never implicitly unproductive.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('application_classifications', {
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
      application_identifier: {
        type: Sequelize.STRING(200),
        allowNull: false,
      },
      application_name: {
        type: Sequelize.STRING(255),
        allowNull: false,
      },
      category: {
        type: Sequelize.ENUM('PRODUCTIVE', 'NEUTRAL', 'UNPRODUCTIVE', 'UNCLASSIFIED'),
        allowNull: false,
        defaultValue: 'UNCLASSIFIED',
      },
      classified_by_user_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      notes: {
        type: Sequelize.TEXT,
        allowNull: true,
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
      'application_classifications',
      ['organization_id', 'application_identifier'],
      {
        name: 'application_classifications_org_identifier_unique',
        unique: true,
      },
    );
    await queryInterface.addIndex('application_classifications', ['organization_id', 'category'], {
      name: 'application_classifications_org_category_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('application_classifications');
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_application_classifications_category";',
    );
  },
};
