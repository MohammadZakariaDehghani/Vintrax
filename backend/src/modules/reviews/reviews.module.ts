import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReviewsAdminController } from './reviews-admin.controller';
import { ReviewsAdminService } from './reviews-admin.service';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';

/** Vehicle reviews and comments, moderated before they are public (D-067). */
@Module({
  imports: [NotificationsModule],
  controllers: [ReviewsController, ReviewsAdminController],
  providers: [ReviewsService, ReviewsAdminService],
})
export class ReviewsModule {}
