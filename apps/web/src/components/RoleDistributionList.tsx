'use client';

// ---------------------------------------------------------------------------
// RoleDistributionList — shows the computed role breakdown for the current
// player count, using the exact same `resolveRoleDistribution` the server
// uses for real role assignment, so what's shown here is never a guess or
// an approximation — it's the actual distribution that will be used if the
// game starts with this many players right now.
// ---------------------------------------------------------------------------

import { resolveRoleDistribution, ROLE_DISPLAY_LABEL, ROLE_TEAM, type Role } from '@mafia/shared';

const TEAM_DOT_CLASS: Record<Role, string> = {
  VILLAGER: 'bg-village-accent',
  DETECTIVE: 'bg-village-accent',
  DOCTOR: 'bg-village-accent',
  MAFIA: 'bg-mafia-accent',
  JESTER: 'bg-secondary',
};

export interface RoleDistributionListProps {
  playerCount: number;
}

export function RoleDistributionList({ playerCount }: RoleDistributionListProps) {
  if (playerCount <= 0) {
    return <p className="text-sm text-base-content/50">Waiting for players to see the role breakdown.</p>;
  }

  const distribution = resolveRoleDistribution(playerCount);
  const specialRoleCount = Object.values(distribution).reduce((sum, n) => sum + (n ?? 0), 0);
  const villagerCount = Math.max(0, playerCount - specialRoleCount);

  const entries: Array<{ role: Role; count: number }> = [
    ...(Object.entries(distribution) as Array<[Role, number]>).map(([role, count]) => ({ role, count })),
    ...(villagerCount > 0 ? [{ role: 'VILLAGER' as Role, count: villagerCount }] : []),
  ];

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-base-content/60">
        With {playerCount} player{playerCount === 1 ? '' : 's'}, this game will have:
      </p>
      <ul className="flex flex-wrap gap-2">
        {entries.map(({ role, count }) => (
          <li
            key={role}
            className="flex items-center gap-1.5 rounded-full bg-elevated px-3 py-1.5 text-sm"
            title={`Team: ${ROLE_TEAM[role]}`}
          >
            <span aria-hidden="true" className={`h-2 w-2 rounded-full ${TEAM_DOT_CLASS[role]}`} />
            <span className="font-semibold">{count}×</span>
            <span className="text-base-content/80">{ROLE_DISPLAY_LABEL[role]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
