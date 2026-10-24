'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('screenshot_requests', {
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
      requesting_admin_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      desktop_agent_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'desktop_agents', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      time_session_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'time_sessions', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      status: {
        type: Sequelize.ENUM('PENDING', 'CLAIMED', 'COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED'),
        allowNull: false,
        defaultValue: 'PENDING',
      },
      requested_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      expires_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      acknowledged_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      claimed_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      completed_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      cancelled_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      failure_code: {
        type: Sequelize.STRING(64),
        allowNull: true,
      },
      failure_message: {
        type: Sequelize.STRING(500),
        allowNull: true,
      },
      idempotency_key: {
        type: Sequelize.STRING(160),
        allowNull: true,
      },
      expected_content_type: {
        type: Sequelize.STRING(64),
        allowNull: true,
      },
      storage_key: {
        type: Sequelize.STRING(512),
        allowNull: true,
      },
      upload_token_hash: {
        type: Sequelize.STRING(64),
        allowNull: true,
      },
      upload_expires_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      uploaded_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      uploaded_size: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      uploaded_content_type: {
        type: Sequelize.STRING(64),
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

    await queryInterface.sequelize.query(
      `CREATE UNIQUE INDEX screenshot_requests_active_employee_unique
         ON screenshot_requests (organization_id, employee_id)
         WHERE status IN ('PENDING', 'CLAIMED')`,
    );
    await queryInterface.addIndex(
      'screenshot_requests',
      ['organization_id', 'requesting_admin_id', 'idempotency_key'],
      {
        name: 'screenshot_requests_idempotency_unique',
        unique: true,
      },
    );
    await queryInterface.addIndex('screenshot_requests', ['upload_token_hash'], {
      name: 'screenshot_requests_upload_token_unique',
      unique: true,
    });
    await queryInterface.addIndex('screenshot_requests', ['storage_key'], {
      name: 'screenshot_requests_storage_key_unique',
      unique: true,
    });
    await queryInterface.addIndex(
      'screenshot_requests',
      ['organization_id', 'employee_id', 'requested_at'],
      {
        name: 'screenshot_requests_org_employee_requested_idx',
      },
    );
    await queryInterface.addIndex(
      'screenshot_requests',
      ['organization_id', 'status', 'expires_at'],
      {
        name: 'screenshot_requests_org_status_expires_idx',
      },
    );
    await queryInterface.addIndex('screenshot_requests', ['desktop_agent_id', 'status'], {
      name: 'screenshot_requests_agent_status_idx',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('screenshot_requests');
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_screenshot_requests_status";',
    );
  },
};
