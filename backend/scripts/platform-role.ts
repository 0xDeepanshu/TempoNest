import { connectDatabase, disconnectDatabase, User } from '../src/database';
import type { PlatformRole } from '../src/modules/users/user.model';

const USAGE = [
  'Usage:',
  '  npm run platform:grant -- <email>',
  '  npm run platform:revoke -- <email>',
  '',
  'The account must already exist. This script never creates users or',
  'credentials, and it is not exposed over HTTP. Run it only from a trusted',
  'server environment with the production database configuration.',
].join('\n');

async function main(): Promise<void> {
  const [action, rawEmail] = process.argv.slice(2);
  if ((action !== 'grant' && action !== 'revoke') || !rawEmail) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  const email = rawEmail.trim().toLowerCase();
  const nextRole: PlatformRole | null = action === 'grant' ? 'SUPERADMIN' : null;

  await connectDatabase();
  try {
    const user = await User.unscoped().findOne({ where: { email } });
    if (!user) {
      throw new Error(`No existing account found for ${email}. Register the account first.`);
    }

    if (user.platformRole === nextRole) {
      console.log(
        `${email} already has platform role ${nextRole ?? 'none'}; no change was made.`,
      );
      return;
    }

    const previousRole = user.platformRole;
    await user.update({ platformRole: nextRole });
    console.log(
      `Platform role updated for ${user.name} <${user.email}>: ${previousRole ?? 'none'} -> ${nextRole ?? 'none'}`,
    );
  } finally {
    await disconnectDatabase();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
