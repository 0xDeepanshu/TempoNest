'use strict';

/**
 * Configurable accrual rollout.
 *
 * Existing policies keep their current accrual schedule by inheriting the
 * balance period start day. `accrual_effective_from` is set to the rollout
 * date so the new scheduler never grants tranches from before this migration.
 * Override the rollout date with LEAVE_ACCRUAL_ROLLOUT_DATE (YYYY-MM-DD) when
 * running the migration in a controlled window.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const dialect = queryInterface.sequelize.getDialect();

    await queryInterface.addColumn('leave_policies', 'accrual_day_of_month', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 1,
    });
    await queryInterface.addColumn('leave_policies', 'accrual_effective_from', {
      type: Sequelize.DATEONLY,
      allowNull: true,
    });
    await queryInterface.addColumn('leave_policies', 'prorate_accrual', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    });

    // Preserve the historical tranche day for existing policies.
    await queryInterface.sequelize.query(
      'UPDATE leave_policies SET accrual_day_of_month = balance_period_start_day',
    );

    const rolloutDate =
      process.env.LEAVE_ACCRUAL_ROLLOUT_DATE || new Date().toISOString().slice(0, 10);
    await queryInterface.sequelize.query(
      `UPDATE leave_policies
          SET accrual_effective_from = :rolloutDate
        WHERE accrual_frequency <> 'NONE'
          AND accrual_amount > 0
          AND accrual_effective_from IS NULL`,
      { replacements: { rolloutDate } },
    );

    await queryInterface.addColumn('leave_ledger_entries', 'accrual_period', {
      type: Sequelize.DATEONLY,
      allowNull: true,
    });

    if (dialect === 'postgres') {
      // Backfill the explicit accrual period key as the month bucket used by
      // runtime idempotency, so changing the configured accrual day later
      // cannot grant the same month twice. If legacy overlapping balance
      // periods already contain the same tranche twice, only the oldest row is
      // keyed; the duplicate stays unkeyed and is reported by reconciliation
      // instead of blocking the migration.
      await queryInterface.sequelize.query(`
        WITH ranked AS (
          SELECT id,
                 date_trunc('month', substring(idempotency_key from 9)::date)::date AS accrual_period,
                 row_number() OVER (
                   PARTITION BY organization_id, employee_id, leave_type_id,
                                date_trunc('month', substring(idempotency_key from 9)::date)
                   ORDER BY created_at ASC, id ASC
                 ) AS row_number
            FROM leave_ledger_entries
           WHERE kind = 'ACCRUAL'
             AND idempotency_key LIKE 'accrual:%'
             AND substring(idempotency_key from 9) ~ '^\\d{4}-\\d{2}-\\d{2}$'
        )
        UPDATE leave_ledger_entries AS entry
           SET accrual_period = ranked.accrual_period
          FROM ranked
         WHERE entry.id = ranked.id
           AND ranked.row_number = 1
      `);
    }

    await queryInterface.addIndex(
      'leave_ledger_entries',
      ['organization_id', 'employee_id', 'leave_type_id', 'accrual_period'],
      { name: 'leave_ledger_accrual_unique', unique: true },
    );
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('leave_ledger_entries', 'leave_ledger_accrual_unique');
    await queryInterface.removeColumn('leave_ledger_entries', 'accrual_period');
    await queryInterface.removeColumn('leave_policies', 'prorate_accrual');
    await queryInterface.removeColumn('leave_policies', 'accrual_effective_from');
    await queryInterface.removeColumn('leave_policies', 'accrual_day_of_month');
  },
};
