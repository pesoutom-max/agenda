import { db } from './firebase-init.js';
import {
    addDoc, getDocs, query, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
    STATUS, sanitize, showToast, validateRut, validateEmail,
    renderCalendar, isOutsideBusinessHours, formatDateYMD,
    apptCollection, blocksCollection, loadProfessionalSettings, loadProfessionalProfile,
    generateTimeSlots, DEFAULT_SLOT_INTERVAL
} from './shared.js';

// ── Read professional ID from URL ───────────────────────────
const params = new URLSearchParams(window.location.search);
const PRO_ID = params.get('pro');

// ── State ──────────────────────────────────────────────────
let bookingData = { service: '', duration: 30, date: '', time: '', name: '', phone: '', email: '' };
let configData = { startTime: "", endTime: "", lunchStart: "", lunchEnd: "", slotInterval: DEFAULT_SLOT_INTERVAL };
let timeSlots = generateTimeSlots(DEFAULT_SLOT_INTERVAL);
let currentMonth = new Date();
let gcalUrl = '';
let proPhone = '';

// ── DOM references ─────────────────────────────────────────
const calendarRoot = document.getElementById('calendar-root');
const datePicker = document.getElementById('date-picker');
const timeContainer = document.getElementById('time-selection-container');
const patientTimeGrid = document.getElementById('patient-time-grid');
const btnServices = document.getElementById('btn-services');
const btnTime = document.getElementById('btn-time');
const servicesCardList = document.getElementById('services-card-list');

// ── Navigation ─────────────────────────────────────────────
function goTo(screenId) {
    document.querySelectorAll('main section').forEach(s => s.style.display = 'none');
    const target = document.getElementById(screenId);
    if (target) {
        target.style.display = 'block';
        window.scrollTo(0, 0);
    }
}

// ── Validate professional exists ───────────────────────────
async function init() {
    if (!PRO_ID) {
        goTo('screen-error');
        return;
    }

    let profile;
    try {
        profile = await loadProfessionalProfile(db, PRO_ID);
    } catch (e) {
        const errScreen = document.getElementById('screen-error');
        const errTitle = errScreen?.querySelector('h1');
        const errSub = errScreen?.querySelector('.subtitle');
        if (errTitle) errTitle.textContent = 'Error de acceso';
        if (errSub) errSub.textContent = 'No se pudo conectar a la base de datos. Verifica las reglas de Firestore.';
        goTo('screen-error');
        return;
    }

    if (!profile) {
        goTo('screen-error');
        return;
    }

    // Show professional name in header
    const headerName = document.getElementById('header-pro-name');
    if (headerName) headerName.textContent = profile.name;

    // Load professional phone for WA routing
    proPhone = profile.phone || '';

    configData = await loadProfessionalSettings(db, PRO_ID);
    timeSlots = generateTimeSlots(configData.slotInterval);

    // Load services dynamically
    const services = (profile.services && profile.services.length > 0) ? profile.services : [];
    renderServices(services);

    renderPatientCalendar();

    if (window.location.hash === '#cancel') {
        goTo('screen-cancel');
    } else {
        goTo('screen-start');
    }
}

// ── Render services from professional config ───────────────
function renderServices(services) {
    servicesCardList.innerHTML = '';

    if (services.length === 0) {
        servicesCardList.innerHTML = '<p class="text-muted">Este profesional a\u00fan no ha configurado sus servicios.</p>';
        return;
    }

    services.forEach(svc => {
        const card = document.createElement('div');
        card.className = 'selectable-card';
        card.dataset.service = svc.name;
        card.dataset.duration = `${svc.duration} min`;
        card.innerHTML = `<div><h3>${sanitize(svc.name)}</h3><span>${svc.duration} min</span></div>`;

        card.addEventListener('click', () => {
            bookingData.service = svc.name;
            bookingData.duration = svc.duration || 30;
            servicesCardList.querySelectorAll('.selectable-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            btnServices.disabled = false;
        });

        servicesCardList.appendChild(card);
    });
}

// ── Back buttons ───────────────────────────────────────────
document.getElementById('btn-back-services')?.addEventListener('click', () => goTo('screen-start'));
document.getElementById('btn-back-date')?.addEventListener('click', () => goTo('screen-services'));
document.getElementById('btn-back-time')?.addEventListener('click', () => {
    // Si retrocede al calendario, limpiamos la selección de hora
    bookingData.time = '';
    document.querySelectorAll('.time-slot').forEach(t => t.classList.remove('active'));
    btnTime.disabled = true;
    goTo('screen-date');
});
document.getElementById('btn-back-data')?.addEventListener('click', () => goTo('screen-time'));
document.getElementById('btn-back-rut')?.addEventListener('click', () => {
    const btn = document.querySelector('#screen-data .btn-primary');
    if (btn) { btn.disabled = false; btn.innerText = 'Siguiente'; }
    goTo('screen-data');
});

// ── Static button handlers ─────────────────────────────────
document.getElementById('btn-start')?.addEventListener('click', () => goTo('screen-services'));
btnServices?.addEventListener('click', () => goTo('screen-date'));
btnTime?.addEventListener('click', () => goTo('screen-data'));
document.getElementById('btn-confirm')?.addEventListener('click', confirmBooking);
document.getElementById('btn-save-rut')?.addEventListener('click', saveRutAndFinish);
document.getElementById('btn-add-gcal')?.addEventListener('click', () => {
    if (gcalUrl) window.open(gcalUrl, '_blank');
});
document.getElementById('btn-cancel-confirm')?.addEventListener('click', confirmCancellation);
document.getElementById('btn-cancel-keep')?.addEventListener('click', () => goTo('screen-start'));
document.getElementById('btn-new-appointment')?.addEventListener('click', () => location.reload());
document.querySelectorAll('.btn-reload').forEach(btn => btn.addEventListener('click', () => location.reload()));

// ── Phone input: only digits ───────────────────────────────
const phoneInput = document.getElementById('patient-phone');
phoneInput?.addEventListener('input', () => {
    phoneInput.value = phoneInput.value.replace(/[^0-9]/g, '');
});

// ── RUT input: uppercase ───────────────────────────────────
const rutInput = document.getElementById('patient-rut');
rutInput?.addEventListener('input', () => {
    rutInput.value = rutInput.value.toUpperCase();
});

// ── Calendar rendering ─────────────────────────────────────
function renderPatientCalendar() {
    renderCalendar({
        rootElement: calendarRoot,
        currentMonth,
        selectedDate: datePicker.value,
        disablePastDays: true,
        onDateSelect(date) {
            datePicker.value = date;
            renderPatientCalendar();
            checkAvailability();
        },
        onMonthChange(offset) {
            currentMonth.setMonth(currentMonth.getMonth() + offset);
            renderPatientCalendar();
        }
    });
}

async function checkAvailability() {
    const date = datePicker.value;
    if (!date) return;

    // Actualizar el título de la fecha en la pantalla de horas
    const displayDate = new Date(`${date}T12:00:00`);
    const dateStr = displayDate.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
    document.getElementById('selected-date-display').textContent = dateStr;

    // Avanzar a la pantalla de tiempo y mostrar "cargando"
    goTo('screen-time');
    patientTimeGrid.innerHTML = '<p class="grid-message grid-message--loading">Cargando disponibilidad...</p>';
    btnTime.disabled = true;

    try {
        const qApp = query(
            apptCollection(db, PRO_ID),
            where("date", "==", date),
            where("status", "==", STATUS.CONFIRMED)
        );
        const qBlock = query(blocksCollection(db, PRO_ID), where("date", "==", date));

        const [snapApp, snapBlock] = await Promise.all([getDocs(qApp), getDocs(qBlock)]);

        const takenTimes = snapApp.docs.map(d => d.data().time);
        const blockedTimes = snapBlock.docs.map(d => d.data().time);
        const isDayBlocked = blockedTimes.includes('all');

        patientTimeGrid.innerHTML = '';
        let slotsRendered = 0;

        timeSlots.forEach(time => {
            if (isOutsideBusinessHours(time, configData)) return;

            slotsRendered++;
            const isTaken = takenTimes.includes(time);
            const isBlocked = isDayBlocked || blockedTimes.includes(time);
            const isUnavailable = isTaken || isBlocked;

            const slot = document.createElement('div');
            slot.className = `time-slot ${isUnavailable ? 'disabled' : ''}`;
            slot.textContent = time;

            if (isUnavailable) {
                slot.classList.add('time-slot--unavailable');
            } else {
                slot.addEventListener('click', () => selectTime(time, slot));
            }
            patientTimeGrid.appendChild(slot);
        });

        if (slotsRendered === 0) {
            patientTimeGrid.innerHTML = '<p class="grid-message grid-message--error">No hay horarios disponibles para este d\u00eda.</p>';
        }
    } catch (e) {
        console.error("Error checking availability:", e);
        patientTimeGrid.innerHTML = '<p class="grid-message grid-message--error">Error al cargar disponibilidad.</p>';
    }
}

function selectTime(time, el) {
    bookingData.time = time;
    document.querySelectorAll('.time-slot').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    btnTime.disabled = false;
}

// ── Confirm booking (step 1: validate patient data) ────────
async function confirmBooking() {
    const name = document.getElementById('patient-name').value.trim();
    bookingData.date = datePicker.value;
    const phone = document.getElementById('patient-phone').value.trim();
    const email = document.getElementById('patient-email').value.trim();

    if (!name) {
        showToast("Por favor, ingresa tu nombre.", "error");
        return;
    }
    if (phone.length !== 9) {
        showToast("Ingresa un n\u00famero de tel\u00e9fono v\u00e1lido de 9 d\u00edgitos.", "error");
        return;
    }
    if (!validateEmail(email)) {
        showToast("El correo electr\u00f3nico no es v\u00e1lido.", "error");
        return;
    }

    bookingData.name = name;
    bookingData.phone = phone;
    bookingData.email = email;

    const btn = document.getElementById('btn-confirm');
    btn.disabled = true;
    btn.innerText = 'Verificando...';

    try {
        goTo('screen-rut');
    } finally {
        btn.disabled = false;
        btn.innerText = 'Siguiente';
    }
}

// ── Save RUT and finish booking ────────────────────────────
async function saveRutAndFinish() {
    const rut = document.getElementById('patient-rut').value.trim();
    const btn = document.getElementById('btn-save-rut');

    if (rut && !validateRut(rut)) {
        showToast("El RUT ingresado no es v\u00e1lido. Verifica el d\u00edgito verificador.", "error");
        return;
    }

    btn.disabled = true;
    btn.innerText = 'Guardando...';

    try {
        const checkQuery = query(
            apptCollection(db, PRO_ID),
            where("date", "==", bookingData.date),
            where("time", "==", bookingData.time),
            where("status", "==", STATUS.CONFIRMED)
        );
        const existing = await getDocs(checkQuery);
        if (!existing.empty) {
            showToast("Este horario acaba de ser reservado por otro paciente. Por favor elige otro.", "error");
            btn.disabled = false;
            btn.innerText = 'Confirmar y Agendar';
            goTo('screen-time');
            checkAvailability();
            return;
        }

        await addDoc(apptCollection(db, PRO_ID), {
            serviceName: bookingData.service,
            date: bookingData.date,
            time: bookingData.time,
            patientName: bookingData.name,
            patientPhone: bookingData.phone,
            patientEmail: bookingData.email,
            patientRut: rut,
            notes: '',
            status: STATUS.CONFIRMED,
            createdAt: serverTimestamp()
        });

        // Generar enlace de Google Calendar
        const startDateObj = new Date(`${bookingData.date}T${bookingData.time}:00`);
        const endDateObj = new Date(startDateObj.getTime() + bookingData.duration * 60000);

        const formatGCalDate = (d) => {
            // Convierte a formato YYYYMMDDTHHMMSSZ (UTC)
            return d.toISOString().replace(/-|:|\.\d\d\d/g, "");
        };

        const startStr = formatGCalDate(startDateObj);
        const endStr = formatGCalDate(endDateObj);

        const proName = document.getElementById('header-pro-name').textContent;
        const gcalTitle = `Cita: ${bookingData.service}`;
        const gcalDetails = `Cita agendada con ${proName} a través de FacilPyme.\\nPaciente: ${bookingData.name}\\nTeléfono: ${bookingData.phone}`;

        gcalUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(gcalTitle)}&dates=${startStr}/${endStr}&details=${encodeURIComponent(gcalDetails)}`;

        document.getElementById('success-detail').textContent =
            `Te esperamos el ${bookingData.date} a las ${bookingData.time}.`;
        goTo('screen-success');

    } catch (e) {
        console.error("Error finishing booking:", e);
        showToast("Hubo un error al guardar la reserva. Int\u00e9ntalo de nuevo.", "error");
        btn.disabled = false;
        btn.innerText = 'Confirmar y Agendar';
    }
}

// ── Cancellation ───────────────────────────────────────────
function confirmCancellation() {
    const nameEl = document.querySelector('.wa-name-c');
    const datetimeEl = document.querySelector('.wa-datetime-c');
    if (nameEl) nameEl.textContent = bookingData.name || "Paciente";
    if (datetimeEl) datetimeEl.textContent = `${bookingData.date} a las ${bookingData.time}`;
    goTo('screen-cancel-success');
}

// ── Start ──────────────────────────────────────────────────
init();
