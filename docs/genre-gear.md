# Жанрове спорядження

Спорядження (педалі, тембри, предмети шкоди) залежить від жанру пісні: у шансоні гітарі не пропонують дисторшн, у металі — щітки.
Таблиця живе в `game.html`, об'єкт `GENRE_GEAR` (жанр → інструмент → ключі). Усе, що пропонує спорядження (`levelOptions`, `availableGear`), бере її за `SONG.genre`.

## Як це працює

- `availableGear(inst, genre = SONG.genre)` — лише жанровий набір. `allGear(inst)` — повний каталог інструмента. Невідомий жанр чи немає пісні — повний каталог.
- Фільтр стосується лише НОВИХ карток. Уже взяте спорядження не відбирається, прокачується й рахується в лімітах 5 звукових + 5 шкоди (`pGrow`, `applyUpgrade`).
- Жанр пісні на весь забіг один: `makeSong` викликається лише на старті забігу (соло — `newRun`, гурт — `hostPrepare` на хості), а `SONG` їде гостям цілим.
  Хост сам складає картки гравців (`levelOptions` у контексті кожного гравця), тож хост і гості бачать один набір.
- `deserializeOption` шукає предмет у повному `PEDALS`, а не в жанровому наборі, тож гість ніколи не отримає `undefined`, навіть якщо його набір відрізняється.
- Звук і бій розділені: предмет має `fx` (бій, `pedalEffects`) і, за потреби, `snd` (звук, `soundEffects`). Без `snd` звук береться з `fx`, як було.
  Жанровий предмет б'є так само, як той, чию роль заміняє в жанрі (однакові числа в `lv`), а звучить по-своєму.

## Звукові предмети за жанрами

Предмети шкоди (медіатор, технік, гострі струни, саб-удар тощо) лишено ширше; відсіяно явно чуже:
`sparks` (іскри) — крім лоу-фаю, джазу, шансонів, реґі, блюзу; `fuzzHit` — лише рок, нова хвиля, метал, індастріал, драйвовий рок, фолк-рок;
`heavyLow` і `subHit` баса — не в джазі, шансонах, блюзі (у фолк-року лише `heavyLow`). Решта шкоди — скрізь.

### Гітара, ударні, бас, клавіші — звукові педалі й тембри

| Жанр | guitar | drums | bass | piano |
|---|---|---|---|---|
| Лоу-фай | delay, chorus, nylon | shells, room, brushes | comp, chorus, slides, sub | sustain, reverb, wobble |
| Поп | delay, chorus, nylon | shells, rim, bronze, room | comp, chorus, slides, sub | sustain, arp, reverb, ensemble |
| Мелодійний рок | drive, overdrive, delay, wah | shells, rim, bronze, room | comp, slides, sub | sustain, reverb, hammers |
| Нова хвиля | drive, overdrive, delay, chorus | shells, rim, bronze, room | comp, chorus, slides | sustain, arp, reverb, ensemble |
| Метал | drive, overdrive, delay | double, shells, rim, bronze | comp, sub, slides | arp, reverb, hammers |
| Джаз | chorus, warm, plate | bronze, room, brushes | slides, upright, chorus | sustain, reverb, ensemble |
| Шансон · рос. | nylon, tremolo, plate | bronze, room, brushes | comp, slides, upright | sustain, reverb, hammers |
| Шансон · укр. | nylon, tremolo, plate | bronze, room, brushes | comp, slides, upright | sustain, reverb, hammers |
| Реґі | delay, spring, tremolo | shells, rim, room | comp, slides, sub | sustain, reverb, ensemble |
| Індастріал | drive, overdrive, delay | double, shells, rim, bronze | comp, octave, sub, slides | arp, reverb, hammers |
| Фанк | wah, chorus, spring | shells, rim, bronze, room | comp, octave, slides, sub | hammers, ensemble, arp |
| Синтвейв | delay, chorus, tremolo | shells, gated, bronze | comp, octave, chorus, sub, slides | sustain, arp, reverb, ensemble |
| Фолк-рок | overdrive, body, plate | shells, rim, bronze, room | comp, slides, upright | sustain, reverb, hammers |
| Блюз | overdrive, wah, spring | bronze, room, brushes | comp, slides, upright | sustain, reverb, hammers |
| Драйвовий рок | drive, overdrive, delay | double, shells, rim, bronze, room | comp, slides, sub | hammers, sustain, reverb |
| Драм-н-бейс | delay, overdrive, chorus | double, shells, rim | comp, octave, sub, slides | arp, reverb, ensemble |

### Сопілка, скрипка, сакс, акордеон — звукові педалі й тембри

| Жанр | flute | violin | sax | accordion |
|---|---|---|---|---|
| Лоу-фай | vibrato, breath, echo | vibrato, mute, hall | subtone, echo, vibrato | musette, cassotto, shake |
| Поп | vibrato, echo, octave | vibrato, hall, orchestra | echo, chorus, vibrato | musette, piccolo, shake |
| Мелодійний рок | vibrato, echo, octave | vibrato, hall, alto, orchestra | vibrato, octave, echo | bandoneon, piccolo, shake |
| Нова хвиля | vibrato, echo, octave, flutter | vibrato, hall, orchestra | echo, chorus, vibrato, subtone | piccolo, shake, cassotto |
| Метал | breath, octave, flutter | vibrato, hall, alto, orchestra | subtone, octave, vibrato | bandoneon, piccolo, shake |
| Джаз | vibrato, breath, echo, flutter | vibrato, mute, hall | subtone, echo, vibrato, octave | musette, cassotto, bandoneon |
| Шансон · рос. | vibrato, breath, echo | vibrato, mute, hall | subtone, echo, vibrato | musette, bandoneon, cassotto, shake |
| Шансон · укр. | vibrato, breath, echo, flutter | vibrato, mute, hall, alto | subtone, echo, vibrato | musette, bandoneon, cassotto, piccolo, shake |
| Реґі | vibrato, breath, echo | vibrato, mute, hall | echo, subtone, vibrato | bandoneon, shake, piccolo |
| Індастріал | breath, octave, flutter | alto, orchestra, hall, mute | octave, subtone, echo | bandoneon, shake, piccolo |
| Фанк | vibrato, breath, octave, flutter | vibrato, orchestra, hall | octave, vibrato, echo | piccolo, shake, musette |
| Синтвейв | vibrato, echo, octave, flutter | vibrato, hall, orchestra, alto | echo, chorus, vibrato, subtone | piccolo, shake, cassotto |
| Фолк-рок | vibrato, breath, echo, octave, flutter | vibrato, mute, hall, alto, orchestra | vibrato, echo, subtone | musette, bandoneon, piccolo, cassotto, shake |
| Блюз | vibrato, breath, echo | vibrato, mute, hall | subtone, vibrato, echo, octave | bandoneon, cassotto, musette |
| Драйвовий рок | vibrato, breath, octave, flutter | vibrato, alto, orchestra | octave, vibrato, echo | bandoneon, piccolo, shake |
| Драм-н-бейс | echo, octave, flutter, breath | hall, orchestra, alto | echo, octave, subtone | piccolo, shake, bandoneon |

## Нові жанрові предмети

| Ключ | Інструмент | Назва | Звук | Бій (як у...) | Де |
|---|---|---|---|---|---|
| `nylon` | гітара | Нейлонові струни | зрізає верх, тепліший тембр | Ламповий перегруз (+10/20/30% шкоди, відкидання) | лоу-фай, поп, шансони |
| `tremolo` | гітара | Тремоло-перебір | LFO на гучність шини | Вау-педаль (шанс криту 10/18/26%) | шансони, реґі, синтвейв |
| `warm` | гітара | Теплий хамбакер | темніший тон, горб низької середини | Октавер (+12/24/36% шкоди) | джаз |
| `spring` | гітара | Спрінг-ревер | більше ревер-сенд, трохи середини | Компресор (відкидання й стан) | реґі, фанк, блюз |
| `body` | гітара | Акустичний корпус | резонанс середини й низу, трохи ревера | Октавер (+12/24/36% шкоди) | фолк-рок |
| `plate` | гітара | Пластинчастий ревер | довгий ревер-сенд | Тейп-ділей (відлуння 40/55/70%) | джаз, шансони, фолк-рок |
| `brushes` | ударні | Щітки | м'якший верх усього кіта | Сталевий обід (малий: +20/40/60%, оглушення) | джаз, шансони, блюз, лоу-фай |
| `gated` | ударні | Гейтований ревер | три відбиття малого з різким обривом | Сталевий обід | синтвейв |
| `upright` | бас | Контрабасові струни | зрізає верх, дерев'яний низ | Октавер (+12/24/36% шкоди, пробивання) | джаз, шансони, блюз, фолк-рок |
| `wobble` | клавіші | Тейп-ворбл | повільне вібрато висоти + м'якший верх | Хорус (сповільнення 25/40/55%) | лоу-фай |

## Як додати предмет

1. Опиши його в `GEAR[інструмент]` (`game.html`, рядок у тому самому форматі `{key:..,name:T(..),type:..,fx:{..},snd:{..},lv:[T(..),T(..),T(..)]}`).
   `fx` — існуючі бойові ключі (нових механік не вигадуємо); `snd` — ключ звуку. Не клади в один жанр два предмети з однаковим бойовим ключем (тест це перевіряє).
2. Якщо звуковий — додай ключ у `SOUND_GEAR[інструмент]` (інакше це предмет шкоди).
3. Реалізуй звук у `applyPedalAudio` (вузли шини) або в `fire` / `drum` через `soundEffects()`.
4. Намалюй іконку в `GEAR_ART` (`pixel-icons.js`): ключ має бути унікальним, піксельний малюнок — відмінним від решти інструмента.
5. Впиши ключ у потрібні жанри таблиці `GENRE_GEAR` (мінімум 3 звукові й 3 шкоди на інструмент у жанрі).
6. Додай переклади en/de/ru для назви й трьох рівнів в `i18n.js` (блок `[uk,en,de,ru]`).
7. `node --test multiplayer.test.js` — тести «genre gear» перевірять таблицю, іконки, переклади й мінімуми.

## Що перевірити на слух

Нові тембри й ефекти перевірені лише тестами (вузли створюються, значення змінюються), не слухом. Першими послухати:
`gated` на малому (чи звучить як гейт, а не луна), `tremolo` у шансоні, `nylon` проти `warm` (чи різняться), `brushes` на всьому кіті (м'якшають і бочка, і тарілки), `wobble` у лоу-фаї (чи не фальшиво).
