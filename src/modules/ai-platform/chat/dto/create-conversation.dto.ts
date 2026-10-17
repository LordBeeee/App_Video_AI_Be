import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateConversationDto {
  @IsString()
  @MinLength(1)
  modelSlug!: string;

  @IsOptional()
  @IsString()
  title?: string;
}
