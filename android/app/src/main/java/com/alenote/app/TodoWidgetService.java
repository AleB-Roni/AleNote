package com.alenote.app;

import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.style.StrikethroughSpan;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;

import org.json.JSONArray;
import org.json.JSONObject;

/** Liefert die Zeilen für das To-do-Widget */
public class TodoWidgetService extends RemoteViewsService {
    @Override
    public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new Factory(getApplicationContext());
    }

    static class Factory implements RemoteViewsFactory {
        private final Context ctx;
        private JSONArray items = new JSONArray();

        Factory(Context ctx) { this.ctx = ctx; }

        @Override public void onCreate() { load(); }
        @Override public void onDataSetChanged() { load(); }
        @Override public void onDestroy() {}
        @Override public int getCount() { return items.length(); }
        @Override public RemoteViews getLoadingView() { return null; }
        @Override public int getViewTypeCount() { return 1; }
        @Override public long getItemId(int position) { return position; }
        @Override public boolean hasStableIds() { return false; }

        private void load() {
            try {
                items = new JSONArray(ctx.getSharedPreferences(TodoWidget.PREFS, Context.MODE_PRIVATE).getString(TodoWidget.KEY_TODOS, "[]"));
            } catch (Exception e) {
                items = new JSONArray();
            }
        }

        @Override
        public RemoteViews getViewAt(int position) {
            RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_todo_item);
            JSONObject t = items.optJSONObject(position);
            if (t == null) return v;
            boolean checked = t.optBoolean("checked");
            String text = t.optString("text", "");
            if (checked) {
                SpannableString s = new SpannableString(text);
                s.setSpan(new StrikethroughSpan(), 0, s.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                v.setTextViewText(R.id.todo_text, s);
                v.setTextColor(R.id.todo_text, 0x80FFFFFF);
            } else {
                v.setTextViewText(R.id.todo_text, text);
                v.setTextColor(R.id.todo_text, 0xF2FFFFFF);
            }
            v.setImageViewResource(R.id.todo_box, checked ? R.drawable.widget_box_checked : R.drawable.widget_box);

            String label = t.optString("label", "");
            StringBuilder meta = new StringBuilder();
            if (!label.isEmpty()) meta.append("📅 ").append(label);
            if (t.optBoolean("bell") && !label.isEmpty()) meta.append(" 🔔");
            String note = t.optString("note", "");
            if (!note.isEmpty()) meta.append(meta.length() > 0 ? "  ·  " : "").append(note);
            v.setTextViewText(R.id.todo_meta, meta.toString());
            int color;
            switch (checked ? "" : t.optString("state", "")) {
                case "overdue": color = Color.parseColor("#FF7A7A"); break;
                case "today": color = Color.parseColor("#B79CFF"); break;
                case "soon": color = Color.parseColor("#FFB35C"); break;
                default: color = 0x80FFFFFF;
            }
            v.setTextColor(R.id.todo_meta, color);

            Intent fill = new Intent();
            fill.putExtra("path", t.optString("path"));
            fill.putExtra("id", t.optString("id"));
            v.setOnClickFillInIntent(R.id.todo_row, fill);
            return v;
        }
    }
}
