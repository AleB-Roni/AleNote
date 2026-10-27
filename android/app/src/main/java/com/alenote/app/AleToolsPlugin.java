package com.alenote.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.speech.RecognizerIntent;
import android.util.Base64;
import android.webkit.WebView;

import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.util.ArrayList;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Hilfen für Export auf dem Handy:
 *  - print:     Android-Druckdialog für die aktuelle Seite (dort „Als PDF speichern“)
 *  - shareFile: Datei (Base64) über das Teilen-Menü weitergeben bzw. speichern
 *  - speechToText: Spracherkennung von Android (wie bei der Tastatur, ohne API-Schlüssel)
 *  - getLaunchAction / Ereignis „launchAction“: Start über Kachel, Widget oder App-Verknüpfung
 *  - updateWidget: fällige Aufgaben für das Schnellnotiz-Widget und die Liste fürs To-do-Widget
 *  - takeWidgetToggles / Ereignis „widgetToggle“: im To-do-Widget abgehakte Aufgaben
 */
@CapacitorPlugin(name = "AleTools")
public class AleToolsPlugin extends Plugin {
    private static AleToolsPlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    /** Neue Startaktion, während die App schon läuft (MainActivity.onNewIntent) */
    public static boolean emitLaunch(String action) {
        AleToolsPlugin p = instance;
        if (p == null || p.getBridge() == null || !p.hasListeners("launchAction")) return false;
        JSObject ret = new JSObject();
        ret.put("action", action);
        p.notifyListeners("launchAction", ret, true);
        return true;
    }

    /** Im To-do-Widget wurde etwas abgehakt (TodoWidget.onReceive) */
    public static void emitWidgetToggle() {
        AleToolsPlugin p = instance;
        if (p == null || p.getBridge() == null || !p.hasListeners("widgetToggle")) return;
        p.notifyListeners("widgetToggle", new JSObject());
    }

    /** Im Widget abgehakte Aufgaben abholen (die App übernimmt sie in die Notizen) */
    @PluginMethod
    public void takeWidgetToggles(PluginCall call) {
        SharedPreferences p = getContext().getSharedPreferences(TodoWidget.PREFS, Context.MODE_PRIVATE);
        String items;
        synchronized (TodoWidget.class) {
            items = p.getString(TodoWidget.KEY_TOGGLES, "[]");
            p.edit().remove(TodoWidget.KEY_TOGGLES).commit();
        }
        JSObject ret = new JSObject();
        ret.put("items", items);
        call.resolve(ret);
    }

    @PluginMethod
    public void getLaunchAction(PluginCall call) {
        JSObject ret = new JSObject();
        String a = LaunchActions.take();
        ret.put("action", a == null ? "" : a);
        call.resolve(ret);
    }

    @PluginMethod
    public void updateWidget(PluginCall call) {
        SharedPreferences p = getContext().getSharedPreferences(TodoWidget.PREFS, Context.MODE_PRIVATE);
        synchronized (TodoWidget.class) {
        SharedPreferences.Editor e = p.edit()
            .putInt("widget_today", call.getInt("today", 0))
            .putInt("widget_overdue", call.getInt("overdue", 0));
        String todos = call.getString("todos");
        if (todos != null) {
            // Noch nicht übernommene Haken aus dem Widget beibehalten
            try {
                JSONArray list = new JSONArray(todos);
                JSONArray queue = new JSONArray(p.getString(TodoWidget.KEY_TOGGLES, "[]"));
                for (int i = 0; i < list.length(); i++) {
                    JSONObject t = list.getJSONObject(i);
                    for (int j = 0; j < queue.length(); j++) {
                        JSONObject q = queue.getJSONObject(j);
                        if (q.optString("path").equals(t.optString("path")) && q.optString("id").equals(t.optString("id"))) t.put("checked", q.optBoolean("checked"));
                    }
                }
                todos = list.toString();
            } catch (Exception ignored) {
            }
            e.putString(TodoWidget.KEY_TODOS, todos);
        }
        e.commit();
        }
        QuickNoteWidget.refresh(getContext());
        TodoWidget.refresh(getContext());
        call.resolve();
    }

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
    public void speechToText(PluginCall call) {
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, call.getString("language", "de-DE"));
        intent.putExtra(RecognizerIntent.EXTRA_PROMPT, call.getString("prompt", "Sprich jetzt …"));
        intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        if (intent.resolveActivity(getContext().getPackageManager()) == null) {
            call.reject("Auf diesem Handy ist keine Spracherkennung installiert (z.B. Google-App)");
            return;
        }
        startActivityForResult(call, intent, "speechResult");
    }

    @ActivityCallback
    private void speechResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject ret = new JSObject();
        String text = "";
        if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
            ArrayList<String> list = result.getData().getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
            if (list != null && !list.isEmpty()) text = list.get(0);
        }
        ret.put("text", text);
        call.resolve(ret);
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
