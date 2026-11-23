package com.spdatdd.midnightexpressway;

import android.os.Bundle;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    // Mở game sát mép màn hình và ẩn hai thanh hệ thống ngay khi khởi động.
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        enterImmersiveMode();
    }

    // Khôi phục chế độ toàn màn hình khi quay lại game từ ứng dụng khác.
    @Override
    public void onResume() {
        super.onResume();
        enterImmersiveMode();
    }

    // Khôi phục chế độ toàn màn hình khi đóng hộp thoại hoặc cửa sổ hệ thống.
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) enterImmersiveMode();
    }

    // Cho phép người chơi vuốt mép để hiện tạm thời các nút Android.
    private void enterImmersiveMode() {
        WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setSystemBarsBehavior(
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.hide(WindowInsetsCompat.Type.statusBars() | WindowInsetsCompat.Type.navigationBars());
    }
}
