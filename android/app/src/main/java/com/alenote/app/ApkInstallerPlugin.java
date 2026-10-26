package com.alenote.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;

/**
 * Lädt eine neue AleNote-APK herunter, prüft die SHA-256-Prüfsumme
 * und öffnet den Android-Installer.
 */
@CapacitorPlugin(name = "ApkInstaller")
public class ApkInstallerPlugin extends Plugin {

    private boolean canInstall() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
        return getContext().getPackageManager().canRequestPackageInstalls();
    }

    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("allowed", canInstall());
        call.resolve(ret);
    }

    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        }
        call.resolve();
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String url = call.getString("url");
        String expected = call.getString("sha256", "");
        if (url == null) { call.reject("url fehlt"); return; }

        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                File dir = new File(getContext().getCacheDir(), "updates");
                if (!dir.exists()) dir.mkdirs();
                File apk = new File(dir, "AleNote-update.apk");
                if (apk.exists()) apk.delete();

                // Weiterleitungen (z.B. GitHub → CDN, http → https) manuell folgen
                URL current = new URL(url);
                for (int i = 0; i < 8; i++) {
                    conn = (HttpURLConnection) current.openConnection();
                    conn.setInstanceFollowRedirects(false);
                    conn.setConnectTimeout(20000);
                    conn.setReadTimeout(60000);
                    conn.setRequestProperty("User-Agent", "AleNote-Android");
                    int code = conn.getResponseCode();
                    if (code >= 300 && code < 400 && conn.getHeaderField("Location") != null) {
                        current = new URL(current, conn.getHeaderField("Location"));
                        conn.disconnect();
                        continue;
                    }
                    if (code != 200) throw new Exception("Server antwortet mit " + code);
                    break;
                }

                long total = conn.getContentLengthLong();
                MessageDigest sha = MessageDigest.getInstance("SHA-256");
                try (InputStream in = conn.getInputStream(); FileOutputStream out = new FileOutputStream(apk)) {
                    byte[] buf = new byte[64 * 1024];
                    long done = 0;
                    int lastPercent = -1;
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        out.write(buf, 0, n);
                        sha.update(buf, 0, n);
                        done += n;
                        if (total > 0) {
                            int percent = (int) (done * 100 / total);
                            if (percent != lastPercent) {
                                lastPercent = percent;
                                JSObject p = new JSObject();
                                p.put("percent", percent);
                                notifyListeners("progress", p);
                            }
                        }
                    }
                }

                StringBuilder hex = new StringBuilder();
                for (byte b : sha.digest()) hex.append(String.format("%02x", b));
                if (!expected.isEmpty() && !expected.equalsIgnoreCase(hex.toString())) {
                    apk.delete();
                    call.reject("Prüfsumme stimmt nicht – Download beschädigt");
                    return;
                }

                if (!canInstall()) {
                    JSObject ret = new JSObject();
                    ret.put("started", false);
                    ret.put("needsPermission", true);
                    call.resolve(ret);
                    return;
                }
                startInstall(apk);
                JSObject ret = new JSObject();
                ret.put("started", true);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Update fehlgeschlagen: " + e.getMessage());
            } finally {
                if (conn != null) conn.disconnect();
            }
        }).start();
    }

    /** Bereits heruntergeladene APK installieren (nach Erteilen der Berechtigung) */
    @PluginMethod
    public void installDownloaded(PluginCall call) {
        File apk = new File(new File(getContext().getCacheDir(), "updates"), "AleNote-update.apk");
        if (!apk.exists()) { call.reject("Kein heruntergeladenes Update gefunden"); return; }
        if (!canInstall()) { call.reject("Installation aus dieser Quelle ist nicht erlaubt"); return; }
        startInstall(apk);
        call.resolve();
    }

    private void startInstall(File apk) {
        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
    }
}
