import { describe, expect, it } from 'vitest';
import {
  hasPermission,
  isSelfScoped,
  policyRole,
  resolvePermissionSubject,
} from '../src/modules/memberships/permissions';

describe('resolvePermissionSubject', () => {
  it('keeps the built-in matrix and scope for built-in roles', () => {
    const employee = resolvePermissionSubject('EMPLOYEE', null, null);
    expect(employee.permissions).toContain('time:read');
    expect(employee.permissions).not.toContain('report:read');
    expect(employee.dataScope).toBe('SELF');
    expect(employee.customRoleId).toBeNull();

    const manager = resolvePermissionSubject('MANAGER', null, null);
    expect(manager.dataScope).toBe('ORGANIZATION');
    expect(hasPermission(manager, 'correction:review')).toBe(true);
  });

  it('uses the custom role permissions and data scope', () => {
    const subject = resolvePermissionSubject('EMPLOYEE', 'role-1', {
      permissions: ['time:read', 'report:read'],
      dataScope: 'ORGANIZATION',
    });

    expect(subject.role).toBe('EMPLOYEE');
    expect(subject.customRoleId).toBe('role-1');
    expect(subject.permissions).toEqual(['time:read', 'report:read']);
    expect(subject.dataScope).toBe('ORGANIZATION');
    expect(isSelfScoped(subject)).toBe(false);
    expect(policyRole(subject)).toBe('EMPLOYEE');
  });

  it('drops administrator-only or unknown permissions from a stored custom role', () => {
    const subject = resolvePermissionSubject('EMPLOYEE', 'role-1', {
      permissions: ['time:read', 'role:manage', 'member:update', 'not:a:permission' as never],
      dataScope: 'SELF',
    });

    expect(subject.permissions).toEqual(['time:read']);
    expect(hasPermission(subject, 'role:manage')).toBe(false);
    expect(hasPermission(subject, 'member:update')).toBe(false);
    expect(isSelfScoped(subject)).toBe(true);
  });

  it('falls back to least privilege when the assigned role cannot be loaded', () => {
    const subject = resolvePermissionSubject('EMPLOYEE', 'missing-role', null);
    expect(subject.permissions).toEqual([]);
    expect(subject.dataScope).toBe('SELF');
    expect(hasPermission(subject, 'time:read')).toBe(false);
  });

  it('treats built-in role strings as self-scoped only for employees', () => {
    expect(isSelfScoped('EMPLOYEE')).toBe(true);
    expect(isSelfScoped('MANAGER')).toBe(false);
    expect(policyRole('ADMIN')).toBe('ADMIN');
  });
});
