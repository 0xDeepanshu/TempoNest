'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('attendance_evidence', {
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
      desktop_agent_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'desktop_agents', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      kind: {
        type: Sequelize.ENUM('SELFIE', 'SITE_PHOTO'),
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM('PENDING', 'UPLOADED', 'ATTACHED'),
        allowNull: false,
        defaultValue: 'PENDING',
      },
      storage_key: {
        type: Sequelize.STRING(512),
        allowNull: false,
      },
      content_type: {
        type: Sequelize.STRING(64),
        allowNull: false,
      },
      file_size_bytes: {
        type: Sequelize.INTEGER,
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
      captured_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      expires_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      attached_session_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'time_sessions', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
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

    await queryInterface.addIndex('attendance_evidence', ['storage_key'], {
      name: 'attendance_evidence_storage_key_unique',
      unique: true,
    });
    await queryInterface.addIndex(
      'attendance_evidence',
      ['organization_id', 'employee_id', 'created_at'],
      { name: 'attendance_evidence_org_employee_created_idx' },
    );
    await queryInterface.addIndex('attendance_evidence', ['desktop_agent_id'], {
      name: 'attendance_evidence_agent_idx',
    });
    await queryInterface.addIndex('attendance_evidence', ['status', 'expires_at'], {
      name: 'attendance_evidence_status_expires_idx',
    });
    await queryInterface.addIndex('attendance_evidence', ['attached_session_id'], {
      name: 'attendance_evidence_attached_session_idx',
    });

    await queryInterface.createTable('attendance_check_ins', {
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
      desktop_agent_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'desktop_agents', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      time_session_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'time_sessions', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      work_mode: {
        type: Sequelize.ENUM('WFO', 'WFH', 'ON_SITE'),
        allowNull: false,
      },
      selfie_evidence_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'attendance_evidence', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      site_photo_evidence_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'attendance_evidence', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      latitude: {
        type: Sequelize.DOUBLE,
        allowNull: true,
      },
      longitude: {
        type: Sequelize.DOUBLE,
        allowNull: true,
      },
      accuracy_meters: {
        type: Sequelize.DOUBLE,
        allowNull: true,
      },
      location_recorded_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      check_in_request_id: {
        type: Sequelize.UUID,
        allowNull: false,
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

    await queryInterface.addIndex('attendance_check_ins', ['time_session_id'], {
      name: 'attendance_check_ins_session_unique',
      unique: true,
    });
    await queryInterface.addIndex(
      'attendance_check_ins',
      ['organization_id', 'employee_id', 'check_in_request_id'],
      { name: 'attendance_check_ins_request_unique', unique: true },
    );
    await queryInterface.addIndex('attendance_check_ins', ['selfie_evidence_id'], {
      name: 'attendance_check_ins_selfie_unique',
      unique: true,
    });
    await queryInterface.addIndex('attendance_check_ins', ['site_photo_evidence_id'], {
      name: 'attendance_check_ins_site_photo_unique',
      unique: true,
    });
    await queryInterface.addIndex(
      'attendance_check_ins',
      ['organization_id', 'employee_id', 'created_at'],
      { name: 'attendance_check_ins_org_employee_created_idx' },
    );
    await queryInterface.addIndex(
      'attendance_check_ins',
      ['organization_id', 'work_mode', 'created_at'],
      { name: 'attendance_check_ins_org_mode_created_idx' },
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('attendance_check_ins');
    await queryInterface.dropTable('attendance_evidence');
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_attendance_check_ins_work_mode"',
    );
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_attendance_evidence_kind"',
    );
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_attendance_evidence_status"',
    );
  },
};
