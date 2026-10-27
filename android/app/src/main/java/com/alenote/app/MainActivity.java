package com.alenote.app;

import android.content.SharedPreferences;
import android.os.Bundle;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ApkInstallerPlugin.class);
        super.onCreate(savedInstanceState);
        clearCacheAfterUpdate();
    }

    /**
     * Nach einem Update kann die WebView noch alte Versionen einzelner Skripte im Cache haben.
     * Alte und neue Dateien passen dann nicht zusammen und die App bleibt grau.
     * Deshalb wird der Cache nach jeder Installation/Aktualisierung einmal geleert.
     */
    private void clearCacheAfterUpdate() {
        try {
            long installed = getPackageManager().getPackageInfo(getPackageName(), 0).lastUpdateTime;
            SharedPreferences prefs = getSharedPreferences("alenote", MODE_PRIVATE);
            if (prefs.getLong("cacheClearedFor", 0) == installed) return;
            WebView web = getBridge().getWebView();
            web.clearCache(true);
            web.reload();
            prefs.edit().putLong("cacheClearedFor", installed).apply();
        } catch (Exception ignored) {
        }
    }
}
