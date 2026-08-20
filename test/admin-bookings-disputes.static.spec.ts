import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('admin booking and dispute management static contracts', () => {
  it('uses consolidated admin resources instead of a route per tab', () => {
    const bookings = read('src/modules/admin-dashboard/controllers/admin-bookings.controller.ts');
    const disputes = read('src/modules/admin-dashboard/controllers/admin-disputes.controller.ts');
    const customers = read('src/modules/admin-dashboard/controllers/admin-customers.controller.ts');

    expect(bookings).toContain("@Controller('admin/bookings')");
    expect(bookings).toContain('@Get()');
    expect(disputes).toContain("@Controller('admin/disputes')");
    expect(disputes).toContain('@Get()');
    expect(customers).not.toContain("@Get('bookings')");
  });

  it('requires finance permission only when a support resolution actually refunds money', () => {
    const controller = read('src/modules/admin-dashboard/controllers/admin-disputes.controller.ts');
    const service = read('src/modules/admin-dashboard/services/admin-disputes.service.ts');
    expect(controller).toContain("@Permissions('support.manage')");
    expect(service).toContain("actor.permissions.includes('finance.manage')");
    expect(service).toContain('Refund resolutions require finance.manage');
  });

  it('keeps refund state provider-backed and webhook-reconcilable', () => {
    const payments = read('src/modules/payments/payments.service.ts');
    expect(payments).toContain('stripeProvider.client().refunds.create');
    expect(payments).toContain("event.type === 'refund.created'");
    expect(payments).toContain("event.type === 'refund.updated'");
    expect(payments).toContain("event.type === 'refund.failed'");
    expect(payments).toContain('applyTaskerRefundClawback');
    expect(payments).toContain('isFullyRefunded ? remainingTaskerEarning : proportionalClawback');
  });

  it('implements end-to-end requested evidence without exposing admin notes to participants', () => {
    const controller = read('src/modules/bookings/participant-disputes.controller.ts');
    const service = read('src/modules/bookings/bookings.service.ts');
    expect(controller).toContain("@Get('disputes/:disputeId')");
    expect(controller).toContain("@Post('disputes/:disputeId/evidence')");
    const lifecycle = read('src/modules/disputes/dispute-lifecycle.service.ts');
    const uploads = read('src/modules/uploads/uploads.service.ts');
    expect(service).toContain('this.disputes.verifyEvidence');
    expect(lifecycle).toContain('verifyDisputeAttachments');
    expect(uploads).toContain('verifyDisputeAttachments');
    expect(service).toContain('duplicateEvidenceIgnored');
    const participantSlice = service.slice(
      service.indexOf('async listComplaints'),
      service.indexOf('async fileComplaint'),
    );
    expect(participantSlice).not.toContain('evidenceReviewNotes');
  });

  it('does not seed operational dispute/refund data', () => {
    const migration = read(
      'prisma/migrations/20260810130000_add_booking_dispute_management/migration.sql',
    );
    expect(migration).toContain('CREATE TABLE "DisputeEvidence"');
    expect(migration).toContain('CREATE TABLE "DisputeEvidenceRequests"');
    expect(migration).toContain('CREATE TABLE "DisputeResolutions"');
    expect(migration).toContain(
      "evidenceReviewStatus\" VARCHAR(32) NOT NULL DEFAULT 'not_required'",
    );
    expect(migration).not.toMatch(/INSERT\s+INTO/i);
  });

  it('reports persisted post-dispute satisfaction metrics', () => {
    const service = read('src/modules/admin-dashboard/services/admin-disputes.service.ts');
    expect(service).toContain('trackingAvailable: true');
    expect(service).toContain('averageRating');
    expect(service).toContain('satisfiedRatePercent');
  });

  it('expires unanswered settlement proposals through the dispute maintenance flow', () => {
    const lifecycle = read('src/modules/disputes/dispute-lifecycle.service.ts');
    const schema = read('prisma/schema.prisma');
    expect(lifecycle).toContain('processSettlementProposalExpiries');
    expect(lifecycle).toContain("status: 'expired'");
    expect(schema).toContain('dispute_resolutions_status_response_due_idx');
  });
});
