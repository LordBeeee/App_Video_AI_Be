import { ServiceUnavailableException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import axios from 'axios';
import { Repository } from 'typeorm';
import { FxRate } from './entities/fx-rate.entity';

@Injectable()
export class FxService {
  constructor(
    @InjectRepository(FxRate) private readonly rates: Repository<FxRate>,
    private readonly config: ConfigService,
  ) {}

  async getUsdVndRate(): Promise<{
    rate: number;
    date: string;
    source: string;
  }> {
    const latest = await this.rates.findOne({
      where: { baseCurrency: 'USD', quoteCurrency: 'VND' },
      order: { fetchedAt: 'DESC' },
    });
    if (latest && Date.now() - latest.fetchedAt.getTime() < 24 * 60 * 60_000) {
      return {
        rate: Number(latest.rate),
        date: latest.rateDate,
        source: latest.source,
      };
    }

    try {
      const response = await axios.get(
        'https://api.frankfurter.dev/v2/rate/usd/vnd',
        { timeout: 8_000 },
      );
      const rate = Number(response.data?.rate);
      if (!Number.isFinite(rate) || rate <= 0)
        throw new Error('Tỷ giá không hợp lệ');
      const rateDate =
        response.data.date || new Date().toISOString().slice(0, 10);
      const entity = this.rates.create({
        baseCurrency: 'USD',
        quoteCurrency: 'VND',
        rate: String(rate),
        rateDate,
        source: 'frankfurter',
      });
      await this.rates.upsert(entity, [
        'baseCurrency',
        'quoteCurrency',
        'rateDate',
      ]);
      return { rate, date: rateDate, source: 'frankfurter' };
    } catch {
      if (
        latest &&
        Date.now() - latest.fetchedAt.getTime() <= 7 * 24 * 60 * 60_000
      ) {
        return {
          rate: Number(latest.rate),
          date: latest.rateDate,
          source: `${latest.source}:cached`,
        };
      }
      const fallback = Number(this.config.get<string>('FX_FALLBACK_USD_VND'));
      if (Number.isFinite(fallback) && fallback > 0) {
        return {
          rate: fallback,
          date: new Date().toISOString().slice(0, 10),
          source: 'environment-fallback',
        };
      }
      throw new ServiceUnavailableException('Không thể lấy tỷ giá USD/VND');
    }
  }
}
