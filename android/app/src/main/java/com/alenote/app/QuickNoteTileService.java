package com.alenote.app;

import android.annotation.SuppressLint;
import android.app.PendingIntent;
import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

/** Kachel in den Schnelleinstellungen (Samsung Quick Panel): öffnet die Schnellnotiz */
public class QuickNoteTileService extends TileService {

    @Override
    public void onStartListening() {
        Tile tile = getQsTile();
        if (tile == null) return;
        tile.setState(Tile.STATE_INACTIVE);
        tile.setLabel(getString(R.string.tile_label));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) tile.setSubtitle(getString(R.string.app_name));
        tile.updateTile();
    }

    @SuppressLint("StartActivityAndCollapseDeprecated")
    @Override
    public void onClick() {
        // Bei gesperrtem Handy erst entsperren lassen, dann öffnen
        if (isLocked()) unlockAndRun(this::launch);
        else launch();
    }

    private void launch() {
        if (Build.VERSION.SDK_INT >= 34) {
            PendingIntent pi = LaunchActions.pending(this, "quicknote", 100);
            startActivityAndCollapse(pi);
        } else {
            startActivityAndCollapse(LaunchActions.intent(this, "quicknote"));
        }
    }
}
