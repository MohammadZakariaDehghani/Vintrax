import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IMAGE_STORAGE, createImageStorage } from './image-storage';
import { StorageService } from './storage.service';

@Global()
@Module({
  providers: [
    StorageService,
    { provide: IMAGE_STORAGE, inject: [ConfigService], useFactory: createImageStorage },
  ],
  exports: [StorageService, IMAGE_STORAGE],
})
export class StorageModule {}
