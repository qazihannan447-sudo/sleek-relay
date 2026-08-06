export function canManageTenantResources(role: string): boolean {
  return role === 'owner' || role === 'admin';
}

