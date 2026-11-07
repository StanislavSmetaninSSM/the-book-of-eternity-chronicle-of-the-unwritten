import type { Faction } from '../types';

export type FactionProjectBucket = 'active' | 'completed';

/**
 * A faction keeps two project lists. Deletion has a separate handler for each, and the
 * completed list used to be wired to a no-op: the trash button rendered, the confirmation
 * opened, and nothing changed. The bucket tells the caller which handler to use.
 */
export function locateFactionProject(faction: Faction, projectId: string): FactionProjectBucket | null {
  if ((faction.activeProjects || []).some(project => project.projectId === projectId)) return 'active';
  if ((faction.completedProjects || []).some(project => project.projectId === projectId)) return 'completed';
  return null;
}
