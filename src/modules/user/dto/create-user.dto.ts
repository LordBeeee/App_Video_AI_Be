import { IsEmail, IsNotEmpty, IsString, MinLength, Matches } from 'class-validator'

export class CreateUserDto {
  @IsNotEmpty({ message: 'Họ và tên không được để trống' })
  @IsString()
  @Matches(
    /^[a-zA-ZÀ-ỹ]+(\s+[a-zA-ZÀ-ỹ]+)+$/u,
    { message: 'Họ và tên phải có ít nhất 2 từ (họ và tên)' },
  )
  fullName!: string

  @IsEmail({}, { message: 'Email không hợp lệ' })
  email!: string

  @IsNotEmpty({ message: 'Mật khẩu không được để trống' })
  @MinLength(8, { message: 'Mật khẩu tối thiểu 8 ký tự' })
  @Matches(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/,
    { message: 'Mật khẩu phải có ít nhất 1 chữ hoa, 1 chữ thường, 1 số và 1 ký tự đặc biệt' },
  )
  password!: string

  // Bắt buộc nhập, đúng định dạng số VN (10 số, đầu 03x / 05x / 07x / 08x / 09x)
  @IsNotEmpty({ message: 'Số điện thoại không được để trống' })
  @Matches(
    /^(0[35789]\d{8}|02\d{9})$/,
    { message: 'Số điện thoại không đúng định dạng Việt Nam (vd: 0901234567)' },
  )
  phone!: string
}