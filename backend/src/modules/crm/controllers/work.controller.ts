import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  appointmentSchema,
  appointmentStatusSchema,
  calendarQuerySchema,
  taskListQuerySchema,
  taskSchema,
  taskStatusSchema,
  type AppointmentInput,
  type AppointmentStatus,
  type CrmTaskStatus,
  type TaskInput,
  type TaskListQuery,
} from '@vintrax/shared';
import { z } from 'zod';
import { zodBody, zodQuery } from '../../../common/pipes/zod-validation.pipe';
import { Crm, RequireCrm, type CrmContext } from '../core/context';
import { CrmGuard } from '../core/crm.guard';
import { WorkService } from '../work/work.service';

/** Dealer CRM: tasks, appointments and the calendar. */
@ApiTags('crm')
@Controller('crm')
@UseGuards(CrmGuard)
@RequireCrm('crm.view')
export class CrmWorkController {
  constructor(private readonly work: WorkService) {}

  @Get('tasks')
  @ApiOperation({ summary: 'Tasks: open, today, overdue, upcoming, completed' })
  tasks(@Crm() ctx: CrmContext, @Query(zodQuery(taskListQuerySchema)) query: TaskListQuery) {
    return this.work.listTasks(ctx, query);
  }

  @Post('tasks')
  @ApiOperation({ summary: 'Create a task' })
  createTask(@Crm() ctx: CrmContext, @Body(zodBody(taskSchema)) input: TaskInput) {
    return this.work.createTask(ctx, input);
  }

  @Put('tasks/:id')
  @ApiOperation({ summary: 'Update a task' })
  updateTask(@Crm() ctx: CrmContext, @Param('id', ParseUUIDPipe) id: string, @Body(zodBody(taskSchema)) input: TaskInput) {
    return this.work.updateTask(ctx, id, input);
  }

  @Post('tasks/:id/status')
  @ApiOperation({ summary: 'Start, complete or cancel a task (completing a repeating task opens the next)' })
  taskStatus(
    @Crm() ctx: CrmContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(taskStatusSchema)) input: { status: CrmTaskStatus },
  ) {
    return this.work.setTaskStatus(ctx, id, input.status);
  }

  @Delete('tasks/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a task' })
  async deleteTask(@Crm() ctx: CrmContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.work.deleteTask(ctx, id);
  }

  @Get('appointments')
  @ApiOperation({ summary: 'Appointments between two instants' })
  appointments(@Crm() ctx: CrmContext, @Query(zodQuery(calendarQuerySchema)) query: z.infer<typeof calendarQuerySchema>) {
    return this.work.listAppointments(ctx, { from: new Date(query.from), to: new Date(query.to), salespersonId: query.salespersonId });
  }

  @Post('appointments')
  @ApiOperation({ summary: 'Book an appointment' })
  createAppointment(@Crm() ctx: CrmContext, @Body(zodBody(appointmentSchema)) input: AppointmentInput) {
    return this.work.createAppointment(ctx, input);
  }

  @Put('appointments/:id')
  @ApiOperation({ summary: 'Update an appointment' })
  updateAppointment(
    @Crm() ctx: CrmContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(appointmentSchema)) input: AppointmentInput,
  ) {
    return this.work.updateAppointment(ctx, id, input);
  }

  @Post('appointments/:id/status')
  @ApiOperation({ summary: 'Confirm, complete, cancel or mark a no-show' })
  appointmentStatus(
    @Crm() ctx: CrmContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(appointmentStatusSchema)) input: { status: AppointmentStatus },
  ) {
    return this.work.setAppointmentStatus(ctx, id, input.status);
  }

  @Delete('appointments/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an appointment' })
  async deleteAppointment(@Crm() ctx: CrmContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.work.deleteAppointment(ctx, id);
  }

  @Get('calendar')
  @ApiOperation({ summary: 'Appointments and dated tasks for the day, week or month views' })
  calendar(@Crm() ctx: CrmContext, @Query(zodQuery(calendarQuerySchema)) query: z.infer<typeof calendarQuerySchema>) {
    return this.work.calendar(ctx, { from: new Date(query.from), to: new Date(query.to), salespersonId: query.salespersonId });
  }
}
