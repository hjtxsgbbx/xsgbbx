import { EventEmitter } from "events";
import { debug } from "../observability/debug.js";

export type Permission =
  | "file:read"
  | "file:write"
  | "file:delete"
  | "file:create"
  | "file:rename"
  | "file:move"
  | "file:lock"
  | "file:unlock"
  | "command:execute"
  | "command:sudo"
  | "project:create"
  | "project:delete"
  | "project:deploy"
  | "agent:manage"
  | "agent:view"
  | "config:read"
  | "config:write"
  | "audit:read"
  | "audit:export"
  | "user:manage"
  | "role:manage"
  | "version:view"
  | "version:restore";

export type ResourceScope =
  | "global"
  | "project"
  | "directory"
  | "file";

export interface Resource {
  type: ResourceScope;
  path: string;
}

export interface PermissionGrant {
  permission: Permission;
  resource: Resource;
  granted: boolean;
  conditions?: PermissionCondition[];
}

export interface PermissionCondition {
  type: "time_range" | "ip_range" | "approval_required" | "max_operations" | "path_pattern";
  value: string | number | boolean;
}

export interface Role {
  id: string;
  name: string;
  description: string;
  permissions: PermissionGrant[];
  isDefault: boolean;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  username: string;
  displayName: string;
  roleIds: string[];
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  metadata: Record<string, string>;
}

export interface AccessCheckResult {
  allowed: boolean;
  userId: string;
  permission: Permission;
  resource: Resource;
  matchedRoles: string[];
  deniedReason?: string;
  conditionsMet: boolean;
  timestamp: string;
}

const SYSTEM_ROLES: Role[] = [
  {
    id: "role-admin",
    name: "Administrator",
    description: "Full system access with all permissions",
    permissions: Object.values([
      "file:read", "file:write", "file:delete", "file:create", "file:rename", "file:move", "file:lock", "file:unlock",
      "command:execute", "command:sudo",
      "project:create", "project:delete", "project:deploy",
      "agent:manage", "agent:view",
      "config:read", "config:write",
      "audit:read", "audit:export",
      "user:manage", "role:manage",
      "version:view", "version:restore",
    ] as Permission[]).map((p): PermissionGrant => ({
      permission: p,
      resource: { type: "global", path: "*" },
      granted: true,
    })),
    isDefault: false,
    isSystem: true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "role-developer",
    name: "Developer",
    description: "Standard development access with file and command permissions",
    permissions: [
      "file:read", "file:write", "file:create", "file:rename", "file:move",
      "command:execute",
      "project:create",
      "agent:view",
      "config:read",
      "version:view", "version:restore",
    ].map((p): PermissionGrant => ({
      permission: p as Permission,
      resource: { type: "global", path: "*" },
      granted: true,
    })),
    isDefault: true,
    isSystem: true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "role-viewer",
    name: "Viewer",
    description: "Read-only access for reviewing code and project status",
    permissions: [
      "file:read",
      "agent:view",
      "config:read",
      "audit:read",
      "version:view",
    ].map((p): PermissionGrant => ({
      permission: p as Permission,
      resource: { type: "global", path: "*" },
      granted: true,
    })),
    isDefault: false,
    isSystem: true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: "role-operator",
    name: "Operator",
    description: "Deployment and operations access",
    permissions: [
      "file:read",
      "command:execute",
      "project:deploy",
      "agent:view",
      "config:read",
      "audit:read",
    ].map((p): PermissionGrant => ({
      permission: p as Permission,
      resource: { type: "global", path: "*" },
      granted: true,
    })),
    isDefault: false,
    isSystem: true,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  },
];

export class RBACManager extends EventEmitter {
  private roles: Map<string, Role> = new Map();
  private users: Map<string, User> = new Map();
  private accessLog: AccessCheckResult[] = [];
  private maxLogSize = 10000;

  constructor() {
    super();
    for (const role of SYSTEM_ROLES) {
      this.roles.set(role.id, { ...role });
    }
  }

  createRole(role: Omit<Role, "id" | "createdAt" | "updatedAt" | "isSystem">): Role {
    const id = `role-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();
    const newRole: Role = {
      ...role,
      id,
      isSystem: false,
      createdAt: now,
      updatedAt: now,
    };
    this.roles.set(id, newRole);
    this.emit("roleCreated", id, newRole.name);
    debug.info("rbac", `Role created: ${newRole.name} (${id})`);
    return newRole;
  }

  updateRole(roleId: string, updates: Partial<Pick<Role, "name" | "description" | "permissions">>): Role | null {
    const role = this.roles.get(roleId);
    if (!role) return null;
    if (role.isSystem) {
      throw new Error("Cannot modify system roles");
    }

    const updated: Role = {
      ...role,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    this.roles.set(roleId, updated);
    this.emit("roleUpdated", roleId);
    debug.info("rbac", `Role updated: ${roleId}`);
    return updated;
  }

  deleteRole(roleId: string): boolean {
    const role = this.roles.get(roleId);
    if (!role) return false;
    if (role.isSystem) {
      throw new Error("Cannot delete system roles");
    }

    for (const user of this.users.values()) {
      if (user.roleIds.includes(roleId)) {
        throw new Error(`Role ${roleId} is assigned to user ${user.username}. Remove assignment first.`);
      }
    }

    this.roles.delete(roleId);
    this.emit("roleDeleted", roleId);
    debug.info("rbac", `Role deleted: ${roleId}`);
    return true;
  }

  getRole(roleId: string): Role | undefined {
    return this.roles.get(roleId);
  }

  getAllRoles(): Role[] {
    return [...this.roles.values()];
  }

  createUser(userInfo: Omit<User, "id" | "createdAt" | "lastLoginAt" | "metadata">): User {
    const id = `user-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const user: User = {
      ...userInfo,
      id,
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
      metadata: {},
    };

    for (const roleId of user.roleIds) {
      if (!this.roles.has(roleId)) {
        throw new Error(`Role not found: ${roleId}`);
      }
    }

    this.users.set(id, user);
    this.emit("userCreated", id, user.username);
    debug.info("rbac", `User created: ${user.username} (${id})`);
    return user;
  }

  updateUser(userId: string, updates: Partial<Pick<User, "username" | "displayName" | "roleIds" | "isActive">>): User | null {
    const user = this.users.get(userId);
    if (!user) return null;

    if (updates.roleIds) {
      for (const roleId of updates.roleIds) {
        if (!this.roles.has(roleId)) {
          throw new Error(`Role not found: ${roleId}`);
        }
      }
    }

    const updated: User = {
      ...user,
      ...updates,
    };
    this.users.set(userId, updated);
    this.emit("userUpdated", userId);
    debug.info("rbac", `User updated: ${userId}`);
    return updated;
  }

  deleteUser(userId: string): boolean {
    const user = this.users.get(userId);
    if (!user) return false;

    this.users.delete(userId);
    this.emit("userDeleted", userId);
    debug.info("rbac", `User deleted: ${userId}`);
    return true;
  }

  getUser(userId: string): User | undefined {
    return this.users.get(userId);
  }

  getUserByUsername(username: string): User | undefined {
    return [...this.users.values()].find((u) => u.username === username);
  }

  getAllUsers(): User[] {
    return [...this.users.values()];
  }

  assignRole(userId: string, roleId: string): boolean {
    const user = this.users.get(userId);
    const role = this.roles.get(roleId);
    if (!user || !role) return false;

    if (user.roleIds.includes(roleId)) return true;

    user.roleIds.push(roleId);
    this.users.set(userId, user);
    this.emit("roleAssigned", userId, roleId);
    debug.info("rbac", `Role ${role.name} assigned to ${user.username}`);
    return true;
  }

  revokeRole(userId: string, roleId: string): boolean {
    const user = this.users.get(userId);
    if (!user) return false;

    user.roleIds = user.roleIds.filter((id) => id !== roleId);
    this.users.set(userId, user);
    this.emit("roleRevoked", userId, roleId);
    debug.info("rbac", `Role ${roleId} revoked from ${user.username}`);
    return true;
  }

  checkAccess(userId: string, permission: Permission, resource: Resource): AccessCheckResult {
    const user = this.users.get(userId);
    const result: AccessCheckResult = {
      allowed: false,
      userId,
      permission,
      resource,
      matchedRoles: [],
      conditionsMet: true,
      timestamp: new Date().toISOString(),
    };

    if (!user) {
      result.deniedReason = "User not found";
      this.logAccess(result);
      return result;
    }

    if (!user.isActive) {
      result.deniedReason = "User account is inactive";
      this.logAccess(result);
      return result;
    }

    const userRoles = user.roleIds
      .map((id) => this.roles.get(id))
      .filter((r): r is Role => r !== undefined);

    for (const role of userRoles) {
      for (const grant of role.permissions) {
        if (grant.permission === permission && grant.granted && this.resourceMatches(grant.resource, resource)) {
          if (grant.conditions && grant.conditions.length > 0) {
            const conditionsMet = this.evaluateConditions(grant.conditions, userId);
            if (!conditionsMet) {
              result.conditionsMet = false;
              continue;
            }
          }

          result.allowed = true;
          result.matchedRoles.push(role.id);
        }
      }
    }

    if (!result.allowed) {
      result.deniedReason = `No matching permission grant for ${permission} on ${resource.type}:${resource.path}`;
    }

    this.logAccess(result);
    this.emit("accessChecked", result);
    return result;
  }

  getUserPermissions(userId: string): PermissionGrant[] {
    const user = this.users.get(userId);
    if (!user) return [];

    const permissions: PermissionGrant[] = [];
    const seen = new Set<string>();

    for (const roleId of user.roleIds) {
      const role = this.roles.get(roleId);
      if (!role) continue;

      for (const grant of role.permissions) {
        const key = `${grant.permission}:${grant.resource.type}:${grant.resource.path}:${grant.granted}`;
        if (!seen.has(key)) {
          seen.add(key);
          permissions.push(grant);
        }
      }
    }

    return permissions;
  }

  getAccessLog(filters?: { userId?: string; permission?: Permission; allowed?: boolean; startTime?: string; endTime?: string }): AccessCheckResult[] {
    let results = [...this.accessLog];

    if (filters?.userId) results = results.filter((r) => r.userId === filters.userId);
    if (filters?.permission) results = results.filter((r) => r.permission === filters.permission);
    if (filters?.allowed !== undefined) results = results.filter((r) => r.allowed === filters.allowed);
    if (filters?.startTime) results = results.filter((r) => r.timestamp >= (filters.startTime ?? ""));
    if (filters?.endTime) results = results.filter((r) => r.timestamp <= (filters.endTime ?? ""));

    return results;
  }

  private resourceMatches(grantResource: Resource, requestedResource: Resource): boolean {
    if (grantResource.path === "*") return true;
    if (grantResource.type === "global") return true;
    if (grantResource.type !== requestedResource.type) return false;

    if (grantResource.path.endsWith("/*")) {
      const prefix = grantResource.path.slice(0, -2);
      return requestedResource.path.startsWith(prefix);
    }

    return grantResource.path === requestedResource.path;
  }

  private evaluateConditions(conditions: PermissionCondition[], userId: string): boolean {
    for (const condition of conditions) {
      switch (condition.type) {
        case "time_range": {
          const range = condition.value as string;
          const [start, end] = range.split("-");
          const now = new Date().getHours();
          if (now < parseInt(start) || now >= parseInt(end)) return false;
          break;
        }
        case "approval_required": {
          if (condition.value === true) return false;
          break;
        }
        case "max_operations": {
          const max = condition.value as number;
          const todayOps = this.accessLog.filter(
            (l) => l.userId === userId && l.allowed && l.timestamp.startsWith(new Date().toISOString().slice(0, 10))
          ).length;
          if (todayOps >= max) return false;
          break;
        }
        case "path_pattern": {
          const pattern = condition.value as string;
          try {
            if (!new RegExp(pattern).test("")) return false;
          } catch {
            return false;
          }
          break;
        }
      }
    }
    return true;
  }

  private logAccess(result: AccessCheckResult): void {
    this.accessLog.push(result);
    if (this.accessLog.length > this.maxLogSize) {
      this.accessLog.shift();
    }
  }

  clearAccessLog(): void {
    this.accessLog = [];
  }
}
