package com.alenote.app;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

/**
 * Startbildschirm-Widget: Schnellnotiz, Diktieren und Kalender mit Anzahl heute fälliger Aufgaben.
 * Die Zahlen schreibt die App (AleTools.updateWidget) in die SharedPreferences.
 */
public class QuickNoteWidget extends AppWidgetProvider {

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) mgr.updateAppWidget(id, build(ctx));
    }

    static RemoteViews build(Context ctx) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_quick);
        SharedPreferences p = ctx.getSharedPreferences("alenote", Context.MODE_PRIVATE);
        int today = p.getInt("widget_today", 0), overdue = p.getInt("widget_overdue", 0);
        String status;
        if (today == 0 && overdue == 0) status = ctx.getString(R.string.widget_none);
        else if (overdue == 0) status = ctx.getResources().getQuantityString(R.plurals.widget_today, today, today);
        else status = ctx.getResources().getQuantityString(R.plurals.widget_today, today, today) + " · " + ctx.getString(R.string.widget_overdue, overdue);
        v.setTextViewText(R.id.widget_status, status);
        v.setOnClickPendingIntent(R.id.widget_note, LaunchActions.pending(ctx, "quicknote", 201));
        v.setOnClickPendingIntent(R.id.widget_text, LaunchActions.pending(ctx, "quicknote", 202));
        v.setOnClickPendingIntent(R.id.widget_mic, LaunchActions.pending(ctx, "dictate", 203));
        v.setOnClickPendingIntent(R.id.widget_calendar, LaunchActions.pending(ctx, "calendar", 204));
        return v;
    }

    /** Alle Widgets neu zeichnen (nach Änderung der Zahlen) */
    static void refresh(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, QuickNoteWidget.class));
        if (ids.length > 0) mgr.updateAppWidget(ids, build(ctx));
    }
}
