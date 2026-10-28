// Emoji-Auswahl mit deutschen (und einigen englischen) Suchbegriffen.
// Format je Zeile: Emoji, danach Suchbegriffe. Neue Emojis einfach ergänzen.
const RAW = {
  'Smileys': `
😀 grinsen lachen froh glücklich smile
😃 grinsen freude froh
😄 lachen strahlen fröhlich
😁 grinsen zähne
😆 lachen kichern
😅 schwitzen erleichtert puh
🤣 lachen boden rofl
😂 tränen lachen lol
🙂 lächeln
🙃 umgedreht ironie
😉 zwinkern
😊 lächeln erröten nett
😇 engel unschuldig
🥰 verliebt herzen
😍 herzaugen verliebt
🤩 sterne begeistert wow
😘 kuss
😗 kuss pfeifen
😋 lecker zunge
😛 zunge frech
😜 zwinkern zunge verrückt
🤪 verrückt crazy
😝 zunge augen zu
🤑 geld reich
🤗 umarmung
🤭 kichern hand mund
🤫 psst leise geheim
🤔 nachdenken überlegen hmm
🤐 mund zu schweigen
🤨 skeptisch augenbraue
😐 neutral
😑 genervt ausdruckslos
😶 sprachlos
😏 grinsen schmunzeln
😒 genervt unzufrieden
🙄 augenrollen
😬 grimasse peinlich
😌 erleichtert zufrieden
😔 nachdenklich traurig
😪 müde schläfrig
🤤 sabbern
😴 schlafen müde zzz
😷 maske krank
🤒 fieber krank
🤕 verletzt verband
🤢 übel krank
🤮 erbrechen
🥵 heiß hitze
🥶 kalt frieren
🥴 benommen beschwipst
😵 schwindelig
🤯 explodieren kopf überwältigt
🤠 cowboy
🥳 party feiern geburtstag
😎 cool sonnenbrille
🤓 nerd streber brille
🧐 monokel prüfen
😕 verwirrt
😟 besorgt
🙁 traurig
😮 überrascht staunen
😯 still überrascht
😲 schockiert erstaunt
😳 verlegen rot
🥺 bitte flehen
😦 entsetzt
😨 angst
😰 angst schweiß
😥 enttäuscht erleichtert
😢 weinen traurig träne
😭 heulen weinen
😱 schreien horror
😖 verwirrt gequält
😣 durchhalten
😞 enttäuscht
😓 schweiß
😩 erschöpft
😫 müde fertig
🥱 gähnen müde
😤 schnauben triumph
😡 wütend sauer
😠 wütend ärger
🤬 fluchen wütend
😈 teufel frech
👿 teufel böse
💀 totenkopf tot
☠️ totenkopf gift
💩 kacke haufen
🤡 clown
👹 oger monster
👻 geist gespenst
👽 alien außerirdisch
🤖 roboter bot ki
😺 katze lachen
😸 katze grinsen
😻 katze verliebt
🙈 affe nichts sehen
🙉 affe nichts hören
🙊 affe nichts sagen`,
  'Gesten & Menschen': `
👋 winken hallo tschüss
🤚 hand
✋ hand stopp
🖐️ hand finger
🖖 vulkanier spock
👌 ok perfekt
🤌 italienisch
🤏 bisschen wenig
✌️ peace sieg
🤞 daumen drücken glück
🤟 love you
🤘 rock metal
🤙 anrufen
👈 links zeigen
👉 rechts zeigen
👆 oben zeigen
👇 unten zeigen
☝️ eins zeigefinger
👍 daumen hoch gut like ja
👎 daumen runter schlecht nein
✊ faust
👊 faustschlag
👏 klatschen applaus bravo
🙌 hurra feiern
👐 offene hände
🤲 bitten
🤝 handschlag deal einigung
🙏 bitte danke beten
✍️ schreiben
💅 nagellack
💪 stark muskel kraft
🧠 gehirn denken
👀 augen schauen
👁️ auge
👂 ohr hören
👃 nase
👄 mund
🦷 zahn
👶 baby
🧒 kind
👦 junge
👧 mädchen
🧑 person
👨 mann
👩 frau
🧓 älter
👴 opa
👵 oma
👮 polizei
🕵️ detektiv
💂 wache
👷 bauarbeiter
🧑‍⚕️ arzt ärztin gesundheit
🧑‍🎓 student studium
🧑‍🏫 lehrer lehrerin
🧑‍💻 programmierer entwickler computer
🧑‍🍳 koch
🧑‍🔧 mechaniker
🧑‍🔬 wissenschaft forscher
🧑‍🎨 künstler
🧑‍🚀 astronaut
🦸 superheld
🧙 zauberer magie
🧚 fee
🙋 melden hand hoch
🙅 nein stopp
🙆 ok
💁 info
🤷 schulterzucken egal keine ahnung
🤦 facepalm
🧘 yoga meditation
🏃 rennen laufen joggen
🚶 gehen spazieren
💃 tanzen
🕺 tanzen
👪 familie
💑 paar liebe
👥 gruppe team leute
🗣️ sprechen`,
  'Tiere & Natur': `
🐶 hund
🐱 katze
🐭 maus
🐹 hamster
🐰 hase kaninchen
🦊 fuchs
🐻 bär
🐼 panda
🐨 koala
🐯 tiger
🦁 löwe
🐮 kuh
🐷 schwein
🐸 frosch
🐵 affe
🐔 huhn
🐧 pinguin
🐦 vogel
🐤 küken
🦆 ente
🦅 adler
🦉 eule
🦇 fledermaus
🐺 wolf
🐗 wildschwein
🐴 pferd
🦄 einhorn
🐝 biene
🐛 raupe
🦋 schmetterling
🐌 schnecke
🐞 marienkäfer
🐜 ameise
🕷️ spinne
🐢 schildkröte
🐍 schlange
🦎 eidechse
🦖 dinosaurier t-rex
🐙 oktopus krake
🦑 tintenfisch
🦀 krabbe
🐠 fisch
🐟 fisch
🐬 delfin
🐳 wal
🦈 hai
🐊 krokodil
🐘 elefant
🦒 giraffe
🦓 zebra
🐪 kamel
🦘 känguru
🐄 kuh
🐑 schaf
🐐 ziege
🦌 hirsch
🐕 hund
🐈 katze
🐿️ eichhörnchen
🦔 igel
🐾 pfoten spuren
🌱 keimling wachsen pflanze
🌿 kraut blatt
☘️ klee
🍀 kleeblatt glück
🌵 kaktus
🌴 palme
🌲 tanne baum
🌳 baum
🍁 ahorn herbst
🍂 laub herbst
🍃 blätter wind
🌾 getreide
🌸 kirschblüte blume
🌺 hibiskus blume
🌻 sonnenblume
🌹 rose
🌷 tulpe
💐 blumenstrauß
🍄 pilz
🌰 kastanie
🪴 topfpflanze
☀️ sonne sonnig
🌤️ sonne wolke
⛅ bewölkt
☁️ wolke
🌧️ regen
⛈️ gewitter
🌩️ blitz
🌨️ schnee
❄️ schneeflocke kalt winter
☃️ schneemann
🌬️ wind
🌪️ tornado
🌫️ nebel
🌈 regenbogen
☔ regenschirm
💧 tropfen wasser
🌊 welle meer
🔥 feuer heiß
⚡ blitz strom energie
🌙 mond nacht
🌕 vollmond
🌍 erde welt europa
🌎 erde amerika
🌏 erde asien
🪐 planet saturn
⭐ stern
🌟 stern glänzen
✨ funkeln glitzer magie
💫 schwindelig stern
☄️ komet`,
  'Essen & Trinken': `
🍎 apfel
🍐 birne
🍊 orange mandarine
🍋 zitrone
🍌 banane
🍉 wassermelone
🍇 trauben
🍓 erdbeere
🫐 heidelbeeren
🍒 kirschen
🍑 pfirsich
🥭 mango
🍍 ananas
🥥 kokosnuss
🥝 kiwi
🍅 tomate
🍆 aubergine
🥑 avocado
🥦 brokkoli
🥬 salat
🥒 gurke
🌶️ chili scharf
🌽 mais
🥕 karotte möhre
🧄 knoblauch
🧅 zwiebel
🥔 kartoffel
🍞 brot
🥐 croissant
🥖 baguette
🥨 brezel
🧀 käse
🥚 ei
🍳 spiegelei kochen braten
🥞 pfannkuchen
🧇 waffel
🥓 speck
🍗 hähnchen
🍖 fleisch
🌭 hotdog
🍔 burger
🍟 pommes
🍕 pizza
🥪 sandwich
🌮 taco
🌯 burrito
🥗 salat gesund
🍝 nudeln pasta spaghetti
🍜 ramen suppe
🍲 eintopf
🍛 curry
🍣 sushi
🍱 bento
🥟 teigtasche
🍤 garnele
🍚 reis
🍦 eis softeis
🍨 eis
🍩 donut
🍪 keks
🎂 geburtstagskuchen torte
🍰 kuchen
🧁 muffin cupcake
🍫 schokolade
🍬 bonbon süßigkeit
🍭 lutscher
🍯 honig
🥛 milch
☕ kaffee tee heiß
🍵 tee
🧃 saft
🥤 becher getränk
🧋 bubble tea
🍺 bier
🍻 prost bier
🥂 anstoßen sekt
🍷 wein
🥃 whisky
🍸 cocktail
🍹 cocktail urlaub
🍾 sekt feiern
🧊 eiswürfel
🥄 löffel
🍴 besteck essen
🍽️ teller essen`,
  'Aktivitäten': `
⚽ fußball
🏀 basketball
🏈 football
⚾ baseball
🎾 tennis
🏐 volleyball
🏉 rugby
🎱 billard
🏓 tischtennis
🏸 badminton
🏒 eishockey
⛳ golf
🏹 bogen
🎣 angeln
🥊 boxen
🥋 kampfsport
⛸️ schlittschuh
🎿 ski
🏂 snowboard
🏋️ gewichtheben training fitness
🤸 turnen
⛹️ ball
🤺 fechten
🏊 schwimmen
🚴 radfahren fahrrad
🧗 klettern
🏆 pokal sieg gewinner
🥇 gold erster
🥈 silber zweiter
🥉 bronze dritter
🏅 medaille
🎖️ orden
🎗️ schleife
🎫 ticket
🎟️ eintrittskarte
🎪 zirkus
🎭 theater
🎨 malen kunst farbe
🎬 film klappe
🎤 mikrofon singen
🎧 kopfhörer musik
🎼 noten musik
🎹 klavier
🥁 schlagzeug
🎷 saxophon
🎺 trompete
🎸 gitarre
🎻 geige
🎲 würfel spiel
♟️ schach
🎯 ziel treffer dart
🎳 bowling
🎮 videospiel gaming controller
🕹️ joystick
🧩 puzzle
🎉 party konfetti feiern
🎊 konfetti
🎈 luftballon
🎁 geschenk
🎀 schleife
🪅 piñata
🎃 kürbis halloween
🎄 weihnachtsbaum
🎆 feuerwerk silvester
🎇 wunderkerze
🧨 böller`,
  'Reisen & Orte': `
🚗 auto
🚕 taxi
🚙 suv
🚌 bus
🚎 trolleybus
🏎️ rennwagen
🚓 polizei
🚑 krankenwagen
🚒 feuerwehr
🚐 kleinbus
🚚 lkw lieferung
🚜 traktor
🛵 roller
🏍️ motorrad
🚲 fahrrad
🛴 tretroller
🚂 lokomotive zug
🚆 zug bahn
🚇 u-bahn
🚊 straßenbahn
✈️ flugzeug fliegen urlaub
🛫 abflug
🛬 landung
🚁 hubschrauber
🚀 rakete start launch
🛸 ufo
⛵ segelboot
🚤 schnellboot
🛳️ schiff kreuzfahrt
⚓ anker
⛽ tankstelle
🚧 baustelle
🚦 ampel
🗺️ karte
🧭 kompass
🏔️ berg schnee
⛰️ berg
🌋 vulkan
🏕️ camping zelt
🏖️ strand urlaub
🏜️ wüste
🏝️ insel
🏞️ nationalpark
🏟️ stadion
🏛️ museum gebäude
🏗️ baustelle kran
🏘️ häuser
🏠 haus zuhause home
🏡 haus garten
🏢 büro gebäude
🏣 post
🏥 krankenhaus
🏦 bank
🏨 hotel
🏪 laden kiosk
🏫 schule
🏬 kaufhaus
🏭 fabrik
🏰 schloss burg
💒 hochzeit kirche
🗼 turm
🗽 freiheitsstatue
⛪ kirche
🕌 moschee
⛩️ schrein
⛲ brunnen
⛺ zelt
🌁 nebel brücke
🌃 nacht stadt
🏙️ skyline stadt
🌄 sonnenaufgang berge
🌅 sonnenaufgang
🌆 abend stadt
🌇 sonnenuntergang
🌉 brücke nacht
🎡 riesenrad
🎢 achterbahn`,
  'Objekte': `
📝 notiz schreiben memo
📒 notizbuch
📓 heft
📔 notizbuch
📕 buch rot
📗 buch grün
📘 buch blau
📙 buch orange
📚 bücher lernen bibliothek
📖 offenes buch lesen
🔖 lesezeichen
🏷️ etikett label tag
📰 zeitung nachrichten
🗞️ zeitung
📄 seite dokument
📃 seite
📑 lesezeichen tabs
🗒️ notizblock
🗓️ kalender
📅 kalender datum termin
📆 kalender abreißen
🗂️ ordner register
📁 ordner
📂 ordner offen
🗃️ karteikasten
🗄️ aktenschrank
📋 klemmbrett
📌 pin reißzwecke
📍 standort pin
📎 büroklammer anhang
🖇️ büroklammern
📏 lineal
📐 geodreieck
✂️ schere
🖊️ kugelschreiber stift
🖋️ füller
✒️ feder
✏️ bleistift stift
🖍️ wachsmalstift
🖌️ pinsel
🔍 suchen lupe
🔎 suchen lupe
🔒 schloss sicher
🔓 offen entsperrt
🔐 schloss schlüssel
🔑 schlüssel passwort
🗝️ alter schlüssel
🔨 hammer
🪓 axt
⛏️ spitzhacke
⚒️ werkzeug
🛠️ werkzeug reparieren
🔧 schraubenschlüssel
🔩 schraube
⚙️ zahnrad einstellungen
🧰 werkzeugkasten
🧲 magnet
🧪 reagenzglas experiment
🔬 mikroskop
🔭 teleskop
📡 satellit antenne
💉 spritze impfung
💊 tablette medizin
🩹 pflaster
🩺 stethoskop arzt
🚪 tür
🛏️ bett
🛋️ sofa
🚽 toilette
🚿 dusche
🛁 badewanne
🧴 lotion
🧹 besen putzen
🧺 korb wäsche
🧻 klopapier
🧼 seife
🛒 einkaufswagen einkaufen
💡 idee glühbirne licht
🔦 taschenlampe
🕯️ kerze
💰 geld sack
💵 geld dollar schein
💶 geld euro schein
💳 kreditkarte bezahlen
💎 diamant edelstein
⚖️ waage recht
🧮 abakus rechnen
💻 laptop computer
🖥️ computer bildschirm desktop
⌨️ tastatur
🖱️ maus computer
🖨️ drucker
📱 handy smartphone
☎️ telefon
📞 telefon hörer anruf
📟 pager
📠 fax
🔋 batterie akku
🔌 stecker strom
💾 diskette speichern
💿 cd
📀 dvd
📷 kamera foto
📸 kamera blitz
📹 videokamera
🎥 filmkamera
📺 fernseher tv
📻 radio
⏰ wecker alarm
⏱️ stoppuhr
⏲️ timer
🕰️ uhr
⌛ sanduhr
⏳ sanduhr warten
📡 antenne
📦 paket karton
📫 briefkasten
📮 briefkasten
✉️ brief umschlag
📧 e-mail
📨 eingehend mail
📩 umschlag pfeil
📤 postausgang
📥 posteingang
🧾 quittung rechnung beleg
📊 diagramm balken statistik
📈 diagramm steigend wachstum
📉 diagramm fallend
🗑️ papierkorb müll
🎒 rucksack schule
👓 brille
🕶️ sonnenbrille
👔 hemd krawatte
👕 t-shirt
👖 jeans
👗 kleid
👟 schuh sneaker
👠 stöckelschuh
🎩 zylinder hut
🧢 kappe
👑 krone könig
💍 ring
👜 handtasche
💼 aktentasche arbeit business
🧳 koffer reise
☂️ schirm`,
  'Symbole': `
❤️ herz liebe rot
🧡 herz orange
💛 herz gelb
💚 herz grün
💙 herz blau
💜 herz lila
🖤 herz schwarz
🤍 herz weiß
🤎 herz braun
💔 gebrochenes herz
❣️ herz ausrufezeichen
💕 zwei herzen
💞 herzen
💓 herz schlagen
💗 herz wachsen
💖 herz funkeln
💘 herz pfeil
💝 herz geschenk
💯 hundert perfekt
💢 ärger
💥 explosion knall
💦 spritzer
💨 schnell wind
💬 sprechblase kommentar chat
💭 gedankenblase
🗨️ sprechblase
🗯️ wut sprechblase
💤 schlafen zzz
✅ erledigt haken fertig ok
☑️ checkbox haken
✔️ haken richtig
❌ kreuz falsch nein
❎ kreuz
➕ plus
➖ minus
➗ geteilt
✖️ mal
♾️ unendlich
‼️ ausrufezeichen doppelt
⁉️ ausrufe fragezeichen
❓ frage
❔ frage weiß
❕ ausrufezeichen weiß
❗ ausrufezeichen wichtig
〰️ welle
⚠️ warnung achtung vorsicht
🚫 verboten
⛔ einfahrt verboten stopp
📛 namensschild
🔰 anfänger
♻️ recycling
⚜️ lilie
🔱 dreizack
✳️ stern
❇️ funke
🆗 ok
🆕 neu
🆓 kostenlos gratis
🆒 cool
🆙 up
🆘 sos hilfe
ℹ️ info information
🔴 rot kreis
🟠 orange kreis
🟡 gelb kreis
🟢 grün kreis
🔵 blau kreis
🟣 lila kreis
🟤 braun kreis
⚫ schwarz kreis
⚪ weiß kreis
🟥 rot quadrat
🟧 orange quadrat
🟨 gelb quadrat
🟩 grün quadrat
🟦 blau quadrat
🟪 lila quadrat
⬛ schwarz quadrat
⬜ weiß quadrat
🔶 raute orange
🔷 raute blau
🔺 dreieck rot
🔻 dreieck unten
💠 raute
🔘 knopf
➡️ pfeil rechts
⬅️ pfeil links
⬆️ pfeil oben
⬇️ pfeil unten
↗️ pfeil rechts oben
↘️ pfeil rechts unten
↙️ pfeil links unten
↖️ pfeil links oben
↕️ pfeil hoch runter
↔️ pfeil links rechts
🔄 wiederholen aktualisieren
🔁 wiederholen schleife
🔂 einmal wiederholen
▶️ abspielen play
⏸️ pause
⏹️ stopp
⏺️ aufnahme
⏭️ weiter
⏮️ zurück
⏩ vorspulen
⏪ zurückspulen
🔀 zufall
🔔 glocke erinnerung benachrichtigung
🔕 glocke aus stumm
📣 megafon ankündigung
📢 lautsprecher
🔇 stumm
🔊 laut
🎵 note musik
🎶 noten musik
♀️ weiblich
♂️ männlich
⚕️ medizin
☮️ frieden
☯️ yin yang
✝️ kreuz
☪️ halbmond
🕉️ om
♈ widder
♉ stier
♊ zwillinge
♋ krebs
♌ löwe
♍ jungfrau
♎ waage
♏ skorpion
♐ schütze
♑ steinbock
♒ wassermann
♓ fische
#️⃣ raute nummer
*️⃣ stern
0️⃣ null
1️⃣ eins
2️⃣ zwei
3️⃣ drei
4️⃣ vier
5️⃣ fünf
6️⃣ sechs
7️⃣ sieben
8️⃣ acht
9️⃣ neun
🔟 zehn
©️ copyright
®️ registriert
™️ trademark marke`,
  'Flaggen': `
🏳️ weiße flagge
🏴 schwarze flagge
🏁 zielflagge rennen
🚩 rote flagge
🏳️‍🌈 regenbogen pride
🇩🇪 deutschland
🇦🇹 österreich
🇨🇭 schweiz
🇪🇺 europa eu
🇬🇧 großbritannien england uk
🇺🇸 usa amerika
🇫🇷 frankreich
🇮🇹 italien
🇪🇸 spanien
🇵🇹 portugal
🇳🇱 niederlande holland
🇧🇪 belgien
🇱🇺 luxemburg
🇩🇰 dänemark
🇸🇪 schweden
🇳🇴 norwegen
🇫🇮 finnland
🇵🇱 polen
🇨🇿 tschechien
🇭🇺 ungarn
🇬🇷 griechenland
🇹🇷 türkei
🇺🇦 ukraine
🇭🇷 kroatien
🇮🇪 irland
🇯🇵 japan
🇨🇳 china
🇰🇷 korea
🇮🇳 indien
🇧🇷 brasilien
🇨🇦 kanada
🇲🇽 mexiko
🇦🇺 australien`
};

export const EMOJI_GROUPS = Object.fromEntries(Object.entries(RAW).map(([group, text]) => [
  group,
  text.trim().split('\n').map((line) => {
    const [e, ...words] = line.trim().split(/\s+/);
    return { e, k: words.join(' ') };
  })
]));

export const ALL_EMOJIS = Object.values(EMOJI_GROUPS).flat();
