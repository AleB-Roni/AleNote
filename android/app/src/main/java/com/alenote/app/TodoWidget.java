package com.alenote.app;

import android.app.NotificationManager;
import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.widget.RemoteViews;

import com.capacitorjs.plugins.localnotifications.TimedNotificationPublisher;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * To-do-Widget: zeigt die offenen Aufgaben (von der App in den SharedPreferences abgelegt)
 * und hakt sie per Antippen ab. Die Änderung wird gemerkt und von der App in die Notiz
 * übernommen – sofort, wenn AleNote läuft, sonst beim nächsten Öffnen.
 * Beim Abhaken werden geplante Erinnerungen für die Aufgabe gleich abgesagt.
 */
public class TodoWidget extends AppWidgetProvider {
    static final String ACTION_TOGGLE = "com.alenote.app.TODO_TOGGLE";
    static final String PREFS = "alenote";
    static final String KEY_TODOS = "widget_todos";
    static final String KEY_TOGGLES = "widget_toggles";

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) mgr.updateAppWidget(id, build(ctx, id));
        mgr.notifyAppWidgetViewDataChanged(ids, R.id.todos_list);
    }

    static RemoteViews build(Context ctx, int widgetId) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_todos);
        Intent svc = new Intent(ctx, TodoWidgetService.class);
        svc.putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId);
        svc.setData(Uri.parse(svc.toUri(Intent.URI_INTENT_SCHEME)));
        v.setRemoteAdapter(R.id.todos_list, svc);
        v.setEmptyView(R.id.todos_list, R.id.todos_empty);

        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        boolean known = p.contains(KEY_TODOS);
        v.setTextViewText(R.id.todos_empty, ctx.getString(known ? R.string.todos_empty : R.string.todos_first));
        int open = 0;
        try {
            JSONArray list = new JSONArray(p.getString(KEY_TODOS, "[]"));
            for (int i = 0; i < list.length(); i++) if (!list.getJSONObject(i).optBoolean("checked")) open++;
        } catch (Exception ignored) {
        }
        v.setTextViewText(R.id.todos_count, open > 0 ? ctx.getResources().getQuantityString(R.plurals.todos_open, open, open) : "");

        // Zeile antippen → abhaken (die Zeile ergänzt path/id per Fill-in-Intent)
        Intent toggle = new Intent(ctx, TodoWidget.class).setAction(ACTION_TOGGLE);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags |= PendingIntent.FLAG_MUTABLE;
        v.setPendingIntentTemplate(R.id.todos_list, PendingIntent.getBroadcast(ctx, 300, toggle, flags));

        v.setOnClickPendingIntent(R.id.todos_header, LaunchActions.pending(ctx, "todos", 301));
        v.setOnClickPendingIntent(R.id.todos_add, LaunchActions.pending(ctx, "newtodo", 302));
        return v;
    }

    @Override
    public void onReceive(Context ctx, Intent intent) {
        super.onReceive(ctx, intent);
        if (!ACTION_TOGGLE.equals(intent.getAction())) return;
        String path = intent.getStringExtra("path"), id = intent.getStringExtra("id");
        if (path == null || id == null) return;
        SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        synchronized (TodoWidget.class) {
            try {
                // Liste im Widget sofort aktualisieren
                JSONArray list = new JSONArray(p.getString(KEY_TODOS, "[]"));
                boolean checked = true;
                JSONArray nids = null;
                for (int i = 0; i < list.length(); i++) {
                    JSONObject t = list.getJSONObject(i);
                    if (path.equals(t.optString("path")) && id.equals(t.optString("id"))) {
                        checked = !t.optBoolean("checked");
                        t.put("checked", checked);
                        nids = t.optJSONArray("nids");
                    }
                }
                // Änderung für die App vormerken (letzter Stand je Aufgabe zählt)
                JSONArray queue = new JSONArray(p.getString(KEY_TOGGLES, "[]")), next = new JSONArray();
                for (int i = 0; i < queue.length(); i++) {
                    JSONObject q = queue.getJSONObject(i);
                    if (!(path.equals(q.optString("path")) && id.equals(q.optString("id")))) next.put(q);
                }
                next.put(new JSONObject().put("path", path).put("id", id).put("checked", checked));
                p.edit().putString(KEY_TODOS, list.toString()).putString(KEY_TOGGLES, next.toString()).commit();
                if (checked && nids != null) cancelReminders(ctx, nids);
            } catch (Exception ignored) {
            }
        }
        refresh(ctx);
        AleToolsPlugin.emitWidgetToggle();
    }

    /** Geplante Erinnerungen (Capacitor Local Notifications) für ein abgehaktes To-do absagen */
    private static void cancelReminders(Context ctx, JSONArray nids) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        int flags = PendingIntent.FLAG_NO_CREATE;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags |= PendingIntent.FLAG_MUTABLE;
        for (int i = 0; i < nids.length(); i++) {
            int nid = nids.optInt(i);
            try {
                PendingIntent pi = PendingIntent.getBroadcast(ctx, nid, new Intent(ctx, TimedNotificationPublisher.class), flags);
                if (pi != null) { am.cancel(pi); pi.cancel(); }
                nm.cancel(nid);
            } catch (Exception ignored) {
            }
        }
    }

    /** Alle To-do-Widgets neu zeichnen */
    static void refresh(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, TodoWidget.class));
        if (ids.length == 0) return;
        for (int id : ids) mgr.updateAppWidget(id, build(ctx, id));
        mgr.notifyAppWidgetViewDataChanged(ids, R.id.todos_list);
    }
}
