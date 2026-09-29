import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { VinDecodeResult } from '@vintrax/shared';
import { RedisService } from '../../common/redis/redis.service';
import { toVinDecodeResult, type VpicValues } from './vin-decode';

/** NHTSA's free VIN decoder. Fixed: nothing in a request can change the host. */
const VPIC_URL = 'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/';
const TIMEOUT_MS = 8_000;
/** A VIN always decodes to the same vehicle, so an answer is kept for a month. */
const CACHE_TTL = 30 * 24 * 60 * 60;

/**
 * Decodes a VIN into make, model, year, trim and drivetrain, so a dealer types
 * seventeen characters instead of filling in a dozen fields.
 *
 * vPIC covers vehicles sold in North America. It knows nothing about a car's
 * options or history — only what the VIN itself encodes — and a VIN it cannot
 * read is a 404 the form answers by letting the dealer type the model in.
 */
@Injectable()
export class VinService {
  private readonly logger = new Logger(VinService.name);

  constructor(private readonly redis: RedisService) {}

  /** Swapped in tests; the real one is the global fetch. */
  fetchImpl: typeof fetch = (input, init) => fetch(input, init);

  async decode(vin: string): Promise<VinDecodeResult> {
    const values = await this.redis.remember(`vin:vpic:${vin}`, CACHE_TTL, () => this.lookup(vin));
    const result = toVinDecodeResult(vin, values);
    if (!result.make || !result.model) {
      throw new NotFoundException(
        'This VIN could not be decoded. Check it, or choose the make and model yourself.',
      );
    }
    return result;
  }

  private async lookup(vin: string): Promise<VpicValues> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${VPIC_URL}${encodeURIComponent(vin)}?format=json`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.warn(`vPIC unreachable for ${vin}: ${String(error)}`);
      throw unavailable();
    }
    if (!response.ok) {
      this.logger.warn(`vPIC answered ${response.status} for ${vin}`);
      throw unavailable();
    }
    const body = (await response.json().catch(() => null)) as { Results?: VpicValues[] } | null;
    const values = body?.Results?.[0];
    if (!values) throw unavailable();
    return values;
  }
}

function unavailable() {
  return new ServiceUnavailableException(
    'The VIN decoder is not answering right now. Choose the make and model yourself, or try again shortly.',
  );
}
