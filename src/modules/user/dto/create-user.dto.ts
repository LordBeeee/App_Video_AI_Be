import { IsEmail, IsNotEmpty, IsOptional, MinLength } from 'class-validator'

export class CreateUserDto {
  @IsNotEmpty({ message: 'Họ và tên không được để trống' })
  fullName!: string

  @IsEmail({}, { message: 'Email không hợp lệ' })
  email!: string

  @IsNotEmpty({ message: 'Mật khẩu không được để trống' })
  @MinLength(6, { message: 'Mật khẩu tối thiểu 6 ký tự' })
  password!: string

  @IsOptional()
  phone?: string
}