// Zeigt Startfehler an, statt einen leeren Bildschirm zu lassen (z.B. wenn ein Skript nicht lädt).
(function () {
  var errors = [];
  function show(title) {
    var app = document.getElementById('app');
    if (!app || document.body.classList.contains('ready')) return;
    app.innerHTML = '';
    document.body.classList.add('boot-failed');
    var box = document.createElement('div');
    box.className = 'boot-error';
    var h = document.createElement('h2'); h.textContent = title; box.appendChild(h);
    var p = document.createElement('p'); p.textContent = 'Bitte AleNote neu starten. Hilft das nicht, schick diese Meldung an den Entwickler.'; box.appendChild(p);
    var pre = document.createElement('pre'); pre.textContent = errors.join('\n\n') || 'Keine Fehlermeldung'; box.appendChild(pre);
    var btn = document.createElement('button'); btn.className = 'btn btn-primary'; btn.textContent = 'Neu laden';
    btn.onclick = function () { location.reload(); };
    box.appendChild(btn);
    app.appendChild(box);
  }
  window.addEventListener('error', function (e) {
    var t = e.target;
    if (t && t !== window) {
      // Nur fehlende Skripte/Styles zählen (kaputte Bilder in Notizen sind kein Startfehler)
      if (!/^(SCRIPT|LINK)$/.test(t.tagName)) return;
      errors.push('Datei konnte nicht geladen werden: ' + (t.src || t.href));
    } else {
      errors.push((e.message || 'Fehler') + (e.filename ? '\n' + e.filename + ':' + e.lineno : ''));
    }
    setTimeout(function () { show('AleNote konnte nicht starten'); }, 3000);
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    errors.push(String((e.reason && (e.reason.stack || e.reason.message)) || e.reason));
  });
  setTimeout(function () { show('AleNote startet nicht'); }, 15000);
})();
