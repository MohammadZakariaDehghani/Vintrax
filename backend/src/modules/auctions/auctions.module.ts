import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuctionsController } from './auctions.controller';
import { AuctionsGateway } from './auctions.gateway';
import { AuctionsService } from './auctions.service';
import { AuctionsWorker } from './auctions.worker';

@Module({
  // The gateway verifies access tokens on the handshake, so it needs JwtService.
  imports: [JwtModule.register({})],
  controllers: [AuctionsController],
  providers: [AuctionsService, AuctionsGateway, AuctionsWorker],
  exports: [AuctionsService],
})
export class AuctionsModule {}
