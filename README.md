# Midnight Expressway

Midnight Expressway là game lái xe arcade 3D trên trình duyệt. Bạn có thể lái từ thành phố ra bờ biển, bật chế độ tự lái để ngắm cảnh hoặc xuống xe để đi bộ. Game dùng Three.js để dựng cảnh và cho phép chỉnh thời gian trong ngày, thời tiết, chất lượng đồ họa và góc camera.

## Chạy game trên máy

Bạn cần Node.js và trình duyệt hỗ trợ WebGL 2. Bản chơi đã có sẵn trong thư mục `dist/`, kèm thư viện Three.js và tài nguyên của game. Máy chủ dùng các mô-đun có sẵn của Node.js nên có thể chạy ngay sau khi tải dự án về.

1. Mở PowerShell tại thư mục gốc của dự án và chạy:

   ```powershell
   npm start
   ```

2. Mở [http://127.0.0.1:8000](http://127.0.0.1:8000/) trong trình duyệt và chọn **Start Drive**.
3. Nhấn **Ctrl+C** trong PowerShell để dừng máy chủ.

Nếu cổng 8000 đang được sử dụng, chạy `$env:PORT = '8080'; npm start` trong PowerShell rồi mở [http://127.0.0.1:8080](http://127.0.0.1:8080/).

## Điều khiển

| Phím | Thao tác |
| --- | --- |
| **W** / **↑** | Tăng ga |
| **S** / **↓** | Phanh hoặc lùi |
| **A** / **←**, **D** / **→** | Rẽ trái, rẽ phải |
| **C** | Đổi góc camera |
| **P** | Bật hoặc tắt chế độ tự lái |
| **E** | Xuống xe hoặc lên xe khi đứng gần |
| **V** | Đổi sang mẫu tiếp theo khi xe đã dừng |
| **Space** | Nhảy khi đi bộ |

Khi đi bộ, dùng **WASD** hoặc các phím mũi tên để di chuyển. Trên màn hình cảm ứng, dùng các nút lái trên màn hình và cần ảo khi đi bộ.

## Build lại thư viện Three.js

Chỉ cần bước này khi chỉnh `tools/three-entry.js` hoặc thay đổi phiên bản thư viện. Cài Node.js và npm, sau đó chạy từ thư mục gốc:

```powershell
npm --prefix tools ci
npm --prefix tools run build
```

Lệnh build cập nhật `dist/vendor/three.js`.

## Nén model GLB

Đặt model nguồn trong `assets/models/`. Git bỏ qua thư mục này. Sau khi cài công cụ bằng `npm --prefix tools ci`, chạy `npm --prefix tools run optimize-models`. Lệnh xuất toàn bộ GLB đã nén vào `assets/models-optimized/` và chép các model game sử dụng vào `dist/assets/models-optimized/`.

Khi build APK bằng Capacitor, đặt `webDir` là `dist` để đóng gói bản chơi cùng các model tối ưu. Thư mục model gốc nằm ngoài `webDir`.
