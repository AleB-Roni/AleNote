package com.alenote.app;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.util.Base64;
import android.webkit.WebView;

import androidx.core.content.FileProvider;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;

/**
 * Hilfen für Export auf dem Handy:
 *  - print:     Android-Druckdialog für die aktuelle Seite (dort „Als PDF speichern“)
 *  - shareFile: Datei (Base64) über das Teilen-Menü weitergeben bzw. speichern
 */
@CapacitorPlugin(name = "AleTools")
public class AleToolsPlugin extends Plugin {

    @PluginMethod
    public void print(PluginCall call) {
        String name = call.getString("name", "AleNote");
        getActivity().runOnUiThread(() -> {
            try {
                WebView web = getBridge().getWebView();
                PrintManager pm = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                PrintDocumentAdapter adapter = web.createPrintDocumentAdapter(name);
                pm.print(name, adapter, new PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build());
                call.resolve();
            } catch (Exception e) {
                call.reject("Drucken nicht möglich: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void shareFile(PluginCall call) {
        String name = call.getString("name", "export");
        String data = call.getString("data");
        String mime = call.getString("mime", "application/octet-stream");
        if (data == null) { call.reject("data fehlt"); return; }
        try {
            File dir = new File(getContext().getCacheDir(), "export");
            dir.mkdirs();
            File file = new File(dir, name.replaceAll("[\\\\/:*?\"<>|]", "_"));
            try (FileOutputStream out = new FileOutputStream(file)) { out.write(Base64.decode(data, Base64.DEFAULT)); }
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(mime);
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.putExtra(Intent.EXTRA_TITLE, name);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            Intent chooser = Intent.createChooser(send, name);
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(chooser);
            call.resolve();
        } catch (Exception e) {
            call.reject("Teilen nicht möglich: " + e.getMessage());
        }
    }
}
