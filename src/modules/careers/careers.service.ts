import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import { randomBytes, randomUUID } from 'node:crypto';
import { normalizePagination } from '../../common/utils/pagination.util';
import { hasPrismaErrorCode } from '../../database/prisma-error.util';
import { PrismaService } from '../../database/prisma.service';
import { Prisma, type User } from '../../generated/prisma/client';
import { AdminAuditService } from '../admin-audit/admin-audit.service';
import { TurnstileService } from '../auth/services/turnstile.service';
import { MailService } from '../mail/mail.service';
import { applicationConfirmationEmail, candidateEmail } from './careers-email.template';
import {
  APPLICATION_STAGES,
  type AdminApplicationsQueryDto,
  type AdminJobsQueryDto,
  type ApplyDto,
  type JobUpsertDto,
  type PublicJobsQueryDto,
  type SendCandidateEmailDto,
  type UpdateApplicationDto,
} from './careers.dto';

export const CV_MAX_BYTES = 5 * 1024 * 1024;
const CV_FOLDER = 'latache-careers/cvs';
const NEW_BADGE_DAYS = 14;
const DUPLICATE_WINDOW_DAYS = 30;

export interface CvFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** MIME is what the browser claims; the magic bytes are what the file really is. */
const CV_TYPES = [
  { ext: 'pdf', mime: ['application/pdf'], magic: (b: Buffer) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { ext: 'docx', mime: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'], magic: (b: Buffer) => b[0] === 0x50 && b[1] === 0x4b },
  { ext: 'doc', mime: ['application/msword'], magic: (b: Buffer) => b.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0])) },
] as const;

const slugify = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'role';

const dec = (value: Prisma.Decimal | null): number | null => (value === null ? null : Number(value));
const full = (user: { firstName: string | null; lastName: string | null } | null | undefined) =>
  user ? `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() : '';

type JobRow = Prisma.JobPostingGetPayload<object>;

@Injectable()
export class CareersService {
  private readonly logger = new Logger(CareersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly turnstile: TurnstileService,
    private readonly mail: MailService,
    private readonly audit: AdminAuditService,
  ) {
    cloudinary.config({
      cloud_name: this.config.get<string>('cloudinary.cloudName'),
      api_key: this.config.get<string>('cloudinary.apiKey'),
      api_secret: this.config.get<string>('cloudinary.apiSecret'),
      secure: true,
    });
  }

  // ---------------------------------------------------------------- public

  async listPublic(query: PublicJobsQueryDto) {
    const { page, limit, offset } = normalizePagination(query.page, query.limit, 12);
    const search = query.search?.trim();
    const where: Prisma.JobPostingWhereInput = {
      status: 'open',
      ...(query.department ? { department: { equals: query.department, mode: 'insensitive' } } : {}),
      ...(query.city ? { city: { equals: query.city, mode: 'insensitive' } } : {}),
      ...(query.workMode ? { workMode: query.workMode } : {}),
      ...(query.employmentType ? { employmentType: query.employmentType } : {}),
      ...(query.seniority ? { seniority: query.seniority } : {}),
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: 'insensitive' } },
              { summary: { contains: search, mode: 'insensitive' } },
              { department: { contains: search, mode: 'insensitive' } },
              { city: { contains: search, mode: 'insensitive' } },
              { requirements: { has: search } },
            ],
          }
        : {}),
    };
    const orderBy: Prisma.JobPostingOrderByWithRelationInput[] =
      query.sort === 'title'
        ? [{ title: 'asc' }]
        : query.sort === 'newest'
          ? [{ publishedAt: 'desc' }]
          : [{ featured: 'desc' }, { urgent: 'desc' }, { publishedAt: 'desc' }];
    const open: Prisma.JobPostingWhereInput = { status: 'open' };
    const [rows, totalItems, departments, cities, workModes, employmentTypes, seniorities, openRoles] = await Promise.all([
      this.prisma.jobPosting.findMany({ where, orderBy, skip: offset, take: limit }),
      this.prisma.jobPosting.count({ where }),
      this.prisma.jobPosting.groupBy({ by: ['department'], where: open, _count: { _all: true }, orderBy: { department: 'asc' } }),
      this.prisma.jobPosting.groupBy({ by: ['city'], where: open, _count: { _all: true }, orderBy: { city: 'asc' } }),
      this.prisma.jobPosting.groupBy({ by: ['workMode'], where: open, _count: { _all: true } }),
      this.prisma.jobPosting.groupBy({ by: ['employmentType'], where: open, _count: { _all: true } }),
      this.prisma.jobPosting.groupBy({ by: ['seniority'], where: open, _count: { _all: true } }),
      this.prisma.jobPosting.count({ where: open }),
    ]);
    return {
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      items: rows.map((row) => this.publicSummary(row)),
      stats: { openRoles, departments: departments.length, cities: cities.length },
      facets: {
        departments: departments.map((r) => ({ value: r.department, count: r._count._all })),
        cities: cities.map((r) => ({ value: r.city, count: r._count._all })),
        workModes: workModes.map((r) => ({ value: r.workMode, count: r._count._all })),
        employmentTypes: employmentTypes.map((r) => ({ value: r.employmentType, count: r._count._all })),
        seniorities: seniorities.map((r) => ({ value: r.seniority, count: r._count._all })),
      },
    };
  }

  async getPublic(slug: string) {
    const job = await this.prisma.jobPosting.findUnique({ where: { slug } });
    if (!job || job.status === 'draft') throw new NotFoundException('Job not found');
    const similar = await this.prisma.jobPosting.findMany({
      where: { status: 'open', id: { not: job.id }, OR: [{ department: job.department }, { city: job.city }] },
      orderBy: [{ publishedAt: 'desc' }],
      take: 3,
    });
    return { ...this.publicDetail(job), similar: similar.map((row) => this.publicSummary(row)) };
  }

  async apply(dto: ApplyDto, file: CvFile | undefined, meta: { ip?: string; locale: string }) {
    // Bots fill hidden fields. Answer like a success so they learn nothing.
    if (dto.website?.trim()) return { id: randomUUID(), reference: 'LC-000000' };
    if (!dto.consent) throw new BadRequestException({ code: 'CONSENT_REQUIRED', message: 'Please accept the privacy notice to apply.' });
    await this.turnstile.verify(dto.captchaToken, meta.ip, 'careers-apply');
    const cv = this.validateCv(file);

    let job: JobRow | null = null;
    if (dto.jobSlug) {
      job = await this.prisma.jobPosting.findUnique({ where: { slug: dto.jobSlug } });
      if (!job || job.status === 'draft') throw new NotFoundException('Job not found');
      if (job.status !== 'open') throw new ConflictException({ code: 'JOB_CLOSED', message: 'This role is no longer accepting applications.' });
    }
    const since = new Date(Date.now() - DUPLICATE_WINDOW_DAYS * 86_400_000);
    const duplicate = await this.prisma.jobApplication.findFirst({
      where: { email: dto.email, jobId: job?.id ?? null, createdAt: { gte: since } },
      select: { reference: true },
    });
    if (duplicate) {
      throw new ConflictException({ code: 'ALREADY_APPLIED', message: `You already applied to this role (reference ${duplicate.reference}). We will be in touch.` });
    }

    const publicId = await this.uploadCv(cv);
    const reference = `LC-${randomBytes(4).toString('hex').toUpperCase().slice(0, 6)}`;
    let created;
    try {
      created = await this.prisma.jobApplication.create({
        data: {
          reference,
          jobId: job?.id ?? null,
          fullName: dto.fullName,
          email: dto.email,
          phone: dto.phone,
          city: dto.city,
          linkedinUrl: dto.linkedinUrl ?? null,
          portfolioUrl: dto.portfolioUrl ?? null,
          coverNote: dto.coverNote,
          source: dto.source ?? null,
          locale: meta.locale,
          cvPublicId: publicId,
          cvFileName: cv.safeName,
          cvMimeType: cv.mime,
          cvBytes: cv.size,
          consentAt: new Date(),
        },
      });
    } catch (error) {
      await this.destroyCv(publicId);
      if (hasPrismaErrorCode(error, 'P2002')) throw new ConflictException('Please try again.');
      throw error;
    }

    try {
      const email = applicationConfirmationEmail({ name: dto.fullName, reference, roleTitle: job?.title ?? null, locale: meta.locale });
      await this.mail.sendRenderedEmail({ to: dto.email, ...email });
    } catch (error) {
      // The application is saved; a failed confirmation email must not lose it.
      this.logger.warn(`Careers confirmation email failed for ${reference}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { id: created.id, reference };
  }

  // ----------------------------------------------------------------- admin

  async adminListJobs(query: AdminJobsQueryDto) {
    const { page, limit, offset } = normalizePagination(query.page, query.limit, 20);
    const search = query.search?.trim();
    const where: Prisma.JobPostingWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(search ? { OR: [{ title: { contains: search, mode: 'insensitive' } }, { department: { contains: search, mode: 'insensitive' } }, { city: { contains: search, mode: 'insensitive' } }] } : {}),
    };
    const [rows, totalItems, byStatus] = await Promise.all([
      this.prisma.jobPosting.findMany({ where, orderBy: [{ updatedAt: 'desc' }], skip: offset, take: limit, include: { _count: { select: { applications: true } } } }),
      this.prisma.jobPosting.count({ where }),
      this.prisma.jobPosting.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);
    return {
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      counts: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])),
      items: rows.map((row) => ({ ...this.adminJob(row), applications: row._count.applications })),
    };
  }

  async adminGetJob(id: string) {
    const row = await this.prisma.jobPosting.findUnique({ where: { id }, include: { _count: { select: { applications: true } } } });
    if (!row) throw new NotFoundException('Job not found');
    return { ...this.adminJob(row), applications: row._count.applications };
  }

  async createJob(actor: User, dto: JobUpsertDto) {
    this.assertSalary(dto);
    const status = dto.status ?? 'draft';
    const row = await this.createWithUniqueSlug(dto, status, actor.id);
    await this.audit.record({ actorId: actor.id, action: 'career_job_created', entityType: 'job_posting', entityId: row.id, metadata: { title: row.title, status } });
    return this.adminJob(row);
  }

  async updateJob(actor: User, id: string, dto: JobUpsertDto) {
    this.assertSalary(dto);
    const current = await this.prisma.jobPosting.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Job not found');
    const status = dto.status ?? current.status;
    const row = await this.prisma.jobPosting.update({ where: { id }, data: { ...this.jobData(dto), ...this.statusStamps(current.status, status, current) } });
    await this.audit.record({ actorId: actor.id, action: 'career_job_updated', entityType: 'job_posting', entityId: id, metadata: { from: current.status, to: status } });
    return this.adminJob(row);
  }

  async setJobStatus(actor: User, id: string, status: 'draft' | 'open' | 'closed') {
    const current = await this.prisma.jobPosting.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Job not found');
    const row = await this.prisma.jobPosting.update({ where: { id }, data: { status, ...this.statusStamps(current.status, status, current) } });
    await this.audit.record({ actorId: actor.id, action: `career_job_${status}`, entityType: 'job_posting', entityId: id, metadata: { from: current.status } });
    return this.adminJob(row);
  }

  async deleteJob(actor: User, id: string) {
    const row = await this.prisma.jobPosting.findUnique({ where: { id }, include: { _count: { select: { applications: true } } } });
    if (!row) throw new NotFoundException('Job not found');
    if (row._count.applications > 0) {
      throw new ConflictException({ code: 'JOB_HAS_APPLICATIONS', message: 'This job has applications. Close it instead of deleting it.' });
    }
    await this.prisma.jobPosting.delete({ where: { id } });
    await this.audit.record({ actorId: actor.id, action: 'career_job_deleted', entityType: 'job_posting', entityId: id, metadata: { title: row.title } });
    return { deleted: true };
  }

  async adminListApplications(query: AdminApplicationsQueryDto) {
    const { page, limit, offset } = normalizePagination(query.page, query.limit, 100);
    const search = query.search?.trim();
    const base: Prisma.JobApplicationWhereInput = {
      ...(query.jobId === 'general' ? { jobId: null } : query.jobId ? { jobId: query.jobId } : {}),
      ...(search
        ? { OR: [{ fullName: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }, { reference: { contains: search, mode: 'insensitive' } }, { city: { contains: search, mode: 'insensitive' } }] }
        : {}),
    };
    const where: Prisma.JobApplicationWhereInput = { ...base, ...(query.stage ? { stage: query.stage } : {}) };
    const [rows, totalItems, byStage] = await Promise.all([
      this.prisma.jobApplication.findMany({
        where,
        orderBy: [{ stageChangedAt: 'desc' }],
        skip: offset,
        take: limit,
        include: { job: { select: { id: true, title: true, slug: true } } },
      }),
      this.prisma.jobApplication.count({ where }),
      this.prisma.jobApplication.groupBy({ by: ['stage'], where: base, _count: { _all: true } }),
    ]);
    return {
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      stageCounts: Object.fromEntries(APPLICATION_STAGES.map((stage) => [stage, byStage.find((r) => r.stage === stage)?._count._all ?? 0])),
      items: rows.map((row) => this.applicationSummary(row)),
    };
  }

  async adminGetApplication(id: string) {
    const row = await this.prisma.jobApplication.findUnique({
      where: { id },
      include: {
        job: { select: { id: true, title: true, slug: true } },
        notes: { orderBy: { createdAt: 'desc' }, include: { author: { select: { firstName: true, lastName: true } } } },
      },
    });
    if (!row) throw new NotFoundException('Application not found');
    return {
      ...this.applicationSummary(row),
      coverNote: row.coverNote,
      linkedinUrl: row.linkedinUrl,
      portfolioUrl: row.portfolioUrl,
      source: row.source,
      locale: row.locale,
      consentAt: row.consentAt.toISOString(),
      cv: { fileName: row.cvFileName, mimeType: row.cvMimeType, bytes: row.cvBytes },
      notes: row.notes.map((n) => ({ id: n.id, body: n.body, author: full(n.author), createdAt: n.createdAt.toISOString() })),
    };
  }

  /** Short-lived signed download link: CVs are private assets, never public URLs. */
  async cvDownloadUrl(actor: User, id: string) {
    const row = await this.prisma.jobApplication.findUnique({ where: { id }, select: { cvPublicId: true, cvFileName: true, fullName: true } });
    if (!row) throw new NotFoundException('Application not found');
    const expiresAt = Math.floor(Date.now() / 1000) + 300;
    const url = cloudinary.utils.private_download_url(row.cvPublicId, '', { resource_type: 'raw', type: 'authenticated', expires_at: expiresAt, attachment: true });
    await this.audit.record({ actorId: actor.id, action: 'career_cv_downloaded', entityType: 'job_application', entityId: id });
    return { url, fileName: row.cvFileName, expiresInSeconds: 300 };
  }

  async updateApplication(actor: User, id: string, dto: UpdateApplicationDto) {
    const current = await this.prisma.jobApplication.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Application not found');
    const stageChanged = dto.stage !== undefined && dto.stage !== current.stage;
    const now = new Date();
    const row = await this.prisma.jobApplication.update({
      where: { id },
      data: {
        ...(dto.rating !== undefined ? { rating: dto.rating } : {}),
        ...(stageChanged
          ? { stage: dto.stage, stageChangedAt: now, hiredAt: dto.stage === 'hired' ? now : null }
          : {}),
      },
      include: { job: { select: { id: true, title: true, slug: true } } },
    });
    if (stageChanged) {
      await this.audit.record({ actorId: actor.id, action: 'career_application_stage_changed', entityType: 'job_application', entityId: id, metadata: { from: current.stage, to: dto.stage } });
    }
    return this.applicationSummary(row);
  }

  async addNote(actor: User, id: string, body: string) {
    const exists = await this.prisma.jobApplication.count({ where: { id } });
    if (!exists) throw new NotFoundException('Application not found');
    const note = await this.prisma.applicationNote.create({ data: { applicationId: id, authorId: actor.id, body }, include: { author: { select: { firstName: true, lastName: true } } } });
    return { id: note.id, body: note.body, author: full(note.author), createdAt: note.createdAt.toISOString() };
  }

  async sendCandidateEmail(actor: User, id: string, dto: SendCandidateEmailDto) {
    const row = await this.prisma.jobApplication.findUnique({ where: { id }, include: { job: { select: { title: true } } } });
    if (!row) throw new NotFoundException('Application not found');
    const email = candidateEmail({ template: dto.template, name: row.fullName, roleTitle: row.job?.title ?? null, note: dto.note, locale: row.locale ?? undefined });
    await this.mail.sendRenderedEmail({ to: row.email, ...email });
    await this.audit.record({ actorId: actor.id, action: 'career_candidate_emailed', entityType: 'job_application', entityId: id, metadata: { template: dto.template } });
    return { sent: true, to: row.email, subject: email.subject };
  }

  async analytics(days = 30) {
    const since = new Date(Date.now() - days * 86_400_000);
    const [total, byStage, byJob, bySource, hired, recent, openJobs] = await Promise.all([
      this.prisma.jobApplication.count({ where: { createdAt: { gte: since } } }),
      this.prisma.jobApplication.groupBy({ by: ['stage'], where: { createdAt: { gte: since } }, _count: { _all: true } }),
      this.prisma.jobApplication.groupBy({ by: ['jobId'], where: { createdAt: { gte: since } }, _count: { _all: true }, orderBy: { _count: { jobId: 'desc' } }, take: 8 }),
      this.prisma.jobApplication.groupBy({ by: ['source'], where: { createdAt: { gte: since } }, _count: { _all: true } }),
      this.prisma.jobApplication.findMany({ where: { stage: 'hired', hiredAt: { not: null }, createdAt: { gte: since } }, select: { createdAt: true, hiredAt: true } }),
      this.prisma.jobApplication.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
      this.prisma.jobPosting.count({ where: { status: 'open' } }),
    ]);
    const jobs = await this.prisma.jobPosting.findMany({ where: { id: { in: byJob.map((r) => r.jobId).filter((v): v is string => v !== null) } }, select: { id: true, title: true } });
    const stageCount = (stage: string) => byStage.find((r) => r.stage === stage)?._count._all ?? 0;
    const reached = {
      applied: total,
      screening: stageCount('screening') + stageCount('interview') + stageCount('offer') + stageCount('hired'),
      interview: stageCount('interview') + stageCount('offer') + stageCount('hired'),
      offer: stageCount('offer') + stageCount('hired'),
      hired: stageCount('hired'),
    };
    const daysToHire = hired.map((h) => ((h.hiredAt as Date).getTime() - h.createdAt.getTime()) / 86_400_000);
    const perDay = new Map<string, number>();
    for (const r of recent) perDay.set(r.createdAt.toISOString().slice(0, 10), (perDay.get(r.createdAt.toISOString().slice(0, 10)) ?? 0) + 1);
    return {
      days,
      totals: {
        applications: total,
        openJobs,
        hired: reached.hired,
        conversionPercent: total ? Math.round((reached.hired / total) * 1000) / 10 : 0,
        avgDaysToHire: daysToHire.length ? Math.round((daysToHire.reduce((a, b) => a + b, 0) / daysToHire.length) * 10) / 10 : null,
      },
      funnel: reached,
      perRole: byJob.map((r) => ({ jobId: r.jobId, title: r.jobId ? (jobs.find((j) => j.id === r.jobId)?.title ?? 'Removed role') : 'General application', applications: r._count._all })),
      sources: bySource.map((r) => ({ source: r.source ?? 'unknown', applications: r._count._all })).sort((a, b) => b.applications - a.applications),
      perDay: [...perDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, applications]) => ({ date, applications })),
    };
  }

  // --------------------------------------------------------------- helpers

  private validateCv(file: CvFile | undefined): { buffer: Buffer; mime: string; ext: string; size: number; safeName: string } {
    if (!file?.buffer?.length) throw new BadRequestException({ code: 'CV_REQUIRED', message: 'Please attach your CV (PDF, DOC or DOCX).' });
    if (file.size > CV_MAX_BYTES) throw new BadRequestException({ code: 'CV_TOO_LARGE', message: 'Your CV must be 5 MB or smaller.' });
    const type = CV_TYPES.find((t) => (t.mime as readonly string[]).includes(file.mimetype));
    if (!type || !type.magic(file.buffer)) {
      throw new BadRequestException({ code: 'CV_INVALID_TYPE', message: 'Your CV must be a real PDF, DOC or DOCX file.' });
    }
    const safeName = (file.originalname || `cv.${type.ext}`).replace(/[^\w.\- ]+/g, '_').slice(-120);
    return { buffer: file.buffer, mime: file.mimetype, ext: type.ext, size: file.size, safeName };
  }

  private async uploadCv(cv: { buffer: Buffer; ext: string }): Promise<string> {
    const publicId = `${CV_FOLDER}/${randomUUID()}.${cv.ext}`;
    try {
      await new Promise<void>((resolve, reject) => {
        cloudinary.uploader
          .upload_stream({ public_id: publicId, resource_type: 'raw', type: 'authenticated', overwrite: false, tags: ['careers-cv'] }, (error) => (error ? reject(error) : resolve()))
          .end(cv.buffer);
      });
    } catch (error) {
      this.logger.error(`CV upload failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new ServiceUnavailableException({ code: 'CV_UPLOAD_FAILED', message: 'We could not store your CV. Please try again in a moment.' });
    }
    return publicId;
  }

  private async destroyCv(publicId: string): Promise<void> {
    try {
      await cloudinary.uploader.destroy(publicId, { resource_type: 'raw', type: 'authenticated' });
    } catch (error) {
      this.logger.warn(`Could not remove orphaned CV ${publicId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private assertSalary(dto: JobUpsertDto): void {
    if (dto.salaryMin != null && dto.salaryMax != null && dto.salaryMin > dto.salaryMax) {
      throw new BadRequestException('salaryMin cannot be greater than salaryMax');
    }
    if (dto.showSalary && (dto.salaryMin == null || dto.salaryMax == null)) {
      throw new BadRequestException('Set both salaryMin and salaryMax to show the salary range publicly');
    }
  }

  private jobData(dto: JobUpsertDto) {
    return {
      title: dto.title,
      department: dto.department,
      city: dto.city,
      workMode: dto.workMode,
      employmentType: dto.employmentType,
      seniority: dto.seniority,
      summary: dto.summary,
      responsibilities: dto.responsibilities,
      requirements: dto.requirements,
      niceToHave: dto.niceToHave ?? [],
      benefits: dto.benefits ?? [],
      salaryMin: dto.salaryMin ?? null,
      salaryMax: dto.salaryMax ?? null,
      salaryCurrency: dto.salaryCurrency ?? 'MAD',
      showSalary: Boolean(dto.showSalary),
      featured: Boolean(dto.featured),
      urgent: Boolean(dto.urgent),
      status: dto.status,
    };
  }

  private statusStamps(from: string, to: string, current: { publishedAt: Date | null }) {
    const now = new Date();
    return {
      ...(to === 'open' && from !== 'open' ? { publishedAt: current.publishedAt ?? now, closedAt: null } : {}),
      ...(to === 'closed' && from !== 'closed' ? { closedAt: now } : {}),
    };
  }

  private async createWithUniqueSlug(dto: JobUpsertDto, status: string, actorId: number): Promise<JobRow> {
    const base = slugify(dto.title);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const slug = attempt === 0 ? base : `${base}-${randomBytes(2).toString('hex')}`;
      try {
        return await this.prisma.jobPosting.create({
          data: { ...this.jobData(dto), status, slug, createdById: actorId, ...(status === 'open' ? { publishedAt: new Date() } : {}) },
        });
      } catch (error) {
        if (!hasPrismaErrorCode(error, 'P2002')) throw error;
      }
    }
    throw new ConflictException('Could not generate a unique URL for this job');
  }

  private salaryView(row: JobRow) {
    return row.showSalary && row.salaryMin !== null && row.salaryMax !== null
      ? { min: dec(row.salaryMin), max: dec(row.salaryMax), currency: row.salaryCurrency }
      : null;
  }

  private publicSummary(row: JobRow) {
    const isNew = row.publishedAt ? Date.now() - row.publishedAt.getTime() < NEW_BADGE_DAYS * 86_400_000 : false;
    return {
      slug: row.slug,
      title: row.title,
      department: row.department,
      city: row.city,
      workMode: row.workMode,
      employmentType: row.employmentType,
      seniority: row.seniority,
      summary: row.summary,
      salary: this.salaryView(row),
      isNew,
      urgent: row.urgent,
      featured: row.featured,
      status: row.status,
      publishedAt: row.publishedAt?.toISOString() ?? null,
    };
  }

  private publicDetail(row: JobRow) {
    return {
      ...this.publicSummary(row),
      responsibilities: row.responsibilities,
      requirements: row.requirements,
      niceToHave: row.niceToHave,
      benefits: row.benefits,
      accepting: row.status === 'open',
    };
  }

  private adminJob(row: JobRow) {
    return {
      ...this.publicDetail(row),
      id: row.id,
      showSalary: row.showSalary,
      salaryMin: dec(row.salaryMin),
      salaryMax: dec(row.salaryMax),
      salaryCurrency: row.salaryCurrency,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      closedAt: row.closedAt?.toISOString() ?? null,
    };
  }

  private applicationSummary(row: Prisma.JobApplicationGetPayload<{ include: { job: { select: { id: true; title: true; slug: true } } } }>) {
    return {
      id: row.id,
      reference: row.reference,
      fullName: row.fullName,
      email: row.email,
      phone: row.phone,
      city: row.city,
      stage: row.stage,
      rating: row.rating,
      job: row.job ? { id: row.job.id, title: row.job.title, slug: row.job.slug } : null,
      createdAt: row.createdAt.toISOString(),
      stageChangedAt: row.stageChangedAt.toISOString(),
    };
  }
}
