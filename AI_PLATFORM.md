# AI multimedia platform

## Khởi tạo

1. Sao chép các biến mới trong `.env.example` vào file môi trường đang dùng và điền khóa OpenRouter, Cloudinary và payOS.
2. Chạy `migrations/202610070001_ai_platform.sql` trên PostgreSQL trước khi khởi động ứng dụng. Dự án tiếp tục giữ `synchronize: false`.
3. Đặt `OPENROUTER_VIDEO_WEBHOOK_URL` thành URL HTTPS công khai trỏ tới `POST /openrouter/webhooks/video`.
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

Giá bán được làm tròn lên theo công thức `providerCostUsd × usdVndRate × (1 + AI_MARKUP_RATE)`. Quote có hiệu lực 10 phút. Server giữ số tiền tối đa trước khi gọi provider, sau đó lấy chi phí thực tế từ OpenRouter để ghi nợ và giải phóng phần dư.

Tỷ giá USD/VND được cache theo ngày từ Frankfurter. Nếu nguồn này lỗi, server dùng bản ghi gần nhất trong 7 ngày, rồi mới dùng `FX_FALLBACK_USD_VND`. Nếu không có tỷ giá hợp lệ, endpoint báo giá sẽ từ chối yêu cầu.

## Chuyển tiếp dữ liệu cũ

Migration chuyển lịch sử video cũ vào `ai_generations` với `source = legacy_kling`, liên kết lại asset qua `ai_generation_assets`, sau đó xóa các bảng và adapter provider cũ. Mọi generation mới đều đi qua module `ai-platform` và OpenRouter.

## Kiểm tra

```bash
npm run build
npm test -- --runInBand
```

Các kiểm thử hiện tại bao phủ công thức markup/làm tròn VND, giới hạn token chat, quote hết hạn và health response. Kiểm thử tích hợp OpenRouter/payOS cần biến môi trường sandbox tương ứng.
