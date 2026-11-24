import { Controller, Get, Param, ParseIntPipe, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiProduces, ApiProperty, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Matches } from 'class-validator';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { User } from '../../generated/prisma/client';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TaskerStatementsService } from './tasker-statements.service';

export class StatementMonthQueryDto {
  @ApiProperty({ example: '2026-11', description: 'UTC calendar month, YYYY-MM.' })
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  month!: string;
}

const send = (res: Response, body: Buffer | string, type: string, filename: string) => {
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.end(body);
};

@ApiTags('63 Tasker Statements')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.Tasker)
@Controller('tasker-dashboard/statements')
export class TaskerStatementsController {
  constructor(private readonly statements: TaskerStatementsService) {}

  @Get()
  @ApiOperation({
    summary: 'My monthly earnings statement',
    description: 'Jobs and net earnings, commission, payouts, wallet opening/closing balance and cash commission owed for one month.',
  })
  get(@CurrentUser() user: User, @Query() query: StatementMonthQueryDto) {
    return this.statements.build(user.id, query.month);
  }

  @Get('pdf')
  @ApiProduces('application/pdf')
  @ApiQuery({ name: 'month', example: '2026-11' })
  async pdf(@CurrentUser() user: User, @Query() query: StatementMonthQueryDto, @Res() res: Response) {
    const statement = await this.statements.build(user.id, query.month);
    send(res, await this.statements.pdf(statement), 'application/pdf', `latache-statement-${query.month}.pdf`);
  }

  @Get('csv')
  @ApiProduces('text/csv')
  @ApiQuery({ name: 'month', example: '2026-11' })
  async csv(@CurrentUser() user: User, @Query() query: StatementMonthQueryDto, @Res() res: Response) {
    const statement = await this.statements.build(user.id, query.month);
    send(res, this.statements.csv(statement), 'text/csv; charset=utf-8', `latache-statement-${query.month}.csv`);
  }
}

@ApiTags('63 Tasker Statements')
@ApiBearerAuth('bearer')
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Permissions('finance.read')
@Controller('admin/taskers/:taskerId/statements')
export class AdminTaskerStatementsController {
  constructor(private readonly statements: TaskerStatementsService) {}

  @Get()
  @ApiParam({ name: 'taskerId', type: Number })
  get(@Param('taskerId', ParseIntPipe) taskerId: number, @Query() query: StatementMonthQueryDto) {
    return this.statements.build(taskerId, query.month);
  }

  @Get('pdf')
  @ApiParam({ name: 'taskerId', type: Number })
  @ApiProduces('application/pdf')
  async pdf(@Param('taskerId', ParseIntPipe) taskerId: number, @Query() query: StatementMonthQueryDto, @Res() res: Response) {
    const statement = await this.statements.build(taskerId, query.month);
    send(res, await this.statements.pdf(statement), 'application/pdf', `latache-statement-${taskerId}-${query.month}.pdf`);
  }

  @Get('csv')
  @ApiParam({ name: 'taskerId', type: Number })
  @ApiProduces('text/csv')
  async csv(@Param('taskerId', ParseIntPipe) taskerId: number, @Query() query: StatementMonthQueryDto, @Res() res: Response) {
    const statement = await this.statements.build(taskerId, query.month);
    send(res, this.statements.csv(statement), 'text/csv; charset=utf-8', `latache-statement-${taskerId}-${query.month}.csv`);
  }
}
