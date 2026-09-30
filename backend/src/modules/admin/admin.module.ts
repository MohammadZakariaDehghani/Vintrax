import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { BodyTypeBackdrops } from './body-type-backdrops';

@Module({
  controllers: [AdminController],
  providers: [AdminService, BodyTypeBackdrops],
})
export class AdminModule {}
