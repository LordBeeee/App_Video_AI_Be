import { IsOptional, IsString, MaxLength, Matches, IsNotEmpty } from 'class-validator'

export class UpdateEmployeeDto {
  @IsNotEmpty({ message: 'Họ và tên không được để trống' })
  @IsString()
  @Matches(
    /^[a-zA-ZÀ-ỹ]+(\s+[a-zA-ZÀ-ỹ]+)+$/u,
    { message: 'Họ và tên phải có ít nhất 2 từ (họ và tên)' },
  )
  fullName!: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  username?: string

  @IsNotEmpty({ message: 'Số điện thoại không được để trống' })
  @Matches(
    /^(0[35789]\d{8}|02\d{9})$/,
    { message: 'Số điện thoại không đúng định dạng Việt Nam (vd: 0901234567)' },
  )
  phone!: string
}