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
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type ContactMessage,
  type ContactMessageInput,
  type Paginated,
  type PaginationQuery,
  contactMessageSchema,
  paginationSchema,
} from '@vintrax/shared';
import { Public, RequirePermissions } from '../../common/decorators';
import { zodBody, zodQuery } from '../../common/pipes/zod-validation.pipe';
import { ContactService } from './contact.service';

@ApiTags('contact')
@Controller()
export class ContactController {
  constructor(private readonly contact: ContactService) {}

  /**
   * The Contact page's form. Public, and throttled well below the global
   * limit: it sends email, so it is worth more to a spammer than a page read.
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('contact')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Send a message through the Contact page' })
  async submit(
    @Body(zodBody(contactMessageSchema)) input: ContactMessageInput,
  ): Promise<{ received: true }> {
    await this.contact.submit(input);
    return { received: true };
  }

  @Get('admin/contact-messages')
  @RequirePermissions('content:manage')
  @ApiOperation({ summary: 'Messages sent through the Contact page, newest first' })
  list(
    @Query(zodQuery(paginationSchema)) query: PaginationQuery,
  ): Promise<Paginated<ContactMessage>> {
    return this.contact.list(query);
  }

  @Delete('admin/contact-messages/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('content:manage')
  @ApiOperation({ summary: 'Delete a Contact-page message' })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.contact.remove(id);
  }
}
