import { MulterModule } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';

/**
 * Multer's defaults accept a file of any size and buffer it whole in memory.
 * This caps every multipart upload in the importing module at the larger of
 * the two configured limits, and at one file per request; the precise
 * per-kind limit is still checked after (StorageService for documents and
 * logos, ImageProcessor for vehicle photos).
 */
export const UploadLimitsModule = MulterModule.registerAsync({
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>) => ({
    limits: {
      fileSize: Math.max(
        config.get('MAX_UPLOAD_BYTES', { infer: true }),
        config.get('IMAGE_MAX_UPLOAD_BYTES', { infer: true }),
      ),
      files: 1,
    },
  }),
});
