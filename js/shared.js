import { collection, getDocs, getDoc, doc, query } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ── Constants ──────────────────────────────────────────────
export const STATUS = {
    CONFIRMED: 'confirmed',
    CANCELLED: 'cancelled'
};

export const TIME_SLOTS = window.TIME_SLOTS;

const MONTH_NAMES = [
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
];

const DAY_NAMES = ["L", "M", "M", "J", "V", "S", "D"];

const DAY_NAMES_SHORT = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
export { DAY_NAMES_SHORT };

// ── Multi-tenant helpers ───────────────────────────────────
export function proDoc(db, proId) {
    return doc(db, "professionals", proId);
}

export function apptCollection(db, proId) {
    return collection(db, "professionals", proId, "appointments");
}

export function blocksCollection(db, proId) {
    return collection(db, "professionals", proId, "blocks");
}

export function apptDoc(db, proId, apptId) {
    return doc(db, "professionals", proId, "appointments", apptId);
}

export function blockDoc(db, proId, blockId) {
    return doc(db, "professionals", proId, "blocks", blockId);
}

// ── Load professional settings ─────────────────────────────
export async function loadProfessionalSettings(db, proId) {
    try {
        const snap = await getDoc(proDoc(db, proId));
        if (snap.exists()) {
            const data = snap.data();
            return data.settings || { startTime: "", endTime: "", lunchStart: "", lunchEnd: "" };
        }
    } catch (e) {
        console.error("Error loading professional settings:", e);
    }
    return { startTime: "", endTime: "", lunchStart: "", lunchEnd: "" };
}

// ── Load professional profile ──────────────────────────────
export async function loadProfessionalProfile(db, proId) {
    try {
        const snap = await getDoc(proDoc(db, proId));
        if (snap.exists()) return { id: snap.id, ...snap.data() };
    } catch (e) {
        console.error("Error loading professional:", e);
    }
    return null;
}

// ── Sanitization (XSS prevention) ──────────────────────────
export function sanitize(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ── Date helpers ───────────────────────────────────────────
export function formatDateYMD(date) {
    return date.getFullYear() + '-' +
        String(date.getMonth() + 1).padStart(2, '0') + '-' +
        String(date.getDate()).padStart(2, '0');
}

export function todayStr() {
    return formatDateYMD(new Date());
}

// ── Toast notifications (replaces alert()) ─────────────────
export function showToast(message, type = 'info') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('toast-visible'));

    setTimeout(() => {
        toast.classList.remove('toast-visible');
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

// ── RUT validation (Chilean ID, modulo 11) ─────────────────
export function validateRut(rut) {
    if (!rut) return false;
    rut = rut.replace(/[.\-\s]/g, '').toUpperCase();
    if (rut.length < 2) return false;

    const body = rut.slice(0, -1);
    const dv = rut.slice(-1);

    if (!/^\d+$/.test(body)) return false;

    let sum = 0;
    let multiplier = 2;
    for (let i = body.length - 1; i >= 0; i--) {
        sum += parseInt(body[i]) * multiplier;
        multiplier = multiplier === 7 ? 2 : multiplier + 1;
    }

    const remainder = 11 - (sum % 11);
    let expectedDv;
    if (remainder === 11) expectedDv = '0';
    else if (remainder === 10) expectedDv = 'K';
    else expectedDv = String(remainder);

    return dv === expectedDv;
}

// ── Email validation ───────────────────────────────────────
export function validateEmail(email) {
    if (!email) return true; // optional field
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ── Calendar component (unified) ───────────────────────────
export function renderCalendar({
    rootElement,
    currentMonth,
    selectedDate,
    disablePastDays = false,
    appointmentDays = {},
    blockedDays = {},
    onDateSelect,
    onMonthChange
}) {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayDateStr = formatDateYMD(today);

    const firstDayOfMonth = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const startOffset = (firstDayOfMonth === 0) ? 6 : firstDayOfMonth - 1;

    // Set up event delegation (once per root element)
    if (!rootElement._calendarInit) {
        rootElement._calendarInit = true;
        rootElement.addEventListener('click', (e) => {
            const dayEl = e.target.closest('[data-date]');
            if (dayEl && !dayEl.classList.contains('disabled')) {
                if (rootElement._onDateSelect) rootElement._onDateSelect(dayEl.dataset.date);
                return;
            }
            if (e.target.closest('.calendar-nav-prev')) {
                if (rootElement._onMonthChange) rootElement._onMonthChange(-1);
            }
            if (e.target.closest('.calendar-nav-next')) {
                if (rootElement._onMonthChange) rootElement._onMonthChange(1);
            }
        });
    }

    rootElement._onDateSelect = onDateSelect;
    rootElement._onMonthChange = onMonthChange;

    let html = `
        <div class="calendar-container">
            <div class="calendar-header">
                <button class="calendar-nav-btn calendar-nav-prev" type="button">&laquo;</button>
                <h3>${MONTH_NAMES[month]} ${year}</h3>
                <button class="calendar-nav-btn calendar-nav-next" type="button">&raquo;</button>
            </div>
            <div class="calendar-grid">
                ${DAY_NAMES.map(d => `<div class="calendar-day-name">${d}</div>`).join('')}
    `;

    for (let i = 0; i < startOffset; i++) {
        html += `<div class="calendar-day disabled"></div>`;
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dateObj = new Date(year, month, day);
        const isPast = disablePastDays && dateObj < today;
        const isToday = dateStr === todayDateStr;
        const isSelected = selectedDate === dateStr;
        const hasApp = !!appointmentDays[dateStr];
        const isBlocked = !!blockedDays[dateStr];
        const dotColor = isBlocked ? 'white' : '#FF3B30';

        const classes = [
            'calendar-day',
            isPast ? 'disabled' : '',
            isToday ? 'today' : '',
            isSelected ? 'selected' : '',
            isBlocked ? 'is-blocked' : '',
            hasApp ? 'has-appointment' : ''
        ].filter(Boolean).join(' ');

        const style = hasApp ? `--dot-color: ${dotColor};` : '';

        html += `<div class="${classes}" style="position:relative;${style}" ${isPast ? '' : `data-date="${dateStr}"`}>${day}</div>`;
    }

    html += `</div></div>`;
    rootElement.innerHTML = html;
}

// ── Check if time slot is outside business hours ───────────
export function isOutsideBusinessHours(time, config) {
    const isBeforeStart = config.startTime && time < config.startTime;
    const isAfterEnd = config.endTime && time > config.endTime;
    const isDuringLunch = (config.lunchStart && config.lunchEnd) &&
        (time >= config.lunchStart && time < config.lunchEnd);
    return isBeforeStart || isAfterEnd || isDuringLunch;
}

// ── Populate a <select> with time slot options ─────────────
export function populateTimeSelect(selectEl) {
    selectEl.innerHTML = '';
    TIME_SLOTS.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t;
        opt.textContent = t;
        selectEl.appendChild(opt);
    });
}
