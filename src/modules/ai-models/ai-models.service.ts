import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiModel } from './entities/ai-model.entity';

@Injectable()
export class AiModelsService {
  constructor(
    @InjectRepository(AiModel)
    private aiModelRepository: Repository<AiModel>,
  ) {}

  // Lấy tất cả models (có thể filter theo provider code và model_type)
  async findAll(providerCode?: string, modelType?: string): Promise<AiModel[]> {
    const query = this.aiModelRepository
      .createQueryBuilder('model')
      .leftJoinAndSelect('model.provider', 'provider')
      .where('model.is_active = :isActive', { isActive: true });

    if (providerCode) {
      query.andWhere('provider.code = :providerCode', { providerCode });
    }

    if (modelType) {
      query.andWhere('model.model_type = :modelType', { modelType });
    }

    return query.orderBy('model.name', 'ASC').getMany();
  }

  // Lấy models theo provider code (dùng cho FE dropdown)
  async findByProvider(providerCode: string): Promise<AiModel[]> {
    return this.aiModelRepository
      .createQueryBuilder('model')
      .leftJoin('model.provider', 'provider')
      .where('provider.code = :providerCode', { providerCode })
      .andWhere('model.is_active = :isActive', { isActive: true })
      .orderBy('model.name', 'ASC')
      .getMany();
  }

  async findOne(id: number): Promise<AiModel | null> {  // thêm | null
    return this.aiModelRepository.findOne({
        where: { id },
        relations: ['provider'],
    });
  }
}