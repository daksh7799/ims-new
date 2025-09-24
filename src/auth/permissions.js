// Single source of truth for all modules user can be granted
export const ALL_MODULES = [
  'dashboard','raw','bom','mfg','live','putaway','bin-inv',
  'sales','outward','returns','inv-rm','inv-fg',
  'blends','blend-mfg',
  'trace','raw-adjust','so-admin',
  'masters','admin'
];

// Minimal hook now (always true for can)
export function usePermissions() {
  return {
    can: () => true,
    isAdmin: true,
  };
}
