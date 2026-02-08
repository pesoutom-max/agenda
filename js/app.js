import { db } from './firebase-init.js';
import {
    collection, addDoc, getDocs, query, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
    STATUS, TIME_SLOTS, sanitize, showToast, validateRut, validateEmail,
    renderCalendar, loadBusinessSettings, isOutsideBusinessHours, formatDateYMD
} from './shared.js';

// ── State ──────────────────────────────────────────────────
let bookingData = { service: '', date: '', time: '', name: '', phone: '', email: '' };
let configData = { startTime: "", endTime: "", lunchStart: "", lunchEnd: "" };
let currentMonth = new Date();
let wpUrl = '';
const isProfessional = new URLSearchParams(window.location.search).get('view') === 'pro';

// ── DOM references ─────────────────────────────────────────
const calendarRoot = document.getElementById('calendar-root');
const datePicker = document.getElementById('date-picker');
const timeContainer = document.getElementById('time-selection-container');
const patientTimeGrid = document.getElementById('patient-time-grid');
const btnServices = document.getElementById('btn-services');
const btnDatetime = document.getElementById('btn-datetime');

// ── Professional mode banner ───────────────────────────────
if (isProfessional) {
    document.querySelector('.logo').innerHTML += ' <span class="pro-label">(Modo Pro)</span>';
    const backBtn = document.createElement('a');
    backBtn.href = 'admin.html';
    backBtn.innerText = '\u2190 Volver al Panel';
    backBtn.className = 'pro-back-link';
    document.body.appendChild(backBtn);
}

// ── Navigation ─────────────────────────────────────────────
function goTo(screenId) {
    document.querySelectorAll('main section').forEach(s => s.style.display = 'none');
    const target = document.getElementById(screenId);
    if (target) {
        target.style.display = 'block';
        window.scrollTo(0, 0);
    }
}

// ── Back buttons ───────────────────────────────────────────
document.getElementById('btn-back-services')?.addEventListener('click', () => goTo('screen-start'));
document.getElementById('btn-back-datetime')?.addEventListener('click', () => goTo('screen-services'));
document.getElementById('btn-back-data')?.addEventListener('click', () => goTo('screen-datetime'));
document.getElementById('btn-back-rut')?.addEventListener('click', () => {
    // Re-enable the "Siguiente" button when going back
    const btn = document.querySelector('#screen-data .btn-primary');
    if (btn) { btn.disabled = false; btn.innerText = 'Siguiente'; }
    goTo('screen-data');
});

// ── Service selection ──────────────────────────────────────
document.querySelectorAll('.selectable-card').forEach(card => {
    card.addEventListener('click', () => {
        const name = card.dataset.service;
        const duration = card.dataset.duration;
        bookingData.service = name;
        document.querySelectorAll('.selectable-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        btnServices.disabled = false;
    });
});

// ── Static button handlers ─────────────────────────────────
document.getElementById('btn-start')?.addEventListener('click', () => goTo('screen-services'));
btnServices?.addEventListener('click', () => goTo('screen-datetime'));
btnDatetime?.addEventListener('click', () => goTo('screen-data'));
document.getElementById('btn-confirm')?.addEventListener('click', confirmBooking);
document.getElementById('btn-save-rut')?.addEventListener('click', saveRutAndFinish);
document.getElementById('btn-open-wp')?.addEventListener('click', () => { window.location.href = wpUrl; });
document.getElementById('btn-cancel-confirm')?.addEventListener('click', confirmCancellation);
document.getElementById('btn-cancel-keep')?.addEventListener('click', () => goTo('screen-start'));
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

// ── Check availability for selected date ───────────────────
async function checkAvailability() {
    const date = datePicker.value;
    if (!date) return;

    timeContainer.style.display = 'block';
    patientTimeGrid.innerHTML = '<p class="grid-message grid-message--loading">Cargando disponibilidad...</p>';
    btnDatetime.disabled = true;

    try {
        const qApp = query(
            collection(db, "appointments"),
            where("date", "==", date),
            where("status", "==", STATUS.CONFIRMED)
        );
        const qBlock = query(collection(db, "blocks"), where("date", "==", date));

        const [snapApp, snapBlock] = await Promise.all([getDocs(qApp), getDocs(qBlock)]);

        const takenTimes = snapApp.docs.map(d => d.data().time);
        const blockedTimes = snapBlock.docs.map(d => d.data().time);
        const isDayBlocked = blockedTimes.includes('all');

        patientTimeGrid.innerHTML = '';
        let slotsRendered = 0;

        TIME_SLOTS.forEach(time => {
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
    btnDatetime.disabled = false;
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
        // Race condition check: verify slot is still available before saving
        const checkQuery = query(
            collection(db, "appointments"),
            where("date", "==", bookingData.date),
            where("time", "==", bookingData.time),
            where("status", "==", STATUS.CONFIRMED)
        );
        const existing = await getDocs(checkQuery);
        if (!existing.empty) {
            showToast("Este horario acaba de ser reservado por otro paciente. Por favor elige otro.", "error");
            btn.disabled = false;
            btn.innerText = 'Confirmar y Agendar';
            goTo('screen-datetime');
            checkAvailability();
            return;
        }

        await addDoc(collection(db, "appointments"), {
            serviceName: bookingData.service,
            date: bookingData.date,
            time: bookingData.time,
            patientName: bookingData.name,
            patientPhone: bookingData.phone,
            patientEmail: bookingData.email,
            patientRut: rut,
            status: STATUS.CONFIRMED,
            createdAt: serverTimestamp()
        });

        // Prepare WhatsApp message
        const msg = `Su hora ha sido agendada para ${bookingData.service} el d\u00eda ${bookingData.date} a las ${bookingData.time}. Muchas gracias`;
        wpUrl = `https://wa.me/56${bookingData.phone}?text=${encodeURIComponent(msg)}`;

        document.getElementById('success-detail').textContent =
            `Te esperamos el ${bookingData.date} a las ${bookingData.time}.`;
        goTo('screen-success');

        setTimeout(() => { window.location.href = wpUrl; }, 3000);
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

// ── Handle #cancel hash ────────────────────────────────────
if (window.location.hash === '#cancel') {
    goTo('screen-cancel');
}

// ── Initialize ─────────────────────────────────────────────
async function init() {
    configData = await loadBusinessSettings(db);
    renderPatientCalendar();
}

init();
