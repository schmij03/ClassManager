// app.js — DOM/State der App. Reine Logik (Parser, Validierung, Team-Verteilung) liegt in core.js (window.TG).
const {
    WEEKDAYS, WEEKDAYS_FULL, REASON_CATEGORIES, TIME_RE,
    sanitizeGender, sanitizeStatus, parseHobbies, sanitizeHobbies,
    todayStr, getWeekdayIndex, getSemester, formatDateDisplay,
    bulkParse, parseCsvImport, parseAttendanceCsv, escapeCsv, pointsToGrade, computePointsTotal, computePointsSeries,
    distributeTeams, enforceApart, uniqueDisplayNames, validateBackup, generateSeating, cleanSeatingPlan
} = window.TG;

// STATE
let classes = [], classIdCounter = 1, stuIdCounter = 1;
let activeClassId = null, selAttendClassId = null;
let persons = [], personIdCounter = 1;
// personsManual: true, wenn die Teilnehmerliste von Hand gepflegt wurde (dann vor Überschreiben warnen)
let personsManual = false;
// apartPairs: [["Anna","Max"], ...] — Paare, die nicht ins gleiche Team sollen (Namensvergleich case-insensitiv)
let apartPairs = [];
// attendanceData: { [classId]: { [dateStr]: { date, weekday, records: { [studentId]: {status, reasonCategory, note} } } } }
let attendanceData = {};
// currentSessionRecords: { [studentId]: {status:'present'|'absent', reasonCategory:'', note:''} } für Klasse/Datum im Anwesenheits-Tab
let currentSessionRecords = {};
let attendanceDirty = false;
let statsSort = { key: 'name', dir: 1 };
// exams: { [classId]: [ { id, title, date, mode:'points'|'grades', maxPoints, results:{ [studentId]: Zahl } } ] }
let exams = {}, examIdCounter = 1;
let selExamClassId = null, selExamId = null, examDirty = false;
// pointsData: { [classId]: { goals: [{id,text,points}], entries: [{id,type:'lektion'|'reset',date,goalIds,note,points}] } }
let pointsData = {}, pointsIdCounter = 1;
let selPointsClassId = null;
let selSeatingClassId = null, seatMode = 'seat', seatSel = null;
// seatingData: { [classId]: { current: Plan|null, saved: [ {id, name, cols, rows, desks} ] (Sitzordnungen mit Personen), layouts: [ dito ohne Personen ] (Tischanordnungen) } }, Plan = { cols, rows, desks:[{x,y,s,l}] }
let seatingData = {}, seatingIdCounter = 1;

const GENDER_ICONS = {
    female:  '<i class="fas fa-venus text-pink-500" title="Weiblich" aria-hidden="true"></i><span class="sr-only">weiblich</span>',
    male:    '<i class="fas fa-mars text-blue-500" title="Männlich" aria-hidden="true"></i><span class="sr-only">männlich</span>',
    diverse: '<i class="fas fa-genderless text-purple-500" title="Divers" aria-hidden="true"></i><span class="sr-only">divers</span>',
    unknown: '<i class="fas fa-circle-question text-gray-300" title="Geschlecht ohne Angabe" aria-hidden="true"></i><span class="sr-only">Geschlecht ohne Angabe</span>'
};
const GENDER_LABELS = { female: 'Weiblich', male: 'Männlich', diverse: 'Divers', unknown: 'Ohne Angabe' };
function genderIconEl(g) { const span = document.createElement('span'); span.innerHTML = GENDER_ICONS[sanitizeGender(g)]; return span; }
// Tabellenzelle mit Geschlechts-Symbol, Name und ggf. "ehemalig" (Flex im inneren div, nicht am td).
function nameCell(student, former, padCls) {
    const td = document.createElement('td');
    td.className = padCls;
    const wrap = document.createElement('div');
    wrap.className = 'flex items-center gap-2';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'font-medium';
    nameSpan.textContent = student.name;
    wrap.append(genderIconEl(student.gender), nameSpan);
    if (former) {
        const badge = document.createElement('span');
        badge.className = 'text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full';
        badge.textContent = 'ehemalig';
        wrap.appendChild(badge);
    }
    td.appendChild(wrap);
    return td;
}

// STORAGE
let storageWarned = false;
function storageWarn() {
    if (storageWarned) return;
    storageWarned = true;
    const el = document.getElementById('storage-warning');
    el.classList.remove('hidden');
}
document.getElementById('storage-warning-close').addEventListener('click', () => document.getElementById('storage-warning').classList.add('hidden'));

// Jeder Datenbereich mit seinen localStorage-Schlüsseln. persist('classes', ...) schreibt die
// genannten Bereiche und stösst danach (falls verbunden) das Schreiben der Datendatei an.
const STORE = {
    classes:    () => ({ tg2_classes: classes, tg2_classId: classIdCounter, tg2_stuId: stuIdCounter }),
    persons:    () => ({ tg2_persons: persons, tg2_personId: personIdCounter, tg2_personsManual: personsManual ? '1' : '0' }),
    attendance: () => ({ tg2_attendance: attendanceData }),
    apart:      () => ({ tg2_apart: apartPairs }),
    exams:      () => ({ tg2_exams: exams, tg2_examId: examIdCounter }),
    points:     () => ({ tg2_points: pointsData, tg2_pointsId: pointsIdCounter }),
    seating:    () => ({ tg2_seating: seatingData, tg2_seatingId: seatingIdCounter })
};
let dataVersion = 0; // steigt bei jeder gespeicherten Änderung (für sicheres Rückgängig)
function persist(...parts) {
    dataVersion++;
    try {
        parts.forEach(part => Object.entries(STORE[part]()).forEach(([k, v]) =>
            localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v))));
    } catch (e) { storageWarn(); }
    scheduleDataFileWrite();
}
const persistAll = () => persist(...Object.keys(STORE));
const saveClasses = () => persist('classes');
const savePersons = () => persist('persons');
const saveAttendanceData = () => persist('attendance');
const saveApartPairs = () => persist('apart');
const saveExams = () => persist('exams');
const savePointsData = () => persist('points');
const saveSeating = () => persist('seating');

// Übernimmt einen validierten Datenstand (Format von validateBackup) in den App-Zustand.
function setData(d) {
    classes = d.classes; classIdCounter = d.classIdCounter; stuIdCounter = d.stuIdCounter;
    attendanceData = d.attendanceData;
    persons = d.persons; personIdCounter = d.personIdCounter;
    apartPairs = d.apartPairs || [];
    exams = d.exams || {}; examIdCounter = d.examIdCounter || 1;
    pointsData = d.pointsData || {}; pointsIdCounter = d.pointsIdCounter || 1;
    seatingData = d.seatingData || {}; seatingIdCounter = d.seatingIdCounter || 1;
}

// Laden läuft durch dieselbe Validierung wie ein Backup-Import: beschädigte oder veraltete
// Einträge werden bereinigt, ID-Zähler können nie hinter vorhandene IDs zurückfallen.
function loadStorage() {
    const read = key => {
        try { const v = localStorage.getItem(key); return v === null ? undefined : JSON.parse(v); }
        catch (e) { return undefined; }
    };
    const rawClasses = read('tg2_classes');
    const data = validateBackup({
        classes: (Array.isArray(rawClasses) ? rawClasses : [])
            .filter(c => c && Number.isInteger(c.id) && c.id > 0 && typeof c.name === 'string' && c.name.trim()),
        classIdCounter: read('tg2_classId'), stuIdCounter: read('tg2_stuId'),
        attendanceData: read('tg2_attendance'),
        persons: read('tg2_persons'), personIdCounter: read('tg2_personId'),
        apartPairs: read('tg2_apart'),
        exams: read('tg2_exams'), examIdCounter: read('tg2_examId'),
        pointsData: read('tg2_points'), pointsIdCounter: read('tg2_pointsId'),
        seatingData: read('tg2_seating'), seatingIdCounter: read('tg2_seatingId')
    });
    if (data) setData(data);
    try { personsManual = localStorage.getItem('tg2_personsManual') === '1'; } catch (e) {}
}

// MODAL-DIALOGE (ersetzen alert/confirm/prompt)
const $modalOverlay = document.getElementById('modal-overlay');
const $modalTitle   = document.getElementById('modal-title');
const $modalMessage = document.getElementById('modal-message');
const $modalInput   = document.getElementById('modal-input');
const $modalHint    = document.getElementById('modal-input-hint');
const $modalOk      = document.getElementById('modal-ok');
const $modalCancel  = document.getElementById('modal-cancel');
let modalResolve = null, modalHasInput = false, modalPrevFocus = null;

function showModal({ title = '', message = '', input = false, inputType = 'text', value = '', placeholder = '', hint = '', okLabel = 'OK', cancelLabel = null, danger = false }) {
    return new Promise(resolve => {
        modalResolve = resolve; modalHasInput = input;
        modalPrevFocus = document.activeElement;
        $modalTitle.textContent = title;
        $modalTitle.classList.toggle('hidden', !title);
        $modalMessage.textContent = message;
        $modalInput.classList.toggle('hidden', !input);
        $modalHint.classList.toggle('hidden', !hint);
        $modalHint.textContent = hint;
        if (input) { $modalInput.type = inputType; $modalInput.value = value; $modalInput.placeholder = placeholder; }
        $modalOk.textContent = okLabel;
        $modalOk.className = danger
            ? 'px-4 py-2 text-sm rounded-md text-white bg-red-600 hover:bg-red-700 font-medium'
            : 'px-4 py-2 text-sm rounded-md text-white bg-indigo-600 hover:bg-indigo-700 font-medium';
        $modalCancel.textContent = cancelLabel || 'Abbrechen';
        $modalCancel.classList.toggle('hidden', cancelLabel === null && !input);
        $modalOverlay.classList.remove('hidden');
        (input ? $modalInput : $modalOk).focus();
        if (input) $modalInput.select();
    });
}
function closeModal(result) {
    if (!modalResolve) return;
    $modalOverlay.classList.add('hidden');
    const resolve = modalResolve; modalResolve = null;
    if (modalPrevFocus && typeof modalPrevFocus.focus === 'function') modalPrevFocus.focus();
    resolve(result);
}
$modalOk.addEventListener('click', () => closeModal(modalHasInput ? $modalInput.value : true));
$modalCancel.addEventListener('click', () => closeModal(modalHasInput ? null : false));
$modalOverlay.addEventListener('mousedown', e => { if (e.target === $modalOverlay) closeModal(modalHasInput ? null : false); });
document.addEventListener('keydown', e => {
    if ($modalOverlay.classList.contains('hidden')) return;
    if (e.key === 'Escape') { e.preventDefault(); closeModal(modalHasInput ? null : false); }
    if (e.key === 'Enter' && document.activeElement !== $modalCancel) { e.preventDefault(); closeModal(modalHasInput ? $modalInput.value : true); }
});
const uiAlert   = (message, title = '') => showModal({ title, message });
const uiConfirm = (message, opts = {}) => showModal({ message, cancelLabel: 'Abbrechen', ...opts });
const uiPrompt  = (message, opts = {}) => showModal({ message, input: true, cancelLabel: 'Abbrechen', ...opts });

// TOASTS + UNDO
// action: { label, fn } zeigt einen Knopf im Toast (z.B. "Rückgängig").
function showToast(message, { undo = null, action = null, duration = 6000 } = {}) {
    if (undo) action = { label: 'Rückgängig', fn: undo };
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = (undo ? 'toast-undo ' : '') + 'toast bg-gray-900 text-white text-sm rounded-xl shadow-lg px-4 py-2.5 flex items-center gap-3 fade-in';
    toast.setAttribute('role', 'status');
    const span = document.createElement('span');
    span.textContent = message;
    toast.appendChild(span);
    let removed = false;
    const remove = () => { if (removed) return; removed = true; toast.remove(); };
    if (action) {
        const btn = document.createElement('button');
        btn.className = 'text-indigo-300 hover:text-indigo-100 font-semibold flex-shrink-0';
        btn.textContent = action.label;
        btn.addEventListener('click', () => { remove(); action.fn(); });
        toast.appendChild(btn);
    }
    container.appendChild(toast);
    setTimeout(remove, duration);
}
function snapshotState() {
    return {
        data: structuredClone(buildBackupObject()),
        activeClassId, selAttendClassId, personsManual
    };
}
function restoreState(snap) {
    setData(snap.data);
    activeClassId = snap.activeClassId; selAttendClassId = snap.selAttendClassId; personsManual = snap.personsManual;
    persistAll();
    refreshAllViews();
}
// Führt eine destruktive Änderung aus und bietet danach "Rückgängig" per Toast an.
// Rückgängig stellt den kompletten früheren Stand her; es ist darum nur möglich, solange
// seither nichts anderes geändert wurde (sonst gingen diese späteren Änderungen verloren).
function withUndo(message, mutate) {
    const snap = snapshotState();
    mutate();
    const version = dataVersion;
    document.querySelectorAll('#toast-container .toast-undo').forEach(t => t.remove());
    showToast(message, { undo: () => {
        if (dataVersion !== version) { showToast('Rückgängig nicht mehr möglich: Inzwischen wurde etwas anderes geändert.'); return; }
        restoreState(snap);
    } });
}

// TABS — der aktive Reiter steht im URL-Hash (#teams), bleibt also beim Neuladen erhalten
// und lässt sich als Lesezeichen bzw. App-Verknüpfung öffnen.
const TAB_ENTER = {
    classes: () => {},
    attendance: () => enterAttendanceTab(),
    stats: () => enterStatsTab(),
    exams: () => enterExamsTab(),
    points: () => enterPointsTab(),
    seating: () => refreshSeatingSelect(),
    teams: () => { renderPersonList(); renderTeamsClassList(); }
};
let currentTab = 'classes';
const tabButtons = Array.from(document.querySelectorAll('.tab-btn'));
tabButtons.forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
tabButtons.forEach((btn, i) => btn.addEventListener('keydown', e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    const next = tabButtons[(i + dir + tabButtons.length) % tabButtons.length];
    next.focus(); switchTab(next.dataset.tab);
}));
function switchTab(tab) {
    if (!TAB_ENTER[tab]) tab = 'classes';
    currentTab = tab;
    Object.keys(TAB_ENTER).forEach(t => document.getElementById('tab-' + t).classList.toggle('hidden', t !== tab));
    tabButtons.forEach(btn => {
        const active = btn.dataset.tab === tab;
        if (active && btn.scrollIntoView) btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', String(active));
        btn.tabIndex = active ? 0 : -1;
    });
    if (location.hash.slice(1) !== tab) history.replaceState(null, '', tab === 'classes' ? location.pathname + location.search : '#' + tab);
    TAB_ENTER[tab]();
}
window.addEventListener('hashchange', () => switchTab(location.hash.slice(1)));

// Nach grösseren Änderungen (Import, Backup, Rückgängig) alles neu zeichnen. Die übrigen
// Reiter aktualisieren sich beim Betreten selbst.
function refreshAllViews() {
    if (activeClassId !== null && !classes.some(c => c.id === activeClassId)) activeClassId = null;
    renderClassList(); renderClassDetail();
    TAB_ENTER[currentTab]();
}

// Füllt eine Klassen-Auswahlliste und wählt selectedId, falls noch vorhanden. Gibt die gültige Auswahl zurück.
function fillClassSelect(sel, list, selectedId, label = c => c.name) {
    sel.replaceChildren(new Option('-- Klasse wählen --', ''), ...list.map(c => new Option(label(c), String(c.id))));
    const valid = selectedId !== null && list.some(c => c.id === selectedId);
    sel.value = valid ? String(selectedId) : '';
    return valid ? selectedId : null;
}
const withCount = c => `${c.name} (${c.students.length} SuS)`;
const findClass = id => classes.find(c => c.id === id) || null;

// GEMEINSAME AKTUELLE KLASSE — wer in einem Reiter eine Klasse wählt, findet sie in den anderen
// Reitern wieder vor (sofern sie dort vorkommt und keine ungespeicherten Eingaben offen sind).
let preferredClassId = (() => { try { return parseInt(localStorage.getItem('tg2_currentClass'), 10) || null; } catch (e) { return null; } })();
function preferClass(id) {
    if (id === null || isNaN(id)) return;
    preferredClassId = id;
    try { localStorage.setItem('tg2_currentClass', String(id)); } catch (e) {}
}
// Bevorzugte Klasse, falls sie in list vorkommt, sonst fallback
const preferredIn = (list, fallback) => preferredClassId !== null && list.some(c => c.id === preferredClassId) ? preferredClassId : fallback;

// Welche Klasse hat laut Wochenplan gerade Unterricht? (Start vor höchstens 90 bzw. in höchstens 30 Minuten)
function scheduledNowClass() {
    const now = new Date();
    const weekday = (now.getDay() + 6) % 7, minutes = now.getHours() * 60 + now.getMinutes();
    let best = null, bestDiff = Infinity;
    classes.forEach(c => (c.schedule || []).forEach(e => {
        if (e.weekday !== weekday) return;
        const [h, m] = e.time.split(':').map(Number);
        const diff = minutes - (h * 60 + m);
        if (diff >= -30 && diff <= 90 && Math.abs(diff) < bestDiff) { best = { cls: c, time: e.time }; bestDiff = Math.abs(diff); }
    }));
    return best;
}

// WOCHENPLAN (gemeinsame Helfer für Klassen-Formular & Detailansicht)
function createScheduleRow(container, entry) {
    const row = document.createElement('div');
    row.className = 'flex items-center gap-1.5 schedule-row';
    const sel = document.createElement('select');
    sel.className = 'schedule-weekday border rounded-md p-1.5 text-xs bg-white focus:border-indigo-500 focus:outline-none';
    sel.setAttribute('aria-label', 'Wochentag');
    sel.innerHTML = '<option value="">Tag</option>' + WEEKDAYS.map((w, i) => `<option value="${i}">${w}</option>`).join('');
    if (entry && entry.weekday !== undefined && entry.weekday !== null) sel.value = String(entry.weekday);
    const time = document.createElement('input');
    time.type = 'time';
    time.setAttribute('aria-label', 'Uhrzeit');
    time.className = 'schedule-time border rounded-md p-1.5 text-xs flex-1 focus:border-indigo-500 focus:outline-none';
    if (entry && entry.time) time.value = entry.time;
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'text-gray-300 hover:text-red-500 px-1';
    rm.innerHTML = '<i class="fas fa-times text-xs" aria-hidden="true"></i>';
    rm.setAttribute('aria-label', 'Termin entfernen');
    rm.addEventListener('click', () => row.remove());
    row.appendChild(sel); row.appendChild(time); row.appendChild(rm);
    container.appendChild(row);
    return row;
}
function readScheduleRows(container) {
    const schedule = [];
    container.querySelectorAll('.schedule-row').forEach(row => {
        const weekday = row.querySelector('.schedule-weekday').value;
        const time = row.querySelector('.schedule-time').value;
        if (weekday === '' || !time) return;
        schedule.push({ weekday: parseInt(weekday, 10), time });
    });
    return schedule;
}

// TAB 1: KLASSEN
const $newClassForm = document.getElementById('new-class-form');
const $newClassName = document.getElementById('new-class-name');
const $newClassErr  = document.getElementById('new-class-error');

const $newClassScheduleRows = document.getElementById('new-class-schedule-rows');

function resetNewClassForm() {
    $newClassName.value = ''; $newClassErr.classList.add('hidden');
    $newClassScheduleRows.innerHTML = '';
    createScheduleRow($newClassScheduleRows);
    document.getElementById('new-class-points-input').checked = false;
    document.getElementById('new-class-kind').value = 'both';
}

// Standard-Ziele des Punkte-Trackers (aus der Sport-Praxis; jederzeit anpassbar).
const DEFAULT_POINT_GOALS = [
    ['Alle starten sofort / gute Startphase', 1],
    ['Aktives Mitmachen der Mehrheit', 2],
    ['Fairplay, respektvolle Kommunikation', 2],
    ['Gute Zusammenarbeit / helfen / motivieren', 2],
    ['Material schnell und sauber verräumt', 1],
    ['Exzellentes Verhalten / über Erwartung', 2]
];
function seedPointGoals(classId) {
    if (pointsData[classId] && pointsData[classId].goals && pointsData[classId].goals.length) return;
    pointsData[classId] = pointsData[classId] || { goals: [], entries: [] };
    pointsData[classId].goals = DEFAULT_POINT_GOALS.map(([text, points]) => ({ id: pointsIdCounter++, text, points }));
    savePointsData();
}

document.getElementById('create-class-btn').addEventListener('click', () => { $newClassForm.classList.remove('hidden'); resetNewClassForm(); $newClassName.focus(); });
document.getElementById('cancel-class-btn').addEventListener('click', () => { $newClassForm.classList.add('hidden'); resetNewClassForm(); });
document.getElementById('new-class-schedule-add-btn').addEventListener('click', () => createScheduleRow($newClassScheduleRows));
document.getElementById('save-class-btn').addEventListener('click', doCreateClass);
$newClassName.addEventListener('keydown', e => { if (e.key === 'Enter') doCreateClass(); });

function doCreateClass() {
    const name = $newClassName.value.trim();
    if (!name) return;
    if (classes.find(c => c.name.toLowerCase() === name.toLowerCase())) { $newClassErr.textContent = `Eine Klasse "${name}" existiert bereits.`; $newClassErr.classList.remove('hidden'); return; }
    const schedule = readScheduleRows($newClassScheduleRows);
    const collectsPoints = document.getElementById('new-class-points-input').checked;
    const newId = classIdCounter++;
    const kind = document.getElementById('new-class-kind').value;
    classes.push({ id: newId, name, students: [], formerStudents: [], schedule, collectsPoints, kind: ['sport', 'room'].includes(kind) ? kind : 'both' });
    if (collectsPoints) seedPointGoals(newId);
    saveClasses();
    $newClassForm.classList.add('hidden');
    selectClass(newId);
    document.getElementById('student-name-input').focus();
}

function renderClassList() {
    const list = document.getElementById('class-list');
    list.innerHTML = '';
    if (classes.length === 0) {
        const noMsg = document.createElement('li');
        noMsg.id = 'no-classes-msg';
        noMsg.className = 'text-center text-gray-400 text-sm py-10';
        noMsg.innerHTML = '<i class="fas fa-graduation-cap text-3xl mb-2 opacity-30 block" aria-hidden="true"></i>Noch keine Klassen angelegt.'
            + '<span class="block text-xs mt-1">Lege oben eine "Neue Klasse" an oder probiere die App mit Beispieldaten aus.</span>';
        const demoBtn = document.createElement('button');
        demoBtn.type = 'button';
        demoBtn.className = 'mt-3 text-sm bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-medium px-3 py-1.5 rounded-md inline-flex items-center gap-1.5';
        demoBtn.innerHTML = '<i class="fas fa-wand-magic-sparkles" aria-hidden="true"></i> Beispielklasse anlegen';
        demoBtn.addEventListener('click', createDemoClass);
        noMsg.appendChild(demoBtn);
        list.appendChild(noMsg);
        return;
    }
    classes.forEach(cls => {
        const isActive = cls.id === activeClassId;
        const li = document.createElement('li');
        li.className = `flex items-center justify-between p-3 rounded-xl border-2 cursor-pointer transition-all ${isActive ? 'bg-indigo-600 border-indigo-600 text-white shadow-md' : 'bg-white border-gray-200 text-gray-700 hover:border-indigo-300 hover:bg-indigo-50'}`;
        const left = document.createElement('button');
        left.type = 'button';
        left.className = 'flex items-center gap-2 flex-1 min-w-0 text-left';
        const nameSpan = document.createElement('span');
        nameSpan.className = 'font-semibold truncate text-sm';
        nameSpan.textContent = cls.name;
        const badge = document.createElement('span');
        badge.className = `text-xs px-2 py-0.5 rounded-full ml-1 ${isActive ? 'bg-white bg-opacity-20 text-white' : 'bg-gray-100 text-gray-500'}`;
        badge.textContent = `${cls.students.length} SuS`;
        left.appendChild(nameSpan); left.appendChild(badge);
        if (classKind(cls) !== 'both') {
            const kindBadge = document.createElement('span');
            kindBadge.className = `text-xs px-2 py-0.5 rounded-full ${isActive ? 'bg-white bg-opacity-20 text-white' : classKind(cls) === 'sport' ? 'bg-emerald-50 text-emerald-700' : 'bg-sky-50 text-sky-700'}`;
            kindBadge.textContent = classKind(cls) === 'sport' ? 'Sport' : 'Klassenzimmer';
            left.appendChild(kindBadge);
        }
        left.addEventListener('click', () => selectClass(cls.id));
        const actions = document.createElement('div');
        actions.className = 'flex items-center gap-0.5 ml-2 flex-shrink-0';
        [['fa-pen','Umbenennen',() => renameClass(cls.id)],['fa-trash-alt','Löschen',() => deleteClass(cls.id)]].forEach(([icon, title, fn]) => {
            const btn = document.createElement('button');
            btn.className = `p-1.5 rounded text-xs transition-colors ${isActive ? 'text-indigo-200 hover:text-white hover:bg-white hover:bg-opacity-20' : 'text-gray-300 hover:text-indigo-500 hover:bg-indigo-50'}`;
            btn.innerHTML = `<i class="fas ${icon}" aria-hidden="true"></i>`;
            btn.title = title;
            btn.setAttribute('aria-label', `Klasse "${cls.name}" ${title.toLowerCase()}`);
            btn.addEventListener('click', e => { e.stopPropagation(); fn(); });
            actions.appendChild(btn);
        });
        li.appendChild(left); li.appendChild(actions);
        list.appendChild(li);
    });
}

function selectClass(id) { activeClassId = id; preferClass(id); renderClassList(); renderClassDetail(); }

// BEISPIELKLASSE — zum Ausprobieren aller Funktionen ohne eigene Daten (später einfach löschen).
const DEMO_STUDENTS = [
    ['Anna', 'w', true, 'Fussball, Tennis'], ['Ben', 'm', true, 'Fussball'], ['Chiara', 'w', false, 'Tanzen'],
    ['David', 'm', false, ''], ['Elena', 'w', true, 'Unihockey'], ['Finn', 'm', true, 'Unihockey, Fussball'],
    ['Gianna', 'w', false, 'Schwimmen'], ['Hugo', 'm', false, ''], ['Ida', 'w', true, 'Volleyball'],
    ['Jonas', 'm', false, 'Basketball'], ['Lea', 'w', false, ''], ['Luca', 'm', true, 'Basketball, Tennis'],
    ['Mia', 'w', true, 'Volleyball, Schwimmen'], ['Noah', 'm', false, 'Schwimmen'], ['Olivia', 'w', false, ''],
    ['Samuel', 'm', true, 'Fussball'], ['Sofia', 'w', false, 'Tanzen'], ['Tim', 'm', false, 'Unihockey'],
    ['Valentina', 'w', true, 'Tennis'], ['Yannick', 'm', false, '']
];
function createDemoClass() {
    let name = 'Beispielklasse';
    for (let i = 2; classes.some(c => c.name.toLowerCase() === name.toLowerCase()); i++) name = `Beispielklasse ${i}`;
    const id = classIdCounter++;
    classes.push({
        id, name, formerStudents: [], collectsPoints: true, kind: 'both',
        schedule: [{ weekday: 0, time: '08:00' }, { weekday: 3, time: '10:15' }],
        students: DEMO_STUDENTS.map(([n, g, sporty, hobbies]) => ({
            id: stuIdCounter++, name: n, gender: g === 'm' ? 'male' : 'female', sporty, classTag: '', hobbies: parseHobbies(hobbies)
        }))
    });
    seedPointGoals(id);
    saveClasses();
    selectClass(id);
    showToast(`"${name}" mit ${DEMO_STUDENTS.length} Schüler(innen) angelegt — probiere Anwesenheit, Teams und Sitzordnung aus.`, { duration: 8000 });
}

async function renameClass(id) {
    const cls = classes.find(c => c.id === id);
    if (!cls) return;
    const n = await uiPrompt('Neuer Klassenname:', { title: 'Klasse umbenennen', value: cls.name });
    if (!n || !n.trim()) return;
    const t = n.trim();
    if (classes.find(c => c.id !== id && c.name.toLowerCase() === t.toLowerCase())) { await uiAlert(`Eine Klasse "${t}" existiert bereits.`); return; }
    cls.name = t; saveClasses(); renderClassList(); renderClassDetail();
}

async function deleteClass(id) {
    const cls = classes.find(c => c.id === id);
    if (!cls) return;
    const ok = await uiConfirm(`Klasse "${cls.name}" wirklich löschen? Damit werden auch alle erfassten Anwesenheiten dieser Klasse gelöscht.`, { title: 'Klasse löschen', okLabel: 'Löschen', danger: true });
    if (!ok) return;
    withUndo(`Klasse "${cls.name}" gelöscht.`, () => {
        classes = classes.filter(c => c.id !== id);
        if (activeClassId === id) activeClassId = null;
        if (selAttendClassId === id) { selAttendClassId = null; currentSessionRecords = {}; attendanceDirty = false; updateDirtyHint(); }
        delete attendanceData[id];
        delete exams[id];
        delete pointsData[id];
        delete seatingData[id];
        if (selPointsClassId === id) selPointsClassId = null;
        if (selSeatingClassId === id) { selSeatingClassId = null; seatSel = null; }
        saveExams(); savePointsData(); saveSeating();
        saveClasses(); saveAttendanceData(); renderClassList(); renderClassDetail();
    });
}

function renderClassDetail() {
    const panel = document.getElementById('class-detail-panel');
    const noSel = document.getElementById('no-class-selected');
    const cls = findClass(activeClassId);
    if (!cls) { panel.classList.add('hidden'); noSel.classList.remove('hidden'); return; }
    panel.classList.remove('hidden'); noSel.classList.add('hidden');
    document.getElementById('detail-class-name').textContent = cls.name;
    document.getElementById('detail-student-count').textContent = `${cls.students.length} Schüler(in)`;
    document.getElementById('detail-schedule-edit').classList.add('hidden');
    document.getElementById('detail-schedule-display').classList.remove('hidden');
    document.getElementById('detail-class-kind').value = classKind(cls);
    renderPointsToggle(cls);
    renderScheduleDisplayBadges(cls);
    renderStudentList(cls);
}

// Unterrichtsart der Klasse: 'sport', 'room' (Klassenzimmer) oder 'both' (Standard, auch für ältere Daten)
function classKind(cls) { return cls.kind === 'sport' || cls.kind === 'room' ? cls.kind : 'both'; }
document.getElementById('detail-class-kind').addEventListener('change', function() {
    const cls = findClass(activeClassId);
    if (!cls) return;
    cls.kind = ['sport', 'room'].includes(this.value) ? this.value : 'both';
    saveClasses();
    renderClassList();
});

function renderPointsToggle(cls) {
    const btn = document.getElementById('toggle-points-btn');
    const on = cls.collectsPoints === true;
    btn.textContent = on ? 'Aktiv' : 'Inaktiv';
    btn.className = `text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${on ? 'bg-amber-400 text-white hover:bg-amber-500' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`;
    btn.title = on ? 'Punkte-Tracker deaktivieren' : 'Punkte-Tracker aktivieren';
    btn.setAttribute('aria-pressed', String(on));
}
document.getElementById('toggle-points-btn').addEventListener('click', () => {
    const cls = findClass(activeClassId);
    if (!cls) return;
    cls.collectsPoints = cls.collectsPoints !== true;
    if (cls.collectsPoints) seedPointGoals(cls.id);
    saveClasses();
    renderPointsToggle(cls);
});

function renderScheduleDisplayBadges(cls) {
    const disp = document.getElementById('detail-schedule-display');
    disp.innerHTML = '';
    if (!cls.schedule || cls.schedule.length === 0) {
        const span = document.createElement('span');
        span.className = 'text-xs text-gray-400 italic';
        span.textContent = 'Kein Wochenplan hinterlegt.';
        disp.appendChild(span);
        return;
    }
    cls.schedule.slice().sort((a, b) => a.weekday - b.weekday || a.time.localeCompare(b.time)).forEach(e => {
        const badge = document.createElement('span');
        badge.className = 'text-xs bg-white border border-indigo-200 text-indigo-700 px-2 py-1 rounded-full';
        badge.textContent = `${WEEKDAYS[e.weekday]} ${e.time}`;
        disp.appendChild(badge);
    });
}

document.getElementById('edit-schedule-btn').addEventListener('click', () => {
    const cls = findClass(activeClassId);
    if (!cls) return;
    const editDiv = document.getElementById('detail-schedule-edit');
    const displayDiv = document.getElementById('detail-schedule-display');
    const rowsContainer = document.getElementById('detail-schedule-rows');
    const opening = editDiv.classList.contains('hidden');
    if (opening) {
        rowsContainer.innerHTML = '';
        if (cls.schedule && cls.schedule.length) cls.schedule.forEach(e => createScheduleRow(rowsContainer, e));
        else createScheduleRow(rowsContainer);
        editDiv.classList.remove('hidden'); displayDiv.classList.add('hidden');
    } else {
        editDiv.classList.add('hidden'); displayDiv.classList.remove('hidden');
    }
});
document.getElementById('detail-schedule-add-btn').addEventListener('click', () => createScheduleRow(document.getElementById('detail-schedule-rows')));
document.getElementById('detail-schedule-save-btn').addEventListener('click', () => {
    const cls = findClass(activeClassId);
    if (!cls) return;
    cls.schedule = readScheduleRows(document.getElementById('detail-schedule-rows'));
    saveClasses();
    document.getElementById('detail-schedule-edit').classList.add('hidden');
    document.getElementById('detail-schedule-display').classList.remove('hidden');
    renderScheduleDisplayBadges(cls);
});

document.getElementById('add-student-form').addEventListener('submit', async e => {
    e.preventDefault();
    const name = document.getElementById('student-name-input').value.trim();
    const gender = document.querySelector('input[name="student-gender"]:checked').value;
    const sporty = document.getElementById('student-sporty-input').checked;
    if (!name || !activeClassId) return;
    const cls = findClass(activeClassId);
    if (!cls) return;
    if (cls.students.find(s => s.name.toLowerCase() === name.toLowerCase())) {
        // Zwei Kinder mit gleichem Vornamen sind real möglich — nachfragen statt blockieren.
        const ok = await uiConfirm(`"${name}" ist bereits in dieser Klasse. Trotzdem hinzufügen (z.B. zweites Kind mit gleichem Namen)? Tipp: Mit Initial unterscheiden, z.B. "${name} M".`, { title: 'Doppelter Name', okLabel: 'Trotzdem hinzufügen' });
        if (!ok) return;
    }
    const classTag = document.getElementById('student-classtag-input').value.trim().slice(0, 20);
    const hobbies = parseHobbies(document.getElementById('student-hobbies-input').value);
    cls.students.push({ id: stuIdCounter++, name, gender, sporty, classTag, hobbies });
    saveClasses();
    document.getElementById('student-name-input').value = '';
    document.getElementById('student-hobbies-input').value = '';
    document.getElementById('student-sporty-input').checked = false;
    renderClassDetail();
    document.getElementById('student-name-input').focus();
});

// Hat der/die Schüler(in) erfasste Anwesenheiten oder Prüfungsergebnisse? Dann beim Entfernen
// als "ehemalig" archivieren, damit Auswertungen die Historie behalten können.
function studentHasAttendance(clsId, studentId) {
    const sessions = attendanceData[clsId];
    if (!sessions) return false;
    return Object.values(sessions).some(session => session.records && session.records[studentId]);
}
function studentHasExamResults(clsId, studentId) {
    return (exams[clsId] || []).some(exam => exam.results && exam.results[studentId] !== undefined);
}
function removeStudent(studentId) {
    const cls = findClass(activeClassId);
    if (!cls) return;
    const student = cls.students.find(s => s.id === studentId);
    if (!student) return;
    withUndo(`"${student.name}" entfernt.`, () => {
        cls.students = cls.students.filter(s => s.id !== studentId);
        if (studentHasAttendance(cls.id, studentId) || studentHasExamResults(cls.id, studentId)) {
            if (!Array.isArray(cls.formerStudents)) cls.formerStudents = [];
            cls.formerStudents.push({ id: student.id, name: student.name, gender: student.gender, sporty: student.sporty === true, classTag: student.classTag || '', hobbies: sanitizeHobbies(student.hobbies) });
        }
        saveClasses(); renderClassDetail();
    });
}

function renderStudentList(cls) {
    const ul = document.getElementById('student-list');
    ul.innerHTML = '';
    if (cls.students.length === 0) {
        const li = document.createElement('li');
        li.className = 'text-center text-gray-400 text-sm py-8';
        li.innerHTML = '<i class="fas fa-user-plus text-2xl mb-2 opacity-30 block" aria-hidden="true"></i>Noch keine Schüler eingetragen.';
        ul.appendChild(li); return;
    }
    const frag = document.createDocumentFragment();
    cls.students.forEach(s => {
        const li = document.createElement('li');
        li.className = 'flex items-center bg-white rounded-lg border border-gray-100 shadow-sm';
        // Ganze Zeile öffnet den Bearbeiten-Dialog
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'student-row flex items-center gap-2 min-w-0 flex-1 text-left p-2 rounded-lg';
        btn.setAttribute('aria-label', `${s.name} bearbeiten`);
        const nameSpan = document.createElement('span'); nameSpan.className = 'text-sm text-gray-700 truncate'; nameSpan.textContent = s.name;
        btn.append(genderIconEl(s.gender), nameSpan);
        if (s.sporty) {
            const sp = document.createElement('span');
            sp.className = 'text-emerald-600 text-xs flex-shrink-0'; sp.title = 'Sportlich';
            sp.innerHTML = '<i class="fas fa-person-running" aria-hidden="true"></i><span class="sr-only">sportlich</span>';
            btn.appendChild(sp);
        }
        if (s.classTag) {
            const tagBadge = document.createElement('span');
            tagBadge.className = 'text-xs bg-sky-50 text-sky-700 border border-sky-200 px-1.5 py-0.5 rounded-full flex-shrink-0';
            tagBadge.textContent = s.classTag;
            btn.appendChild(tagBadge);
        }
        if (s.hobbies.length) {
            const hobbyBadge = document.createElement('span');
            hobbyBadge.className = 'text-xs bg-teal-50 text-teal-700 border border-teal-200 px-1.5 py-0.5 rounded-full truncate max-w-[9rem]';
            hobbyBadge.textContent = s.hobbies.join(', ');
            btn.appendChild(hobbyBadge);
        }
        const pen = document.createElement('span');
        pen.className = 'ml-auto text-indigo-400 text-xs px-1 flex-shrink-0';
        pen.innerHTML = '<i class="fas fa-pen" aria-hidden="true"></i>';
        btn.appendChild(pen);
        btn.addEventListener('click', () => openStudentDialog(cls, s));
        li.appendChild(btn);
        frag.appendChild(li);
    });
    ul.appendChild(frag);
}

// BEARBEITEN-DIALOG für eine Person: Name, Kürzel, Geschlecht, Hobbys, Sportlich, Entfernen.
const $sd = document.getElementById('student-dialog');
let sdTarget = null, sdPrevFocus = null;
function openStudentDialog(cls, s) {
    sdTarget = { cls, s }; sdPrevFocus = document.activeElement;
    document.getElementById('sd-name').value = s.name;
    document.getElementById('sd-tag').value = s.classTag || '';
    document.getElementById('sd-hobbies').value = s.hobbies.join(', ');
    document.getElementById('sd-sporty').checked = s.sporty === true;
    document.querySelectorAll('input[name="sd-gender"]').forEach(r => { r.checked = r.value === sanitizeGender(s.gender); });
    document.getElementById('sd-error').classList.add('hidden');
    $sd.classList.remove('hidden');
    document.getElementById('sd-name').focus();
}
function closeStudentDialog() {
    $sd.classList.add('hidden'); sdTarget = null;
    if (sdPrevFocus && sdPrevFocus.isConnected) sdPrevFocus.focus();
}
document.getElementById('sd-cancel').addEventListener('click', closeStudentDialog);
$sd.addEventListener('mousedown', e => { if (e.target === $sd) closeStudentDialog(); });
$sd.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); closeStudentDialog(); } });
document.getElementById('sd-remove').addEventListener('click', () => {
    if (!sdTarget) return;
    const id = sdTarget.s.id;
    closeStudentDialog();
    removeStudent(id);
});
document.getElementById('student-dialog-form').addEventListener('submit', async e => {
    e.preventDefault();
    if (!sdTarget) return;
    const { cls, s } = sdTarget;
    const name = document.getElementById('sd-name').value.trim();
    const err = document.getElementById('sd-error');
    if (!name) { err.textContent = 'Bitte einen Namen eingeben.'; err.classList.remove('hidden'); return; }
    if (cls.students.some(o => o !== s && o.name.toLowerCase() === name.toLowerCase())) {
        err.textContent = `"${name}" gibt es in dieser Klasse schon. Tipp: mit Initial unterscheiden, z.B. "${name} M".`;
        err.classList.remove('hidden'); return;
    }
    const oldName = s.name;
    s.name = name;
    s.classTag = document.getElementById('sd-tag').value.trim().slice(0, 20);
    s.hobbies = parseHobbies(document.getElementById('sd-hobbies').value);
    s.sporty = document.getElementById('sd-sporty').checked;
    const g = document.querySelector('input[name="sd-gender"]:checked');
    s.gender = sanitizeGender(g ? g.value : s.gender);
    // "Nicht zusammen"-Regeln laufen über den Namen: bei Umbenennung mitziehen
    if (oldName !== name) {
        const k = oldName.trim().toLowerCase();
        apartPairs = apartPairs.map(pair => pair.map(n => n.trim().toLowerCase() === k ? name : n));
        saveApartPairs();
    }
    saveClasses();
    closeStudentDialog();
    renderClassDetail();
});

document.getElementById('sort-alpha-btn').addEventListener('click', () => {
    const cls = findClass(activeClassId);
    if (!cls) return;
    cls.students.sort((a, b) => a.name.localeCompare(b.name, 'de'));
    saveClasses(); renderStudentList(cls);
});

document.getElementById('toggle-class-bulk-btn').addEventListener('click', () => document.getElementById('class-bulk-area').classList.toggle('hidden'));
document.getElementById('class-bulk-import-btn').addEventListener('click', () => {
    const cls = findClass(activeClassId);
    if (!cls) return;
    const text = document.getElementById('class-bulk-input').value.trim();
    if (!text) return;
    const { added, skipped, defaults } = bulkParse(text, (name, gender, sporty, classTag) => {
        if (cls.students.find(s => s.name.toLowerCase() === name.toLowerCase())) return false;
        cls.students.push({ id: stuIdCounter++, name, gender, sporty, classTag: classTag || '', hobbies: [] }); return true;
    });
    saveClasses(); document.getElementById('class-bulk-input').value = '';
    showBulkMsg('class-bulk-msg', added, skipped, defaults);
    setTimeout(() => document.getElementById('class-bulk-area').classList.add('hidden'), 4000);
    renderClassDetail();
});

// KLASSEN IMPORT / EXPORT
function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Umlaute/Akzente für Dateinamen transliterieren — Chromium ersetzt Download-Namen
// mit Nicht-ASCII-Zeichen sonst teils durch ein generisches "download".
function safeFilePart(str, maxLen = 40) {
    return String(str)
        .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
        .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue')
        .replace(/ß/g, 'ss')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^A-Za-z0-9._-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, maxLen) || 'export';
}

document.getElementById('export-classes-btn').addEventListener('click', async () => {
    if (classes.length === 0) { await uiAlert('Keine Klassen zum Exportieren vorhanden.'); return; }
    const data = classes.map(c => ({ name: c.name, kind: classKind(c), collectsPoints: c.collectsPoints === true, schedule: c.schedule || [], students: c.students.map(s => ({ name: s.name, gender: s.gender, sporty: s.sporty === true, classTag: s.classTag || '', hobbies: sanitizeHobbies(s.hobbies) })) }));
    downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `klassen-export-${todayStr()}.json`);
});

document.getElementById('import-format-help-btn').addEventListener('click', () => document.getElementById('import-format-help').classList.toggle('hidden'));

const $importFileInput = document.getElementById('import-file-input');
document.getElementById('import-classes-btn').addEventListener('click', () => $importFileInput.click());
$importFileInput.addEventListener('change', () => {
    const file = $importFileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
        try {
            let imported = 0, importedStudents = 0;
            if (file.name.toLowerCase().endsWith('.json')) {
                const data = JSON.parse(reader.result);
                const list = Array.isArray(data) ? data : [data];
                list.forEach(entry => {
                    if (!entry || typeof entry !== 'object') return;
                    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
                    if (!name) return;
                    let cls = classes.find(c => c.name.toLowerCase() === name.toLowerCase());
                    if (!cls) {
                        const schedule = Array.isArray(entry.schedule)
                            ? entry.schedule.filter(e => e && Number.isInteger(e.weekday) && e.weekday >= 0 && e.weekday <= 6 && typeof e.time === 'string' && TIME_RE.test(e.time)).map(e => ({ weekday: e.weekday, time: e.time }))
                            : [];
                        cls = { id: classIdCounter++, name, students: [], formerStudents: [], schedule,
                            collectsPoints: entry.collectsPoints === true, kind: classKind(entry) };
                        classes.push(cls); imported++;
                        if (cls.collectsPoints) seedPointGoals(cls.id);
                    }
                    (Array.isArray(entry.students) ? entry.students : []).forEach(s => {
                        const obj = s && typeof s === 'object' ? s : {};
                        const sName = (typeof s === 'string' ? s : typeof obj.name === 'string' ? obj.name : '').trim();
                        if (!sName) return;
                        if (cls.students.find(st => st.name.toLowerCase() === sName.toLowerCase())) return;
                        cls.students.push({
                            id: stuIdCounter++, name: sName, gender: sanitizeGender(obj.gender), sporty: obj.sporty === true,
                            classTag: typeof obj.classTag === 'string' ? obj.classTag.slice(0, 20).trim() : '',
                            hobbies: sanitizeHobbies(obj.hobbies)
                        });
                        importedStudents++;
                    });
                });
            } else {
                parseCsvImport(reader.result).forEach(row => {
                    let cls = classes.find(c => c.name.toLowerCase() === row.className.toLowerCase());
                    if (!cls) { cls = { id: classIdCounter++, name: row.className, students: [], formerStudents: [], schedule: [], collectsPoints: false, kind: 'both' }; classes.push(cls); imported++; }
                    if (cls.students.find(st => st.name.toLowerCase() === row.studentName.toLowerCase())) return;
                    cls.students.push({ id: stuIdCounter++, name: row.studentName, gender: row.gender, sporty: row.sporty, classTag: row.classTag || '', hobbies: row.hobbies || [] });
                    importedStudents++;
                });
            }
            saveClasses();
            refreshAllViews();
            await uiAlert(`Import abgeschlossen: ${imported} neue Klasse(n), ${importedStudents} Schüler(innen) hinzugefügt.`, 'Import');
        } catch (err) {
            await uiAlert('Import fehlgeschlagen: Datei konnte nicht gelesen werden. Bitte ein gültiges JSON (Klassenexport) oder eine CSV mit "Klasse;Name;Geschlecht" verwenden.', 'Import');
        }
        $importFileInput.value = '';
    };
    reader.readAsText(file);
});

// TAB 2: ANWESENHEIT
const $attendanceSelect = document.getElementById('attendance-class-select');
const $attendanceDate = document.getElementById('attendance-date-input');
let lastAttendanceSelectValue = '';
let lastAttendanceDate = '';

function updateDirtyHint() {
    document.getElementById('attendance-dirty-hint').classList.toggle('hidden', !attendanceDirty);
}
function markAttendanceDirty() {
    attendanceDirty = true;
    document.getElementById('attendance-saved-msg').classList.add('hidden');
    updateDirtyHint();
}
async function confirmDiscardAttendance() {
    if (!attendanceDirty) return true;
    const ok = await uiConfirm('Die Anwesenheit für den aktuellen Termin wurde noch nicht gespeichert. Änderungen verwerfen?', { title: 'Ungespeicherte Änderungen', okLabel: 'Verwerfen', danger: true });
    if (ok) { attendanceDirty = false; updateDirtyHint(); }
    return ok;
}
window.addEventListener('beforeunload', e => {
    if (attendanceDirty || examDirty) { e.preventDefault(); e.returnValue = ''; }
});

// Hinweis "Laut Wochenplan jetzt: 7a", wenn gerade eine andere Klasse gewählt ist
function renderScheduleSuggestion() {
    const box = document.getElementById('attendance-suggest');
    const now = scheduledNowClass();
    const show = now && now.cls.id !== selAttendClassId;
    box.classList.toggle('hidden', !show);
    if (!show) return;
    document.getElementById('attendance-suggest-text').textContent = `Laut Wochenplan jetzt: ${now.cls.name} (${now.time} Uhr)`;
    document.getElementById('attendance-suggest-btn').onclick = () => {
        $attendanceSelect.value = String(now.cls.id);
        $attendanceSelect.dispatchEvent(new Event('change'));
    };
}

function showAttendanceContent(on) {
    document.getElementById('attendance-empty').classList.toggle('hidden', on);
    document.getElementById('attendance-content').classList.toggle('hidden', !on);
}

// Beim Betreten des Reiters: Auswahl aktualisieren. Ungespeicherte Eingaben bleiben erhalten,
// werden aber an die aktuelle Schülerliste angepasst (neue Schüler(innen) = anwesend).
function enterAttendanceTab() {
    if (!attendanceDirty) {
        const now = scheduledNowClass();
        // Ohne Auswahl die Klasse vorschlagen, die gerade laut Wochenplan Unterricht hat
        selAttendClassId = preferredIn(classes, selAttendClassId);
        if (selAttendClassId === null && now) selAttendClassId = now.cls.id;
    }
    selAttendClassId = fillClassSelect($attendanceSelect, classes, selAttendClassId, withCount);
    renderScheduleSuggestion();
    lastAttendanceSelectValue = $attendanceSelect.value;
    if (!$attendanceDate.value) $attendanceDate.value = todayStr();
    lastAttendanceDate = $attendanceDate.value;
    const cls = findClass(selAttendClassId);
    showAttendanceContent(!!cls);
    if (!cls) { currentSessionRecords = {}; attendanceDirty = false; updateDirtyHint(); return; }
    if (!attendanceDirty) { loadAttendanceSession(); return; }
    const ids = new Set(cls.students.map(s => String(s.id)));
    Object.keys(currentSessionRecords).forEach(id => { if (!ids.has(id)) delete currentSessionRecords[id]; });
    cls.students.forEach(s => { if (!currentSessionRecords[s.id]) currentSessionRecords[s.id] = { status: 'present', reasonCategory: '', note: '' }; });
    renderAttendanceGrid();
    renderAttendanceSessionsList(cls);
}

$attendanceSelect.addEventListener('change', async function() {
    if (!(await confirmDiscardAttendance())) { this.value = lastAttendanceSelectValue; return; }
    lastAttendanceSelectValue = this.value;
    const id = parseInt(this.value, 10);
    selAttendClassId = isNaN(id) ? null : id;
    preferClass(selAttendClassId);
    renderScheduleSuggestion();
    if (selAttendClassId === null) currentSessionRecords = {};
    showAttendanceContent(selAttendClassId !== null);
    if (selAttendClassId !== null) loadAttendanceSession();
});

$attendanceDate.addEventListener('change', async function() {
    if (selAttendClassId === null) { lastAttendanceDate = this.value; return; }
    if (!(await confirmDiscardAttendance())) { this.value = lastAttendanceDate; return; }
    loadAttendanceSession();
});

function loadAttendanceSession() {
    const cls = findClass(selAttendClassId);
    if (!cls) return;
    const dateStr = $attendanceDate.value || todayStr();
    $attendanceDate.value = dateStr;
    lastAttendanceDate = dateStr;
    const existing = attendanceData[cls.id] && attendanceData[cls.id][dateStr];
    currentSessionRecords = {};
    cls.students.forEach(s => {
        const rec = existing && existing.records[s.id];
        currentSessionRecords[s.id] = rec ? { status: sanitizeStatus(rec.status), reasonCategory: rec.reasonCategory || '', note: rec.note || '' } : { status: 'present', reasonCategory: '', note: '' };
    });
    attendanceDirty = false; updateDirtyHint();
    document.getElementById('attendance-saved-msg').classList.add('hidden');
    renderScheduleHint(cls, dateStr);
    renderAttendanceGrid();
    renderAttendanceSessionsList(cls);
}

function renderScheduleHint(cls, dateStr) {
    const hintEl = document.getElementById('attendance-schedule-hint');
    const textEl = hintEl.querySelector('span');
    if (!cls.schedule || cls.schedule.length === 0) { hintEl.classList.add('hidden'); return; }
    const weekday = getWeekdayIndex(dateStr);
    const matches = cls.schedule.filter(e => e.weekday === weekday);
    if (matches.length > 0) {
        textEl.textContent = `Geplanter Termin: ${WEEKDAYS_FULL[weekday]}, ${matches.map(m => m.time).join(' / ')} Uhr.`;
    } else {
        textEl.textContent = `Hinweis: Laut Wochenplan von "${cls.name}" ist am ${WEEKDAYS_FULL[weekday]} normalerweise kein Termin vorgesehen.`;
    }
    hintEl.classList.remove('hidden');
}

['present', 'absent'].forEach(status => document.getElementById(`all-${status}-btn`).addEventListener('click', () => {
    Object.values(currentSessionRecords).forEach(rec => { rec.status = status; });
    markAttendanceDirty(); renderAttendanceGrid();
}));

// Klick wechselt den Status im Kreis: anwesend → abwesend → verletzt (anwesend,
// macht nicht mit) → anwesend. Verletzte zählen als anwesend, werden aber nicht
// in die Team-Generierung übernommen.
const STATUS_LABELS = { present: 'anwesend', absent: 'abwesend', injured: 'anwesend, macht nicht mit (verletzt)' };
const NEXT_STATUS = { present: 'absent', absent: 'injured', injured: 'present' };

function updateAttendanceCounts(cls) {
    const recs = Object.values(currentSessionRecords);
    const participatingCount = recs.filter(r => r.status === 'present').length;
    const injuredCount = recs.filter(r => r.status === 'injured').length;
    document.getElementById('total-students-count').textContent = cls.students.length;
    document.getElementById('present-count').textContent = participatingCount + injuredCount;
    document.getElementById('injured-count-note').textContent = injuredCount > 0 ? `davon ${injuredCount} verletzt (machen nicht mit)` : '';
    document.getElementById('load-to-teams-label').textContent = `Teams erstellen mit ${participatingCount} Schüler${participatingCount === 1 ? '' : 'n'}`;
    document.getElementById('bar-present').textContent = participatingCount + injuredCount;
    document.getElementById('bar-total').textContent = cls.students.length;
}

function renderAttendanceGrid() {
    const cls = findClass(selAttendClassId);
    if (!cls) return;
    updateAttendanceCounts(cls);
    const grid = document.getElementById('attendance-grid');
    if (cls.students.length === 0) { grid.innerHTML = '<p class="text-sm text-gray-400 col-span-full text-center py-6">Diese Klasse hat noch keine Schüler.</p>'; return; }
    const frag = document.createDocumentFragment();
    cls.students.forEach(s => frag.appendChild(buildAttendanceCard(cls, s)));
    grid.replaceChildren(frag);
}

const CARD_STYLE = {
    present: { card: 'bg-green-50 border-green-400 text-green-900', box: 'bg-green-500 border-green-500', icon: 'fa-check' },
    absent:  { card: 'bg-red-50 border-red-300 text-red-900', box: 'bg-red-400 border-red-400', icon: 'fa-times' },
    injured: { card: 'bg-orange-50 border-orange-400 text-orange-900', box: 'bg-orange-400 border-orange-400', icon: 'fa-user-injured' }
};
function attendanceNoteInput(rec, label, placeholder, colorCls) {
    const note = document.createElement('input');
    note.type = 'text'; note.placeholder = placeholder; note.value = rec.note || '';
    note.setAttribute('aria-label', label);
    note.className = `text-xs border ${colorCls} rounded-md p-1.5 flex-1 w-full focus:outline-none`;
    note.addEventListener('input', () => { rec.note = note.value; markAttendanceDirty(); });
    return note;
}
// Eine Karte pro Person. Beim Umschalten wird nur diese Karte ersetzt (schnell, Fokus bleibt).
function buildAttendanceCard(cls, s) {
    const rec = currentSessionRecords[s.id];
    const status = sanitizeStatus(rec.status);
    const st = CARD_STYLE[status];
    const card = document.createElement('div');
    card.className = `attendance-card p-3 rounded-xl border-2 select-none ${st.card}`;
    const topRow = document.createElement('button');
    topRow.type = 'button';
    topRow.className = 'flex items-center gap-3 cursor-pointer w-full text-left';
    topRow.setAttribute('aria-label', `${s.name}: ${STATUS_LABELS[status]} — klicken zum Umschalten (anwesend → abwesend → verletzt)`);
    topRow.addEventListener('click', () => {
        rec.status = NEXT_STATUS[status];
        markAttendanceDirty();
        const next = buildAttendanceCard(cls, s);
        card.replaceWith(next);
        next.querySelector('button').focus();
        updateAttendanceCounts(cls);
    });
    const checkbox = document.createElement('div');
    checkbox.className = `w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 ${st.box}`;
    checkbox.innerHTML = `<i class="fas ${st.icon} text-white text-xs" aria-hidden="true"></i>`;
    const nameSpan = document.createElement('span'); nameSpan.className = 'font-medium text-sm flex-1 truncate'; nameSpan.textContent = s.name;
    topRow.append(checkbox, genderIconEl(s.gender), nameSpan);
    if (status === 'injured') {
        const injuredTag = document.createElement('span');
        injuredTag.className = 'text-xs bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full flex-shrink-0';
        injuredTag.textContent = 'macht nicht mit';
        topRow.appendChild(injuredTag);
    }
    card.appendChild(topRow);
    if (status === 'absent') {
        const reasonRow = document.createElement('div');
        reasonRow.className = 'flex flex-col sm:flex-row gap-1.5 mt-2 pt-2 border-t border-red-200';
        const sel = document.createElement('select');
        sel.className = 'text-xs border border-red-200 rounded-md p-1.5 bg-white focus:outline-none';
        sel.setAttribute('aria-label', `Abwesenheitsgrund für ${s.name}`);
        sel.append(new Option('Grund wählen…', ''), ...REASON_CATEGORIES.map(r => new Option(r, r)));
        sel.value = rec.reasonCategory || '';
        sel.addEventListener('change', () => { rec.reasonCategory = sel.value; markAttendanceDirty(); });
        reasonRow.append(sel, attendanceNoteInput(rec, `Notiz zur Abwesenheit von ${s.name}`, 'Notiz (optional)', 'border-red-200'));
        card.appendChild(reasonRow);
    } else if (status === 'injured') {
        const noteRow = document.createElement('div');
        noteRow.className = 'mt-2 pt-2 border-t border-orange-200';
        noteRow.appendChild(attendanceNoteInput(rec, `Notiz zur Verletzung von ${s.name}`, 'Notiz (optional, z.B. Fuss verstaucht)', 'border-orange-200'));
        card.appendChild(noteRow);
    }
    return card;
}

document.getElementById('save-attendance-btn').addEventListener('click', async () => {
    const cls = findClass(selAttendClassId);
    if (!cls) return;
    const dateStr = $attendanceDate.value || todayStr();
    if (dateStr > todayStr()) {
        const ok = await uiConfirm(`Das Datum ${formatDateDisplay(dateStr)} liegt in der Zukunft. Trotzdem speichern?`, { title: 'Datum prüfen', okLabel: 'Trotzdem speichern' });
        if (!ok) { $attendanceDate.focus(); return; }
    }
    if (!attendanceData[cls.id]) attendanceData[cls.id] = {};
    const records = {};
    Object.keys(currentSessionRecords).forEach(id => { records[id] = { ...currentSessionRecords[id] }; });
    attendanceData[cls.id][dateStr] = { date: dateStr, weekday: getWeekdayIndex(dateStr), records };
    saveAttendanceData();
    attendanceDirty = false; updateDirtyHint();
    const msg = document.getElementById('attendance-saved-msg');
    msg.classList.remove('hidden');
    renderAttendanceSessionsList(cls);
});

function renderAttendanceSessionsList(cls) {
    const list = document.getElementById('attendance-sessions-list');
    list.innerHTML = '';
    const sessions = attendanceData[cls.id] ? Object.values(attendanceData[cls.id]).sort((a, b) => b.date.localeCompare(a.date)) : [];
    if (sessions.length === 0) {
        const li = document.createElement('li');
        li.className = 'text-gray-400 text-xs py-2';
        li.textContent = 'Noch keine Termine für diese Klasse gespeichert.';
        list.appendChild(li);
        return;
    }
    sessions.forEach(session => {
        // Verletzte gelten als anwesend (sie sind vor Ort, machen nur nicht mit).
        const presentN = Object.values(session.records).filter(r => r.status !== 'absent').length;
        const totalN = Object.values(session.records).length;
        const li = document.createElement('li');
        li.className = 'flex items-center justify-between bg-white border border-gray-100 rounded-lg px-3 py-2 shadow-sm';
        const left = document.createElement('button');
        left.className = 'flex items-center gap-2 text-left hover:text-indigo-600 transition-colors';
        left.setAttribute('aria-label', `Termin vom ${formatDateDisplay(session.date)} öffnen`);
        [[ 'font-medium', formatDateDisplay(session.date) ],
         [ 'text-xs text-gray-400', WEEKDAYS[session.weekday] || '' ],
         [ 'text-xs bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded-full', `Sem. ${getSemester(session.date)}` ],
         [ 'text-xs text-gray-400', `· ${presentN}/${totalN} anwesend` ]].forEach(([cls2, txt]) => {
            const sp = document.createElement('span'); sp.className = cls2; sp.textContent = txt; left.appendChild(sp);
        });
        left.addEventListener('click', async () => {
            if (!(await confirmDiscardAttendance())) return;
            $attendanceDate.value = session.date;
            loadAttendanceSession();
        });
        const delBtn = document.createElement('button');
        delBtn.className = 'text-gray-300 hover:text-red-500 text-xs p-1';
        delBtn.innerHTML = '<i class="fas fa-trash-alt" aria-hidden="true"></i>';
        delBtn.setAttribute('aria-label', `Termin vom ${formatDateDisplay(session.date)} löschen`);
        delBtn.addEventListener('click', () => {
            withUndo(`Termin vom ${formatDateDisplay(session.date)} gelöscht.`, () => {
                delete attendanceData[cls.id][session.date];
                saveAttendanceData();
                if ($attendanceDate.value === session.date) loadAttendanceSession();
                else renderAttendanceSessionsList(cls);
            });
        });
        li.appendChild(left); li.appendChild(delBtn);
        list.appendChild(li);
    });
}

// TERMIN-IMPORT (CSV aus Excel): vergangene Anwesenheitschecks in die gewählte Klasse übernehmen.
document.getElementById('attendance-import-help-btn').addEventListener('click', () => document.getElementById('attendance-import-help').classList.toggle('hidden'));
const $attendanceImportInput = document.getElementById('attendance-import-input');
document.getElementById('attendance-import-btn').addEventListener('click', async () => {
    if (selAttendClassId === null) { await uiAlert('Bitte zuerst oben eine Klasse auswählen — die Termine werden in diese Klasse importiert.', 'Termin-Import'); return; }
    $attendanceImportInput.click();
});
$attendanceImportInput.addEventListener('change', () => {
    const file = $attendanceImportInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
        $attendanceImportInput.value = '';
        const cls = findClass(selAttendClassId);
        if (!cls) return;
        const { rows, invalid } = parseAttendanceCsv(String(reader.result));
        if (rows.length === 0) {
            await uiAlert('Keine gültigen Zeilen gefunden. Erwartetes Format: "Datum;Name;Status;Grund;Notiz" — siehe Fragezeichen-Hilfe neben dem Import-Knopf.', 'Termin-Import');
            return;
        }
        // Namen der Klasse (inkl. ehemaliger Schüler) case-insensitiv nachschlagen.
        const byName = new Map();
        cls.students.concat(cls.formerStudents || []).forEach(s => byName.set(s.name.trim().toLowerCase(), s));
        let importedRecords = 0;
        const dates = new Set(), unknown = new Set();
        if (!attendanceData[cls.id]) attendanceData[cls.id] = {};
        rows.forEach(row => {
            const student = byName.get(row.name.trim().toLowerCase());
            if (!student) { unknown.add(row.name); return; }
            if (!attendanceData[cls.id][row.date]) {
                attendanceData[cls.id][row.date] = { date: row.date, weekday: getWeekdayIndex(row.date), records: {} };
            }
            attendanceData[cls.id][row.date].records[student.id] = {
                status: row.status,
                reasonCategory: row.status === 'absent' ? row.reasonCategory : '',
                note: row.status === 'present' ? '' : row.note
            };
            importedRecords++;
            dates.add(row.date);
        });
        saveAttendanceData();
        // Falls der gerade angezeigte Termin betroffen ist und keine ungespeicherten
        // Änderungen offen sind, die Ansicht mit den importierten Daten auffrischen.
        if (!attendanceDirty && dates.has($attendanceDate.value)) loadAttendanceSession();
        else renderAttendanceSessionsList(cls);
        let msg = `${importedRecords} Einträge an ${dates.size} Termin(en) in "${cls.name}" importiert.`;
        if (unknown.size > 0) msg += `\n\nNicht zugeordnet (Name nicht in der Klasse): ${[...unknown].join(', ')}`;
        if (invalid.length > 0) msg += `\n\n${invalid.length} Zeile(n) übersprungen (ungültiges Datum/Status).`;
        await uiAlert(msg, 'Termin-Import');
    };
    reader.readAsText(file);
});

// Übernimmt eine Schülerliste in den Teams-Tab (ersetzt die Teilnehmerliste nach Rückfrage).
async function loadPersonsIntoTeams(list, bannerText) {
    if (personsManual && persons.length > 0) {
        const ok = await uiConfirm(`Die aktuelle Teilnehmerliste (${persons.length} manuell erfasste Person(en)) wird ersetzt. Fortfahren?`, { okLabel: 'Ersetzen' });
        if (!ok) return;
    }
    const names = uniqueDisplayNames(list.map(s => ({ name: s.name, group: s.group })));
    persons = list.map((s, i) => ({ id: personIdCounter++, name: names[i], gender: sanitizeGender(s.gender), sporty: s.sporty === true, hobbies: sanitizeHobbies(s.hobbies) }));
    personsManual = false;
    savePersons();
    document.getElementById('source-banner-text').textContent = bannerText;
    // Sind sportliche Schüler(innen) dabei, die Verteilung gleich darauf einstellen — sonst bleibt
    // die Auswahl auf "Kein Sport" und die Sportlichkeit wird bei der Gruppenbildung ignoriert.
    const hasSporty = persons.some(p => p.sporty === true);
    switchTab('teams');
    const activitySel = document.getElementById('activity-select');
    if (hasSporty && activitySel.value === 'none') {
        activitySel.value = 'general';
        document.getElementById('source-banner-text').textContent += ' Sportlichkeit wird fair verteilt (Auswahl "Wofür sind die Gruppen?" anpassbar).';
    }
    document.getElementById('source-banner').classList.remove('hidden');
    document.getElementById('results-section').classList.add('hidden');
}

document.getElementById('load-to-teams-btn').addEventListener('click', async () => {
    const cls = findClass(selAttendClassId);
    if (!cls) return;
    // Nur aktiv Mitmachende übernehmen — Verletzte sind zwar anwesend, spielen aber nicht mit.
    const present = cls.students.filter(s => currentSessionRecords[s.id] && currentSessionRecords[s.id].status === 'present');
    const injuredN = cls.students.filter(s => currentSessionRecords[s.id] && currentSessionRecords[s.id].status === 'injured').length;
    if (present.length === 0) { await uiAlert('Keine Schüler(innen) als anwesend (mitmachend) markiert.'); return; }
    await loadPersonsIntoTeams(present, `Geladen aus "${cls.name}": ${present.length} von ${cls.students.length} Schüler(innen) anwesend.`
        + (injuredN > 0 ? ` ${injuredN} verletzte Schüler(innen) wurden nicht übernommen.` : ''));
});

// TAB: AUSWERTUNG
function enterStatsTab() {
    const sel = document.getElementById('stats-class-select');
    fillClassSelect(sel, classes, preferredIn(classes, parseInt(sel.value, 10)));
    renderStats();
}

document.getElementById('stats-class-select').addEventListener('change', e => { preferClass(parseInt(e.target.value, 10)); renderStats(); });
document.getElementById('stats-semester-select').addEventListener('change', renderStats);
document.getElementById('stats-classtag-select').addEventListener('change', renderStats);

document.querySelectorAll('#stats-table th[data-sort-key]').forEach(th => {
    th.addEventListener('click', () => {
        const key = th.dataset.sortKey;
        if (statsSort.key === key) statsSort.dir = -statsSort.dir;
        else statsSort = { key, dir: key === 'name' ? 1 : -1 };
        renderStats();
    });
});

function buildStatsRows(cls, sessions) {
    const rowFor = (s, former) => {
        let present = 0, absent = 0, injured = 0;
        const reasonCounts = {};
        const absences = [];
        sessions.forEach(session => {
            const rec = session.records[s.id];
            if (!rec) return;
            if (rec.status === 'present') present++;
            else if (rec.status === 'injured') {
                // Verletzt = anwesend für die Quote, aber separat ausgewiesen (inkl. Details).
                present++; injured++;
                reasonCounts['Verletzt (anwesend)'] = (reasonCounts['Verletzt (anwesend)'] || 0) + 1;
                absences.push({ date: session.date, reasonCategory: 'Verletzt (anwesend)', note: rec.note || '', injured: true });
            } else {
                absent++;
                const key = rec.reasonCategory || 'Ohne Angabe';
                reasonCounts[key] = (reasonCounts[key] || 0) + 1;
                absences.push({ date: session.date, reasonCategory: rec.reasonCategory || '', note: rec.note || '' });
            }
        });
        const total = present + absent;
        const quote = total > 0 ? Math.round((present / total) * 100) : null;
        return { student: s, former, present, absent, injured, recorded: total, quote, reasonCounts, absences };
    };
    const rows = cls.students.map(s => rowFor(s, false));
    // Ehemalige Schüler(innen) mit erfasster Historie bleiben in der Auswertung sichtbar.
    (cls.formerStudents || []).forEach(s => {
        const row = rowFor(s, true);
        if (row.recorded > 0) rows.push(row);
    });
    return rows;
}

function sortStatsRows(rows) {
    const dir = statsSort.dir;
    const key = statsSort.key;
    return rows.slice().sort((a, b) => {
        if (key === 'name') return dir * a.student.name.localeCompare(b.student.name, 'de');
        if (key === 'classTag') {
            const cmp = (a.student.classTag || '').localeCompare(b.student.classTag || '', 'de');
            if (cmp !== 0) return dir * cmp;
            return a.student.name.localeCompare(b.student.name, 'de');
        }
        const av = a[key] === null ? -1 : a[key];
        const bv = b[key] === null ? -1 : b[key];
        if (av !== bv) return dir * (av - bv);
        return a.student.name.localeCompare(b.student.name, 'de');
    });
}

// Kürzel-Dropdown mit den in der Klasse vorkommenden Klassenkürzeln füllen;
// ausblenden, wenn die Klasse keine Kürzel nutzt.
function refreshStatsClassTagSelect(cls) {
    const wrap = document.getElementById('stats-classtag-wrap');
    const sel = document.getElementById('stats-classtag-select');
    const prev = sel.value;
    const tags = cls
        ? [...new Set(cls.students.concat(cls.formerStudents || []).map(s => s.classTag || '').filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'))
        : [];
    sel.innerHTML = '<option value="all">Alle Klassen</option>';
    tags.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t; opt.textContent = t;
        sel.appendChild(opt);
    });
    const hasUntagged = cls && cls.students.concat(cls.formerStudents || []).some(s => !s.classTag);
    if (tags.length && hasUntagged) {
        const opt = document.createElement('option');
        opt.value = '__none__'; opt.textContent = 'Ohne Kürzel';
        sel.appendChild(opt);
    }
    if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
    wrap.classList.toggle('hidden', tags.length === 0);
    return sel.value;
}

function renderStats() {
    const id = parseInt(document.getElementById('stats-class-select').value, 10);
    const semesterFilter = document.getElementById('stats-semester-select').value; // 'all' | '1' | '2'
    const emptyEl = document.getElementById('stats-empty');
    const contentEl = document.getElementById('stats-content');
    const exportBtn = document.getElementById('export-stats-btn');
    const cls = classes.find(c => c.id === id);
    const tagFilter = refreshStatsClassTagSelect(cls); // 'all' | '__none__' | Kürzel
    let sessions = cls && attendanceData[cls.id] ? Object.values(attendanceData[cls.id]).sort((a, b) => a.date.localeCompare(b.date)) : [];
    if (semesterFilter !== 'all') sessions = sessions.filter(session => getSemester(session.date) === parseInt(semesterFilter, 10));
    if (!cls || sessions.length === 0) {
        emptyEl.classList.remove('hidden'); contentEl.classList.add('hidden'); exportBtn.classList.add('hidden');
        return;
    }
    emptyEl.classList.add('hidden'); contentEl.classList.remove('hidden'); exportBtn.classList.remove('hidden');
    document.getElementById('stats-session-count').textContent = sessions.length;

    let statsRows = sortStatsRows(buildStatsRows(cls, sessions));
    if (tagFilter === '__none__') statsRows = statsRows.filter(r => !(r.student.classTag || ''));
    else if (tagFilter !== 'all') statsRows = statsRows.filter(r => (r.student.classTag || '') === tagFilter);

    document.querySelectorAll('#stats-table th[data-sort-key]').forEach(th => {
        const active = th.dataset.sortKey === statsSort.key;
        th.setAttribute('aria-sort', active ? (statsSort.dir === 1 ? 'ascending' : 'descending') : 'none');
        th.querySelector('.sort-arrow').textContent = active ? (statsSort.dir === 1 ? '▲' : '▼') : '';
    });

    const tbody = document.getElementById('stats-table-body');
    tbody.innerHTML = '';
    statsRows.forEach(row => {
        const tr = document.createElement('tr');
        tr.className = 'border-t border-gray-100';
        const nameTd = nameCell(row.student, row.former, 'px-3 py-2');
        const tagTd = document.createElement('td');
        tagTd.className = 'px-3 py-2 text-xs text-sky-700';
        tagTd.textContent = row.student.classTag || '–';
        const presentTd = document.createElement('td'); presentTd.className = 'text-center px-3 py-2 text-green-700'; presentTd.textContent = row.present;
        if (row.injured > 0) {
            presentTd.title = `davon ${row.injured}× verletzt anwesend (nicht mitgemacht)`;
            const injSpan = document.createElement('span');
            injSpan.className = 'text-orange-500 text-xs ml-1';
            injSpan.textContent = `(${row.injured})`;
            injSpan.setAttribute('aria-label', `davon ${row.injured} mal verletzt anwesend`);
            presentTd.appendChild(injSpan);
        }
        const absentTd = document.createElement('td'); absentTd.className = 'text-center px-3 py-2 text-red-600'; absentTd.textContent = row.absent;
        const recordedTd = document.createElement('td');
        recordedTd.className = 'text-center px-3 py-2 text-gray-500 text-xs';
        recordedTd.textContent = `${row.recorded}/${sessions.length}`;
        recordedTd.title = `An ${row.recorded} von ${sessions.length} Terminen erfasst`;
        const quoteTd = document.createElement('td');
        quoteTd.className = 'text-center px-3 py-2';
        if (row.quote !== null) {
            const chip = document.createElement('span');
            chip.className = `quote-chip ${row.quote < 80 ? 'quote-low' : row.quote < 95 ? 'quote-mid' : 'quote-high'}`;
            chip.textContent = `${row.quote}%`;
            quoteTd.appendChild(chip);
        } else { quoteTd.textContent = '–'; }
        const reasonsTd = document.createElement('td');
        reasonsTd.className = 'px-3 py-2 text-xs text-gray-500';
        const reasonEntries = Object.entries(row.reasonCounts);
        reasonsTd.textContent = reasonEntries.length ? reasonEntries.map(([k, v]) => `${k}: ${v}`).join(', ') : '–';
        tr.appendChild(nameTd); tr.appendChild(tagTd); tr.appendChild(presentTd); tr.appendChild(absentTd); tr.appendChild(recordedTd); tr.appendChild(quoteTd); tr.appendChild(reasonsTd);
        tbody.appendChild(tr);

        if (row.absences.length > 0) {
            tr.className += ' cursor-pointer hover:bg-gray-50';
            tr.title = 'Klicken für Details (Abwesenheiten/Verletzungen)';
            const detailTr = document.createElement('tr');
            detailTr.className = 'hidden bg-gray-50 border-t border-gray-100';
            const detailTd = document.createElement('td');
            detailTd.colSpan = 7;
            detailTd.className = 'px-3 py-2';
            const ul = document.createElement('ul');
            ul.className = 'text-xs text-gray-600 space-y-1';
            row.absences.forEach(a => {
                const li = document.createElement('li');
                li.className = 'flex items-center gap-2';
                const dateSpan = document.createElement('span');
                dateSpan.className = 'font-medium text-gray-700 w-20 flex-shrink-0';
                dateSpan.textContent = formatDateDisplay(a.date);
                const catSpan = document.createElement('span');
                catSpan.className = `px-1.5 py-0.5 rounded flex-shrink-0 ${a.injured ? 'bg-orange-50 text-orange-700' : 'bg-red-50 text-red-700'}`;
                catSpan.textContent = a.reasonCategory || 'Ohne Angabe';
                li.appendChild(dateSpan); li.appendChild(catSpan);
                if (a.note) {
                    const noteSpan = document.createElement('span');
                    noteSpan.className = 'text-gray-400 truncate';
                    noteSpan.textContent = a.note;
                    li.appendChild(noteSpan);
                }
                ul.appendChild(li);
            });
            detailTd.appendChild(ul);
            detailTr.appendChild(detailTd);
            tbody.appendChild(detailTr);
            tr.addEventListener('click', () => detailTr.classList.toggle('hidden'));
        }
    });

    // Zusammenfassung (Ø-Zeile)
    const withQuote = statsRows.filter(r => r.quote !== null);
    const avgQuote = withQuote.length ? Math.round(withQuote.reduce((sum, r) => sum + r.quote, 0) / withQuote.length) : null;
    const totalPresent = statsRows.reduce((sum, r) => sum + r.present, 0);
    const totalAbsent = statsRows.reduce((sum, r) => sum + r.absent, 0);
    document.getElementById('stats-total-present').textContent = totalPresent;
    document.getElementById('stats-total-absent').textContent = totalAbsent;
    document.getElementById('stats-avg-quote').textContent = avgQuote === null ? '–' : `${avgQuote}%`;

    exportBtn.onclick = () => exportStatsCsv(cls, statsRows, sessions.length, semesterFilter, tagFilter);
}

function exportStatsCsv(cls, statsRows, sessionCount, semesterFilter, tagFilter) {
    const lines = [['Name', 'Klasse', 'Status', 'Anwesend', 'Abwesend', 'Erfasst (von ' + sessionCount + ')', 'Quote (%)', 'Gründe', 'Abwesenheits-Details'].map(escapeCsv).join(';')];
    statsRows.forEach(row => {
        const reasons = Object.entries(row.reasonCounts).map(([k, v]) => `${k}: ${v}`).join(', ');
        const details = (row.absences || []).map(a => `${formatDateDisplay(a.date)} ${a.reasonCategory || 'Ohne Angabe'}${a.note ? ` (${a.note})` : ''}`).join(' | ');
        lines.push([row.student.name, row.student.classTag || '', row.former ? 'ehemalig' : 'aktiv', row.present, row.absent, row.recorded, row.quote === null ? '' : row.quote, reasons, details].map(escapeCsv).join(';'));
    });
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv' });
    const semesterSuffix = semesterFilter === '1' ? '-Semester1' : semesterFilter === '2' ? '-Semester2' : '';
    const tagSuffix = tagFilter && tagFilter !== 'all' ? `-${tagFilter === '__none__' ? 'OhneKuerzel' : safeFilePart(tagFilter)}` : '';
    downloadBlob(blob, `anwesenheit-${safeFilePart(cls.name)}${semesterSuffix}${tagSuffix}-${todayStr()}.csv`);
}

// TAB: PRÜFUNGEN / LERNZIELKONTROLLEN
const $examsSelect = document.getElementById('exams-class-select');

function showExamsContent(on) {
    document.getElementById('exams-empty').classList.toggle('hidden', on);
    document.getElementById('exams-content').classList.toggle('hidden', !on);
    document.getElementById('create-exam-btn').classList.toggle('hidden', !on);
    if (!on) document.getElementById('new-exam-form').classList.add('hidden');
}
// Beim Betreten: Auswahl prüfen (Klasse gelöscht?) und Tabelle mit aktueller Schülerliste zeichnen.
function enterExamsTab() {
    if (!examDirty) {
        const pref = preferredIn(classes, selExamClassId);
        if (pref !== selExamClassId) { selExamClassId = pref; selExamId = null; }
    }
    selExamClassId = fillClassSelect($examsSelect, classes, selExamClassId);
    showExamsContent(selExamClassId !== null);
    if (selExamClassId === null) { selExamId = null; examDirty = false; updateExamDirtyHint(); return; }
    if (!getSelectedExam()) { selExamId = null; examDirty = false; updateExamDirtyHint(); }
    renderExamList();
    if (!examDirty) renderExamDetail();
}

async function confirmDiscardExam() {
    if (!examDirty) return true;
    const ok = await uiConfirm('Es gibt ungespeicherte Prüfungs-Eingaben. Ohne Speichern fortfahren?', { okLabel: 'Verwerfen', danger: true });
    if (ok) { examDirty = false; updateExamDirtyHint(); }
    return ok;
}
function updateExamDirtyHint() {
    document.getElementById('exam-unsaved-hint').classList.toggle('hidden', !examDirty);
}

$examsSelect.addEventListener('change', async function() {
    if (!(await confirmDiscardExam())) { this.value = selExamClassId === null ? '' : String(selExamClassId); return; }
    const id = parseInt(this.value, 10);
    selExamClassId = isNaN(id) ? null : id; selExamId = null;
    preferClass(selExamClassId);
    showExamsContent(selExamClassId !== null);
    if (selExamClassId === null) return;
    renderExamList();
    renderExamDetail();
});

document.getElementById('create-exam-btn').addEventListener('click', () => {
    const form = document.getElementById('new-exam-form');
    form.classList.toggle('hidden');
    if (!form.classList.contains('hidden')) {
        document.getElementById('exam-title-input').value = '';
        document.getElementById('exam-date-input').value = todayStr();
        document.getElementById('exam-form-error').classList.add('hidden');
        document.getElementById('exam-title-input').focus();
    }
});
document.getElementById('cancel-exam-btn').addEventListener('click', () => document.getElementById('new-exam-form').classList.add('hidden'));
document.querySelectorAll('input[name="exam-mode"]').forEach(radio => radio.addEventListener('change', () => {
    document.getElementById('exam-maxpoints-wrap').classList.toggle('hidden', radio.value !== 'points' || !radio.checked);
}));

document.getElementById('save-exam-btn').addEventListener('click', async () => {
    const cls = findClass(selExamClassId);
    if (!cls) return;
    const errEl = document.getElementById('exam-form-error');
    const title = document.getElementById('exam-title-input').value.trim();
    const date = document.getElementById('exam-date-input').value;
    const mode = document.querySelector('input[name="exam-mode"]:checked').value;
    const maxPoints = parseFloat(document.getElementById('exam-maxpoints-input').value);
    if (!title) { errEl.textContent = 'Bitte einen Titel angeben.'; errEl.classList.remove('hidden'); return; }
    if (!date) { errEl.textContent = 'Bitte ein Datum angeben.'; errEl.classList.remove('hidden'); return; }
    if (mode === 'points' && (!isFinite(maxPoints) || maxPoints <= 0)) { errEl.textContent = 'Bitte eine gültige Maximalpunktzahl angeben.'; errEl.classList.remove('hidden'); return; }
    if (!(await confirmDiscardExam())) return;
    if (!exams[cls.id]) exams[cls.id] = [];
    const exam = { id: examIdCounter++, title, date, mode, maxPoints: mode === 'points' ? maxPoints : null, results: {} };
    exams[cls.id].push(exam);
    saveExams();
    document.getElementById('new-exam-form').classList.add('hidden');
    selExamId = exam.id;
    renderExamList();
    renderExamDetail();
});

function renderExamList() {
    const cls = findClass(selExamClassId);
    const list = document.getElementById('exam-list');
    list.innerHTML = '';
    const examList = (cls && exams[cls.id] ? exams[cls.id] : []).slice().sort((a, b) => b.date.localeCompare(a.date));
    if (examList.length === 0) {
        const li = document.createElement('li');
        li.className = 'text-gray-400 text-xs py-2';
        li.textContent = 'Noch keine Prüfungen erfasst.';
        list.appendChild(li);
        return;
    }
    examList.forEach(exam => {
        const li = document.createElement('li');
        const isActive = exam.id === selExamId;
        li.className = `rounded-lg border-2 transition-all ${isActive ? 'bg-indigo-600 border-indigo-600 text-white shadow-md' : 'bg-white border-gray-200 text-gray-700 hover:border-indigo-300 hover:bg-indigo-50'}`;
        const btn = document.createElement('button');
        btn.className = 'w-full text-left px-3 py-2';
        const titleSpan = document.createElement('div');
        titleSpan.className = 'font-medium text-sm truncate';
        titleSpan.textContent = exam.title;
        const metaSpan = document.createElement('div');
        metaSpan.className = `text-xs ${isActive ? 'text-indigo-200' : 'text-gray-400'}`;
        const gradedCount = Object.keys(exam.results).length;
        metaSpan.textContent = `${formatDateDisplay(exam.date)} · ${gradedCount} bewertet`;
        btn.appendChild(titleSpan); btn.appendChild(metaSpan);
        btn.addEventListener('click', async () => {
            if (exam.id === selExamId) return;
            if (!(await confirmDiscardExam())) return;
            selExamId = exam.id;
            renderExamList(); renderExamDetail();
        });
        li.appendChild(btn);
        list.appendChild(li);
    });
}

function getSelectedExam() {
    const list = exams[selExamClassId];
    return list ? list.find(e => e.id === selExamId) : null;
}

// Zeilen der Ergebnistabelle: aktuelle Schüler(innen) plus Ehemalige mit erfasstem Resultat.
function examRowStudents(cls, exam) {
    const rows = cls.students.slice();
    (cls.formerStudents || []).forEach(s => {
        if (exam.results[s.id] !== undefined) rows.push({ ...s, former: true });
    });
    return rows;
}

function examGradeOf(exam, value) {
    if (typeof value !== 'number' || !isFinite(value)) return null;
    return exam.mode === 'points' ? pointsToGrade(value, exam.maxPoints) : Math.round(value * 10) / 10;
}
function gradeColorClass(grade) {
    return grade === null ? 'text-gray-300' : grade < 4 ? 'text-red-600' : 'text-green-700';
}

function renderExamDetail() {
    const cls = findClass(selExamClassId);
    const exam = getSelectedExam();
    const emptyEl = document.getElementById('exam-detail-empty');
    const detailEl = document.getElementById('exam-detail');
    if (!cls || !exam) { detailEl.classList.add('hidden'); emptyEl.classList.remove('hidden'); return; }
    emptyEl.classList.add('hidden'); detailEl.classList.remove('hidden');
    document.getElementById('exam-detail-title').textContent = exam.title;
    document.getElementById('exam-detail-meta').textContent =
        `${formatDateDisplay(exam.date)} · ${exam.mode === 'points' ? `Punkte (max. ${exam.maxPoints})` : 'Noten direkt'}`;
    document.getElementById('exam-input-col-header').textContent = exam.mode === 'points' ? 'Punkte' : 'Note';
    examDirty = false; updateExamDirtyHint();

    const tbody = document.getElementById('exam-results-body');
    tbody.innerHTML = '';
    examRowStudents(cls, exam).forEach(s => {
        const tr = document.createElement('tr');
        tr.className = 'border-t border-gray-100';
        const nameTd = nameCell(s, s.former, 'px-3 py-1.5');
        const tagTd = document.createElement('td');
        tagTd.className = 'px-3 py-1.5 text-xs text-sky-700';
        tagTd.textContent = s.classTag || '–';
        const inputTd = document.createElement('td');
        inputTd.className = 'text-center px-3 py-1.5';
        const input = document.createElement('input');
        input.type = 'number';
        input.step = exam.mode === 'points' ? '0.5' : '0.1';
        input.min = exam.mode === 'points' ? '0' : '1';
        if (exam.mode === 'points') input.max = String(exam.maxPoints);
        else input.max = '6';
        input.className = 'w-20 border rounded-md p-1.5 text-sm text-center focus:border-indigo-500 focus:outline-none exam-result-input';
        input.dataset.studentId = String(s.id);
        input.setAttribute('aria-label', `${exam.mode === 'points' ? 'Punkte' : 'Note'} für ${s.name}`);
        if (exam.results[s.id] !== undefined) input.value = String(exam.results[s.id]);
        const gradeTd = document.createElement('td');
        gradeTd.className = 'text-center px-3 py-1.5 font-semibold exam-grade-cell';
        const updateGradeCell = () => {
            const v = input.value === '' ? null : parseFloat(input.value);
            const grade = v === null || !isFinite(v) ? null : examGradeOf(exam, v);
            gradeTd.textContent = grade === null ? '–' : grade.toFixed(1);
            gradeTd.className = `text-center px-3 py-1.5 font-semibold exam-grade-cell ${gradeColorClass(grade)}`;
        };
        input.addEventListener('input', () => { examDirty = true; updateExamDirtyHint(); updateGradeCell(); input.classList.remove('input-invalid'); input.removeAttribute('aria-invalid'); });
        updateGradeCell();
        inputTd.appendChild(input);
        tr.appendChild(nameTd); tr.appendChild(tagTd); tr.appendChild(inputTd); tr.appendChild(gradeTd);
        tbody.appendChild(tr);
    });
    renderExamStats(cls, exam);
}

document.getElementById('save-exam-results-btn').addEventListener('click', async () => {
    const cls = findClass(selExamClassId);
    const exam = getSelectedExam();
    if (!cls || !exam) return;
    const invalid = [];
    const newResults = {};
    // Ehemalige ohne Eingabefeld behalten ihr Ergebnis; ungültige Eingaben überschreiben nie einen gespeicherten Wert.
    const max = exam.mode === 'points' ? exam.maxPoints : 6;
    const min = exam.mode === 'points' ? 0 : 1;
    document.querySelectorAll('#exam-results-body .exam-result-input').forEach(input => {
        const id = input.dataset.studentId;
        const v = parseFloat(input.value);
        const bad = input.value !== '' && (!isFinite(v) || v < min || v > max);
        input.classList.toggle('input-invalid', bad);
        input.setAttribute('aria-invalid', String(bad));
        if (bad) { invalid.push(input); if (exam.results[id] !== undefined) newResults[id] = exam.results[id]; return; }
        if (input.value !== '') newResults[id] = v;
    });
    exam.results = newResults;
    saveExams();
    examDirty = invalid.length > 0; updateExamDirtyHint();
    if (invalid.length) {
        await uiAlert(`${invalid.length} Eingabe(n) sind ungültig (erlaubt: ${exam.mode === 'points' ? `0 bis ${exam.maxPoints} Punkte` : 'Note 1 bis 6'}) und rot markiert. Dort gilt weiterhin der bisher gespeicherte Wert, alle anderen Eingaben sind gespeichert.`, 'Prüfung');
        invalid[0].focus();
    }
    renderExamList();
    renderExamStats(cls, exam);
    showToast('Prüfungsergebnisse gespeichert.');
});

// Auswertung: Ø-Note gesamt und — wenn die Gruppe Klassenkürzel nutzt — separat pro Klasse.
function renderExamStats(cls, exam) {
    const container = document.getElementById('exam-stats-rows');
    container.innerHTML = '';
    const rows = examRowStudents(cls, exam)
        .map(s => ({ student: s, grade: exam.results[s.id] !== undefined ? examGradeOf(exam, exam.results[s.id]) : null }))
        .filter(r => r.grade !== null);
    const addStatRow = (label, group) => {
        const div = document.createElement('div');
        div.className = 'flex items-center justify-between gap-2 flex-wrap';
        const labelSpan = document.createElement('span');
        labelSpan.className = 'text-xs font-medium text-indigo-900';
        labelSpan.textContent = label;
        const valSpan = document.createElement('span');
        valSpan.className = 'text-xs text-indigo-800';
        if (group.length === 0) { valSpan.textContent = 'keine Ergebnisse'; }
        else {
            const avg = group.reduce((sum, r) => sum + r.grade, 0) / group.length;
            const insufficient = group.filter(r => r.grade < 4).length;
            const min = Math.min(...group.map(r => r.grade));
            const max = Math.max(...group.map(r => r.grade));
            valSpan.textContent = `${group.length} bewertet · Ø ${avg.toFixed(2)} · min ${min.toFixed(1)} / max ${max.toFixed(1)}${insufficient ? ` · ${insufficient} ungenügend` : ''}`;
        }
        div.appendChild(labelSpan); div.appendChild(valSpan);
        container.appendChild(div);
    };
    addStatRow('Gesamt', rows);
    const tags = [...new Set(rows.map(r => r.student.classTag || '').filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
    if (tags.length) {
        tags.forEach(tag => addStatRow(`Klasse ${tag}`, rows.filter(r => (r.student.classTag || '') === tag)));
        const untagged = rows.filter(r => !(r.student.classTag || ''));
        if (untagged.length) addStatRow('Ohne Kürzel', untagged);
    }
}

document.getElementById('delete-exam-btn').addEventListener('click', async () => {
    const cls = findClass(selExamClassId);
    const exam = getSelectedExam();
    if (!cls || !exam) return;
    const ok = await uiConfirm(`Prüfung "${exam.title}" vom ${formatDateDisplay(exam.date)} wirklich löschen?`, { okLabel: 'Löschen', danger: true });
    if (!ok) return;
    exams[cls.id] = exams[cls.id].filter(e => e.id !== exam.id);
    if (exams[cls.id].length === 0) delete exams[cls.id];
    saveExams();
    selExamId = null; examDirty = false; updateExamDirtyHint();
    renderExamList(); renderExamDetail();
});

// TXT-Export: eine Zeile pro Schüler(in) im Format "Name Wert" — Wert ist im
// Punkte-Modus die Punktzahl, im Noten-Modus die eingegebene Note. Mischt die
// Gruppe mehrere Klassenkürzel, wird pro Kürzel eine eigene Datei erzeugt.
document.getElementById('export-exam-btn').addEventListener('click', async () => {
    const cls = findClass(selExamClassId);
    const exam = getSelectedExam();
    if (!cls || !exam) return;
    const rows = examRowStudents(cls, exam).filter(s => exam.results[s.id] !== undefined);
    if (rows.length === 0) { await uiAlert('Noch keine Ergebnisse erfasst — nichts zu exportieren.', 'Prüfung exportieren'); return; }
    const groups = new Map();
    rows.forEach(s => {
        const tag = s.classTag || '';
        if (!groups.has(tag)) groups.set(tag, []);
        groups.get(tag).push(s);
    });
    const multi = groups.size > 1;
    [...groups.entries()]
        .sort((a, b) => a[0].localeCompare(b[0], 'de'))
        .forEach(([tag, students], i) => {
            const lines = students
                .slice().sort((a, b) => a.name.localeCompare(b.name, 'de'))
                .map(s => `${s.name} ${exam.results[s.id]}`);
            const tagPart = tag ? `-${safeFilePart(tag)}` : (multi ? '-ohne-kuerzel' : '');
            const fname = `pruefung-${safeFilePart(exam.title)}-${exam.date}${tagPart}.txt`;
            // Downloads leicht versetzt anstossen, damit der Browser mehrere Dateien zulässt.
            setTimeout(() => downloadBlob(new Blob([lines.join('\n') + '\n'], { type: 'text/plain' }), fname), i * 300);
        });
    if (multi) showToast(`${groups.size} Textdateien werden heruntergeladen (eine pro Klasse). Der Browser fragt evtl. nach Erlaubnis für mehrere Downloads.`);
});

// TAB: PUNKTE (Klassenpunkte-Tracker fuer Bonusstunden)
const $pointsSelect = document.getElementById('points-class-select');
const $pointsDate = document.getElementById('points-date-input');

function getPointsData(classId) {
    if (!pointsData[classId]) pointsData[classId] = { goals: [], entries: [] };
    if (!Array.isArray(pointsData[classId].goals)) pointsData[classId].goals = [];
    if (!Array.isArray(pointsData[classId].entries)) pointsData[classId].entries = [];
    return pointsData[classId];
}

function enterPointsTab() {
    const pointClasses = classes.filter(c => c.collectsPoints === true);
    selPointsClassId = fillClassSelect($pointsSelect, pointClasses, preferredIn(pointClasses, selPointsClassId));
    const on = selPointsClassId !== null;
    document.getElementById('points-empty').classList.toggle('hidden', on);
    document.getElementById('points-content').classList.toggle('hidden', !on);
    if (!on) return;
    if (!$pointsDate.value) $pointsDate.value = todayStr();
    renderPointsTab();
}
$pointsSelect.addEventListener('change', function() {
    const id = parseInt(this.value, 10);
    selPointsClassId = isNaN(id) ? null : id;
    preferClass(selPointsClassId);
    enterPointsTab();
});

function renderPointsTab() {
    const cls = findClass(selPointsClassId);
    if (!cls) return;
    const pd = getPointsData(cls.id);
    const total = computePointsTotal(pd.entries);
    document.getElementById('points-total').textContent = total;
    const lektionen = pd.entries.filter(e => e.type !== 'reset' && e.type !== 'adjust').length;
    const lastReset = pd.entries.filter(e => e.type === 'reset').slice(-1)[0];
    document.getElementById('points-total-meta').textContent =
        `${lektionen} Lektion(en) erfasst${lastReset ? ` · zuletzt eingelöst am ${formatDateDisplay(lastReset.date)}` : ''}`;
    renderPointsGoalCheckboxes(pd);
    renderPointsGoalsEditor(pd);
    renderPointsEntries(pd);
    renderPointsChart(pd);
    updateLektionSum(pd);
}

function renderPointsGoalCheckboxes(pd) {
    const container = document.getElementById('points-goal-checkboxes');
    container.innerHTML = '';
    if (pd.goals.length === 0) {
        const p = document.createElement('p');
        p.className = 'text-xs text-gray-400';
        p.textContent = 'Keine Ziele definiert — unten unter "Ziele & Punktwerte bearbeiten" hinzufügen.';
        container.appendChild(p);
        return;
    }
    pd.goals.forEach(goal => {
        const label = document.createElement('label');
        label.className = 'flex items-center gap-2 text-sm cursor-pointer bg-white rounded-md border border-gray-200 px-2.5 py-1.5 hover:border-amber-300 transition-colors';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'rounded text-amber-500 h-4 w-4 points-goal-cb';
        cb.dataset.goalId = String(goal.id);
        cb.dataset.points = String(goal.points);
        cb.addEventListener('change', () => updateLektionSum(pd));
        const text = document.createElement('span');
        text.className = 'flex-1 text-gray-700';
        text.textContent = goal.text;
        const badge = document.createElement('span');
        badge.className = 'text-xs font-bold text-amber-600 flex-shrink-0';
        badge.textContent = `+${goal.points}`;
        label.appendChild(cb); label.appendChild(text); label.appendChild(badge);
        container.appendChild(label);
    });
}

function updateLektionSum(pd) {
    let sum = 0;
    document.querySelectorAll('#points-goal-checkboxes .points-goal-cb:checked').forEach(cb => { sum += parseInt(cb.dataset.points, 10) || 0; });
    document.getElementById('points-lektion-sum').textContent = sum;
}

document.getElementById('points-save-lektion-btn').addEventListener('click', async () => {
    const cls = findClass(selPointsClassId);
    if (!cls) return;
    const pd = getPointsData(cls.id);
    const date = $pointsDate.value || todayStr();
    const checked = [...document.querySelectorAll('#points-goal-checkboxes .points-goal-cb:checked')];
    const goalIds = checked.map(cb => parseInt(cb.dataset.goalId, 10));
    const points = checked.reduce((sum, cb) => sum + (parseInt(cb.dataset.points, 10) || 0), 0);
    if (goalIds.length === 0) {
        const ok = await uiConfirm('Kein Ziel angehakt — Lektion mit 0 Punkten speichern?', { okLabel: 'Speichern' });
        if (!ok) return;
    }
    const note = document.getElementById('points-note-input').value.trim().slice(0, 200);
    pd.entries.push({ id: pointsIdCounter++, type: 'lektion', date, goalIds, note, points });
    savePointsData();
    document.getElementById('points-note-input').value = '';
    renderPointsTab();
    showToast(`Lektion gespeichert: +${points} Punkte.`);
});

document.getElementById('points-reset-btn').addEventListener('click', async () => {
    const cls = findClass(selPointsClassId);
    if (!cls) return;
    const pd = getPointsData(cls.id);
    const total = computePointsTotal(pd.entries);
    const ok = await uiConfirm(`Punktestand von ${total} Punkten einlösen und auf 0 zurücksetzen? Der Verlauf bleibt erhalten.`, { title: 'Punkte einlösen', okLabel: 'Einlösen' });
    if (!ok) return;
    pd.entries.push({ id: pointsIdCounter++, type: 'reset', date: todayStr() });
    savePointsData();
    renderPointsTab();
});

// Pauschale Anpassung: Punkte direkt hinzufügen oder abziehen — z.B. Startpunktestand
// beim Umstieg vom alten Excel-Tracker. Der Stand fällt dabei nie unter 0.
document.getElementById('points-adjust-btn').addEventListener('click', async () => {
    const cls = findClass(selPointsClassId);
    if (!cls) return;
    const pd = getPointsData(cls.id);
    const raw = await uiPrompt('Punkte hinzufügen oder abziehen (z.B. 30 für Startpunktestand, -5 für Abzug):', {
        title: 'Punkte anpassen', placeholder: 'z.B. 30 oder -5', okLabel: 'Weiter'
    });
    if (raw === null) return;
    const trimmed = String(raw).trim();
    const amount = /^[+-]?\d+$/.test(trimmed) ? parseInt(trimmed, 10) : NaN;
    if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 9999) {
        await uiAlert('Bitte eine ganze Zahl ungleich 0 eingeben (z.B. 30 oder -5).', 'Punkte anpassen');
        return;
    }
    const note = await uiPrompt('Bemerkung (optional, z.B. "Übertrag aus altem Tracker"):', {
        title: 'Punkte anpassen', placeholder: 'Bemerkung', okLabel: 'Speichern'
    });
    if (note === null) return;
    pd.entries.push({ id: pointsIdCounter++, type: 'adjust', date: todayStr(), note: note.trim().slice(0, 200), points: amount });
    savePointsData();
    renderPointsTab();
    showToast(`Punktestand angepasst: ${amount > 0 ? '+' : ''}${amount} Punkte.`);
});

// PUNKTEVERLAUF-GRAPH — schlichte SVG-Linie (eine Serie, Amber), Tooltip pro Punkt.
// Der Verlauf (Liste rechts) dient zugleich als Tabellen-Ansicht der gleichen Daten.
const CHART_COLOR = '#d97706'; // amber-600, validiert gegen hellen Hintergrund
function svgEl(tag, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, String(v));
    return el;
}
function renderPointsChart(pd) {
    const container = document.getElementById('points-chart');
    container.innerHTML = '';
    const series = computePointsSeries(pd.entries);
    if (series.length < 2) {
        const p = document.createElement('p');
        p.className = 'text-xs text-gray-400 py-4 text-center';
        p.textContent = 'Der Verlauf erscheint, sobald mindestens zwei Einträge erfasst sind.';
        container.appendChild(p);
        return;
    }
    const W = 640, H = 190, padL = 34, padR = 12, padT = 12, padB = 26;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const maxTotal = Math.max(...series.map(s => s.total), 1);
    // Y-Maximum auf runden Wert aufziehen (5er-/10er-Schritte)
    const step = maxTotal <= 10 ? 2 : maxTotal <= 25 ? 5 : maxTotal <= 60 ? 10 : maxTotal <= 120 ? 20 : 50;
    const yMax = Math.ceil(maxTotal / step) * step;
    const x = i => padL + (series.length === 1 ? plotW / 2 : (i / (series.length - 1)) * plotW);
    const y = v => padT + plotH - (v / yMax) * plotH;

    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: 'auto', role: 'img' });
    svg.setAttribute('aria-label', 'Punkteverlauf über die erfassten Einträge');

    // dezente horizontale Gitterlinien + Y-Beschriftung
    for (let v = 0; v <= yMax; v += step) {
        svg.appendChild(svgEl('line', { x1: padL, y1: y(v), x2: W - padR, y2: y(v), stroke: '#e5e7eb', 'stroke-width': 1 }));
        const lbl = svgEl('text', { x: padL - 6, y: y(v) + 3, 'text-anchor': 'end', 'font-size': 10, fill: '#9ca3af' });
        lbl.textContent = String(v);
        svg.appendChild(lbl);
    }
    // X-Beschriftung: erstes/letztes Datum plus wenige Zwischenschritte
    const tickEvery = Math.max(1, Math.ceil(series.length / 6));
    series.forEach((s, i) => {
        if (i !== 0 && i !== series.length - 1 && i % tickEvery !== 0) return;
        const lbl = svgEl('text', { x: x(i), y: H - 8, 'text-anchor': 'middle', 'font-size': 10, fill: '#9ca3af' });
        lbl.textContent = formatDateDisplay(s.date).slice(0, 6); // TT.MM.
        svg.appendChild(lbl);
    });

    // Linie
    const path = series.map((s, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(s.total).toFixed(1)}`).join(' ');
    svg.appendChild(svgEl('path', { d: path, fill: 'none', stroke: CHART_COLOR, 'stroke-width': 2, 'stroke-linejoin': 'round' }));

    // Tooltip (HTML, über dem SVG positioniert)
    const tooltip = document.createElement('div');
    tooltip.className = 'hidden absolute z-10 bg-gray-800 text-white text-xs rounded-md px-2 py-1 pointer-events-none shadow-lg';
    container.appendChild(tooltip);

    // Marker + grosszügige Hover-Flächen
    series.forEach((s, i) => {
        const cx = x(i), cy = y(s.total);
        const isReset = s.type === 'reset';
        svg.appendChild(svgEl('circle', {
            cx, cy, r: 3.5,
            fill: isReset ? '#ffffff' : CHART_COLOR,
            stroke: CHART_COLOR, 'stroke-width': isReset ? 2 : 0
        }));
        const hit = svgEl('circle', { cx, cy, r: 11, fill: 'transparent' });
        hit.style.cursor = 'pointer';
        hit.addEventListener('mouseenter', () => {
            const kind = isReset ? 'Eingelöst — Stand 0' : s.type === 'adjust'
                ? `Anpassung ${s.delta > 0 ? '+' : ''}${s.delta} → ${s.total} Punkte`
                : `+${s.delta} → ${s.total} Punkte`;
            tooltip.textContent = `${formatDateDisplay(s.date)}: ${kind}${s.note ? ` (${s.note})` : ''}`;
            tooltip.classList.remove('hidden');
            const rect = container.getBoundingClientRect();
            const sx = rect.width / W;
            tooltip.style.left = Math.min(Math.max(cx * sx - 40, 0), rect.width - 140) + 'px';
            tooltip.style.top = Math.max(cy * sx - 30, 0) + 'px';
        });
        hit.addEventListener('mouseleave', () => tooltip.classList.add('hidden'));
        svg.appendChild(hit);
    });

    container.appendChild(svg);
}

// Ziele-Editor: Text und Punktwert (1 oder 2) pro Ziel anpassen, Ziele ergaenzen/entfernen.
document.getElementById('points-goals-toggle-btn').addEventListener('click', () => document.getElementById('points-goals-editor').classList.toggle('hidden'));

function renderPointsGoalsEditor(pd) {
    const container = document.getElementById('points-goals-rows');
    container.innerHTML = '';
    pd.goals.forEach(goal => {
        const row = document.createElement('div');
        row.className = 'flex items-center gap-1.5';
        const input = document.createElement('input');
        input.type = 'text'; input.maxLength = 120; input.value = goal.text;
        input.className = 'flex-1 border rounded-md p-1.5 text-xs focus:border-indigo-500 focus:outline-none';
        input.addEventListener('change', () => {
            const t = input.value.trim().slice(0, 120);
            if (!t) { input.value = goal.text; return; }
            goal.text = t; savePointsData(); renderPointsGoalCheckboxes(pd);
        });
        const sel = document.createElement('select');
        sel.className = 'border rounded-md p-1.5 text-xs bg-white';
        sel.innerHTML = '<option value="1">1 Punkt</option><option value="2">2 Punkte</option>';
        sel.value = String(goal.points === 2 ? 2 : 1);
        sel.addEventListener('change', () => {
            goal.points = parseInt(sel.value, 10) === 2 ? 2 : 1;
            savePointsData(); renderPointsGoalCheckboxes(pd); updateLektionSum(pd);
        });
        const rm = document.createElement('button');
        rm.className = 'text-gray-300 hover:text-red-500 px-1';
        rm.innerHTML = '<i class="fas fa-times text-xs" aria-hidden="true"></i>';
        rm.title = 'Ziel entfernen (bereits erfasste Lektionen behalten ihre Punkte)';
        rm.addEventListener('click', () => {
            pd.goals = pd.goals.filter(g => g.id !== goal.id);
            savePointsData(); renderPointsGoalsEditor(pd); renderPointsGoalCheckboxes(pd); updateLektionSum(pd);
        });
        row.appendChild(input); row.appendChild(sel); row.appendChild(rm);
        container.appendChild(row);
    });
}

document.getElementById('points-add-goal-btn').addEventListener('click', () => {
    const cls = findClass(selPointsClassId);
    if (!cls) return;
    const pd = getPointsData(cls.id);
    const input = document.getElementById('points-new-goal-input');
    const text = input.value.trim().slice(0, 120);
    if (!text) return;
    const points = parseInt(document.getElementById('points-new-goal-points').value, 10) === 2 ? 2 : 1;
    pd.goals.push({ id: pointsIdCounter++, text, points });
    savePointsData();
    input.value = '';
    renderPointsGoalsEditor(pd); renderPointsGoalCheckboxes(pd);
});

function renderPointsEntries(pd) {
    const list = document.getElementById('points-entries-list');
    list.innerHTML = '';
    if (pd.entries.length === 0) {
        const li = document.createElement('li');
        li.className = 'text-gray-400 text-xs py-2';
        li.textContent = 'Noch keine Lektionen erfasst.';
        list.appendChild(li);
        return;
    }
    const goalById = new Map(pd.goals.map(g => [g.id, g]));
    pd.entries.slice().reverse().forEach(entry => {
        const li = document.createElement('li');
        if (entry.type === 'reset') {
            li.className = 'flex items-center justify-between bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-amber-800';
            const span = document.createElement('span');
            span.className = 'text-xs font-medium';
            span.textContent = `${formatDateDisplay(entry.date)} — Punkte eingelöst (Stand auf 0 gesetzt)`;
            li.appendChild(span);
        } else {
            const isAdjust = entry.type === 'adjust';
            li.className = `bg-white border rounded-lg px-3 py-2 shadow-sm ${isAdjust ? 'border-amber-200' : 'border-gray-100'}`;
            const top = document.createElement('div');
            top.className = 'flex items-center justify-between gap-2';
            const left = document.createElement('span');
            left.className = 'text-sm';
            const dateB = document.createElement('span'); dateB.className = 'font-medium'; dateB.textContent = formatDateDisplay(entry.date);
            const ptsB = document.createElement('span');
            ptsB.className = `ml-2 text-xs font-bold ${entry.points < 0 ? 'text-red-500' : 'text-amber-600'}`;
            ptsB.textContent = `${entry.points > 0 ? '+' : ''}${entry.points}`;
            left.appendChild(dateB); left.appendChild(ptsB);
            if (isAdjust) {
                const tag = document.createElement('span');
                tag.className = 'ml-2 text-xs bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded-full';
                tag.textContent = 'Anpassung';
                left.appendChild(tag);
            }
            top.appendChild(left);
            const delBtn = document.createElement('button');
            delBtn.className = 'text-gray-300 hover:text-red-500 text-xs p-1';
            delBtn.innerHTML = '<i class="fas fa-trash-alt" aria-hidden="true"></i>';
            delBtn.setAttribute('aria-label', `Lektion vom ${formatDateDisplay(entry.date)} löschen`);
            top.appendChild(delBtn);
            li.appendChild(top);
            const goalsTxt = (entry.goalIds || []).map(gid => (goalById.get(gid) || {}).text).filter(Boolean).join(', ');
            if (goalsTxt || entry.note) {
                const sub = document.createElement('p');
                sub.className = 'text-xs text-gray-400 mt-0.5';
                sub.textContent = [goalsTxt, entry.note].filter(Boolean).join(' — ');
                li.appendChild(sub);
            }
            delBtn.addEventListener('click', async () => {
                const ok = await uiConfirm(`${entry.type === 'adjust' ? 'Anpassung' : 'Lektion'} vom ${formatDateDisplay(entry.date)} (${entry.points > 0 ? '+' : ''}${entry.points} Punkte) löschen?`, { okLabel: 'Löschen', danger: true });
                if (!ok) return;
                pd.entries = pd.entries.filter(e => e.id !== entry.id);
                savePointsData(); renderPointsTab();
            });
        }
        list.appendChild(li);
    });
}

// TAB: SITZORDNUNG
// Raster aus Zellen; Tische werden gesetzt/entfernt ("Tische setzen") oder Personen per Klick getauscht
// ("Plätze tauschen"). Der aktuelle Plan wird pro Klasse automatisch gespeichert, benannte Varianten
// liegen in seatingData[classId].saved.
const $seatingSelect = document.getElementById('seating-class-select');
const $seatingGrid = document.getElementById('seating-grid');

function seatingState(clsId) {
    if (!seatingData[clsId]) seatingData[clsId] = { current: null, saved: [] };
    const sd = seatingData[clsId];
    if (!sd.current) sd.current = { cols: 8, rows: 6, desks: seatingPreset('rows', 8, 6) };
    if (!Array.isArray(sd.saved)) sd.saved = [];
    if (!Array.isArray(sd.layouts)) sd.layouts = [];
    return sd;
}
function seatingPreset(kind, cols, rows) {
    const desks = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        let on = false;
        if (kind === 'rows') on = x % 3 !== 2;
        else if (kind === 'groups') on = x % 3 !== 2 && y % 3 !== 2;
        else if (kind === 'u') on = x === 0 || x === cols - 1 || y === rows - 1;
        if (on) desks.push({ x, y, s: null, l: false });
    }
    return desks;
}
function currentSeatingClass() { return findClass(selSeatingClassId); }

function refreshSeatingSelect() {
    // Sitzordnungen gibt es nur für Klassen mit Unterricht im Klassenzimmer
    const roomClasses = classes.filter(c => classKind(c) !== 'sport');
    const pref = preferredIn(roomClasses, selSeatingClassId);
    if (pref !== selSeatingClassId) seatSel = null;
    selSeatingClassId = fillClassSelect($seatingSelect, roomClasses, pref, withCount);
    renderSeating();
}
$seatingSelect.addEventListener('change', () => {
    const id = parseInt($seatingSelect.value, 10);
    selSeatingClassId = isNaN(id) ? null : id;
    preferClass(selSeatingClassId);
    seatSel = null;
    renderSeating();
});

function setSeatMsg(text) {
    const el = document.getElementById('seating-msg');
    el.textContent = text || ''; el.classList.toggle('hidden', !text);
}
function setSeatMode(mode) {
    seatMode = mode; seatSel = null;
    renderSeating();
}
document.getElementById('seating-mode-edit').addEventListener('click', () => setSeatMode('edit'));
document.getElementById('seating-mode-seat').addEventListener('click', () => setSeatMode('seat'));

function renderSeating() {
    const cls = currentSeatingClass();
    document.getElementById('seating-empty').classList.toggle('hidden', cls !== null);
    document.getElementById('seating-content').classList.toggle('hidden', cls === null);
    if (!cls) return;
    const sd = seatingState(cls.id);
    const plan = sd.current;
    const byId = new Map(cls.students.map(s => [s.id, s]));
    // Personen, die nicht mehr in der Klasse sind, verlieren ihren Platz
    plan.desks.forEach(d => { if (d.s !== null && !byId.has(d.s)) { d.s = null; d.l = false; } });
    document.getElementById('seating-cols').value = plan.cols;
    document.getElementById('seating-rows').value = plan.rows;
    ['edit', 'seat'].forEach(m => {
        const b = document.getElementById('seating-mode-' + m);
        const on = seatMode === m;
        b.classList.toggle('seat-mode-on', on); b.setAttribute('aria-pressed', String(on));
    });
    document.getElementById('seating-mode-hint').textContent = seatMode === 'edit'
        ? 'Auf eine leere Zelle klicken, um einen Tisch zu setzen — auf einen Tisch klicken, um ihn zu entfernen.'
        : 'Personen auf einen anderen Tisch ziehen (oder zwei Tische nacheinander anklicken), um sie zu tauschen. Von "Ohne Platz" auf einen Tisch ziehen, um sie zu setzen. Das Schloss fixiert einen Platz.';
    document.getElementById('seating-print-title').textContent = `Sitzordnung ${cls.name}`;

    $seatingGrid.style.gridTemplateColumns = `repeat(${plan.cols}, minmax(0, 1fr))`;
    $seatingGrid.style.minWidth = `${plan.cols * 68}px`;
    $seatingGrid.classList.toggle('seat-editing', seatMode === 'edit');
    const deskAt = new Map(plan.desks.map((d, i) => [d.x + ',' + d.y, i]));
    const frag = document.createDocumentFragment();
    for (let y = 0; y < plan.rows; y++) for (let x = 0; x < plan.cols; x++) {
        const i = deskAt.get(x + ',' + y);
        if (i === undefined) {
            const cell = document.createElement('button');
            cell.type = 'button'; cell.className = 'seat-cell';
            cell.dataset.x = x; cell.dataset.y = y;
            if (seatMode === 'edit') cell.setAttribute('aria-label', `Tisch setzen (Spalte ${x + 1}, Reihe ${y + 1})`);
            else { cell.tabIndex = -1; cell.setAttribute('aria-hidden', 'true'); }
            frag.appendChild(cell);
            continue;
        }
        const d = plan.desks[i];
        const stu = d.s !== null ? byId.get(d.s) : null;
        const wrap = document.createElement('div');
        wrap.className = 'seat-wrap';
        const btn = document.createElement('button');
        btn.type = 'button'; btn.dataset.desk = i;
        btn.className = 'seat-desk' + (stu ? ' seat-' + sanitizeGender(stu.gender) : ' seat-empty')
            + (d.l ? ' seat-locked' : '') + (seatSel && seatSel.kind === 'desk' && seatSel.i === i ? ' seat-selected' : '');
        btn.textContent = stu ? stu.name : '';
        if (stu && seatMode === 'seat' && !d.l) btn.dataset.drag = '1';
        btn.setAttribute('aria-label', seatMode === 'edit' ? `Tisch entfernen (Spalte ${x + 1}, Reihe ${y + 1})` : (stu ? `${stu.name}, Platz auswählen oder tauschen` : 'Leerer Tisch'));
        wrap.appendChild(btn);
        if (stu && seatMode === 'seat') {
            const lock = document.createElement('button');
            lock.type = 'button'; lock.dataset.lock = i; lock.className = 'seat-lock' + (d.l ? ' on' : '');
            lock.innerHTML = `<i class="fas ${d.l ? 'fa-lock' : 'fa-lock-open'}" aria-hidden="true"></i>`;
            lock.setAttribute('aria-label', d.l ? `Platz von ${stu.name} lösen` : `Platz von ${stu.name} fixieren`);
            wrap.appendChild(lock);
        }
        frag.appendChild(wrap);
    }
    $seatingGrid.replaceChildren(frag);

    // Personen ohne Platz
    const seated = new Set(plan.desks.map(d => d.s).filter(v => v !== null));
    const un = cls.students.filter(s => !seated.has(s.id));
    document.getElementById('seating-unseated-count').textContent = un.length;
    const chips = document.createDocumentFragment();
    if (un.length === 0) {
        const p = document.createElement('span'); p.className = 'text-xs text-gray-400'; p.textContent = cls.students.length ? 'Alle haben einen Platz.' : 'Diese Klasse hat noch keine Schüler.'; chips.appendChild(p);
    }
    un.forEach(s => {
        const c = document.createElement('button');
        c.type = 'button'; c.dataset.stu = s.id;
        c.className = 'seat-chip seat-' + sanitizeGender(s.gender) + (seatSel && seatSel.kind === 'stu' && seatSel.id === s.id ? ' seat-selected' : '');
        c.textContent = s.name;
        chips.appendChild(c);
    });
    document.getElementById('seating-unseated').replaceChildren(chips);
    renderSeatingList('saved', sd.saved);
    renderSeatingList('layout', sd.layouts);
}

// Listen gespeicherter Sitzordnungen ('saved', mit Personen) und Tischanordnungen ('layout', nur Tische)
const SEAT_LISTS = {
    saved:  { el: 'seating-saved-list',  empty: 'Noch nichts gespeichert.', meta: p => `${p.desks.filter(d => d.s !== null).length} Plätze` },
    layout: { el: 'seating-layout-list', empty: 'Noch keine Tischanordnung gespeichert.', meta: p => `${p.desks.length} Tische` }
};
function renderSeatingList(kind, plans) {
    const cfg = SEAT_LISTS[kind];
    const frag = document.createDocumentFragment();
    if (plans.length === 0) {
        const li = document.createElement('li'); li.className = 'text-xs text-gray-400'; li.textContent = cfg.empty; frag.appendChild(li);
    }
    plans.forEach(p => {
        const li = document.createElement('li');
        li.className = 'flex items-center justify-between gap-2 bg-white border border-gray-100 rounded-lg px-3 py-2 shadow-sm';
        const name = document.createElement('span'); name.className = 'text-sm font-medium truncate flex-1'; name.textContent = p.name;
        const meta = document.createElement('span'); meta.className = 'text-xs text-gray-400 flex-shrink-0'; meta.textContent = cfg.meta(p);
        const load = document.createElement('button'); load.type = 'button'; load.dataset.load = p.id;
        load.className = 'text-xs bg-indigo-50 hover:bg-indigo-100 text-indigo-700 px-2.5 py-1 rounded-md font-medium flex-shrink-0'; load.textContent = 'Laden';
        const del = document.createElement('button'); del.type = 'button'; del.dataset.del = p.id;
        del.className = 'text-gray-300 hover:text-red-500 text-xs p-1 flex-shrink-0';
        del.innerHTML = '<i class="fas fa-trash-alt" aria-hidden="true"></i>'; del.setAttribute('aria-label', `"${p.name}" löschen`);
        li.append(name, meta, load, del);
        frag.appendChild(li);
    });
    document.getElementById(cfg.el).replaceChildren(frag);
}

// Ein einziger Listener für das Raster (Event-Delegation statt hunderter Handler)
$seatingGrid.addEventListener('click', e => {
    const cls = currentSeatingClass();
    if (!cls) return;
    const plan = seatingState(cls.id).current;
    setSeatMsg('');
    const lock = e.target.closest('[data-lock]');
    if (lock) {
        const d = plan.desks[parseInt(lock.dataset.lock, 10)];
        if (d && d.s !== null) { d.l = !d.l; saveSeating(); renderSeating(); }
        return;
    }
    const deskBtn = e.target.closest('[data-desk]');
    if (deskBtn) {
        const i = parseInt(deskBtn.dataset.desk, 10);
        const d = plan.desks[i];
        if (!d) return;
        if (seatMode === 'edit') { plan.desks.splice(i, 1); seatSel = null; saveSeating(); renderSeating(); return; }
        if (seatSel === null) { if (d.s !== null) seatSel = { kind: 'desk', i }; }
        else if (seatSel.kind === 'desk') {
            const other = plan.desks[seatSel.i];
            if (seatSel.i === i || !other) seatSel = null;
            else if (d.l || other.l) { showToast('Fixierte Plätze lassen sich nicht tauschen.'); seatSel = null; }
            else { [d.s, other.s] = [other.s, d.s]; seatSel = null; saveSeating(); }
        } else {
            if (d.l) showToast('Dieser Platz ist fixiert.');
            else { d.s = seatSel.id; saveSeating(); }
            seatSel = null;
        }
        renderSeating();
        return;
    }
    const cell = e.target.closest('.seat-cell');
    if (cell && seatMode === 'edit') {
        plan.desks.push({ x: parseInt(cell.dataset.x, 10), y: parseInt(cell.dataset.y, 10), s: null, l: false });
        saveSeating(); renderSeating();
    }
});
document.getElementById('seating-unseated').addEventListener('click', e => {
    const chip = e.target.closest('[data-stu]');
    if (!chip) return;
    const id = parseInt(chip.dataset.stu, 10);
    seatSel = seatSel && seatSel.kind === 'stu' && seatSel.id === id ? null : { kind: 'stu', id };
    if (seatMode === 'edit') seatMode = 'seat';
    renderSeating();
});

// ZIEHEN UND ABLEGEN (Maus, Stift und Finger über Pointer-Events): Person auf einen Tisch ziehen
// = tauschen bzw. setzen, auf "Ohne Platz" ziehen = Platz freigeben. Ohne Bewegung bleibt es ein Klick.
let seatDrag = null, suppressSeatClick = false;
function seatDropTarget(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    const desk = el.closest('#seating-grid [data-desk]');
    if (desk) return { kind: 'desk', i: parseInt(desk.dataset.desk, 10), el: desk };
    const pool = el.closest('#seating-unseated');
    if (pool) return { kind: 'pool', el: pool };
    return null;
}
function onSeatPointerDown(e) {
    if (e.button !== 0 || seatMode !== 'seat') return;
    const src = e.target.closest('[data-drag], [data-stu]');
    if (!src || e.target.closest('[data-lock]')) return;
    seatDrag = { x: e.clientX, y: e.clientY, src, active: false, ghost: null, over: null,
        from: src.dataset.stu ? { kind: 'stu', id: parseInt(src.dataset.stu, 10) } : { kind: 'desk', i: parseInt(src.dataset.desk, 10) } };
}
document.addEventListener('pointermove', e => {
    if (!seatDrag) return;
    if (!seatDrag.active) {
        if (Math.hypot(e.clientX - seatDrag.x, e.clientY - seatDrag.y) < 6) return;
        seatDrag.active = true;
        const g = document.createElement('div');
        g.className = 'seat-ghost'; g.textContent = seatDrag.src.textContent;
        document.body.appendChild(g); seatDrag.ghost = g;
        seatDrag.src.classList.add('seat-drag-src');
    }
    e.preventDefault();
    seatDrag.ghost.style.transform = `translate(${e.clientX + 8}px, ${e.clientY + 8}px)`;
    const t = seatDropTarget(e.clientX, e.clientY);
    const el = t ? t.el : null;
    if (seatDrag.over !== el) {
        if (seatDrag.over) seatDrag.over.classList.remove('seat-drop-over');
        if (el) el.classList.add('seat-drop-over');
        seatDrag.over = el;
    }
}, { passive: false });
function endSeatDrag(e, cancelled) {
    const d = seatDrag; seatDrag = null;
    if (!d || !d.active) return;
    d.ghost.remove();
    d.src.classList.remove('seat-drag-src');
    if (d.over) d.over.classList.remove('seat-drop-over');
    suppressSeatClick = true; setTimeout(() => { suppressSeatClick = false; }, 0);
    const cls = currentSeatingClass();
    const t = cancelled ? null : seatDropTarget(e.clientX, e.clientY);
    if (!cls || !t) return;
    const plan = seatingState(cls.id).current;
    const fromDesk = d.from.kind === 'desk' ? plan.desks[d.from.i] : null;
    if (t.kind === 'pool') {
        if (fromDesk && !fromDesk.l) { fromDesk.s = null; }
    } else {
        const target = plan.desks[t.i];
        if (!target || target === fromDesk) return;
        if (target.l) { showToast('Dieser Platz ist fixiert.'); return; }
        if (fromDesk) [fromDesk.s, target.s] = [target.s, fromDesk.s];
        else target.s = d.from.id;
    }
    seatSel = null; setSeatMsg('');
    saveSeating(); renderSeating();
}
document.addEventListener('pointerup', e => endSeatDrag(e, false));
document.addEventListener('pointercancel', e => endSeatDrag(e, true));
$seatingGrid.addEventListener('pointerdown', onSeatPointerDown);
document.getElementById('seating-unseated').addEventListener('pointerdown', onSeatPointerDown);
// Klick direkt nach einem Ziehen nicht zusätzlich als Auswahl werten
['seating-grid', 'seating-unseated'].forEach(id => document.getElementById(id).addEventListener('click', e => {
    if (suppressSeatClick) { e.stopImmediatePropagation(); e.preventDefault(); }
}, true));

function applySeatingSize() {
    const cls = currentSeatingClass();
    if (!cls) return;
    const plan = seatingState(cls.id).current;
    const cols = Math.min(16, Math.max(2, parseInt(document.getElementById('seating-cols').value, 10) || plan.cols));
    const rows = Math.min(12, Math.max(2, parseInt(document.getElementById('seating-rows').value, 10) || plan.rows));
    if (cols === plan.cols && rows === plan.rows) return;
    // Entspricht die Anordnung einer Vorlage, wird sie auf das neue Raster fortgesetzt
    // (z.B. 9 statt 6 Tische hintereinander), sonst bleiben neue Reihen/Spalten leer.
    const posKey = ds => ds.map(d => d.x + ',' + d.y).sort().join(';');
    const current = posKey(plan.desks);
    const kind = plan.desks.length ? ['rows', 'groups', 'u'].find(k => posKey(seatingPreset(k, plan.cols, plan.rows)) === current) : null;
    withUndo('Rastergrösse geändert.', () => {
        const grows = cols > plan.cols || rows > plan.rows;
        if (kind) {
            const old = new Map(plan.desks.map(d => [d.x + ',' + d.y, d]));
            plan.desks = seatingPreset(kind, cols, rows).map(d => {
                const o = old.get(d.x + ',' + d.y);
                return o ? { ...d, s: o.s, l: o.l } : d;
            });
        } else {
            plan.desks = plan.desks.filter(d => d.x < cols && d.y < rows);
        }
        plan.cols = cols; plan.rows = rows;
        saveSeating(); renderSeating();
        if (!kind && grows) setSeatMsg('Das Raster wurde vergrössert. Mit "Tische setzen" kannst du in den neuen Zellen Tische hinzufügen.');
    });
}
document.getElementById('seating-cols').addEventListener('change', applySeatingSize);
document.getElementById('seating-rows').addEventListener('change', applySeatingSize);

document.getElementById('seating-preset').addEventListener('change', function() {
    const kind = this.value; this.value = '';
    const cls = currentSeatingClass();
    if (!kind || !cls) return;
    const plan = seatingState(cls.id).current;
    withUndo(kind === 'clear' ? 'Alle Tische entfernt.' : 'Vorlage angewendet.', () => {
        const old = new Map(plan.desks.map(d => [d.x + ',' + d.y, d]));
        plan.desks = kind === 'clear' ? [] : seatingPreset(kind, plan.cols, plan.rows).map(d => {
            const o = old.get(d.x + ',' + d.y);
            return o ? { ...d, s: o.s, l: o.l } : d;
        });
        seatSel = null; saveSeating(); renderSeating();
    });
});

document.getElementById('seating-clear-desks-btn').addEventListener('click', () => {
    const cls = currentSeatingClass();
    if (!cls) return;
    const plan = seatingState(cls.id).current;
    if (plan.desks.length === 0) { seatMode = 'edit'; setSeatMsg('Es sind keine Tische vorhanden — klicke auf eine Zelle, um Tische zu setzen.'); renderSeating(); return; }
    withUndo('Alle Tische gelöscht — jetzt neu setzen.', () => {
        plan.desks = []; seatSel = null; seatMode = 'edit';
        setSeatMsg('Klicke auf die Zellen, um Tische neu zu setzen. Danach "Plätze tauschen" wählen und die Sitzordnung erstellen.');
        saveSeating(); renderSeating();
    });
});

document.getElementById('seating-unseat-btn').addEventListener('click', () => {
    const cls = currentSeatingClass();
    if (!cls) return;
    const plan = seatingState(cls.id).current;
    withUndo('Plätze geleert.', () => {
        plan.desks.forEach(d => { if (!d.l) d.s = null; });
        seatSel = null; setSeatMsg(''); saveSeating(); renderSeating();
    });
});

document.getElementById('seating-generate-btn').addEventListener('click', () => {
    const cls = currentSeatingClass();
    if (!cls) return;
    const plan = seatingState(cls.id).current;
    let students = cls.students;
    if (document.getElementById('seating-only-present').checked) {
        const sessions = Object.values(attendanceData[cls.id] || {}).sort((a, b) => b.date.localeCompare(a.date));
        if (sessions.length === 0) { setSeatMsg('Für diese Klasse gibt es noch keinen gespeicherten Anwesenheitstermin.'); return; }
        const recs = sessions[0].records;
        students = students.filter(s => !recs[s.id] || recs[s.id].status !== 'absent');
    }
    let apart = [];
    if (document.getElementById('seating-use-apart').checked) {
        const byName = new Map(students.map(s => [s.name.trim().toLowerCase(), s.id]));
        apart = apartPairs.map(([a, b]) => [byName.get(a.trim().toLowerCase()), byName.get(b.trim().toLowerCase())])
            .filter(p => p[0] !== undefined && p[1] !== undefined && p[0] !== p[1]);
    }
    const res = generateSeating(plan.desks, students, { mixGender: document.getElementById('seating-mix-gender').checked, apart });
    if (!res.ok) {
        setSeatMsg(`Zu wenige Tische: es fehlen ${res.unplaced} Tisch(e). Bitte im Modus "Tische setzen" ergänzen.`);
        return;
    }
    withUndo('Sitzordnung erstellt.', () => {
        plan.desks = res.desks; seatSel = null;
        saveSeating(); renderSeating();
    });
    setSeatMsg(res.penalty > 0 ? 'Nicht alle Wünsche (Abwechslung / "Nicht zusammen") liessen sich vollständig erfüllen.' : '');
});

// EXPORT als PNG / PDF (A4 quer). Gezeichnet wird direkt auf ein Canvas — ohne Fremdbibliotheken.
// Neutrale Darstellung wie im Präsentationsmodus (keine Geschlechtsfarben).
const EXPORT_W = 2339, EXPORT_H = 1654; // A4 quer bei 200 dpi
function renderSeatingCanvas(cls, plan) {
    const byId = new Map(cls.students.map(s => [s.id, s]));
    const cv = document.createElement('canvas');
    cv.width = EXPORT_W; cv.height = EXPORT_H;
    const ctx = cv.getContext('2d');
    const font = (px, weight = 600) => `${weight} ${px}px Inter, system-ui, sans-serif`;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, EXPORT_W, EXPORT_H);
    const margin = 90;
    ctx.fillStyle = '#1e1b4b'; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    ctx.font = font(64, 800); ctx.fillText(`Sitzordnung ${cls.name}`, margin, margin + 50);
    ctx.fillStyle = '#6b7280'; ctx.font = font(34, 500); ctx.textAlign = 'right';
    ctx.fillText(formatDateDisplay(todayStr()), EXPORT_W - margin, margin + 48);
    // Tafel
    const boardY = margin + 100, boardH = 64;
    ctx.fillStyle = '#334155';
    ctx.beginPath(); ctx.roundRect(EXPORT_W * 0.2, boardY, EXPORT_W * 0.6, boardH, 14); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.font = font(34, 700); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('T A F E L', EXPORT_W / 2, boardY + boardH / 2 + 2);
    const desks = plan.desks;
    if (desks.length) {
        const minX = Math.min(...desks.map(d => d.x)), maxX = Math.max(...desks.map(d => d.x));
        const minY = Math.min(...desks.map(d => d.y)), maxY = Math.max(...desks.map(d => d.y));
        const cols = maxX - minX + 1, rows = maxY - minY + 1;
        const areaX = margin, areaY = boardY + boardH + 50;
        const areaW = EXPORT_W - 2 * margin, areaH = EXPORT_H - areaY - margin;
        const gap = 18;
        const cw = (areaW - gap * (cols - 1)) / cols, ch = (areaH - gap * (rows - 1)) / rows;
        const w = Math.min(cw, ch * 2.4), h = Math.min(ch, w / 1.5); // Tische nicht unnatürlich strecken
        const totalW = w * cols + gap * (cols - 1), totalH = h * rows + gap * (rows - 1);
        const offX = areaX + (areaW - totalW) / 2, offY = areaY + (areaH - totalH) / 2;
        desks.forEach(d => {
            const x = offX + (d.x - minX) * (w + gap), y = offY + (d.y - minY) * (h + gap);
            const stu = d.s !== null ? byId.get(d.s) : null;
            const g = ctx.createLinearGradient(0, y, 0, y + h);
            g.addColorStop(0, stu ? '#f6ebdc' : '#f3e6d3'); g.addColorStop(1, stu ? '#e8d3b5' : '#dec5a2');
            ctx.fillStyle = g; ctx.strokeStyle = '#b98f5f'; ctx.lineWidth = 4;
            ctx.beginPath(); ctx.roundRect(x, y, w, h, 14); ctx.fill(); ctx.stroke();
            if (!stu) return;
            // Schrift so gross wie möglich, bei langen Namen auf zwei Zeilen
            const words = stu.name.split(/\s+/);
            let size = Math.min(54, h * 0.4), lines = [stu.name];
            ctx.font = font(size);
            while (size > 14) {
                ctx.font = font(size);
                if (ctx.measureText(stu.name).width <= w - 24) { lines = [stu.name]; break; }
                if (words.length > 1) {
                    const half = Math.ceil(words.length / 2);
                    const two = [words.slice(0, half).join(' '), words.slice(half).join(' ')];
                    if (Math.max(...two.map(t => ctx.measureText(t).width)) <= w - 24 && size * 2.3 <= h) { lines = two; break; }
                }
                size -= 2;
            }
            ctx.fillStyle = '#3b2a1a'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            lines.forEach((t, i) => ctx.fillText(t, x + w / 2, y + h / 2 + (i - (lines.length - 1) / 2) * size * 1.15));
        });
    } else {
        ctx.fillStyle = '#9ca3af'; ctx.font = font(40, 500); ctx.textAlign = 'center';
        ctx.fillText('Keine Tische gesetzt', EXPORT_W / 2, EXPORT_H / 2);
    }
    return cv;
}
const canvasToBlob = (cv, type, q) => new Promise(res => cv.toBlob(res, type, q));

// Minimales PDF (eine Seite A4 quer) mit dem Bild als JPEG
function buildPdfFromJpeg(jpegBytes, imgW, imgH) {
    const enc = new TextEncoder();
    const parts = []; const offsets = []; let pos = 0;
    const push = data => { const b = typeof data === 'string' ? enc.encode(data) : data; parts.push(b); pos += b.length; };
    const obj = (n, body) => { offsets[n] = pos; push(`${n} 0 obj\n${body}\nendobj\n`); };
    push('%PDF-1.4\n');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>');
    const content = 'q 842 0 0 595 0 0 cm /Im0 Do Q';
    obj(4, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    offsets[5] = pos;
    push(`5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`);
    push(jpegBytes); push('\nendstream\nendobj\n');
    const xref = pos;
    let x = 'xref\n0 6\n0000000000 65535 f \n';
    for (let i = 1; i <= 5; i++) x += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    push(x + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
    return new Blob(parts, { type: 'application/pdf' });
}

async function exportSeating(kind) {
    const cls = currentSeatingClass();
    if (!cls) return;
    const plan = seatingState(cls.id).current;
    if (plan.desks.length === 0) { setSeatMsg('Es sind noch keine Tische gesetzt.'); return; }
    setSeatMsg('');
    try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (e) {}
    const cv = renderSeatingCanvas(cls, plan);
    const base = `sitzordnung-${safeFilePart(cls.name)}-${todayStr()}`;
    if (kind === 'png') {
        downloadBlob(await canvasToBlob(cv, 'image/png'), `${base}.png`);
    } else {
        const jpg = await canvasToBlob(cv, 'image/jpeg', 0.95);
        const bytes = new Uint8Array(await jpg.arrayBuffer());
        downloadBlob(buildPdfFromJpeg(bytes, EXPORT_W, EXPORT_H), `${base}.pdf`);
    }
}
document.getElementById('seating-png-btn').addEventListener('click', () => exportSeating('png'));
document.getElementById('seating-pdf-btn').addEventListener('click', () => exportSeating('pdf'));

document.getElementById('seating-print-btn').addEventListener('click', () => { seatSel = null; renderSeating(); window.print(); });

// Aktuellen Plan unter einem Namen ablegen; gleicher Name = überschreiben.
// Tischanordnungen ('layout') speichern nur die Tische, Sitzordnungen ('saved') auch die Personen.
function saveSeatingAs(kind, inputId) {
    const cls = currentSeatingClass();
    const input = document.getElementById(inputId);
    const name = input.value.trim().slice(0, 60);
    if (!cls || !name) return;
    const sd = seatingState(cls.id);
    const list = kind === 'layout' ? sd.layouts : sd.saved;
    const label = kind === 'layout' ? 'Tischanordnung ' : '';
    const copy = structuredClone(sd.current);
    if (kind === 'layout') copy.desks = copy.desks.map(d => ({ x: d.x, y: d.y, s: null, l: false }));
    const existing = list.find(x => x.name.toLowerCase() === name.toLowerCase());
    if (existing) { Object.assign(existing, copy); showToast(`${label}"${existing.name}" aktualisiert.`); }
    else { list.push({ id: seatingIdCounter++, name, ...copy }); showToast(`${label}"${name}" gespeichert.`); }
    input.value = '';
    saveSeating(); renderSeating();
}
document.getElementById('seating-save-form').addEventListener('submit', e => { e.preventDefault(); saveSeatingAs('saved', 'seating-save-name'); });
document.getElementById('seating-layout-form').addEventListener('submit', e => { e.preventDefault(); saveSeatingAs('layout', 'seating-layout-name'); });

['saved', 'layout'].forEach(kind => document.getElementById(SEAT_LISTS[kind].el).addEventListener('click', e => {
    const cls = currentSeatingClass();
    if (!cls) return;
    const sd = seatingState(cls.id);
    const key = kind === 'layout' ? 'layouts' : 'saved';
    const btn = e.target.closest('[data-load], [data-del]');
    if (!btn) return;
    const p = sd[key].find(x => x.id === parseInt(btn.dataset.load || btn.dataset.del, 10));
    if (!p) return;
    const label = kind === 'layout' ? `Tischanordnung "${p.name}"` : `"${p.name}"`;
    if (btn.dataset.load) {
        setSeatMsg('');
        withUndo(`${label} geladen.`, () => {
            // Tischanordnung: nur die Tische übernehmen, die Personen werden neu gesetzt
            sd.current = kind === 'layout'
                ? { cols: p.cols, rows: p.rows, desks: p.desks.map(d => ({ x: d.x, y: d.y, s: null, l: false })) }
                : cleanSeatingPlan(structuredClone(p), new Set(cls.students.map(s => s.id))) || sd.current;
            seatSel = null; saveSeating(); renderSeating();
        });
    } else {
        withUndo(`${label} gelöscht.`, () => {
            sd[key] = sd[key].filter(x => x !== p); saveSeating(); renderSeating();
        });
    }
}));

// PRÄSENTATIONSMODUS — Vollbild für den Beamer (Fullscreen API, sonst Overlay über die ganze Seite).
// Zeigt nur Namen: keine Geschlechts-/Sport-Hinweise.
const $present = document.getElementById('present-overlay');
const $presentBody = document.getElementById('present-body');
let presentFit = null;
function openPresentation(title, build, fit) {
    document.getElementById('present-title').textContent = title;
    $presentBody.replaceChildren();
    build($presentBody);
    $present.classList.remove('hidden');
    document.body.classList.add('presenting');
    presentFit = fit;
    fit();
    if ($present.requestFullscreen) $present.requestFullscreen().catch(() => {});
    document.getElementById('present-close-btn').focus();
}
function closePresentation() {
    if ($present.classList.contains('hidden')) return;
    $present.classList.add('hidden');
    document.body.classList.remove('presenting');
    presentFit = null; pickerActive = false; clearInterval(pickerTimer); stopTimerView();
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
}
document.getElementById('present-close-btn').addEventListener('click', closePresentation);
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) closePresentation(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePresentation(); });
window.addEventListener('resize', () => { if (presentFit) presentFit(); });

document.getElementById('seating-present-btn').addEventListener('click', () => {
    const cls = currentSeatingClass();
    if (!cls) return;
    const plan = seatingState(cls.id).current;
    const byId = new Map(cls.students.map(s => [s.id, s]));
    if (plan.desks.length === 0) { setSeatMsg('Es sind noch keine Tische gesetzt.'); return; }
    // Nur den belegten Ausschnitt des Rasters zeigen, damit die Namen möglichst gross werden
    const minX = Math.min(...plan.desks.map(d => d.x)), maxX = Math.max(...plan.desks.map(d => d.x));
    const minY = Math.min(...plan.desks.map(d => d.y)), maxY = Math.max(...plan.desks.map(d => d.y));
    const cols = maxX - minX + 1, rows = maxY - minY + 1;
    const names = plan.desks.map(d => (d.s !== null && byId.get(d.s)) ? byId.get(d.s).name : '');
    const longest = Math.max(6, ...names.map(n => n.length));
    openPresentation(`Sitzordnung ${cls.name}`, body => {
        const board = document.createElement('div'); board.className = 'present-board'; board.textContent = 'Tafel';
        const grid = document.createElement('div'); grid.className = 'present-seat-grid';
        grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
        grid.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
        plan.desks.forEach((d, i) => {
            const el = document.createElement('div');
            el.className = 'present-desk' + (names[i] ? '' : ' present-desk-empty');
            el.style.gridColumn = String(d.x - minX + 1); el.style.gridRow = String(d.y - minY + 1);
            el.textContent = names[i];
            grid.appendChild(el);
        });
        body.appendChild(board); body.appendChild(grid);
    }, () => {
        const grid = $presentBody.querySelector('.present-seat-grid');
        if (!grid) return;
        const w = $presentBody.clientWidth / cols, h = ($presentBody.clientHeight - 60) / rows;
        const font = Math.max(11, Math.min(44, w / (longest * 0.58), h / 2.2));
        grid.style.fontSize = font + 'px';
    });
});

document.getElementById('present-teams-btn').addEventListener('click', () => {
    const teams = Array.from(document.querySelectorAll('#teams-container .team-card')).map(card => ({
        title: card.querySelector('h3').textContent,
        names: Array.from(card.querySelectorAll('.team-member-name')).map(n => n.textContent)
    }));
    if (teams.length === 0) return;
    const n = teams.length;
    const cols = n <= 2 ? n : n <= 4 ? 2 : n <= 6 ? 3 : 4;
    const rows = Math.ceil(n / cols);
    const maxSize = Math.max(...teams.map(t => t.names.length));
    const longest = Math.max(6, ...teams.flatMap(t => t.names.map(x => x.length)));
    openPresentation('Teams', body => {
        const grid = document.createElement('div'); grid.className = 'present-team-grid';
        grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
        teams.forEach((t, i) => {
            const card = document.createElement('div'); card.className = 'present-team';
            const h = document.createElement('div'); h.className = `present-team-hdr team-hdr-${i % 8}`; h.textContent = t.title;
            const ul = document.createElement('ul');
            t.names.forEach(nm => { const li = document.createElement('li'); li.textContent = nm; ul.appendChild(li); });
            card.appendChild(h); card.appendChild(ul); grid.appendChild(card);
        });
        body.appendChild(grid);
    }, () => {
        const grid = $presentBody.querySelector('.present-team-grid');
        if (!grid) return;
        const w = $presentBody.clientWidth / cols - 30, h = ($presentBody.clientHeight - 20) / rows - 20;
        const font = Math.max(10, Math.min(40, w / (longest * 0.62), h / (maxSize * 1.5 + 3.4)));
        grid.style.fontSize = font + 'px';
    });
});

// WER IST DRAN? — zieht zufällig eine Person aus der Teilnehmerliste, ohne Wiederholung,
// bis alle einmal dran waren. Anzeige gross im Präsentationsmodus (Leertaste = nächste Person).
const pickerDrawn = new Set();
let pickerActive = false;
function openPicker() {
    if (persons.length === 0) { showAddError('Zuerst Teilnehmer laden oder hinzufügen.'); return; }
    let nameEl, metaEl;
    openPresentation('Wer ist dran?', body => {
        const wrap = document.createElement('div'); wrap.className = 'picker-wrap';
        nameEl = document.createElement('div'); nameEl.className = 'picker-name'; nameEl.setAttribute('aria-live', 'polite');
        metaEl = document.createElement('p'); metaEl.className = 'picker-meta';
        const actions = document.createElement('div'); actions.className = 'picker-actions';
        const next = document.createElement('button'); next.type = 'button'; next.className = 'picker-btn picker-btn-main';
        next.innerHTML = '<i class="fas fa-shuffle" aria-hidden="true"></i> Nächste Person';
        const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'picker-btn';
        reset.innerHTML = '<i class="fas fa-rotate-left" aria-hidden="true"></i> Von vorn';
        next.addEventListener('click', () => drawPicker(nameEl, metaEl));
        reset.addEventListener('click', () => { pickerDrawn.clear(); drawPicker(nameEl, metaEl); });
        actions.append(next, reset);
        wrap.append(nameEl, metaEl, actions);
        body.appendChild(wrap);
    }, () => fitPickerName(nameEl));
    pickerActive = true;
    $presentBody.querySelector('.picker-btn-main').focus();
    drawPicker(nameEl, metaEl);
}
function fitPickerName(nameEl) {
    if (!nameEl) return;
    const len = Math.max(4, nameEl.textContent.length);
    nameEl.style.fontSize = Math.max(32, Math.min($presentBody.clientHeight * 0.32, $presentBody.clientWidth / (len * 0.62))) + 'px';
}
let pickerTimer = null;
function drawPicker(nameEl, metaEl) {
    const ids = new Set(persons.map(p => p.id));
    [...pickerDrawn].forEach(id => { if (!ids.has(id)) pickerDrawn.delete(id); });
    if (pickerDrawn.size >= persons.length) pickerDrawn.clear();
    const pool = persons.filter(p => !pickerDrawn.has(p.id));
    const pick = pool[Math.floor(Math.random() * pool.length)];
    pickerDrawn.add(pick.id);
    const done = () => {
        nameEl.textContent = pick.name; nameEl.classList.remove('picker-rolling'); fitPickerName(nameEl);
        metaEl.textContent = `${pickerDrawn.size} von ${persons.length} gezogen` + (pickerDrawn.size === persons.length ? ' — alle waren dran' : '');
    };
    clearInterval(pickerTimer);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || persons.length < 2) { done(); return; }
    // Kurzes "Würfeln" durch zufällige Namen, dann das Ergebnis
    let ticks = 0;
    nameEl.classList.add('picker-rolling');
    pickerTimer = setInterval(() => {
        nameEl.textContent = persons[Math.floor(Math.random() * persons.length)].name; fitPickerName(nameEl);
        if (++ticks >= 10) { clearInterval(pickerTimer); done(); }
    }, 60);
}
document.getElementById('picker-btn').addEventListener('click', openPicker);
document.addEventListener('keydown', e => {
    if (!pickerActive || $present.classList.contains('hidden') || (e.key !== ' ' && e.key !== 'Enter')) return;
    if (e.target.closest && e.target.closest('button')) return; // Knöpfe reagieren selbst auf Leertaste/Enter
    e.preventDefault();
    const btn = $presentBody.querySelector('.picker-btn-main');
    if (btn) btn.click();
});

// TIMER — Countdown oder Stoppuhr im Präsentationsmodus. Mit mehreren Runden wird nach jedem
// Countdown automatisch gewechselt (Stationenbetrieb); sind Teams erstellt, zeigt die Rotation,
// welches Team an welcher Station ist. Leertaste = Start/Pause, R = zurücksetzen.
const timer = { mode: 'down', duration: 300, rounds: 1, round: 1, running: false, endAt: 0, elapsed: 0, startedAt: 0, tick: null, wake: null };
let timerEls = null;
function fmtTime(sec) {
    sec = Math.max(0, Math.ceil(sec));
    const m = Math.floor(sec / 60), s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
function timerRemaining() { return timer.running ? (timer.endAt - Date.now()) / 1000 : timer.duration - timer.elapsed; }
function timerElapsed() { return timer.elapsed + (timer.running ? (Date.now() - timer.startedAt) / 1000 : 0); }
function beep(times = 3) {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        for (let i = 0; i < times; i++) {
            const osc = ctx.createOscillator(), gain = ctx.createGain();
            osc.frequency.value = 880; osc.connect(gain); gain.connect(ctx.destination);
            const t = ctx.currentTime + i * 0.35;
            gain.gain.setValueAtTime(0.0001, t); gain.gain.exponentialRampToValueAtTime(0.4, t + 0.02); gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
            osc.start(t); osc.stop(t + 0.3);
        }
        setTimeout(() => ctx.close(), times * 400 + 200);
    } catch (e) {}
}
async function keepScreenOn(on) {
    try {
        if (on && !timer.wake && navigator.wakeLock) timer.wake = await navigator.wakeLock.request('screen');
        if (!on && timer.wake) { await timer.wake.release(); timer.wake = null; }
    } catch (e) { timer.wake = null; }
}
function timerStart() {
    if (timer.running) return;
    if (timer.mode === 'down' && timerRemaining() <= 0) timerReset(false);
    timer.running = true; timer.startedAt = Date.now();
    timer.endAt = Date.now() + (timer.duration - timer.elapsed) * 1000;
    timerEls.wrap.classList.remove('timer-done');
    clearInterval(timer.tick);
    timer.tick = setInterval(timerUpdate, 200);
    keepScreenOn(true);
    timerUpdate();
}
function timerPause() {
    if (!timer.running) return;
    timer.elapsed = timerElapsed(); timer.running = false;
    clearInterval(timer.tick); keepScreenOn(false);
    timerUpdate();
}
function timerReset(full = true) {
    timer.running = false; timer.elapsed = 0; clearInterval(timer.tick); keepScreenOn(false);
    if (full) timer.round = 1;
    if (timerEls) { timerEls.wrap.classList.remove('timer-done'); timerUpdate(); }
}
function timerUpdate() {
    if (!timerEls) return;
    if (timer.mode === 'down' && timer.running && timerRemaining() <= 0) {
        if (timer.round < timer.rounds) {
            // Runde vorbei: kurz signalisieren und direkt die nächste Station starten
            beep(2);
            timer.round++; timer.elapsed = 0; timer.startedAt = Date.now(); timer.endAt = Date.now() + timer.duration * 1000;
        } else {
            beep(3);
            timer.running = false; timer.elapsed = timer.duration; clearInterval(timer.tick); keepScreenOn(false);
            timerEls.wrap.classList.add('timer-done');
        }
    }
    timerEls.display.textContent = fmtTime(timer.mode === 'down' ? timerRemaining() : timerElapsed());
    timerEls.start.innerHTML = timer.running ? '<i class="fas fa-pause" aria-hidden="true"></i> Pause' : '<i class="fas fa-play" aria-hidden="true"></i> Start';
    const multi = timer.mode === 'down' && timer.rounds > 1;
    timerEls.roundInfo.textContent = multi ? `Runde ${timer.round} von ${timer.rounds}` : '';
    timerEls.roundsLabel.textContent = `${timer.rounds} ${timer.rounds === 1 ? 'Runde' : 'Runden'}`;
    timerEls.downOnly.forEach(el => el.classList.toggle('hidden', timer.mode !== 'down'));
    timerEls.modeBtns.forEach(b => b.classList.toggle('on', b.dataset.mode === timer.mode));
    timerEls.presetBtns.forEach(b => b.classList.toggle('on', Number(b.dataset.sec) === timer.duration));
    // Stationen-Rotation: Team i ist in Runde r an Station ((i + r - 1) mod Anzahl) + 1
    const showRot = multi && lastTeams.length > 1;
    timerEls.rotation.classList.toggle('hidden', !showRot);
    if (showRot) {
        timerEls.rotation.replaceChildren(...lastTeams.map((names, i) => {
            const d = document.createElement('div');
            d.textContent = `Team ${i + 1} → Station ${((i + timer.round - 1) % lastTeams.length) + 1}`;
            const sub = document.createElement('span'); sub.textContent = names.slice(0, 4).join(', ') + (names.length > 4 ? ' …' : '');
            d.appendChild(sub);
            return d;
        }));
    }
    if (presentFit) presentFit();
}
function stopTimerView() {
    if (!timerEls) return;
    timerPause();
    timerEls = null;
}
function openTimer() {
    if (lastTeams.length > 1 && timer.rounds === 1) timer.rounds = lastTeams.length;
    openPresentation('Timer', body => {
        const wrap = document.createElement('div'); wrap.className = 'timer-wrap';
        const mk = (tag, cls, html) => { const el = document.createElement(tag); if (cls) el.className = cls; if (html) el.innerHTML = html; return el; };
        const modes = mk('div', 'timer-row');
        const modeBtns = [['down', '<i class="fas fa-hourglass-half" aria-hidden="true"></i> Countdown'], ['up', '<i class="fas fa-stopwatch" aria-hidden="true"></i> Stoppuhr']].map(([m, html]) => {
            const b = mk('button', 'timer-chip', html); b.type = 'button'; b.dataset.mode = m;
            b.addEventListener('click', () => { timer.mode = m; timerReset(); timerEls.start.focus(); });
            modes.appendChild(b); return b;
        });
        const display = mk('div', 'timer-display'); display.setAttribute('role', 'timer'); display.setAttribute('aria-live', 'off');
        const roundInfo = mk('div', 'timer-round');
        const presets = mk('div', 'timer-row');
        const presetBtns = [30, 60, 120, 180, 300, 600, 900].map(sec => {
            const b = mk('button', 'timer-chip'); b.type = 'button'; b.dataset.sec = sec;
            b.textContent = sec < 60 ? `${sec} s` : `${sec / 60} min`;
            b.addEventListener('click', () => { timer.duration = sec; timerReset(); timerEls.start.focus(); });
            presets.appendChild(b); return b;
        });
        const adjust = mk('div', 'timer-row');
        const rounds = mk('div', 'timer-row');
        const roundsLabel = mk('span', 'font-semibold text-indigo-900 px-1');
        [['−', -1], ['+', 1]].forEach(([lbl, d], i) => {
            const b = mk('button', 'timer-chip'); b.type = 'button'; b.textContent = lbl;
            b.setAttribute('aria-label', d < 0 ? 'Eine Runde weniger' : 'Eine Runde mehr');
            b.addEventListener('click', () => { timer.rounds = Math.min(20, Math.max(1, timer.rounds + d)); timer.round = Math.min(timer.round, timer.rounds); timerUpdate(); timerEls.start.focus(); });
            if (i === 1) rounds.appendChild(roundsLabel);
            rounds.appendChild(b);
        });
        rounds.insertBefore(mk('span', 'text-sm text-gray-500 mr-1', '<i class="fas fa-repeat" aria-hidden="true"></i> Stationen:'), rounds.firstChild);
        [['−1 min', -60], ['+1 min', 60], ['+10 s', 10]].forEach(([lbl, d]) => {
            const b = mk('button', 'timer-chip'); b.type = 'button'; b.textContent = lbl;
            b.addEventListener('click', () => {
                const remaining = timerRemaining();
                timer.duration = Math.max(5, Math.min(5999, timer.duration + d));
                if (timer.running) timer.endAt = Date.now() + Math.max(1, remaining + d) * 1000;
                timerUpdate(); timerEls.start.focus();
            });
            adjust.appendChild(b);
        });
        const actions = mk('div', 'picker-actions');
        const start = mk('button', 'picker-btn picker-btn-main'); start.type = 'button';
        start.addEventListener('click', () => timer.running ? timerPause() : timerStart());
        const reset = mk('button', 'picker-btn', '<i class="fas fa-rotate-left" aria-hidden="true"></i> Zurücksetzen'); reset.type = 'button';
        reset.addEventListener('click', () => timerReset());
        actions.append(start, reset);
        const rotation = mk('div', 'timer-rotation hidden');
        wrap.append(modes, display, roundInfo, actions, presets, adjust, rounds, rotation);
        body.appendChild(wrap);
        timerEls = { wrap, display, roundInfo, start, roundsLabel, rotation, modeBtns, presetBtns, downOnly: [presets, adjust, rounds] };
    }, () => {
        if (!timerEls) return;
        const reserve = timerEls.rotation.classList.contains('hidden') ? 260 : 360;
        timerEls.display.style.fontSize = Math.max(48, Math.min(($presentBody.clientHeight - reserve) * 0.85, $presentBody.clientWidth / 3.4)) + 'px';
    });
    timerUpdate();
    timerEls.start.focus();
}
document.getElementById('timer-btn').addEventListener('click', openTimer);
document.addEventListener('keydown', e => {
    if (!timerEls || $present.classList.contains('hidden')) return;
    if (e.target.closest && e.target.closest('button') && e.key !== 'r' && e.key !== 'R') return;
    if (e.key === ' ') { e.preventDefault(); timer.running ? timerPause() : timerStart(); }
    else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); timerReset(); }
});

// TAB 3: TEAMS
async function addPerson(name, gender, sporty = false, { confirmDuplicate = false } = {}) {
    if (persons.find(p => p.name.toLowerCase() === name.toLowerCase())) {
        if (!confirmDuplicate) { showAddError(`"${name}" ist bereits in der Liste.`); return false; }
        const ok = await uiConfirm(`"${name}" ist bereits in der Liste. Trotzdem hinzufügen (z.B. zweite Person mit gleichem Namen)?`, { title: 'Doppelter Name', okLabel: 'Trotzdem hinzufügen' });
        if (!ok) return false;
    }
    persons.push({ id: personIdCounter++, name, gender, sporty: sporty === true, hobbies: [] });
    personsManual = true;
    savePersons(); renderPersonList(); return true;
}
function showAddError(msg) {
    const el = document.getElementById('add-error-msg'); el.textContent = msg; el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 3000);
}
function removePerson(id) {
    const p = persons.find(x => x.id === id);
    if (!p) return;
    withUndo(`"${p.name}" aus Teilnehmerliste entfernt.`, () => {
        persons = persons.filter(x => x.id !== id); savePersons(); renderPersonList();
    });
}

document.getElementById('add-person-form').addEventListener('submit', async e => {
    e.preventDefault();
    const name = document.getElementById('person-name').value.trim();
    const gender = document.querySelector('input[name="gender"]:checked').value;
    const sporty = document.getElementById('person-sporty-input').checked;
    if (!name) return;
    const ok = await addPerson(name, gender, sporty, { confirmDuplicate: true });
    if (ok) {
        document.getElementById('person-name').value = '';
        document.getElementById('person-sporty-input').checked = false;
        document.getElementById('add-error-msg').classList.add('hidden');
    }
    document.getElementById('person-name').focus();
});

document.getElementById('clear-all-btn').addEventListener('click', () => {
    withUndo('Alle Teilnehmer gelöscht.', () => {
        persons = []; personsManual = false; savePersons(); renderPersonList();
        document.getElementById('results-section').classList.add('hidden');
        document.getElementById('source-banner').classList.add('hidden');
    });
});

// Klassen direkt in den Teams-Tab laden (ohne Anwesenheitserfassung)
function renderTeamsClassList() {
    const list = document.getElementById('teams-class-list');
    const checked = new Set(Array.from(list.querySelectorAll('input:checked')).map(i => i.value));
    list.innerHTML = '';
    document.getElementById('teams-class-empty').classList.toggle('hidden', classes.length > 0);
    document.getElementById('teams-load-classes-btn').classList.toggle('hidden', classes.length === 0);
    const frag = document.createDocumentFragment();
    classes.forEach(cls => {
        const li = document.createElement('li');
        const label = document.createElement('label');
        label.className = 'flex items-center gap-2 text-sm bg-white border border-gray-100 rounded-lg px-2.5 py-1.5 cursor-pointer';
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = String(cls.id); cb.className = 'h-4 w-4';
        cb.checked = checked.has(cb.value);
        const name = document.createElement('span'); name.className = 'flex-1 truncate'; name.textContent = cls.name;
        const n = document.createElement('span'); n.className = 'text-xs text-gray-400'; n.textContent = `${cls.students.length} SuS` + (classKind(cls) === 'sport' ? ' · Sport' : classKind(cls) === 'room' ? ' · Klassenzimmer' : '');
        label.appendChild(cb); label.appendChild(name); label.appendChild(n);
        li.appendChild(label); frag.appendChild(li);
    });
    list.appendChild(frag);
}
document.getElementById('teams-load-classes-btn').addEventListener('click', async () => {
    const ids = Array.from(document.querySelectorAll('#teams-class-list input:checked')).map(i => parseInt(i.value, 10));
    const chosen = classes.filter(c => ids.includes(c.id));
    if (chosen.length === 0) { await uiAlert('Bitte mindestens eine Klasse auswählen.'); return; }
    const students = chosen.flatMap(c => c.students.map(s => ({ ...s, group: c.name })));
    if (students.length === 0) { await uiAlert('Die gewählten Klassen haben noch keine Schüler(innen).'); return; }
    await loadPersonsIntoTeams(students, `Geladen aus ${chosen.map(c => `"${c.name}"`).join(' + ')}: ${students.length} Schüler(innen).`);
});

function renderPersonList() {
    const list = document.getElementById('person-list');
    const emptyEl = document.getElementById('empty-state');
    const clearBtn = document.getElementById('clear-all-btn');
    document.getElementById('total-count').textContent = persons.length;
    list.innerHTML = '';
    if (persons.length === 0) { list.appendChild(emptyEl); clearBtn.classList.add('hidden'); }
    else {
        clearBtn.classList.remove('hidden');
        persons.forEach(p => {
            const li = document.createElement('li');
            li.className = 'flex justify-between items-center bg-white p-2.5 rounded-lg shadow-sm border border-gray-100';
            const inner = document.createElement('div'); inner.className = 'flex items-center gap-2';
            const icon = genderIconEl(p.gender);
            const name = document.createElement('span'); name.className = 'text-sm font-medium text-gray-700'; name.textContent = p.name;
            inner.appendChild(icon); inner.appendChild(name);
            const btn = document.createElement('button');
            btn.className = 'text-gray-200 hover:text-red-500 text-xs transition-colors';
            btn.innerHTML = '<i class="fas fa-times" aria-hidden="true"></i>';
            btn.setAttribute('aria-label', `${p.name} entfernen`);
            btn.addEventListener('click', () => removePerson(p.id));
            li.appendChild(inner); li.appendChild(btn); list.appendChild(li);
        });
    }
    refreshApartSelects();
    refreshActivitySelect();
    renderApartList();
}

// AKTIVITÄTS-AUSWAHL — steuert, wie Sportlichkeit/Hobbys bei der Verteilung zählen:
// 'none' = kein Sport (keine Sport-Balance), 'general' = allgemeines Sportspiel
// (sportlich-Markierung fair verteilen), 'sport:<Name>' = konkrete Sportart
// (Schüler(innen) mit diesem Hobby zusätzlich fair verteilen).
function refreshActivitySelect() {
    const sel = document.getElementById('activity-select');
    const prev = sel.value;
    const sports = [...new Set(persons.flatMap(p => p.hobbies || []).map(h => h.trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, 'de'));
    sel.innerHTML = '<option value="none">Kein Sport (z.B. Klassenzimmer)</option>'
        + '<option value="general">Sport — allgemeines Spiel</option>';
    sports.forEach(sport => {
        const opt = document.createElement('option');
        opt.value = `sport:${sport}`; opt.textContent = `Sport — ${sport}`;
        sel.appendChild(opt);
    });
    if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
    document.getElementById('activity-hint').classList.toggle('hidden', sports.length > 0);
}

document.getElementById('toggle-bulk-btn').addEventListener('click', () => document.getElementById('bulk-area').classList.toggle('hidden'));
document.getElementById('add-bulk-btn').addEventListener('click', () => {
    const text = document.getElementById('bulk-input').value.trim();
    if (!text) return;
    const { added, skipped, defaults } = bulkParse(text, (name, gender, sporty) => {
        if (persons.find(p => p.name.toLowerCase() === name.toLowerCase())) return false;
        persons.push({ id: personIdCounter++, name, gender, sporty: sporty === true, hobbies: [] });
        return true;
    });
    personsManual = true;
    savePersons(); renderPersonList();
    document.getElementById('bulk-input').value = '';
    showBulkMsg('bulk-result-msg', added, skipped, defaults);
    setTimeout(() => { document.getElementById('bulk-result-msg').classList.add('hidden'); document.getElementById('bulk-area').classList.add('hidden'); }, 4000);
});

function showBulkMsg(elId, added, skipped, defaults) {
    let msg = `${added} hinzugefügt.`;
    if (skipped  > 0) msg += ` ${skipped} übersprungen (Duplikate).`;
    if (defaults > 0) msg += ` ${defaults} ohne Geschlechtsangabe (später über den Stift ergänzen).`;
    const el = document.getElementById(elId); el.textContent = msg; el.classList.remove('hidden');
}

// "NICHT ZUSAMMEN"-REGELN
function refreshApartSelects() {
    ['apart-a', 'apart-b'].forEach(id => {
        const sel = document.getElementById(id);
        const prev = sel.value;
        sel.innerHTML = '<option value="">– Person –</option>';
        persons.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.name; opt.textContent = p.name;
            sel.appendChild(opt);
        });
        if (prev && persons.find(p => p.name === prev)) sel.value = prev;
    });
}
function pairEquals(p1, p2) {
    const k = x => x.trim().toLowerCase();
    return (k(p1[0]) === k(p2[0]) && k(p1[1]) === k(p2[1])) || (k(p1[0]) === k(p2[1]) && k(p1[1]) === k(p2[0]));
}
document.getElementById('apart-add-btn').addEventListener('click', () => {
    const a = document.getElementById('apart-a').value;
    const b = document.getElementById('apart-b').value;
    if (!a || !b || a.trim().toLowerCase() === b.trim().toLowerCase()) return;
    if (apartPairs.some(p => pairEquals(p, [a, b]))) return;
    apartPairs.push([a, b]);
    saveApartPairs();
    renderApartList();
});
function renderApartList() {
    const ul = document.getElementById('apart-list');
    ul.innerHTML = '';
    if (apartPairs.length === 0) {
        const li = document.createElement('li');
        li.className = 'text-xs text-gray-400 italic';
        li.textContent = 'Keine Regeln definiert.';
        ul.appendChild(li);
        return;
    }
    apartPairs.forEach((pair, idx) => {
        const li = document.createElement('li');
        li.className = 'inline-flex items-center gap-1.5 bg-amber-50 border border-amber-200 text-amber-800 text-xs px-2 py-1 rounded-full mr-1.5 mb-1.5';
        const span = document.createElement('span');
        span.textContent = `${pair[0]} ↮ ${pair[1]}`;
        const rm = document.createElement('button');
        rm.className = 'text-amber-400 hover:text-red-500';
        rm.innerHTML = '<i class="fas fa-times" aria-hidden="true"></i>';
        rm.setAttribute('aria-label', `Regel "${pair[0]} nicht mit ${pair[1]}" entfernen`);
        rm.addEventListener('click', () => { apartPairs.splice(idx, 1); saveApartPairs(); renderApartList(); });
        li.appendChild(span); li.appendChild(rm);
        ul.appendChild(li);
    });
}

// TEAM-GENERIERUNG
document.getElementById('generate-btn').addEventListener('click', generateTeams);
document.getElementById('regenerate-btn').addEventListener('click', generateTeams);
document.getElementById('team-mode').addEventListener('change', function() {
    document.getElementById('num-teams-label').textContent = this.value === 'size' ? 'Personen pro Team' : 'Anzahl der Teams';
});

function generateTeams() {
    const mode = document.getElementById('team-mode').value; // 'teams' | 'size'
    const inputVal = parseInt(document.getElementById('num-teams').value, 10);
    const balanceGender = document.getElementById('balance-gender').checked;
    const activity = document.getElementById('activity-select').value; // 'none' | 'general' | 'sport:<Name>'
    let balanceSport = false, sportLevelOf;
    if (activity === 'general') {
        balanceSport = true;
    } else if (activity.startsWith('sport:')) {
        const sport = activity.slice(6).toLowerCase();
        balanceSport = true;
        // 2 = spielt diese Sportart (Hobby), 1 = allgemein sportlich, 0 = keins von beidem —
        // so werden Vereinsspieler UND sportliche Kinder gleichmässig verteilt.
        sportLevelOf = p => (p.hobbies || []).some(h => h.trim().toLowerCase() === sport) ? 2 : (p.sporty === true ? 1 : 0);
    }
    const errEl = document.getElementById('error-msg');
    const apartWarnEl = document.getElementById('apart-warning');
    errEl.classList.add('hidden'); apartWarnEl.classList.add('hidden');
    if (persons.length === 0) { errEl.textContent = 'Bitte füge zuerst Personen hinzu.'; errEl.classList.remove('hidden'); return; }
    let n;
    if (mode === 'size') {
        if (isNaN(inputVal) || inputVal < 1) { errEl.textContent = 'Mindestens 1 Person pro Team.'; errEl.classList.remove('hidden'); return; }
        n = Math.ceil(persons.length / inputVal);
        if (n < 2) { errEl.textContent = 'Diese Gruppengrösse ergibt weniger als 2 Teams.'; errEl.classList.remove('hidden'); return; }
    } else {
        n = inputVal;
        if (isNaN(n) || n < 2) { errEl.textContent = 'Mindestens 2 Teams erforderlich.'; errEl.classList.remove('hidden'); return; }
        if (n > persons.length) { errEl.textContent = 'Mehr Teams als Teilnehmer.'; errEl.classList.remove('hidden'); return; }
    }
    let teams = distributeTeams(persons, n, { balanceGender, balanceSport, sportLevelOf });
    if (apartPairs.length > 0) {
        const result = enforceApart(teams, apartPairs, { balanceStrict: balanceGender || balanceSport, sportLevelOf });
        teams = result.teams;
        if (result.unresolved) {
            apartWarnEl.textContent = 'Hinweis: Nicht alle "Nicht zusammen"-Regeln konnten erfüllt werden.';
            apartWarnEl.classList.remove('hidden');
        }
    }
    renderTeams(teams);
}

let lastTeams = []; // Namen der zuletzt erstellten Teams (für die Stationen-Rotation im Timer)
function renderTeams(teams) {
    lastTeams = teams.map(t => t.map(p => p.name));
    const container = document.getElementById('teams-container');
    container.innerHTML = '';
    teams.forEach((team, i) => {
        const card = document.createElement('div');
        card.className = 'team-card bg-white rounded-xl shadow-md overflow-hidden border border-gray-200 flex flex-col fade-in';
        const header = document.createElement('div');
        header.className = `team-hdr-${i % 8} text-white p-4 flex justify-between items-center`;
        const titleEl = document.createElement('h3'); titleEl.className = 'font-bold text-lg'; titleEl.textContent = `Team ${i + 1}`;
        const badge = document.createElement('span'); badge.className = 'bg-white bg-opacity-20 rounded-full px-3 py-1 text-sm font-medium'; badge.textContent = `${team.length} ${team.length === 1 ? 'Person' : 'Personen'}`;
        header.appendChild(titleEl); header.appendChild(badge);
        const stats = document.createElement('div');
        stats.className = 'px-4 py-1.5 bg-gray-50 border-b border-gray-100 flex text-xs text-gray-500 gap-3';
        Object.keys(GENDER_ICONS).forEach(g => {
            const cnt = team.filter(p => p.gender === g).length;
            if (!cnt) return;
            const s = genderIconEl(g); s.title = `${cnt} ${GENDER_LABELS[g]}`; s.append(` ${cnt}`); stats.appendChild(s);
        });
        const ul = document.createElement('ul'); ul.className = 'team-members p-3 flex-grow' + (team.length > 8 ? ' team-members-2col' : '');
        team.forEach(p => {
            const li = document.createElement('li'); li.className = 'flex items-center gap-2 py-0.5 border-b border-gray-50';
            const icon = genderIconEl(p.gender);
            const name = document.createElement('span'); name.className = 'text-gray-700 text-sm team-member-name'; name.textContent = p.name;
            li.appendChild(icon); li.appendChild(name); ul.appendChild(li);
        });
        card.appendChild(header); card.appendChild(stats); card.appendChild(ul);
        container.appendChild(card);
    });
    document.getElementById('results-section').classList.remove('hidden');
    document.getElementById('results-section').scrollIntoView({ behavior: 'auto', block: 'start' });
}

document.getElementById('print-teams-btn').addEventListener('click', () => window.print());

document.getElementById('copy-teams-btn').addEventListener('click', async () => {
    const cards = document.querySelectorAll('.team-card');
    if (!cards.length) return;
    let text = 'Generierte Teams:\n\n';
    cards.forEach((card, i) => { text += `--- Team ${i+1} ---\n`; card.querySelectorAll('.team-member-name').forEach(s => text += `- ${s.textContent.trim()}\n`); text += '\n'; });
    const orig = document.getElementById('copy-teams-btn').innerHTML;
    try {
        await navigator.clipboard.writeText(text);
        document.getElementById('copy-teams-btn').innerHTML = '<i class="fas fa-check text-green-500 mr-1" aria-hidden="true"></i> Kopiert!';
    } catch {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); document.getElementById('copy-teams-btn').innerHTML = '<i class="fas fa-check text-green-500 mr-1" aria-hidden="true"></i> Kopiert!'; } catch {}
        document.body.removeChild(ta);
    }
    setTimeout(() => { document.getElementById('copy-teams-btn').innerHTML = orig; }, 2000);
});

// KOMPLETT-BACKUP (Klassen + Wochenpläne + Anwesenheitsdaten + Teilnehmerliste)
// Optional mit Passwort verschlüsselt (AES-GCM, Schlüssel via PBKDF2-SHA-256).
const PBKDF2_ITERATIONS = 210000;
// In Blöcken umwandeln: String.fromCharCode(...bytes) sprengt bei grossen Backups den Call-Stack.
function b64encode(buf) {
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
}
const b64decode = str => Uint8Array.from(atob(str), c => c.charCodeAt(0));

async function deriveBackupKey(password, salt, iterations) {
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
        material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
}
async function encryptBackup(obj, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveBackupKey(password, salt, PBKDF2_ITERATIONS);
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
    return {
        app: 'teamgenerator-backup', encrypted: true,
        kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: PBKDF2_ITERATIONS },
        salt: b64encode(salt), iv: b64encode(iv), data: b64encode(ciphertext)
    };
}
async function decryptBackup(payload, password) {
    const iterations = payload.kdf && Number.isInteger(payload.kdf.iterations) ? payload.kdf.iterations : PBKDF2_ITERATIONS;
    const key = await deriveBackupKey(password, b64decode(payload.salt), iterations);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64decode(payload.iv) }, key, b64decode(payload.data));
    return JSON.parse(new TextDecoder().decode(plain));
}

// Serialisiert den kompletten App-Zustand (auch für die lokale Datendatei genutzt).
function buildBackupObject() {
    return {
        version: 3,
        exportedAt: new Date().toISOString(),
        classes, classIdCounter, stuIdCounter,
        attendanceData,
        persons, personIdCounter,
        apartPairs,
        exams, examIdCounter,
        pointsData, pointsIdCounter,
        seatingData, seatingIdCounter
    };
}

document.getElementById('backup-export-btn').addEventListener('click', async () => {
    const backup = buildBackupObject();
    let payload = backup;
    if (window.crypto && crypto.subtle) {
        const pw = await uiPrompt('Optional: Passwort zum Verschlüsseln des Backups. Leer lassen für unverschlüsselt.', {
            title: 'Backup herunterladen', inputType: 'password', placeholder: 'Passwort (optional)',
            hint: 'Empfohlen, da das Backup sensible Daten (Namen, Abwesenheitsgründe) enthält.', okLabel: 'Herunterladen'
        });
        if (pw === null) return;
        if (pw) {
            try { payload = await encryptBackup(backup, pw); }
            catch (e) { await uiAlert('Verschlüsselung fehlgeschlagen — Backup wurde nicht erstellt.'); return; }
        }
    }
    downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `klassenmanager-backup-${todayStr()}.json`);
    markBackupDone();
});

const $backupFileInput = document.getElementById('backup-file-input');
document.getElementById('backup-import-btn').addEventListener('click', () => $backupFileInput.click());
$backupFileInput.addEventListener('change', () => {
    const file = $backupFileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
        try {
            let data = JSON.parse(reader.result);
            if (data && data.encrypted === true) {
                if (!(window.crypto && crypto.subtle)) { await uiAlert('Dieses Backup ist verschlüsselt, aber der Browser unterstützt hier keine Entschlüsselung (unsichere Umgebung?).'); return; }
                const pw = await uiPrompt('Dieses Backup ist verschlüsselt. Passwort eingeben:', { title: 'Backup wiederherstellen', inputType: 'password', okLabel: 'Entschlüsseln' });
                if (pw === null) return;
                try { data = await decryptBackup(data, pw); }
                catch (e) { await uiAlert('Entschlüsselung fehlgeschlagen — falsches Passwort oder beschädigte Datei.'); return; }
            }
            const result = validateBackup(data);
            if (!result) { await uiAlert('Ungültige Backup-Datei: Es wurde kein Komplett-Backup dieser App erkannt.'); return; }
            const ok = await uiConfirm(`Backup vom ${result.exportedAt ? formatDateDisplay(result.exportedAt.slice(0,10)) : 'unbekannten Datum'} mit ${result.classes.length} Klasse(n) wiederherstellen? Alle aktuellen Klassen und Anwesenheitsdaten werden ersetzt.`, { title: 'Backup wiederherstellen', okLabel: 'Wiederherstellen', danger: true });
            if (!ok) return;
            applyRestoredData(result);
            switchTab('classes');
            await uiAlert(`Backup wiederhergestellt: ${result.classes.length} Klasse(n).`);
        } catch (err) {
            await uiAlert('Backup konnte nicht gelesen werden (kein gültiges JSON).');
        }
        $backupFileInput.value = '';
    };
    reader.readAsText(file);
});

// Übernimmt validierte Daten (aus Backup-Import oder Datendatei) als neuen App-Zustand.
function applyRestoredData(result) {
    setData(result);
    selSeatingClassId = null; seatSel = null;
    selPointsClassId = null;
    personsManual = false;
    activeClassId = null; selAttendClassId = null; currentSessionRecords = {};
    selExamClassId = null; selExamId = null; examDirty = false; updateExamDirtyHint();
    attendanceDirty = false; updateDirtyHint();
    persistAll();
    refreshAllViews();
}

// LOKALE DATENDATEI (File System Access API — Chrome/Edge)
// Speichert alle Daten zusätzlich automatisch in eine JSON-Datei auf der Festplatte.
// Das Datei-Handle wird in IndexedDB gemerkt, damit die Verbindung Neustarts überlebt.
const DATA_FILE_IDB = 'tg2_filestore';
const DATA_FILE_KEY = 'dataFile';
let dataFileHandle = null, fileStorageActive = false, fileWriteTimer = null, fileWriteErrorShown = false;

function fsSupported() { return 'showSaveFilePicker' in window && window.isSecureContext && 'indexedDB' in window; }

function idbOpen() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DATA_FILE_IDB, 1);
        req.onupgradeneeded = () => req.result.createObjectStore('handles');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
async function idbSet(key, val) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('handles', 'readwrite');
        tx.objectStore('handles').put(val, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}
async function idbGet(key) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
        const req = db.transaction('handles', 'readonly').objectStore('handles').get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
async function idbDel(key) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('handles', 'readwrite');
        tx.objectStore('handles').delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

function setFileStatus(state, detail = '') {
    const row = document.getElementById('file-storage-row');
    if (!fsSupported()) { row.classList.add('hidden'); return; }
    row.classList.remove('hidden');
    const text = document.getElementById('file-storage-status-text');
    document.getElementById('file-storage-connect-btn').classList.toggle('hidden', state !== 'disconnected');
    document.getElementById('file-storage-reconnect-btn').classList.toggle('hidden', state !== 'needs-permission');
    document.getElementById('file-storage-disconnect-btn').classList.toggle('hidden', state === 'disconnected');
    text.classList.toggle('text-amber-600', state === 'needs-permission' || state === 'error');
    if (state === 'disconnected') text.textContent = 'Optional: Alle Daten zusätzlich automatisch in eine lokale Datei sichern (z.B. im Dokumente-Ordner).';
    else if (state === 'connected') text.textContent = `Daten werden automatisch gespeichert in: ${detail}`;
    else if (state === 'needs-permission') text.textContent = `Datendatei "${detail}" verbunden — Zugriff bestätigen, um weiter automatisch zu speichern.`;
    else if (state === 'error') text.textContent = detail;
}

function scheduleDataFileWrite() {
    if (!fileStorageActive || !dataFileHandle) return;
    clearTimeout(fileWriteTimer);
    fileWriteTimer = setTimeout(() => { fileWriteTimer = null; writeDataFile(); }, 400);
}
async function writeDataFile() {
    if (!fileStorageActive || !dataFileHandle) return;
    try {
        const writable = await dataFileHandle.createWritable();
        await writable.write(JSON.stringify(buildBackupObject()));
        await writable.close();
        fileWriteErrorShown = false;
        markBackupDone();
        setFileStatus('connected', dataFileHandle.name);
    } catch (e) {
        setFileStatus('error', `Schreiben in "${dataFileHandle.name}" fehlgeschlagen — Daten sind weiterhin im Browser gespeichert.`);
        if (!fileWriteErrorShown) { fileWriteErrorShown = true; showToast('Datendatei konnte nicht geschrieben werden.'); }
    }
}
// Ausstehende Schreibvorgänge beim Verlassen der Seite noch anstossen.
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && fileWriteTimer) { clearTimeout(fileWriteTimer); fileWriteTimer = null; writeDataFile(); }
});

// Gleicht Browser-Stand und Datei ab: identisch → nichts tun; Datei leer/ungültig →
// (nach Rückfrage) überschreiben; unterschiedlich → Nutzer entscheidet, welche Seite gilt.
async function syncWithDataFile() {
    let text;
    try { text = await (await dataFileHandle.getFile()).text(); }
    catch (e) { setFileStatus('error', `Datendatei "${dataFileHandle.name}" konnte nicht gelesen werden.`); return; }
    if (!text.trim()) { await writeDataFile(); return; }
    let result = null;
    try {
        const data = JSON.parse(text);
        if (data && data.encrypted === true) {
            await uiAlert('Die gewählte Datei ist ein verschlüsseltes Backup. Als automatische Datendatei bitte eine unverschlüsselte Datei verwenden (oder eine neue anlegen).');
            await disconnectDataFile();
            return;
        }
        result = validateBackup(data);
    } catch (e) {}
    if (!result) {
        const ok = await uiConfirm(`Die Datei "${dataFileHandle.name}" enthält keine gültigen Klassenmanager-Daten. Mit dem aktuellen Stand überschreiben?`, { title: 'Datendatei', okLabel: 'Überschreiben', danger: true });
        if (ok) await writeDataFile();
        else await disconnectDataFile();
        return;
    }
    // Beide Seiten normalisieren (gleiche Validierung), sonst gelten ältere Daten ohne neue Felder immer als "anders".
    // Verglichen wird der gesamte Stand — auch Prüfungen, Punkte und Sitzordnungen.
    const snapOf = r => JSON.stringify([r.classes, r.attendanceData, r.persons, r.apartPairs, r.exams, r.pointsData, r.seatingData]);
    const localNorm = validateBackup(JSON.parse(JSON.stringify(buildBackupObject())));
    const localSnap = localNorm ? snapOf(localNorm) : '';
    const fileSnap = snapOf(result);
    if (localSnap === fileSnap) { setFileStatus('connected', dataFileHandle.name); return; }
    const loadIt = await uiConfirm(
        `Die Datendatei "${dataFileHandle.name}"${result.exportedAt ? ` (Stand ${formatDateDisplay(result.exportedAt.slice(0, 10))})` : ''} unterscheidet sich vom Stand in diesem Browser.\n\n"Aus Datei laden" ersetzt den Browser-Stand. "Browser-Stand behalten" überschreibt die Datei.`,
        { title: 'Datendatei', okLabel: 'Aus Datei laden', cancelLabel: 'Browser-Stand behalten' }
    );
    if (loadIt) { applyRestoredData(result); switchTab('classes'); }
    else await writeDataFile();
    setFileStatus('connected', dataFileHandle.name);
}

async function connectDataFile() {
    let handle;
    try {
        handle = await window.showSaveFilePicker({
            suggestedName: 'klassenmanager-daten.json',
            types: [{ description: 'JSON-Datei', accept: { 'application/json': ['.json'] } }]
        });
    } catch (e) { return; } // abgebrochen
    dataFileHandle = handle;
    fileStorageActive = true;
    try { await idbSet(DATA_FILE_KEY, handle); } catch (e) {}
    await syncWithDataFile();
}
async function disconnectDataFile() {
    fileStorageActive = false;
    dataFileHandle = null;
    clearTimeout(fileWriteTimer); fileWriteTimer = null;
    try { await idbDel(DATA_FILE_KEY); } catch (e) {}
    setFileStatus('disconnected');
}
async function reconnectDataFile() {
    if (!dataFileHandle) return;
    let perm = 'denied';
    try { perm = await dataFileHandle.requestPermission({ mode: 'readwrite' }); } catch (e) {}
    if (perm !== 'granted') { setFileStatus('needs-permission', dataFileHandle.name); return; }
    fileStorageActive = true;
    await syncWithDataFile();
}
async function initDataFile() {
    if (!fsSupported()) return;
    setFileStatus('disconnected');
    try { dataFileHandle = (await idbGet(DATA_FILE_KEY)) || null; } catch (e) { dataFileHandle = null; }
    if (!dataFileHandle) return;
    let perm = 'prompt';
    try { perm = await dataFileHandle.queryPermission({ mode: 'readwrite' }); } catch (e) {}
    if (perm === 'granted') { fileStorageActive = true; await syncWithDataFile(); }
    else setFileStatus('needs-permission', dataFileHandle.name);
}
document.getElementById('file-storage-connect-btn').addEventListener('click', connectDataFile);
document.getElementById('file-storage-reconnect-btn').addEventListener('click', reconnectDataFile);
document.getElementById('file-storage-disconnect-btn').addEventListener('click', async () => {
    await disconnectDataFile();
    showToast('Datendatei getrennt — Daten bleiben im Browser gespeichert.');
});

// SERVICE WORKER (offline-fähig; nur online unter https sinnvoll)
// Lokal (localhost) wird bewusst KEIN Service Worker genutzt — sonst liefert Chrome nach Code-Änderungen
// alte Dateien aus dem Cache. Vorhandene Worker/Caches von früher werden dabei entfernt.
const isLocalDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
if ('serviceWorker' in navigator) {
    if (isLocalDev) {
        navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(r => r.unregister())).catch(() => {});
        if (window.caches) caches.keys().then(keys => keys.forEach(k => caches.delete(k))).catch(() => {});
    } else if (location.protocol === 'https:') {
        window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => {}); });
    }
}

// APP INSTALLIEREN (Chrome/Edge bieten das an, sobald die App per https läuft)
let installPrompt = null;
const $installBtn = document.getElementById('install-btn');
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; $installBtn.classList.remove('hidden'); });
window.addEventListener('appinstalled', () => { installPrompt = null; $installBtn.classList.add('hidden'); });
$installBtn.addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    try { await installPrompt.userChoice; } catch (e) {}
    installPrompt = null; $installBtn.classList.add('hidden');
});

// DATENSICHERHEIT — Browser bitten, die Daten nicht automatisch zu löschen, und an Backups erinnern,
// wenn seit 30 Tagen keines erstellt wurde (höchstens einmal pro Woche, nicht in den ersten 14 Tagen).
const DAY = 86400000;
function storageNum(key) { try { return parseInt(localStorage.getItem(key) || '0', 10) || 0; } catch (e) { return 0; } }
function storageSet(key, val) { try { localStorage.setItem(key, String(val)); } catch (e) {} }
function markBackupDone() { storageSet('tg2_lastBackup', Date.now()); }
function backupHousekeeping() {
    if (!classes.some(c => c.students.length)) return;
    if (navigator.storage && navigator.storage.persist) {
        navigator.storage.persisted().then(p => p || navigator.storage.persist()).catch(() => {});
    }
    const now = Date.now();
    if (!storageNum('tg2_firstUse')) storageSet('tg2_firstUse', now);
    if (fileStorageActive || now - storageNum('tg2_firstUse') < 14 * DAY) return;
    if (now - storageNum('tg2_lastBackup') < 30 * DAY || now - storageNum('tg2_backupNag') < 7 * DAY) return;
    storageSet('tg2_backupNag', now);
    showToast('Tipp: Seit über 30 Tagen kein Backup. Browserdaten können verloren gehen.', {
        action: { label: 'Backup erstellen', fn: () => document.getElementById('backup-export-btn').click() }, duration: 15000
    });
}

// FARBSCHEMA — Umschalter Hell/Dunkel; ohne eigene Wahl gilt die Systemeinstellung (siehe theme.js).
const $themeBtn = document.getElementById('theme-btn');
function applyTheme(dark) {
    document.documentElement.classList.toggle('dark', dark);
    $themeBtn.innerHTML = `<i class="fas ${dark ? 'fa-sun' : 'fa-moon'}" aria-hidden="true"></i>`;
    $themeBtn.title = dark ? 'Helles Farbschema' : 'Dunkles Farbschema';
    document.querySelector('meta[name="theme-color"]').content = dark ? '#1e1b4b' : '#4f46e5';
}
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
applyTheme(document.documentElement.classList.contains('dark'));
$themeBtn.addEventListener('click', () => {
    const dark = !document.documentElement.classList.contains('dark');
    storageSet('tg2_theme', dark ? 'dark' : 'light');
    applyTheme(dark);
});
darkQuery.addEventListener('change', e => { try { if (!localStorage.getItem('tg2_theme')) applyTheme(e.matches); } catch (err) {} });

// INFO-DIALOG (Hilfe, Einführungstour)
const $info = document.getElementById('info-dialog');
let infoPrevFocus = null;
function openInfo(title, html, actions) {
    infoPrevFocus = document.activeElement;
    document.getElementById('info-title').textContent = title;
    document.getElementById('info-body').innerHTML = html; // nur feste, eigene Texte (keine Nutzerdaten)
    const bar = document.getElementById('info-actions');
    bar.replaceChildren(...actions.map(({ label, primary, fn, left }) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = primary ? 'px-4 py-2 text-sm rounded-md text-white bg-indigo-600 hover:bg-indigo-700 font-medium'
            : 'px-4 py-2 text-sm rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50';
        if (left) b.classList.add('mr-auto');
        b.innerHTML = label;
        b.addEventListener('click', fn);
        return b;
    }));
    $info.classList.remove('hidden');
    (bar.querySelector('.bg-indigo-600') || document.getElementById('info-close')).focus();
}
function closeInfo() {
    if ($info.classList.contains('hidden')) return;
    $info.classList.add('hidden');
    if (infoPrevFocus && infoPrevFocus.isConnected) infoPrevFocus.focus();
}
document.getElementById('info-close').addEventListener('click', () => { closeInfo(); storageSet('tg2_tourDone', 1); });
$info.addEventListener('mousedown', e => { if (e.target === $info) { closeInfo(); storageSet('tg2_tourDone', 1); } });
$info.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); closeInfo(); storageSet('tg2_tourDone', 1); } });

const kbd = k => `<kbd class="px-1.5 py-0.5 rounded border border-gray-300 bg-gray-50 text-xs font-mono">${k}</kbd>`;
function showHelp() {
    openInfo('Hilfe und Tastenkürzel', `
        <p><strong>So geht's:</strong> Klasse anlegen (oder Beispielklasse), Anwesenheit erfassen und speichern, dann Teams bilden oder die Sitzordnung planen. Alles wird automatisch im Browser gespeichert.</p>
        <table class="w-full text-sm">
            <tr><td class="py-1 pr-3 whitespace-nowrap">${kbd('Alt')} + ${kbd('1')} bis ${kbd('7')}</td><td>Reiter wechseln</td></tr>
            <tr><td class="py-1 pr-3 whitespace-nowrap">${kbd('←')} ${kbd('→')}</td><td>Nächster Reiter (wenn die Reiterleiste den Fokus hat)</td></tr>
            <tr><td class="py-1 pr-3 whitespace-nowrap">${kbd('Leertaste')}</td><td>"Wer ist dran?": nächste Person · Timer: Start/Pause</td></tr>
            <tr><td class="py-1 pr-3 whitespace-nowrap">${kbd('R')}</td><td>Timer zurücksetzen</td></tr>
            <tr><td class="py-1 pr-3 whitespace-nowrap">${kbd('Esc')}</td><td>Dialog oder Präsentation schliessen</td></tr>
        </table>
        <p><strong>Sitzordnung:</strong> Personen mit Maus oder Finger auf einen anderen Tisch ziehen. Das Schloss fixiert einen Platz.</p>
        <p><strong>Datensicherheit:</strong> Die Daten liegen nur in diesem Browser. Über die Fusszeile regelmässig ein Backup herunterladen (optional mit Passwort). In Chrome/Edge kann zusätzlich eine Datendatei automatisch mitgeschrieben werden.</p>
        <p><strong>Auf dem Handy</strong> ist vor allem die Anwesenheit gedacht; die übrigen Bereiche funktionieren am besten auf Laptop oder Tablet.</p>`,
        [{ label: 'Einführung erneut zeigen', left: true, fn: () => { closeInfo(); showTour(0); } }, { label: 'Schliessen', primary: true, fn: closeInfo }]);
}
document.getElementById('help-btn').addEventListener('click', showHelp);

// EINFÜHRUNGSTOUR beim ersten Start (drei Schritte), später über die Hilfe erneut aufrufbar.
const TOUR = [
    ['Willkommen im Klassenmanager', `<p class="text-base">Dein Werkzeug für den Unterricht: <strong>Anwesenheit</strong> erfassen, <strong>Prüfungen</strong> und <strong>Bonuspunkte</strong> führen, <strong>faire Teams</strong> bilden und <strong>Sitzordnungen</strong> planen.</p>
        <p>Kostenlos, ohne Konto und ohne Werbung. Läuft auch offline, z.B. in der Turnhalle.</p>`],
    ['In drei Schritten startklar', `<ol class="list-decimal pl-5 space-y-2">
        <li><strong>Klasse anlegen</strong> und Schüler(innen) eintragen, einzeln oder als Liste (auch Import aus Excel).</li>
        <li><strong>Anwesenheit</strong> antippen und speichern. Die App schlägt die Klasse vor, die laut Wochenplan gerade dran ist.</li>
        <li>Daraus mit einem Klick <strong>Teams</strong> bilden, jemanden mit <strong>"Wer ist dran?"</strong> ziehen oder den <strong>Timer</strong> starten.</li></ol>`],
    ['Deine Daten gehören dir', `<p>Alles bleibt auf diesem Gerät, nichts geht an einen Server. Darum: ab und zu über die Fusszeile ein <strong>Backup</strong> herunterladen. Die App erinnert dich daran.</p>
        <p>Tipp: Über ${kbd('?')} oben rechts findest du jederzeit Hilfe und Tastenkürzel.</p>`]
];
function showTour(step) {
    const [title, html] = TOUR[step];
    const dots = `<div class="flex justify-center gap-1.5 pt-2">${TOUR.map((_, i) => `<span class="w-2 h-2 rounded-full ${i === step ? 'bg-indigo-600' : 'bg-gray-200'}"></span>`).join('')}</div>`;
    const done = () => { storageSet('tg2_tourDone', 1); closeInfo(); };
    const last = step === TOUR.length - 1;
    const actions = [{ label: 'Überspringen', left: true, fn: done }];
    if (step > 0) actions.push({ label: 'Zurück', fn: () => showTour(step - 1) });
    if (!last) actions.push({ label: 'Weiter', primary: true, fn: () => showTour(step + 1) });
    else {
        if (!classes.length) actions.push({ label: '<i class="fas fa-wand-magic-sparkles mr-1" aria-hidden="true"></i> Beispielklasse anlegen', primary: true, fn: () => { done(); switchTab('classes'); createDemoClass(); } });
        actions.push({ label: classes.length ? 'Los geht\'s' : 'Selbst starten', primary: !!classes.length, fn: done });
    }
    openInfo(title, html + dots, actions);
}

// TASTENKÜRZEL: Alt + 1–7 wechselt den Reiter
document.addEventListener('keydown', e => {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code || '');
    const n = m ? parseInt(m[1], 10) : 0;
    if (n >= 1 && n <= tabButtons.length && $present.classList.contains('hidden')) {
        e.preventDefault();
        switchTab(tabButtons[n - 1].dataset.tab);
        tabButtons[n - 1].focus();
    }
});

// INIT
loadStorage();
renderClassList(); renderClassDetail();
// Auf dem Handy ist die Anwesenheit der Hauptzweck: dort direkt starten, sobald Klassen existieren.
const isPhone = window.matchMedia('(max-width: 639px)').matches;
switchTab(location.hash.slice(1) || (isPhone && classes.length ? 'attendance' : 'classes'));
initDataFile().catch(() => {}).then(backupHousekeeping);
if (!classes.length && !storageNum('tg2_tourDone')) showTour(0);
