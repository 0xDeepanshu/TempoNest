'use strict';

/**
 * Flowtrium -> WorkZen read-only integration.
 *
 * Forward-only: this migration only creates new tables and indexes. It never
 * alters existing WorkZen tables, and the down migration drops only the tables
 * introduced here (never user, membership, attendance or session data).
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. Provisioned OAuth clients (one per partner application).
    await queryInterface.createTable('integration_clients', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      client_id: {
        type: Sequelize.STRING(64),
        allowNull: false,
      },
      name: {
        type: Sequelize.STRING(120),
        allowNull: false,
      },
      description: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      redirect_uris: {
        type: Sequelize.JSON,
        allowNull: false,
        defaultValue: [],
      },
      allowed_scopes: {
        type: Sequelize.JSON,
        allowNull: false,
        defaultValue: [],
      },
      secret_hash: {
        type: Sequelize.STRING(64),
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM('ACTIVE', 'DISABLED'),
        allowNull: false,
        defaultValue: 'ACTIVE',
      },
      created_by_user_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      last_secret_rotated_at: {
        type: Sequelize.DATE,
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

    await queryInterface.addIndex('integration_clients', ['client_id'], {
      name: 'integration_clients_client_id_unique',
      unique: true,
    });
    await queryInterface.addIndex('integration_clients', ['status'], {
      name: 'integration_clients_status_idx',
    });

    // 2. Organisation-level connection between a Flowtrium organisation and a
    //    WorkZen organisation.
    await queryInterface.createTable('integration_connections', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      client_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'integration_clients', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      organization_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'organizations', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      external_organization_id: {
        type: Sequelize.STRING(200),
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM('ACTIVE', 'DISCONNECTED', 'REVOKED'),
        allowNull: false,
        defaultValue: 'ACTIVE',
      },
      scopes: {
        type: Sequelize.JSON,
        allowNull: false,
        defaultValue: [],
      },
      connected_by_user_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      connected_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      last_authorized_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      disconnected_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      revoked_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      webhook_sequence: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
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

    await queryInterface.addIndex('integration_connections', ['organization_id'], {
      name: 'integration_connections_org_idx',
    });
    await queryInterface.addIndex('integration_connections', ['client_id', 'organization_id'], {
      name: 'integration_connections_client_org_idx',
    });
    await queryInterface.addIndex(
      'integration_connections',
      ['client_id', 'external_organization_id'],
      { name: 'integration_connections_client_external_idx' },
    );
    await queryInterface.addIndex('integration_connections', ['status'], {
      name: 'integration_connections_status_idx',
    });
    // At most one live connection per Flowtrium organisation. Disconnected or
    // revoked rows remain for history and can be reactivated by re-authorizing.
    await queryInterface.addIndex(
      'integration_connections',
      ['client_id', 'external_organization_id'],
      {
        name: 'integration_connections_active_external_unique',
        unique: true,
        where: { status: 'ACTIVE' },
      },
    );

    // 3. Browser-bound authorization attempts.
    await queryInterface.createTable('integration_authorization_requests', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      client_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'integration_clients', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      state_hash: {
        type: Sequelize.STRING(64),
        allowNull: false,
      },
      state_ciphertext: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      browser_binding_hash: {
        type: Sequelize.STRING(64),
        allowNull: false,
      },
      redirect_uri: {
        type: Sequelize.STRING(2048),
        allowNull: false,
      },
      scopes: {
        type: Sequelize.JSON,
        allowNull: false,
        defaultValue: [],
      },
      code_challenge: {
        type: Sequelize.STRING(128),
        allowNull: false,
      },
      code_challenge_method: {
        type: Sequelize.STRING(10),
        allowNull: false,
        defaultValue: 'S256',
      },
      status: {
        type: Sequelize.ENUM('PENDING', 'APPROVED', 'DENIED', 'CONSUMED', 'EXPIRED'),
        allowNull: false,
        defaultValue: 'PENDING',
      },
      authorized_by_user_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      organization_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'organizations', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      expires_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      decided_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      consumed_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      error_code: {
        type: Sequelize.STRING(64),
        allowNull: true,
      },
      ip_address: {
        type: Sequelize.STRING(64),
        allowNull: true,
      },
      user_agent: {
        type: Sequelize.STRING(512),
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

    await queryInterface.addIndex('integration_authorization_requests', ['state_hash'], {
      name: 'integration_auth_requests_state_hash_unique',
      unique: true,
    });
    await queryInterface.addIndex('integration_authorization_requests', ['expires_at'], {
      name: 'integration_auth_requests_expires_idx',
    });
    await queryInterface.addIndex(
      'integration_authorization_requests',
      ['client_id', 'status'],
      { name: 'integration_auth_requests_client_status_idx' },
    );

    // 4. Single-use authorization codes (hashed at rest).
    await queryInterface.createTable('integration_authorization_codes', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      authorization_request_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'integration_authorization_requests', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      client_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'integration_clients', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      organization_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'organizations', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      authorized_by_user_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      connection_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'integration_connections', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      code_hash: {
        type: Sequelize.STRING(64),
        allowNull: false,
      },
      redirect_uri: {
        type: Sequelize.STRING(2048),
        allowNull: false,
      },
      scopes: {
        type: Sequelize.JSON,
        allowNull: false,
        defaultValue: [],
      },
      code_challenge: {
        type: Sequelize.STRING(128),
        allowNull: false,
      },
      code_challenge_method: {
        type: Sequelize.STRING(10),
        allowNull: false,
        defaultValue: 'S256',
      },
      expires_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      consumed_at: {
        type: Sequelize.DATE,
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

    await queryInterface.addIndex('integration_authorization_codes', ['code_hash'], {
      name: 'integration_auth_codes_hash_unique',
      unique: true,
    });
    await queryInterface.addIndex('integration_authorization_codes', ['expires_at'], {
      name: 'integration_auth_codes_expires_idx',
    });
    await queryInterface.addIndex('integration_authorization_codes', ['client_id'], {
      name: 'integration_auth_codes_client_idx',
    });
    await queryInterface.addIndex('integration_authorization_codes', ['organization_id'], {
      name: 'integration_auth_codes_org_idx',
    });

    // 5. Access/refresh credentials (only keyed hashes are stored).
    await queryInterface.createTable('integration_credentials', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      connection_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'integration_connections', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      client_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'integration_clients', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      authorization_code_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'integration_authorization_codes', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      access_token_hash: {
        type: Sequelize.STRING(64),
        allowNull: false,
      },
      refresh_token_hash: {
        type: Sequelize.STRING(64),
        allowNull: false,
      },
      previous_refresh_token_hash: {
        type: Sequelize.STRING(64),
        allowNull: true,
      },
      scopes: {
        type: Sequelize.JSON,
        allowNull: false,
        defaultValue: [],
      },
      access_expires_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      refresh_expires_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      last_used_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      rotated_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      revoked_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      revoked_reason: {
        type: Sequelize.STRING(64),
        allowNull: true,
      },
      created_by_user_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
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

    await queryInterface.addIndex('integration_credentials', ['access_token_hash'], {
      name: 'integration_credentials_access_hash_unique',
      unique: true,
    });
    await queryInterface.addIndex('integration_credentials', ['refresh_token_hash'], {
      name: 'integration_credentials_refresh_hash_unique',
      unique: true,
    });
    await queryInterface.addIndex('integration_credentials', ['previous_refresh_token_hash'], {
      name: 'integration_credentials_previous_refresh_idx',
    });
    await queryInterface.addIndex('integration_credentials', ['connection_id'], {
      name: 'integration_credentials_connection_idx',
    });
    await queryInterface.addIndex('integration_credentials', ['revoked_at'], {
      name: 'integration_credentials_revoked_idx',
    });

    // 6. External employee -> WorkZen employee identity links.
    await queryInterface.createTable('integration_employee_mappings', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      connection_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'integration_connections', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      organization_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'organizations', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      workzen_user_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      external_employee_id: {
        type: Sequelize.STRING(200),
        allowNull: false,
      },
      external_employee_email: {
        type: Sequelize.STRING(254),
        allowNull: true,
      },
      workzen_email_snapshot: {
        type: Sequelize.STRING(254),
        allowNull: true,
      },
      status: {
        type: Sequelize.ENUM('ACTIVE', 'PENDING', 'CONFLICT', 'REVOKED'),
        allowNull: false,
        defaultValue: 'PENDING',
      },
      match_method: {
        type: Sequelize.ENUM('AUTO_EMAIL', 'MANUAL'),
        allowNull: true,
      },
      conflict_reason: {
        type: Sequelize.STRING(64),
        allowNull: true,
      },
      resolved_by_user_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      resolved_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      notes: {
        type: Sequelize.STRING(500),
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
      'integration_employee_mappings',
      ['connection_id', 'workzen_user_id'],
      { name: 'integration_employee_mappings_workzen_unique', unique: true },
    );
    await queryInterface.addIndex(
      'integration_employee_mappings',
      ['connection_id', 'external_employee_id'],
      { name: 'integration_employee_mappings_external_unique', unique: true },
    );
    await queryInterface.addIndex(
      'integration_employee_mappings',
      ['organization_id', 'status'],
      { name: 'integration_employee_mappings_org_status_idx' },
    );

    // 7. Webhook endpoints. Signing secrets are encrypted at rest.
    await queryInterface.createTable('integration_webhook_subscriptions', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      connection_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'integration_connections', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      organization_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'organizations', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      url: {
        type: Sequelize.STRING(2048),
        allowNull: false,
      },
      description: {
        type: Sequelize.STRING(200),
        allowNull: true,
      },
      event_types: {
        type: Sequelize.JSON,
        allowNull: false,
        defaultValue: [],
      },
      status: {
        type: Sequelize.ENUM('ACTIVE', 'PAUSED', 'DISABLED'),
        allowNull: false,
        defaultValue: 'ACTIVE',
      },
      secret_ciphertext: {
        type: Sequelize.TEXT,
        allowNull: false,
      },
      secret_version: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
      previous_secret_ciphertext: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      previous_secret_expires_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      created_by_user_id: {
        type: Sequelize.UUID,
        allowNull: true,
        references: { model: 'users', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      disabled_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      last_success_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      last_failure_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      failure_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
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
      'integration_webhook_subscriptions',
      ['connection_id', 'status'],
      { name: 'integration_webhook_subscriptions_connection_idx' },
    );
    await queryInterface.addIndex(
      'integration_webhook_subscriptions',
      ['connection_id', 'url'],
      { name: 'integration_webhook_subscriptions_url_unique', unique: true },
    );

    // 8. Durable event outbox.
    await queryInterface.createTable('integration_webhook_events', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      connection_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'integration_connections', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      organization_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'organizations', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      event_id: {
        type: Sequelize.UUID,
        allowNull: false,
      },
      event_type: {
        type: Sequelize.STRING(64),
        allowNull: false,
      },
      sequence: {
        type: Sequelize.INTEGER,
        allowNull: false,
      },
      payload: {
        type: Sequelize.JSON,
        allowNull: false,
        defaultValue: {},
      },
      occurred_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      status: {
        type: Sequelize.ENUM('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED', 'DEAD'),
        allowNull: false,
        defaultValue: 'PENDING',
      },
      attempt_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      last_error: {
        type: Sequelize.STRING(1000),
        allowNull: true,
      },
      processed_at: {
        type: Sequelize.DATE,
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

    await queryInterface.addIndex('integration_webhook_events', ['event_id'], {
      name: 'integration_webhook_events_event_id_unique',
      unique: true,
    });
    await queryInterface.addIndex(
      'integration_webhook_events',
      ['connection_id', 'sequence'],
      { name: 'integration_webhook_events_connection_sequence_unique', unique: true },
    );
    await queryInterface.addIndex('integration_webhook_events', ['status', 'created_at'], {
      name: 'integration_webhook_events_status_created_idx',
    });
    await queryInterface.addIndex('integration_webhook_events', ['organization_id', 'created_at'], {
      name: 'integration_webhook_events_org_created_idx',
    });

    // 9. Per-subscription delivery attempts and bounded retry state.
    await queryInterface.createTable('integration_webhook_deliveries', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        allowNull: false,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      event_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'integration_webhook_events', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      subscription_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'integration_webhook_subscriptions', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      organization_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'organizations', key: 'id' },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
      },
      status: {
        type: Sequelize.ENUM('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED', 'DEAD'),
        allowNull: false,
        defaultValue: 'PENDING',
      },
      attempt_count: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      next_attempt_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('NOW()'),
      },
      last_attempt_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
      response_status: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },
      error: {
        type: Sequelize.STRING(1000),
        allowNull: true,
      },
      delivered_at: {
        type: Sequelize.DATE,
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
      'integration_webhook_deliveries',
      ['event_id', 'subscription_id'],
      { name: 'integration_webhook_deliveries_event_sub_unique', unique: true },
    );
    await queryInterface.addIndex(
      'integration_webhook_deliveries',
      ['status', 'next_attempt_at'],
      { name: 'integration_webhook_deliveries_status_next_idx' },
    );
    await queryInterface.addIndex(
      'integration_webhook_deliveries',
      ['subscription_id', 'created_at'],
      { name: 'integration_webhook_deliveries_subscription_created_idx' },
    );
  },

  async down(queryInterface) {
    await queryInterface.dropTable('integration_webhook_deliveries');
    await queryInterface.dropTable('integration_webhook_events');
    await queryInterface.dropTable('integration_webhook_subscriptions');
    await queryInterface.dropTable('integration_employee_mappings');
    await queryInterface.dropTable('integration_credentials');
    await queryInterface.dropTable('integration_authorization_codes');
    await queryInterface.dropTable('integration_authorization_requests');
    await queryInterface.dropTable('integration_connections');
    await queryInterface.dropTable('integration_clients');

    await queryInterface.sequelize.query(
      [
        'DROP TYPE IF EXISTS "enum_integration_webhook_deliveries_status"',
        'DROP TYPE IF EXISTS "enum_integration_webhook_events_status"',
        'DROP TYPE IF EXISTS "enum_integration_webhook_subscriptions_status"',
        'DROP TYPE IF EXISTS "enum_integration_employee_mappings_status"',
        'DROP TYPE IF EXISTS "enum_integration_employee_mappings_match_method"',
        'DROP TYPE IF EXISTS "enum_integration_authorization_requests_status"',
        'DROP TYPE IF EXISTS "enum_integration_connections_status"',
        'DROP TYPE IF EXISTS "enum_integration_clients_status"',
      ].join('; '),
    );
  },
};
