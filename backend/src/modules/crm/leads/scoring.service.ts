import { Injectable } from '@nestjs/common';
import { SCORE_SIGNAL_LABELS, temperatureFor, type ScoreSignal } from '@vintrax/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { recordTimeline } from './timeline';

type Db = Prisma.TransactionClient;

/**
 * Lead scoring from the dealer's own rules (CRM → Settings → Scoring): each
 * signal adds or takes away its points, and the score sets the temperature
 * against the dealer's thresholds. Nothing about the points is hard-coded
 * beyond the starting values.
 */
@Injectable()
export class ScoringService {
  constructor(private readonly prisma: PrismaService) {}

  async apply(
    leadId: string,
    signal: ScoreSignal,
    db: Db = this.prisma,
  ): Promise<{ score: number; changed: boolean } | null> {
    const lead = await db.crmLead.findUnique({
      where: { id: leadId },
      select: { id: true, dealerId: true, score: true, temperature: true },
    });
    if (!lead) return null;
    const rule = await db.crmScoringRule.findUnique({
      where: { dealerId_signal: { dealerId: lead.dealerId, signal } },
    });
    if (!rule || !rule.isActive || rule.points === 0) return { score: lead.score, changed: false };

    const settings = await db.crmSettings.findUnique({
      where: { dealerId: lead.dealerId },
      select: { hotThreshold: true, warmThreshold: true },
    });
    const score = Math.max(-1000, Math.min(1000, lead.score + rule.points));
    const temperature = temperatureFor(score, {
      hot: settings?.hotThreshold ?? 50,
      warm: settings?.warmThreshold ?? 20,
    });
    await db.crmLead.update({ where: { id: lead.id }, data: { score, temperature } });
    await db.crmLeadScoreEvent.create({
      data: { leadId: lead.id, signal, points: rule.points, scoreAfter: score },
    });
    if (temperature !== lead.temperature) {
      await recordTimeline(db, {
        dealerId: lead.dealerId,
        leadId: lead.id,
        type: 'SCORE_CHANGED',
        title: `Now ${temperature.toLowerCase()} (score ${score})`,
        notes: `${SCORE_SIGNAL_LABELS[signal]}: ${rule.points > 0 ? '+' : ''}${rule.points}`,
        metadata: { from: lead.temperature, to: temperature, score },
      });
    }
    return { score, changed: true };
  }

  /** After the thresholds change, every lead's temperature is re-read from its score. */
  async retemper(dealerId: string, hot: number, warm: number): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.crmLead.updateMany({
        where: { dealerId, score: { gte: hot } },
        data: { temperature: 'HOT' },
      }),
      this.prisma.crmLead.updateMany({
        where: { dealerId, score: { gte: warm, lt: hot } },
        data: { temperature: 'WARM' },
      }),
      this.prisma.crmLead.updateMany({
        where: { dealerId, score: { lt: warm } },
        data: { temperature: 'COLD' },
      }),
    ]);
  }
}
