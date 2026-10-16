# AI multimedia platform

## Khởi tạo

1. Sao chép các biến mới trong `.env.example` vào file môi trường đang dùng và điền khóa OpenRouter (ảnh/audio/chat), Kling (video), Cloudinary và payOS.
2. Với database trống, chạy `npm run db:setup` như hướng dẫn trong README. Với database của phiên bản cũ, làm theo [hướng dẫn nâng cấp](docs/database.md) và chạy `migrations/202610070001_ai_platform.sql`; không chạy migration cũ trên database trống. Dự án tiếp tục giữ `synchronize: false`.
   Chỉ với database cũ, chạy tiếp `migrations/202610160001_reference_assets.sql` để cho phép `assets.source_type = 'reference'`. Database tạo mới đã có giá trị này.
3. Video Kling được đối soát qua polling hiện có; cần `KLING_API_KEY` từ [Kling Developer Console](https://kling.ai/dev/api-key).
4. Cấu hình webhook payOS trỏ tới `POST /payments/payos/webhook`. `PAYOS_RETURN_URL` chỉ dùng để đưa người dùng trở lại trang ví; việc cộng tiền chỉ xảy ra sau khi chữ ký webhook hợp lệ.

## Luồng API

- `GET /ai-catalog?modality=image|video|audio|chat`
- `POST /pricing/quotes`
- `POST /generations`, `GET /generations`, `GET /generations/:id`
- `POST /chat/conversations`, `GET /chat/conversations`
- `POST /chat/conversations/:id/messages` (SSE)
- `GET /wallet`, `GET /wallet/transactions`, `POST /wallet/topups`

Client phải lấy báo giá mới sau khi đổi prompt, model hoặc tùy chọn. Client chỉ gửi `quoteId`; server không nhận giá, tỷ giá hoặc markup từ client.

## Giá và quyết toán

Giá bán được làm tròn lên theo công thức `providerCostUsd × usdVndRate × (1 + AI_MARKUP_RATE)`. Quote có hiệu lực 10 phút. Server giữ số tiền tối đa trước khi gọi provider. Với ảnh, audio và chat, server lấy chi phí thực tế từ OpenRouter để quyết toán.

Giá video Kling 3.0 Turbo, 3.0 và 3.0 Omni lấy theo **API units/giây** tại [bảng giá API trực tiếp của Kling](https://kling.ai/dev/pricing), nhân với `KLING_USD_PER_API_UNIT` (mặc định 0,14 USD) rồi quy đổi tỷ giá. `KLING_VIDEO_MARKUP_RATE` mặc định 0, tách khỏi markup của ảnh/audio/chat. Đây là giá API, không phải Credits của ứng dụng Kling. Bảng giá API công khai hiện không liệt kê O1, nên model O1 vẫn có adapter nhưng không phát báo giá/không cho tạo tác vụ để tránh thu sai tiền. Nếu Kling trả chi phí thực tế USD, server quyết toán theo chi phí đó, tối đa bằng số tiền đã giữ; nếu chỉ trả unit, server quyết toán theo quote.

Tỷ giá USD/VND được cache theo ngày từ Frankfurter. Nếu nguồn này lỗi, server dùng bản ghi gần nhất trong 7 ngày, rồi mới dùng `FX_FALLBACK_USD_VND`. Nếu không có tỷ giá hợp lệ, endpoint báo giá sẽ từ chối yêu cầu.

## Chuyển tiếp dữ liệu cũ

Migration chuyển lịch sử video cũ vào `ai_generations` với `source = legacy_kling`, liên kết lại asset qua `ai_generation_assets`, sau đó xóa các bảng và adapter provider cũ. Video mới dùng Kling trực tiếp; ảnh, audio và chat tiếp tục dùng OpenRouter.

## Kiểm tra

```bash
npm run build
npm test -- --runInBand
```

Các kiểm thử hiện tại bao phủ công thức markup/làm tròn VND, giới hạn token chat, quote hết hạn và health response. Kiểm thử tích hợp OpenRouter/payOS cần biến môi trường sandbox tương ứng.
