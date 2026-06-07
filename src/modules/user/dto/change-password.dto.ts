import { IsNotEmpty, IsString, MinLength, Matches } from 'class-validator'

export class ChangePasswordDto {
  @IsNotEmpty({ message: 'Mật khẩu hiện tại không được để trống' })
  @IsString()
  currentPassword!: string

  @IsNotEmpty({ message: 'Mật khẩu mới không được để trống' })
  @IsString()
  @MinLength(8, { message: 'Mật khẩu phải có ít nhất 8 ký tự' })
  @Matches(/[A-Z]/, { message: 'Mật khẩu phải có ít nhất 1 chữ hoa' })
  @Matches(/[a-z]/, { message: 'Mật khẩu phải có ít nhất 1 chữ thường' })
  @Matches(/\d/,   { message: 'Mật khẩu phải có ít nhất 1 chữ số' })
  @Matches(/[^A-Za-z\d]/, { message: 'Mật khẩu phải có ít nhất 1 ký tự đặc biệt' })
  newPassword!: string
}