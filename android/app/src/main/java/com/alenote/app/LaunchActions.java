package com.alenote.app;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;

/**
 * Startaktionen von außen (Schnelleinstellungen, Widget, App-Verknüpfungen):
 *   quicknote → Schnellnotiz öffnen · dictate → Schnellnotiz + Diktieren · calendar → Kalender
 * Die Web-Oberfläche fragt die Aktion beim Start ab bzw. bekommt sie als Ereignis.
 */
public final class LaunchActions {
    public static final String EXTRA = "alenote_action";
    private static String pending = null;

    private LaunchActions() {}

    public static Intent intent(Context ctx, String action) {
        Intent i = new Intent(ctx, MainActivity.class);
        i.setAction("com.alenote.app.ACTION_" + action.toUpperCase());
        i.putExtra(EXTRA, action);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return i;
    }

    public static PendingIntent pending(Context ctx, String action, int requestCode) {
        return PendingIntent.getActivity(ctx, requestCode, intent(ctx, action), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Aus einem Start-Intent die Aktion merken */
    public static String read(Intent intent) {
        if (intent == null) return null;
        String a = intent.getStringExtra(EXTRA);
        if (a == null && intent.getAction() != null && intent.getAction().startsWith("com.alenote.app.ACTION_")) {
            a = intent.getAction().substring("com.alenote.app.ACTION_".length()).toLowerCase();
        }
        return a;
    }

    public static synchronized void set(String a) { pending = a; }

    public static synchronized String take() { String a = pending; pending = null; return a; }
}
