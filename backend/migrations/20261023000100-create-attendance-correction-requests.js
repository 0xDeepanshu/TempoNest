'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('attendance_correction_requests', {
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
      time_session_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'time_sessions', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      request_type: {
        type: Sequelize.ENUM('CREATE_SESSION', 'UPDATE_SESSION'),
        allowNull: false,
      },
      work_date: {
        type: Sequelize.DATEONLY,
        allowNull: false,
      },
      requested_started_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      requested_ended_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      requested_breaks: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: [],
      },
      reason: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM('PENDING', 'APPROVED', 'REJECTED'),
        allowNull: false,
        defaultValue: 'PENDING',
      },
      original_snapshot: {
        type: Sequelize.JSONB,
        allowNull: true,
      },
      applied_snapshot: {
        type: Sequelize.JSONB,
        allowNull: true,
      },
      resulting_session_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'time_sessions', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      reviewed_by_user_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      reviewed_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      reviewer_note: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      rejection_reason: {
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
      'attendance_correction_requests',
      ['organization_id', 'status', 'created_at'],
      { name: 'attendance_corrections_org_status_created_idx' },
    );
    await queryInterface.addIndex(
      'attendance_correction_requests',
      ['organization_id', 'employee_id', 'work_date'],
      { name: 'attendance_corrections_org_employee_work_date_idx' },
    );
    await queryInterface.addIndex('attendance_correction_requests', ['time_session_id'], {
      name: 'attendance_corrections_time_session_idx',
    });
    await queryInterface.addIndex('attendance_correction_requests', ['resulting_session_id'], {
      name: 'attendance_corrections_resulting_session_idx',
    });

    // At most one pending correction may target a given existing session. NULL
    // time_session_id values (missing-session requests) are intentionally not
    // constrained; the service checks their requested intervals for overlap.
    await queryInterface.sequelize.query(
      `CREATE UNIQUE INDEX attendance_corrections_pending_session_unique
       ON attendance_correction_requests (organization_id, employee_id, time_session_id)
       WHERE status = 'PENDING' AND time_session_id IS NOT NULL`,
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('attendance_correction_requests');
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_attendance_correction_requests_status"',
    );
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_attendance_correction_requests_request_type"',
    );
  },
};
