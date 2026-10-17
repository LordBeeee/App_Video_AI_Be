import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import type { AiModality } from '../../catalog/catalog.service';

export class CreateQuoteDto {
  @IsIn(['image', 'video', 'audio', 'chat'])
  modality!: AiModality;

  @IsString()
  @MinLength(1)
  modelSlug!: string;

  @IsOptional()
  @IsString()
  prompt?: string;

  @IsOptional()
  @IsObject()
  options?: Record<string, unknown>;
}
