import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class CreateGenerationDto {
  @IsUUID()
  quoteId!: string;

  @IsString()
  @MinLength(1)
  prompt!: string;

  @IsOptional()
  @IsInt()
  projectId?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  referenceUrls?: string[];

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  referenceAssetIds?: number[];
}
