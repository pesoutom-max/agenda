import { db } from './firebase-init.js';
import {
    collection, query, where, onSnapshot, doc, setDoc, deleteDoc,
    getDocs, writeBatch, updateDoc, getDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
    STATUS, TIME_SLOTS, sanitize, showToast, renderCalendar,
    isOutsideBusinessHours, formatDateYMD, populateTimeSelect, DAY_NAMES_SHORT,
    proDoc, apptCollection, blocksCollection, apptDoc, blockDoc,
    loadProfessionalSettings, loadProfessionalProfile
} from './shared.js';

// ── Read professional ID from URL ───────────────────────────
const params = new URLSearchParams(window.location.search);
const PRO_ID = params.get('pro');

// ── PIN Authentication ─────────────────────────────────────
const PIN_SESSION_KEY = `facilpyme_admin_${PRO_ID}`;

const pinScreen = document.getElementById('pin-screen');
const errorScreen = document.getElementById('error-screen');
const pinInput = document.getElementById('pin-input');
const dashboard = document.getElementById('view-admin');
const agendarLink = document.getElementById('btn-agendar-link');

// ── Initialize: validate pro exists ────────────────────────
async function init() {
    if (!PRO_ID) {
        pinScreen.style.display = 'none';
        errorScreen.style.display = 'block';
        return;
    }

    const profile = await loadProfessionalProfile(db, PRO_ID);
    if (!profile) {
        pinScreen.style.display = 'none';
        errorScreen.style.display = 'block';
        return;
    }

    // Show professional name on PIN screen
    const pinProName = document.getElementById('pin-pro-name');
    if (pinProName) pinProName.textContent = `Ingresa tu PIN, ${profile.name}`;

    // Set agendar link
    if (agendarLink) {
        const base = window.location.pathname.replace('admin.html', '');
        agendarLink.href = `${base}index.html?pro=${PRO_ID}`;
    }

    // Check session
    if (sessionStorage.getItem(PIN_SESSION_KEY) === 'true') {
        showDashboard();
    }
}

async function verifyPin() {
    const entered = pinInput.value.trim();
    if (!entered) { showToast("Ingresa tu PIN.", "error"); return; }

    const btn = document.getElementById('btn-pin-submit');
    btn.disabled = true;
    btn.innerText = 'Verificando...';

    try {
        const profile = await loadProfessionalProfile(db, PRO_ID);
        const storedPin = profile ? profile.pin : null;

        if (entered === storedPin) {
            sessionStorage.setItem(PIN_SESSION_KEY, 'true');
            showDashboard();
        } else {
            showToast("PIN incorrecto.", "error");
            pinInput.value = '';
            pinInput.focus();
        }
    } catch (e) {
        showToast("Error de conexi\u00f3n.", "error");
    } finally {
        btn.disabled = false;
        btn.innerText = 'Ingresar';
    }
}

function showDashboard() {
    pinScreen.style.display = 'none';
    dashboard.style.display = 'block';
    if (agendarLink) agendarLink.style.display = 'flex';
    initDashboard();
}

document.getElementById('btn-pin-submit')?.addEventListener('click', verifyPin);
pinInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') verifyPin(); });

// ── Change PIN ─────────────────────────────────────────────
document.getElementById('btn-change-pin')?.addEventListener('click', async () => {
    const newPin = document.getElementById('new-pin').value.trim();
    const confirmPin = document.getElementById('confirm-pin').value.trim();

    if (newPin.length < 4) { showToast("El PIN debe tener al menos 4 d\u00edgitos.", "error"); return; }
    if (newPin !== confirmPin) { showToast("Los PIN no coinciden.", "error"); return; }
    if (!/^\d+$/.test(newPin)) { showToast("El PIN debe contener solo n\u00fameros.", "error"); return; }

    try {
        await updateDoc(proDoc(db, PRO_ID), { pin: newPin });
        showToast("PIN actualizado correctamente.", "success");
        document.getElementById('new-pin').value = '';
        document.getElementById('confirm-pin').value = '';
    } catch (e) {
        console.error("Error changing PIN:", e);
        showToast("Error al cambiar el PIN.", "error");
    }
});

// ── Logout ─────────────────────────────────────────────────
document.getElementById('btn-logout')?.addEventListener('click', () => {
    sessionStorage.removeItem(PIN_SESSION_KEY);
    dashboard.style.display = 'none';
    if (agendarLink) agendarLink.style.display = 'none';
    pinScreen.style.display = 'block';
    pinInput.value = '';
    pinInput.focus();
});

// ── Dashboard State ────────────────────────────────────────
const TODAY_STR = formatDateYMD(new Date());
let currentMonth = new Date();
let currentData = { appointments: [], blocks: [] };
let appointmentsByDay = {};
let blocksByDay = {};
let configData = { startTime: "", endTime: "", lunchStart: "", lunchEnd: "" };

let unsubDateApp = null;
let unsubDateBlock = null;
let unsubIndicators = null;
let dashboardInitialized = false;

// ── DOM references (dashboard) ─────────────────────────────
const picker = document.getElementById('admin-date-picker');
const calendarRootAdmin = document.getElementById('calendar-root-admin');
const adminTimeGrid = document.getElementById('admin-time-grid');
const appointmentsSection = document.getElementById('appointments-section');
const adminAppointmentsList = document.getElementById('admin-appointments-list');
const remindersList = document.getElementById('reminders-list');

// ── Initialize dashboard (only once, after PIN) ────────────
async function initDashboard() {
    if (dashboardInitialized) return;
    dashboardInitialized = true;

    picker.value = TODAY_STR;
    configData = await loadProfessionalSettings(db, PRO_ID);
    loadDateData();
    listenMonthIndicators();
}

// ── Load data for selected date (with cleanup) ────────────
function loadDateData() {
    const date = picker.value;
    if (!date) return;

    if (unsubDateApp) unsubDateApp();
    if (unsubDateBlock) unsubDateBlock();

    const qApp = query(apptCollection(db, PRO_ID), where("date", "==", date));
    unsubDateApp = onSnapshot(qApp, (snap) => {
        currentData.appointments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderAll();
    });

    const qBlock = query(blocksCollection(db, PRO_ID), where("date", "==", date));
    unsubDateBlock = onSnapshot(qBlock, (snap) => {
        currentData.blocks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderAll();
    });
}

// ── Month indicators ───────────────────────────────────────
function listenMonthIndicators() {
    if (unsubIndicators) unsubIndicators();

    const year = currentMonth.getFullYear();
    const month = String(currentMonth.getMonth() + 1).padStart(2, '0');
    const startStr = `${year}-${month}-01`;
    const endStr = `${year}-${month}-31`;

    const qApp = query(apptCollection(db, PRO_ID),
        where("date", ">=", startStr), where("date", "<=", endStr));
    const qBlock = query(blocksCollection(db, PRO_ID),
        where("date", ">=", startStr), where("date", "<=", endStr));

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

// ── Render functions ───────────────────────────────────────
function renderAll() {
    renderTimeGrid();
    renderAppointments();
    appointmentsSection.classList.remove('appointments-section-hidden');
}

function renderTimeGrid() {
    adminTimeGrid.innerHTML = '';

    TIME_SLOTS.forEach(time => {
        const isAppointed = currentData.appointments.find(a => a.time === time && a.status === STATUS.CONFIRMED);
        const isBlockedByDay = currentData.blocks.find(b => b.time === time || b.time === 'all');
        const isGlobalBlocked = isOutsideBusinessHours(time, configData);
        const isBlocked = isBlockedByDay || isGlobalBlocked;

        const slot = document.createElement('div');
        slot.className = `time-slot time-slot--admin`;
        if (isAppointed) slot.classList.add('active');
        if (isGlobalBlocked) slot.classList.add('time-slot--global-blocked');
        else if (isBlockedByDay) slot.classList.add('time-slot--manual-blocked');

        let statusLabel = 'Libre';
        if (isAppointed) statusLabel = 'Ocupado';
        else if (isGlobalBlocked) statusLabel = 'Fuera';
        else if (isBlockedByDay) statusLabel = 'Bloq.';

        slot.innerHTML = `
            <div class="slot-time">${time}</div>
            <div class="slot-status">${statusLabel}</div>
            <button class="slot-toggle-btn" data-time="${time}" data-blocked="${!!isBlockedByDay}" ${isGlobalBlocked ? 'disabled' : ''}>
                ${isBlockedByDay ? 'Abrir' : 'Cerrar'}
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

        const notesDot = app.notes
            ? `<span class="notes-dot" title="Tiene observaciones"></span>`
            : '';

        card.innerHTML = `
            <div class="appointment-row">
                <div class="appointment-info">
                    <div class="time">${sanitize(app.time)} ${notesDot}</div>
                    <div class="name">${sanitize(app.patientName)}</div>
                    <div class="service">${sanitize(app.serviceName)}</div>
                    ${app.patientRut ? `<div class="detail">RUT: ${sanitize(app.patientRut)}</div>` : ''}
                    <div class="detail">Tel: ${sanitize(app.patientPhone || 'N/A')}</div>
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

// ── Event delegation ───────────────────────────────────────
document.getElementById('admin-app').addEventListener('click', (e) => {
    const editBtn = e.target.closest('[data-id].btn-edit-outline');
    if (editBtn) { openEdit(editBtn.dataset.id); return; }

    const cancelBtn = e.target.closest('[data-id].btn-cancel-outline');
    if (cancelBtn) { cancelApp(cancelBtn.dataset.id); return; }
});

adminTimeGrid.addEventListener('click', (e) => {
    const toggleBtn = e.target.closest('.slot-toggle-btn');
    if (toggleBtn && !toggleBtn.disabled) {
        toggleBlock(toggleBtn.dataset.time, toggleBtn.dataset.blocked === 'true');
    }
});

// ── Block/Unblock ──────────────────────────────────────────
async function toggleBlock(time, currentlyBlocked) {
    const date = picker.value;
    try {
        if (currentlyBlocked) {
            const b = currentData.blocks.find(b => b.time === time || b.time === 'all');
            if (b) await deleteDoc(blockDoc(db, PRO_ID, b.id));
        } else {
            await setDoc(blockDoc(db, PRO_ID, `${date}_${time}`), { date, time, createdAt: new Date() });
        }
    } catch (e) {
        console.error("Error toggling block:", e);
        showToast("Error al modificar el bloqueo.", "error");
    }
}

document.getElementById('btn-block-day')?.addEventListener('click', async () => {
    const date = picker.value;
    try {
        await setDoc(blockDoc(db, PRO_ID, `${date}_all`), { date, time: "all", createdAt: new Date() });
        showToast("D\u00eda bloqueado.", "success");
    } catch (e) {
        showToast("Error al bloquear.", "error");
    }
});

document.getElementById('btn-unblock-day')?.addEventListener('click', async () => {
    const date = picker.value;
    try {
        const q = query(blocksCollection(db, PRO_ID), where("date", "==", date));
        const snap = await getDocs(q);
        const batch = writeBatch(db);
        snap.forEach(d => batch.delete(d.ref));
        await batch.commit();
        showToast("Bloqueos eliminados.", "success");
    } catch (e) {
        showToast("Error al limpiar.", "error");
    }
});

// ── Edit modal ─────────────────────────────────────────────
const editModal = document.getElementById('edit-modal');
const editTimeSelect = document.getElementById('edit-time');
populateTimeSelect(editTimeSelect);

function openEdit(id) {
    const app = currentData.appointments.find(a => a.id === id);
    if (!app) return;

    document.getElementById('edit-id').value = id;
    document.getElementById('edit-name').value = app.patientName || '';
    document.getElementById('edit-phone').value = app.patientPhone || '';
    document.getElementById('edit-rut').value = app.patientRut || '';
    document.getElementById('edit-notes').value = app.notes || '';
    editTimeSelect.value = app.time;
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
        notes: document.getElementById('edit-notes').value,
        time: editTimeSelect.value
    };
    const btn = document.getElementById('btn-modal-save');
    btn.disabled = true;
    btn.innerText = 'Guardando...';
    try {
        await updateDoc(apptDoc(db, PRO_ID, id), updates);
        editModal.style.display = 'none';
        showToast("Cita actualizada.", "success");
    } catch (e) {
        showToast("Error al actualizar.", "error");
    } finally {
        btn.disabled = false;
        btn.innerText = 'Guardar';
    }
});

// ── Cancel appointment ─────────────────────────────────────
async function cancelApp(id) {
    if (!confirm("\u00bfCancelar esta cita?")) return;
    try {
        const app = currentData.appointments.find(a => a.id === id);
        await deleteDoc(apptDoc(db, PRO_ID, id));
        showToast("Cita cancelada.", "success");

        if (app && app.patientPhone && confirm("\u00bfEnviar aviso por WhatsApp?")) {
            const msg = `Hola ${app.patientName}, tu cita del ${app.date} a las ${app.time} fue cancelada. Cont\u00e1ctanos para reagendar.`;
            window.open(`https://wa.me/56${app.patientPhone}?text=${encodeURIComponent(msg)}`, '_blank');
        }
    } catch (e) {
        showToast("Error al cancelar.", "error");
    }
}

// ── Tab navigation ─────────────────────────────────────────
const tabs = { agenda: 'tab-content-agenda', reminders: 'tab-content-reminders', settings: 'tab-content-settings' };
const titles = { agenda: 'Agenda', reminders: 'Avisos', settings: 'Configuraci\u00f3n' };
const subtitles = { agenda: 'Gestiona bloqueos y fechas', reminders: 'Seguimiento y recordatorios', settings: 'Horarios y acceso' };

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
    configData = await loadProfessionalSettings(db, PRO_ID);
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
        const newSettings = {
            startTime: document.getElementById('set-start').value,
            endTime: document.getElementById('set-end').value,
            lunchStart: document.getElementById('set-lunch-start').value,
            lunchEnd: document.getElementById('set-lunch-end').value
        };
        await updateDoc(proDoc(db, PRO_ID), { settings: newSettings });
        configData = newSettings;
        showToast("Configuraci\u00f3n guardada.", "success");
    } catch (e) {
        showToast("Error al guardar.", "error");
    } finally {
        btn.disabled = false;
        btn.innerText = 'Guardar Configuraci\u00f3n';
    }
});

// ── Reminders ──────────────────────────────────────────────
async function loadReminders() {
    remindersList.innerHTML = '<p class="text-muted text-center loading-text">Cargando...</p>';

    try {
        const now = new Date();
        const rangeDates = [];
        for (let i = 0; i < 5; i++) {
            const d = new Date();
            d.setDate(d.getDate() + i);
            rangeDates.push(formatDateYMD(d));
        }

        const q = query(
            apptCollection(db, PRO_ID),
            where("date", ">=", rangeDates[0]),
            where("date", "<=", rangeDates[rangeDates.length - 1])
        );
        const snap = await getDocs(q);
        const allApps = snap.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .filter(a => a.status === STATUS.CONFIRMED);

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

        remindersList.innerHTML = '<h3 class="section-title">Pr\u00f3ximos 5 d\u00edas</h3>';
        reminders
            .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
            .forEach(app => {
                const card = document.createElement('div');
                card.className = 'pro-card';

                const appDateObj = new Date(app.date + 'T00:00:00');
                const dayName = DAY_NAMES_SHORT[appDateObj.getDay()];

                let label, color, msg;
                if (app.dayOffset === 0) {
                    label = app.type === '2h' ? 'Pronto' : 'Hoy';
                    color = app.type === '2h' ? '#FF9500' : '#007AFF';
                    msg = `Hola ${app.patientName}, te recordamos tu hora de hoy a las ${app.time}.`;
                } else if (app.dayOffset === 1) {
                    label = 'Ma\u00f1ana'; color = '#34C759';
                    msg = `Hola ${app.patientName}, te recordamos tu hora para ma\u00f1ana ${dayName} a las ${app.time}.`;
                } else {
                    label = `${dayName} (${app.dayOffset}d)`; color = '#5856D6';
                    msg = `Hola ${app.patientName}, te recordamos tu cita del ${dayName} ${app.date} a las ${app.time}.`;
                }

                card.style.borderLeftColor = color;
                card.innerHTML = `
                    <div class="reminder-row">
                        <div class="reminder-info">
                            <span class="reminder-label" style="color: ${color};">${label}</span>
                            <div class="reminder-title">${sanitize(app.time)} - ${sanitize(app.patientName)}</div>
                            <div class="reminder-detail">${sanitize(app.serviceName)}</div>
                        </div>
                        <a href="https://wa.me/56${sanitize(app.patientPhone)}?text=${encodeURIComponent(msg)}" target="_blank" class="btn-whatsapp">WA</a>
                    </div>
                `;
                remindersList.appendChild(card);
            });
    } catch (e) {
        console.error("Error loading reminders:", e);
        remindersList.innerHTML = '<p class="text-muted text-center">Error al cargar recordatorios.</p>';
    }
}

// ── Start ──────────────────────────────────────────────────
init();
