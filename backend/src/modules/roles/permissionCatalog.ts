import {
  CUSTOM_ROLE_GRANTABLE_PERMISSIONS,
  MANAGER_OVERRIDE_GRANTABLE_PERMISSIONS,
  PERMISSIONS,
  isGrantablePermission,
  isManagerOverridePermission,
  type Permission,
} from '../memberships/permissions';

export type PermissionGroupKey =
  | 'organization'
  | 'people'
  | 'time'
  | 'reports'
  | 'attendance'
  | 'monitoring'
  | 'leave'
  | 'administration';

export interface PermissionCatalogEntry {
  id: Permission;
  group: PermissionGroupKey;
  label: string;
  description: string;
  grantableToCustomRole: boolean;
  grantableToManager: boolean;
}

const ENTRIES: Array<Omit<PermissionCatalogEntry, 'grantableToCustomRole' | 'grantableToManager'>> = [
  {
    id: 'organization:read',
    group: 'organization',
    label: 'View organization',
    description: 'Read organization profile, timezone, and member count.',
  },
  {
    id: 'organization:update',
    group: 'organization',
    label: 'Edit organization',
    description: 'Change organization name and timezone.',
  },
  {
    id: 'role:read',
    group: 'organization',
    label: 'View roles',
    description: 'View built-in and custom roles and their permission sets.',
  },
  {
    id: 'role:manage',
    group: 'organization',
    label: 'Manage roles',
    description: 'Create, edit, delete, and assign custom roles.',
  },
  {
    id: 'member:read',
    group: 'people',
    label: 'View people',
    description: 'View the organization member directory.',
  },
  {
    id: 'member:onboard',
    group: 'people',
    label: 'Invite and onboard employees',
    description:
      'Invite new employees to this organization without granting administrative access.',
  },
  {
    id: 'member:invite',
    group: 'people',
    label: 'Invite people',
    description: 'Send organization invitations.',
  },
  {
    id: 'member:update',
    group: 'people',
    label: 'Manage people',
    description: 'Change roles, suspend, and reactivate members.',
  },
  {
    id: 'member:remove',
    group: 'people',
    label: 'Remove people',
    description: 'Remove members from the organization.',
  },
  {
    id: 'invitation:read',
    group: 'people',
    label: 'View invitations',
    description: 'List pending and historic invitations.',
  },
  {
    id: 'invitation:revoke',
    group: 'people',
    label: 'Revoke invitations',
    description: 'Cancel outstanding invitations.',
  },
  {
    id: 'time:read',
    group: 'time',
    label: 'View time',
    description: 'Read tracked time sessions and attendance summaries.',
  },
  {
    id: 'time:write',
    group: 'time',
    label: 'Track time',
    description: 'Start, pause, and stop personal time tracking.',
  },
  {
    id: 'agent:read',
    group: 'time',
    label: 'View devices',
    description: 'View registered desktop and mobile agents.',
  },
  {
    id: 'agent:revoke',
    group: 'time',
    label: 'Revoke devices',
    description: 'Revoke registered devices for any member.',
  },
  {
    id: 'report:read',
    group: 'reports',
    label: 'View reports',
    description: 'Read productivity, activity, and session reports.',
  },
  {
    id: 'activity:policy',
    group: 'reports',
    label: 'Manage app tracking',
    description: 'Change application tracking and idle-detection policy.',
  },
  {
    id: 'classification:manage',
    group: 'reports',
    label: 'Manage classifications',
    description: 'Classify applications as productive, neutral, or unproductive.',
  },
  {
    id: 'correction:review',
    group: 'attendance',
    label: 'Review corrections',
    description: 'Review and decide attendance correction requests.',
  },
  {
    id: 'attendance:location:read',
    group: 'attendance',
    label: 'View location history',
    description: 'Read attendance location history for any member.',
  },
  {
    id: 'screenshot:request',
    group: 'monitoring',
    label: 'Request screenshots',
    description: 'Request screenshots from an employee device.',
  },
  {
    id: 'screenshot:read',
    group: 'monitoring',
    label: 'View screenshots',
    description: 'View captured screenshots and screenshot audit events.',
  },
  {
    id: 'screenshot:live',
    group: 'monitoring',
    label: 'View live screens',
    description: 'Start and watch live screen sessions.',
  },
  {
    id: 'screenshot:manage',
    group: 'monitoring',
    label: 'Manage screenshot requests',
    description: 'Cancel and manage screenshot requests.',
  },
  {
    id: 'screenshot:policy',
    group: 'monitoring',
    label: 'Manage monitoring policy',
    description: 'Change screenshot and live-viewing policy.',
  },
  {
    id: 'leave:read',
    group: 'leave',
    label: 'View leave',
    description: 'View leave requests and balances.',
  },
  {
    id: 'leave:write',
    group: 'leave',
    label: 'Request leave',
    description: 'Submit and cancel personal leave requests.',
  },
  {
    id: 'leave:approve',
    group: 'leave',
    label: 'Approve leave',
    description: 'Approve or reject leave requests.',
  },
  {
    id: 'leave:manage',
    group: 'leave',
    label: 'Manage leave',
    description: 'Manage leave types, policies, and balances.',
  },
  {
    id: 'holiday:view',
    group: 'leave',
    label: 'View holiday calendar',
    description: 'View the organization holiday calendar and applicable holidays.',
  },
  {
    id: 'holiday:create',
    group: 'leave',
    label: 'Add holidays',
    description: 'Create company, public, and optional holidays.',
  },
  {
    id: 'holiday:update',
    group: 'leave',
    label: 'Edit holidays',
    description: 'Change holiday dates, categories, duration, and applicability.',
  },
  {
    id: 'holiday:delete',
    group: 'leave',
    label: 'Delete holidays',
    description: 'Remove holidays from the organization calendar.',
  },
  {
    id: 'holiday:settings:manage',
    group: 'leave',
    label: 'Manage holiday settings',
    description: 'Configure holiday management, optional holidays, and working days.',
  },
];

export const PERMISSION_CATALOG: PermissionCatalogEntry[] = ENTRIES.filter((entry) =>
  (PERMISSIONS as readonly string[]).includes(entry.id),
).map((entry) => ({
  ...entry,
  grantableToCustomRole: isGrantablePermission(entry.id),
  grantableToManager: isManagerOverridePermission(entry.id),
}));

export const PERMISSION_GROUP_LABELS: Record<PermissionGroupKey, string> = {
  organization: 'Organization',
  people: 'People & Onboarding',
  time: 'Time tracking',
  reports: 'Reports & activity',
  attendance: 'Attendance',
  monitoring: 'Monitoring',
  leave: 'Leave',
  administration: 'Administration',
};

export const GRANTABLE_PERMISSIONS = CUSTOM_ROLE_GRANTABLE_PERMISSIONS;
