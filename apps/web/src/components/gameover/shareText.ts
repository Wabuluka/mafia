// ---------------------------------------------------------------------------
// buildShareText — the plain-text recap for group chats (Web Share API
// payload, or clipboard fallback — see GameOverScreen's handleShare).
// Falls back to whatever `view` alone can tell us (winning team, reason)
// if the full summary fetch hasn't resolved yet, so sharing is never
// blocked on the network round trip that populates the role reveal.
// ---------------------------------------------------------------------------

import type { PlayerView } from '@mafia/shared';
import type { GameSummary } from '@/lib/api';
import { END_REASON_LABEL, ROLE_LABEL, TEAM_LABEL } from '@/lib/roleLabels';

export function buildShareText(view: PlayerView, summary: GameSummary | null): string {
  const winningTeamLabel = view.winningTeam ? TEAM_LABEL[view.winningTeam] ?? view.winningTeam : 'No one';
  const lines = [`🏘️ Mafia recap — ${winningTeamLabel} won!`];

  const endReasonLabel = view.endReason ? END_REASON_LABEL[view.endReason] : undefined;
  if (endReasonLabel) {
    lines.push(endReasonLabel);
  }

  if (summary) {
    lines.push('');
    lines.push('Roles:');
    for (const p of summary.players) {
      const roleLabel = ROLE_LABEL[p.role] ?? p.role;
      const suffix = p.status === 'DEAD' ? ' 💀' : '';
      lines.push(`• ${p.name} — ${roleLabel}${suffix}`);
    }
  }

  return lines.join('\n');
}
