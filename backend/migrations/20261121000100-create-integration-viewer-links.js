'use strict';

/**
 * Live screen viewing through a partner integration (Flowtrium).
 *
 * Forward-only and additive: two new tables plus nullable/defaulted columns on
 * screen_live_sessions. Existing rows keep origin = 'WORKZEN' and behave exactly as before.
 *
 * - integration_viewer_link_requests: one-time, short-lived, hashed nonce. Created by the
 *   integration, consumed by a signed-in WorkZen OWNER on the hosted approval page.
 * - integration_viewer_links: the verified identity binding between one external (Flowtrium)
 *   user and one WorkZen user. Revocable. At most one ACTIVE link per external user and per
 *   WorkZen user on a connection.
 * - screen_live_sessions: records where a session came from and, for integration sessions, the
 *   link, connection and external identities, plus when the employee's indicator was confirmed.
 *
 * @type {import('sequelize-cli').Migration}
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.createTable(
        'integration_viewer_link_requests',
        {
          id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
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
          external_user_id: { type: Sequelize.STRING(200), allowNull: false },
          // Display text supplied by the integration. Shown on the approval page as "reported by",
          // never used for matching.
          external_user_label: { type: Sequelize.STRING(200), allowNull: false },
          external_organization_label: { type: Sequelize.STRING(200), allowNull: false },
          nonce_hash: { type: Sequelize.STRING(64), allowNull: false },
          // S256 PKCE challenge supplied by the integration. Completing the link needs the matching
          // verifier, so only the party that created the request can finish it.
          code_challenge: { type: Sequelize.STRING(128), allowNull: false },
          // Hash of the HTTP-only cookie set when the approval page is first opened. Ties the
          // approval to the one browser that opened the link.
          browser_binding_hash: { type: Sequelize.STRING(64), allowNull: true },
          status: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'PENDING' },
          expires_at: { type: Sequelize.DATE, allowNull: false },
          decided_at: { type: Sequelize.DATE, allowNull: true },
          decided_by_user_id: {
            type: Sequelize.UUID,
            allowNull: true,
            references: { model: 'users', key: 'id' },
            onDelete: 'SET NULL',
            onUpdate: 'CASCADE',
          },
          created_at: { type: Sequelize.DATE, allowNull: false },
          updated_at: { type: Sequelize.DATE, allowNull: false },
        },
        { transaction },
      );
      await queryInterface.addIndex('integration_viewer_link_requests', ['nonce_hash'], {
        name: 'integration_viewer_link_requests_nonce_unique',
        unique: true,
        transaction,
      });
      await queryInterface.addIndex(
        'integration_viewer_link_requests',
        ['connection_id', 'external_user_id', 'status'],
        { name: 'integration_viewer_link_requests_connection_user_idx', transaction },
      );
      await queryInterface.sequelize.query(
        `ALTER TABLE integration_viewer_link_requests
           ADD CONSTRAINT integration_viewer_link_requests_status_check
           CHECK (status IN ('PENDING','APPROVED','DENIED','EXPIRED','CONSUMED'))`,
        { transaction },
      );

      await queryInterface.createTable(
        'integration_viewer_links',
        {
          id: { type: Sequelize.UUID, primaryKey: true, allowNull: false },
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
            allowNull: false,
            references: { model: 'users', key: 'id' },
            onDelete: 'CASCADE',
            onUpdate: 'CASCADE',
          },
          external_user_id: { type: Sequelize.STRING(200), allowNull: false },
          external_user_label: { type: Sequelize.STRING(200), allowNull: false },
          status: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'ACTIVE' },
          request_id: {
            type: Sequelize.UUID,
            allowNull: true,
            references: { model: 'integration_viewer_link_requests', key: 'id' },
            onDelete: 'SET NULL',
            onUpdate: 'CASCADE',
          },
          linked_at: { type: Sequelize.DATE, allowNull: false },
          revoked_at: { type: Sequelize.DATE, allowNull: true },
          revoked_by_user_id: {
            type: Sequelize.UUID,
            allowNull: true,
            references: { model: 'users', key: 'id' },
            onDelete: 'SET NULL',
            onUpdate: 'CASCADE',
          },
          revoke_reason: { type: Sequelize.STRING(64), allowNull: true },
          created_at: { type: Sequelize.DATE, allowNull: false },
          updated_at: { type: Sequelize.DATE, allowNull: false },
        },
        { transaction },
      );
      await queryInterface.addIndex(
        'integration_viewer_links',
        ['connection_id', 'external_user_id'],
        {
          name: 'integration_viewer_links_active_external_unique',
          unique: true,
          where: { status: 'ACTIVE' },
          transaction,
        },
      );
      await queryInterface.addIndex(
        'integration_viewer_links',
        ['connection_id', 'workzen_user_id'],
        {
          name: 'integration_viewer_links_active_workzen_unique',
          unique: true,
          where: { status: 'ACTIVE' },
          transaction,
        },
      );
      await queryInterface.addIndex('integration_viewer_links', ['organization_id', 'status'], {
        name: 'integration_viewer_links_org_status_idx',
        transaction,
      });
      await queryInterface.sequelize.query(
        `ALTER TABLE integration_viewer_links
           ADD CONSTRAINT integration_viewer_links_status_check
           CHECK (status IN ('ACTIVE','REVOKED'))`,
        { transaction },
      );

      await queryInterface.addColumn(
        'screen_live_sessions',
        'origin',
        { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'WORKZEN' },
        { transaction },
      );
      await queryInterface.addColumn(
        'screen_live_sessions',
        'integration_connection_id',
        {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'integration_connections', key: 'id' },
          onDelete: 'SET NULL',
          onUpdate: 'CASCADE',
        },
        { transaction },
      );
      await queryInterface.addColumn(
        'screen_live_sessions',
        'integration_viewer_link_id',
        {
          type: Sequelize.UUID,
          allowNull: true,
          references: { model: 'integration_viewer_links', key: 'id' },
          onDelete: 'SET NULL',
          onUpdate: 'CASCADE',
        },
        { transaction },
      );
      await queryInterface.addColumn(
        'screen_live_sessions',
        'external_organization_id',
        { type: Sequelize.STRING(200), allowNull: true },
        { transaction },
      );
      await queryInterface.addColumn(
        'screen_live_sessions',
        'external_user_id',
        { type: Sequelize.STRING(200), allowNull: true },
        { transaction },
      );
      // Set by the relay when the employee's desktop agent confirms the on-screen indicator is
      // visible. Integration sessions never forward frames while this is null.
      await queryInterface.addColumn(
        'screen_live_sessions',
        'indicator_confirmed_at',
        { type: Sequelize.DATE, allowNull: true },
        { transaction },
      );
      await queryInterface.sequelize.query(
        `ALTER TABLE screen_live_sessions
           ADD CONSTRAINT screen_live_sessions_origin_check
           CHECK (origin IN ('WORKZEN','INTEGRATION'))`,
        { transaction },
      );
    });
  },

  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      await queryInterface.sequelize.query(
        'ALTER TABLE screen_live_sessions DROP CONSTRAINT IF EXISTS screen_live_sessions_origin_check',
        { transaction },
      );
      for (const column of [
        'indicator_confirmed_at',
        'external_user_id',
        'external_organization_id',
        'integration_viewer_link_id',
        'integration_connection_id',
        'origin',
      ]) {
        await queryInterface.removeColumn('screen_live_sessions', column, { transaction });
      }
      await queryInterface.dropTable('integration_viewer_links', { transaction });
      await queryInterface.dropTable('integration_viewer_link_requests', { transaction });
    });
  },
};
