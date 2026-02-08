import { db } from './firebase-init.js';
import {
    collection, query, where, onSnapshot, doc, setDoc, deleteDoc,
    getDocs, writeBatch, updateDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
    STATUS, TIME_SLOTS, sanitize, showToast, renderCalendar,
    loadBusinessSettings, isOutsideBusinessHours, formatDateYMD,
    populateTimeSelect, DAY_NAMES_SHORT
} from './shared.js';

// ── State ──────────────────────────────────────────────────
const TODAY_STR = formatDateYMD(new Date());
let currentMonth = new Date();
let currentData = { appointments: [], blocks: [] };
let todayAppointments = [];
let appointmentsByDay = {};
let blocksByDay = {};
let configData = { startTime: "", endTime: "", lunchStart: "", lunchEnd: "" };

// Listener cleanup refs (fix memory leak)
let unsubDateApp = null;
let unsubDateBlock = null;
let unsubIndicators = null;

// ── DOM references ─────────────────────────────────────────
const picker = document.getElementById('admin-date-picker');
picker.value = TODAY_STR;

const calendarRootAdmin = document.getElementById('calendar-root-admin');
const adminTimeGrid = document.getElementById('admin-time-grid');
const todayAgendaList = document.getElementById('today-agenda-list');
const appointmentsSection = document.getElementById('appointments-section');
const adminAppointmentsList = document.getElementById('admin-appointments-list');
const remindersList = document.getElementById('reminders-list');

// ── Load data for selected date (with cleanup) ────────────
function loadDateData() {
    const date = picker.value;
    if (!date) return;

    // Unsubscribe previous listeners to prevent memory leak
    if (unsubDateApp) unsubDateApp();
    if (unsubDateBlock) unsubDateBlock();

    const qApp = query(collection(db, "appointments"), where("date", "==", date));
    unsubDateApp = onSnapshot(qApp, (snap) => {
        currentData.appointments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderAll();
    });

    const qBlock = query(collection(db, "blocks"), where("date", "==", date));
    unsubDateBlock = onSnapshot(qBlock, (snap) => {
        currentData.blocks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderAll();
    });
}

// ── Month indicators (red dots + blocked days) ─────────────
function listenMonthIndicators() {
    if (unsubIndicators) unsubIndicators();

    const year = currentMonth.getFullYear();
    const month = String(currentMonth.getMonth() + 1).padStart(2, '0');
    const startStr = `${year}-${month}-01`;
    const endStr = `${year}-${month}-31`;

    const qApp = query(collection(db, "appointments"),
        where("date", ">=", startStr),
        where("date", "<=", endStr));
    const qBlock = query(collection(db, "blocks"),
        where("date", ">=", startStr),
        where("date", "<=", endStr));

    const unsubApp = onSnapshot(qApp, (snap) => {
        const counts = {};
        snap.forEach(d => {
            if (d.data().status === STATUS.CONFIRMED) counts[d.data().date] = true;
        });
        appointmentsByDay = counts;
        renderAdminCalendar();
    });

    const unsubBlock = onSnapshot(qBlock, (snap) => {
        const counts = {};
        snap.forEach(d => {
            if (d.data().time === 'all') counts[d.data().date] = true;
        });
        blocksByDay = counts;
        renderAdminCalendar();
    });

    unsubIndicators = () => { unsubApp(); unsubBlock(); };
}

// ── Calendar ───────────────────────────────────────────────
function renderAdminCalendar() {
    renderCalendar({
        rootElement: calendarRootAdmin,
        currentMonth,
        selectedDate: picker.value,
        appointmentDays: appointmentsByDay,
        blockedDays: blocksByDay,
        onDateSelect(date) {
            picker.value = date;
            renderAdminCalendar();
            loadDateData();
        },
        onMonthChange(offset) {
            currentMonth.setMonth(currentMonth.getMonth() + offset);
            listenMonthIndicators();
        }
    });
}

// ── Today tab listener ─────────────────────────────────────
function listenToday() {
    const q = query(collection(db, "appointments"), where("date", "==", TODAY_STR));
    onSnapshot(q, (snap) => {
        todayAppointments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderTodayTab();
    });
}

// ── Render functions ───────────────────────────────────────
function renderAll() {
    renderTimeGrid();
    renderAppointments();
    appointmentsSection.style.display = 'block';
}

function renderTodayTab() {
    todayAgendaList.innerHTML = '';

    const sorted = todayAppointments
        .filter(a => a.status === STATUS.CONFIRMED)
        .sort((a, b) => a.time.localeCompare(b.time));

    if (sorted.length === 0) {
        todayAgendaList.innerHTML = `
            <div class="empty-state">
                <div class="empty-state__icon">\u2615</div>
                <p>No hay citas agendadas para hoy todav\u00eda.</p>
            </div>`;
        return;
    }

    sorted.forEach(app => {
        const card = document.createElement('div');
        card.className = 'pro-card';
        card.innerHTML = `
            <div class="appointment-row">
                <div>
                    <div class="appointment-time">${sanitize(app.time)}</div>
                    <div class="appointment-name">${sanitize(app.patientName)}</div>
                    <div class="appointment-service">${sanitize(app.serviceName)}</div>
                </div>
                <div class="appointment-actions">
                    <button class="btn-edit" data-id="${app.id}">Editar</button>
                    <button class="btn-cancel-app" data-id="${app.id}">X</button>
                </div>
            </div>
        `;
        todayAgendaList.appendChild(card);
    });
}

function renderTimeGrid() {
    adminTimeGrid.innerHTML = '';

    TIME_SLOTS.forEach(time => {
        const isAppointed = currentData.appointments.find(a => a.time === time && a.status === STATUS.CONFIRMED);
        const isBlockedByDay = currentData.blocks.find(b => b.time === time || b.time === 'all');
        const isGlobalBlocked = isOutsideBusinessHours(time, configData);
        const isBlocked = isBlockedByDay || isGlobalBlocked;

        const slot = document.createElement('div');
        slot.className = `time-slot ${isAppointed ? 'active' : ''} ${isBlocked ? 'blocked' : ''}`;
        slot.classList.add('time-slot--admin');

        if (isBlocked) {
            if (isGlobalBlocked) slot.classList.add('time-slot--global-blocked');
            else slot.classList.add('time-slot--manual-blocked');
        }

        let statusLabel = 'Libre';
        if (isAppointed) statusLabel = 'Ocupado';
        else if (isGlobalBlocked) statusLabel = 'Fuera Horario';
        else if (isBlockedByDay) statusLabel = 'Bloqueado';

        slot.innerHTML = `
            <div class="slot-time">${time}</div>
            <div class="slot-status">${statusLabel}</div>
            <button class="slot-toggle-btn" data-time="${time}" data-blocked="${!!isBlockedByDay}" ${isGlobalBlocked ? 'disabled' : ''}>
                ${isBlockedByDay ? 'Quitar Bloqueo' : 'Bloquear'}
            </button>
        `;
        adminTimeGrid.appendChild(slot);
    });
}

function renderAppointments() {
    adminAppointmentsList.innerHTML = '';

    const activeApps = currentData.appointments
        .filter(a => a.status === STATUS.CONFIRMED)
        .sort((a, b) => a.time.localeCompare(b.time));

    if (activeApps.length === 0) {
        adminAppointmentsList.innerHTML = '<p class="text-muted">No hay citas para este d\u00eda.</p>';
        return;
    }

    activeApps.forEach(app => {
        const card = document.createElement('div');
        card.className = 'pro-card';
        card.innerHTML = `
            <div class="appointment-row">
                <div>
                    <div class="time">${sanitize(app.time)}</div>
                    <div class="name">${sanitize(app.patientName)}</div>
                    <div class="service">${sanitize(app.serviceName)}</div>
                    ${app.patientRut ? `<div class="detail">RUT: ${sanitize(app.patientRut)}</div>` : ''}
                    <div class="detail">Tel: ${sanitize(app.patientPhone || 'No registrado')}</div>
                </div>
                <div class="appointment-actions appointment-actions--vertical">
                    <button class="btn-edit-outline" data-id="${app.id}">Editar</button>
                    <button class="btn-cancel-outline" data-id="${app.id}">Cancelar</button>
                </div>
            </div>
        `;
        adminAppointmentsList.appendChild(card);
    });
}

// ── Event delegation for dynamic buttons ───────────────────
document.getElementById('admin-app').addEventListener('click', (e) => {
    const editBtn = e.target.closest('[data-id].btn-edit, [data-id].btn-edit-outline');
    if (editBtn) { openEdit(editBtn.dataset.id); return; }

    const cancelBtn = e.target.closest('[data-id].btn-cancel-app, [data-id].btn-cancel-outline');
    if (cancelBtn) { cancelApp(cancelBtn.dataset.id); return; }
});

adminTimeGrid.addEventListener('click', (e) => {
    const toggleBtn = e.target.closest('.slot-toggle-btn');
    if (toggleBtn && !toggleBtn.disabled) {
        const time = toggleBtn.dataset.time;
        const isBlocked = toggleBtn.dataset.blocked === 'true';
        toggleBlock(time, isBlocked);
    }
});

// ── Block/Unblock operations ───────────────────────────────
async function toggleBlock(time, currentlyBlocked) {
    const date = picker.value;
    try {
        if (currentlyBlocked) {
            const b = currentData.blocks.find(b => b.time === time || b.time === 'all');
            if (b) await deleteDoc(doc(db, "blocks", b.id));
        } else {
            await setDoc(doc(db, "blocks", `${date}_${time}`), {
                date, time, createdAt: new Date()
            });
        }
    } catch (e) {
        console.error("Error toggling block:", e);
        showToast("Error al modificar el bloqueo.", "error");
    }
}

document.getElementById('btn-block-day')?.addEventListener('click', async () => {
    const date = picker.value;
    try {
        await setDoc(doc(db, "blocks", `${date}_all`), {
            date, time: "all", createdAt: new Date()
        });
        showToast("D\u00eda bloqueado correctamente.", "success");
    } catch (e) {
        console.error("Error blocking day:", e);
        showToast("Error al bloquear el d\u00eda.", "error");
    }
});

document.getElementById('btn-unblock-day')?.addEventListener('click', async () => {
    const date = picker.value;
    try {
        const q = query(collection(db, "blocks"), where("date", "==", date));
        const snap = await getDocs(q);
        const batch = writeBatch(db);
        snap.forEach(d => batch.delete(d.ref));
        await batch.commit();
        showToast("Bloqueos del d\u00eda eliminados.", "success");
    } catch (e) {
        console.error("Error unblocking day:", e);
        showToast("Error al limpiar bloqueos.", "error");
    }
});

// ── Edit modal ─────────────────────────────────────────────
const editModal = document.getElementById('edit-modal');
const editTimeSelect = document.getElementById('edit-time');

// Populate time select options on load (fixes broken template literal)
populateTimeSelect(editTimeSelect);

function openEdit(id) {
    // Search in both currentData and todayAppointments (fixes today tab bug)
    const app = currentData.appointments.find(a => a.id === id)
        || todayAppointments.find(a => a.id === id);

    document.getElementById('edit-id').value = id;
    if (app) {
        document.getElementById('edit-name').value = app.patientName || '';
        document.getElementById('edit-phone').value = app.patientPhone || '';
        document.getElementById('edit-rut').value = app.patientRut || '';
        editTimeSelect.value = app.time;
    }

    editModal.style.display = 'flex';
}

document.getElementById('btn-modal-cancel')?.addEventListener('click', () => {
    editModal.style.display = 'none';
});

document.getElementById('btn-modal-save')?.addEventListener('click', async () => {
    const id = document.getElementById('edit-id').value;
    const updates = {
        patientName: document.getElementById('edit-name').value,
        patientPhone: document.getElementById('edit-phone').value,
        patientRut: document.getElementById('edit-rut').value,
        time: editTimeSelect.value
    };

    const btn = document.getElementById('btn-modal-save');
    btn.disabled = true;
    btn.innerText = 'Guardando...';

    try {
        await updateDoc(doc(db, "appointments", id), updates);
        editModal.style.display = 'none';
        showToast("Cita actualizada correctamente.", "success");
    } catch (e) {
        console.error("Error updating appointment:", e);
        showToast("Error al actualizar la cita.", "error");
    } finally {
        btn.disabled = false;
        btn.innerText = 'Guardar Cambios';
    }
});

// ── Cancel appointment ─────────────────────────────────────
async function cancelApp(id) {
    if (!confirm("\u00bfEst\u00e1s seguro de que deseas cancelar esta cita?")) return;

    try {
        // Find appointment data before deleting for WhatsApp notification
        const app = currentData.appointments.find(a => a.id === id)
            || todayAppointments.find(a => a.id === id);

        await deleteDoc(doc(db, "appointments", id));
        showToast("Cita cancelada.", "success");

        if (app && app.patientPhone && confirm("\u00bfDeseas enviar un aviso por WhatsApp?")) {
            const msg = `Hola ${app.patientName}, lamentamos informarte que tu cita del ${app.date} a las ${app.time} ha sido cancelada. Cont\u00e1ctanos para reagendar.`;
            window.open(`https://wa.me/56${app.patientPhone}?text=${encodeURIComponent(msg)}`, '_blank');
        }
    } catch (e) {
        console.error("Error cancelling appointment:", e);
        showToast("Error al cancelar la cita.", "error");
    }
}

// ── Tab navigation ─────────────────────────────────────────
const tabs = { today: 'tab-content-today', agenda: 'tab-content-agenda', reminders: 'tab-content-reminders', settings: 'tab-content-settings' };
const titles = { today: 'Agenda de Hoy', agenda: 'Otros D\u00edas', reminders: 'Avisos de Pacientes', settings: 'Configuraci\u00f3n General' };
const subtitles = { today: 'Tus citas para este d\u00eda', agenda: 'Gestiona bloqueos y fechas futuras', reminders: 'Seguimiento y recordatorios', settings: 'Horarios globales de atenci\u00f3n' };

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        if (!tab) return;

        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        Object.values(tabs).forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        const targetEl = document.getElementById(tabs[tab]);
        if (targetEl) targetEl.style.display = 'block';

        document.getElementById('dashboard-title').textContent = titles[tab];
        document.getElementById('dashboard-subtitle').textContent = subtitles[tab];

        if (tab === 'agenda') loadDateData();
        if (tab === 'reminders') loadReminders();
        if (tab === 'settings') loadSettingsUI();
    });
});

// ── Settings ───────────────────────────────────────────────
function fillSettingsSelects() {
    ['set-start', 'set-end', 'set-lunch-start', 'set-lunch-end'].forEach(id => {
        const s = document.getElementById(id);
        s.innerHTML = '<option value="">Ninguno</option>';
        TIME_SLOTS.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t;
            opt.textContent = t;
            s.appendChild(opt);
        });
    });
}

async function loadSettingsUI() {
    fillSettingsSelects();
    configData = await loadBusinessSettings(db);
    document.getElementById('set-start').value = configData.startTime || "";
    document.getElementById('set-end').value = configData.endTime || "";
    document.getElementById('set-lunch-start').value = configData.lunchStart || "";
    document.getElementById('set-lunch-end').value = configData.lunchEnd || "";
    renderAll();
}

document.getElementById('btn-save-settings')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-save-settings');
    btn.disabled = true;
    btn.innerText = 'Guardando...';

    try {
        await setDoc(doc(db, "settings", "business_hours"), {
            startTime: document.getElementById('set-start').value,
            endTime: document.getElementById('set-end').value,
            lunchStart: document.getElementById('set-lunch-start').value,
            lunchEnd: document.getElementById('set-lunch-end').value,
            updatedAt: new Date()
        });
        configData = await loadBusinessSettings(db);
        showToast("Configuraci\u00f3n guardada correctamente.", "success");
    } catch (e) {
        console.error("Error saving settings:", e);
        showToast("Error al guardar configuraci\u00f3n.", "error");
    } finally {
        btn.disabled = false;
        btn.innerText = 'Guardar Configuraci\u00f3n';
    }
});

// ── Reminders (optimized query with date filter) ───────────
async function loadReminders() {
    remindersList.innerHTML = '<p class="text-muted text-center loading-text">Cargando recordatorios...</p>';

    try {
        const now = new Date();
        const rangeDates = [];
        for (let i = 0; i < 5; i++) {
            const d = new Date();
            d.setDate(d.getDate() + i);
            rangeDates.push(formatDateYMD(d));
        }

        // Optimized: only fetch appointments in the date range instead of ALL confirmed
        const q = query(
            collection(db, "appointments"),
            where("status", "==", STATUS.CONFIRMED),
            where("date", ">=", rangeDates[0]),
            where("date", "<=", rangeDates[rangeDates.length - 1])
        );
        const snap = await getDocs(q);
        const allApps = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        const reminders = [];
        allApps.forEach(app => {
            const dateIdx = rangeDates.indexOf(app.date);
            if (dateIdx === -1) return;

            if (dateIdx === 0) {
                const [h, m] = app.time.split(':').map(Number);
                const appTime = new Date();
                appTime.setHours(h, m, 0, 0);
                const diffHours = (appTime - now) / (1000 * 60 * 60);
                if (diffHours > 0) {
                    reminders.push({ ...app, type: diffHours <= 3 ? '2h' : 'today', dayOffset: 0 });
                }
            } else {
                reminders.push({ ...app, type: dateIdx === 1 ? '24h' : 'future', dayOffset: dateIdx });
            }
        });

        if (reminders.length === 0) {
            remindersList.innerHTML = '<p class="text-muted text-center">No hay recordatorios pendientes.</p>';
            return;
        }

        remindersList.innerHTML = '<h3>Pr\u00f3ximos Recordatorios (5 d\u00edas)</h3>';
        reminders
            .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
            .forEach(app => {
                const card = document.createElement('div');
                card.className = 'pro-card';

                const appDateObj = new Date(app.date + 'T00:00:00');
                const dayName = DAY_NAMES_SHORT[appDateObj.getDay()];

                let label, color, msg;
                if (app.dayOffset === 0) {
                    label = app.type === '2h' ? 'Hoy (Pronto)' : 'Hoy';
                    color = app.type === '2h' ? '#FF9500' : '#007AFF';
                    msg = `Hola ${app.patientName}, te recordamos tu hora de hoy a las ${app.time}.`;
                } else if (app.dayOffset === 1) {
                    label = 'Ma\u00f1ana'; color = '#34C759';
                    msg = `Hola ${app.patientName}, te recordamos tu hora para ma\u00f1ana ${dayName} a las ${app.time}.`;
                } else {
                    label = `En ${app.dayOffset} d\u00edas (${dayName})`; color = '#5856D6';
                    msg = `Hola ${app.patientName}, te recordamos tu cita del ${dayName} ${app.date} a las ${app.time}.`;
                }

                card.style.borderLeft = `4px solid ${color}`;
                card.innerHTML = `
                    <div class="reminder-row">
                        <div>
                            <span class="reminder-label" style="color: ${color};">${label}</span>
                            <div class="reminder-title">${sanitize(app.time)} - ${sanitize(app.patientName)}</div>
                            <div class="reminder-detail">${sanitize(app.serviceName)} (${sanitize(app.date)})</div>
                        </div>
                        <a href="https://wa.me/56${sanitize(app.patientPhone)}?text=${encodeURIComponent(msg)}" target="_blank" class="btn-whatsapp">WhatsApp</a>
                    </div>
                `;
                remindersList.appendChild(card);
            });
    } catch (e) {
        console.error("Error loading reminders:", e);
        remindersList.innerHTML = '<p class="text-muted text-center">Error al cargar recordatorios.</p>';
    }
}

// ── Initialize ─────────────────────────────────────────────
async function init() {
    configData = await loadBusinessSettings(db);
    listenToday();
    loadDateData();
    listenMonthIndicators();
}

init();
