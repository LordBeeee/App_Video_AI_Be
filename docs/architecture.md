# Cấu trúc backend

## Điểm vào

- `src/main.ts`: HTTP middleware, CORS, validation và cổng lắng nghe.
- `src/app.module.ts`: ghép các Nest module, PostgreSQL và rate limit.
- `src/config/validate-env.ts`: kiểm tra cấu hình bắt buộc trước khi ứng dụng chạy.

## Nghiệp vụ

| Thư mục | Trách nhiệm |
| --- | --- |
| `modules/auth` | Đăng nhập, cookie, refresh token và JWT guard. |
| `modules/user` | Hồ sơ, nhân viên và thống kê người dùng/hệ thống. |
| `modules/assets` | Upload và thư viện asset. |
| `modules/wallet` | Số dư, giữ tiền, quyết toán và nạp qua payOS. |
| `modules/ai-platform/catalog` | Danh sách model được hỗ trợ, cache và đồng bộ metadata. |
| `modules/ai-platform/pricing` | Kiểm tra lựa chọn model, báo giá và tỷ giá. |
| `modules/ai-platform/generations` | Tạo media, lưu output và đối soát video bất đồng bộ. |
| `modules/ai-platform/chat` | Hội thoại và stream phản hồi. |
| `modules/ai-platform/references` | API quản lý reference của Kling. |

`AiPlatformModule` hiện ghép các phần AI trong một Nest module. Các thư mục con
giúp tìm code theo luồng; khi một phần cần dùng độc lập, có thể tách thành Nest
module riêng mà vẫn giữ route bên ngoài.

## Luồng tạo nội dung

1. `CatalogService` xác nhận model thuộc modality người dùng chọn.
2. `PricingService` tạo quote và ghi giá tối đa vào PostgreSQL.
3. `GenerationsService` kiểm tra quote, giữ tiền qua `WalletService`, rồi gọi provider.
4. `GenerationAssetsService` lưu output vào thư viện asset.
5. `VideoReconciliationService` lấy trạng thái Kling và quyết toán hoặc hoàn
   khoản giữ sau khi video hoàn thành.

Khi thêm provider mới, giữ request/response đặc thù provider trong một adapter.
Không đưa lời gọi HTTP hoặc khóa API vào controller. Khi thêm loại nội dung mới,
cập nhật catalog, pricing, generation, DTO và kiểm thử cho luồng ví tương ứng.

## Database

`database/migrations/0001_fresh_install.sql` là schema cho database trống.
`database/seeds/0001_roles.sql` chứa role ID mà guard và user service đang dùng.
Các file trong `migrations/` ở gốc là đường nâng cấp từ schema cũ. Xem
[database.md](database.md) trước khi chạy SQL trên một database đã có dữ liệu.
