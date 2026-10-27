package com.alenote.app;

import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import java.io.File;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ApkInstallerPlugin.class);
        registerPlugin(AleToolsPlugin.class);
        clearCacheAfterUpdate();
        if (savedInstanceState == null) LaunchActions.set(LaunchActions.read(getIntent()));
        super.onCreate(savedInstanceState);
    }

    /** App läuft schon: Aktion von Kachel/Widget/Verknüpfung direkt an die Oberfläche geben */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String action = LaunchActions.read(intent);
        if (action == null) return;
        if (!AleToolsPlugin.emitLaunch(action)) LaunchActions.set(action);
    }

    /**
     * Nach einem Update könnte die WebView noch alte Versionen einzelner Skripte im Cache haben.
     * Deshalb werden nach jeder Installation/Aktualisierung einmal die Cache-Ordner gelöscht –
     * bevor die WebView startet. Notizen, Anmeldung und Einstellungen liegen nicht im Cache.
     */
    private void clearCacheAfterUpdate() {
        try {
            long installed = getPackageManager().getPackageInfo(getPackageName(), 0).lastUpdateTime;
            SharedPreferences prefs = getSharedPreferences("alenote", MODE_PRIVATE);
            if (prefs.getLong("cacheClearedFor", 0) == installed) return;
            deleteRecursive(getCacheDir(), false);
            File webview = getDir("webview", MODE_PRIVATE);
            for (String name : new String[] { "Cache", "Code Cache", "GPUCache", "Service Worker", "Default/Cache", "Default/Code Cache", "Default/GPUCache", "Default/Service Worker" }) {
                deleteRecursive(new File(webview, name), true);
            }
            prefs.edit().putLong("cacheClearedFor", installed).apply();
        } catch (Exception ignored) {
        }
    }

    private static void deleteRecursive(File f, boolean self) {
        if (f == null || !f.exists()) return;
        File[] children = f.listFiles();
        if (children != null) for (File c : children) deleteRecursive(c, true);
        if (self) f.delete();
    }
}
