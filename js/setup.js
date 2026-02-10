import { db } from './firebase-init.js';
import {
    collection, doc, getDoc, setDoc, getDocs, deleteDoc, updateDoc, query, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { sanitize, showToast } from './shared.js';

// ── Constants ───────────────────────────────────────────────
const MASTER_PIN_KEY = 'facilpyme_master_auth';
const DEFAULT_MASTER_PIN = '0000';

// ── DOM references ──────────────────────────────────────────
const pinScreen = document.getElementById('setup-pin-screen');
const dashboard = document.getElementById('setup-dashboard');
const pinInput = document.getElementById('master-pin-input');
const proList = document.getElementById('professionals-list');

// ── Master PIN ──────────────────────────────────────────────
async function getMasterPin() {
    try {
        const snap = await getDoc(doc(db, "config", "master"));
        return snap.exists() ? snap.data().pin : DEFAULT_MASTER_PIN;
    } catch (e) {
        console.error("Error fetching master PIN:", e);
        return DEFAULT_MASTER_PIN;
    }
}

async function verifyMasterPin() {
    const entered = pinInput.value.trim();
    if (!entered) { showToast("Ingresa el PIN maestro.", "error"); return; }

    const btn = document.getElementById('btn-master-pin');
    btn.disabled = true;
    btn.innerText = 'Verificando...';

    try {
        const storedPin = await getMasterPin();
        if (entered === storedPin) {
            sessionStorage.setItem(MASTER_PIN_KEY, 'true');
            showSetupDashboard();
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

function showSetupDashboard() {
    pinScreen.style.display = 'none';
    dashboard.style.display = 'block';
    loadProfessionals();
}

document.getElementById('btn-master-pin')?.addEventListener('click', verifyMasterPin);
pinInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') verifyMasterPin(); });

if (sessionStorage.getItem(MASTER_PIN_KEY) === 'true') {
    showSetupDashboard();
}

// ── Load professionals list ─────────────────────────────────
async function loadProfessionals() {
    proList.innerHTML = '<p class="text-muted text-center">Cargando...</p>';

    try {
        const snap = await getDocs(collection(db, "professionals"));
        const pros = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        if (pros.length === 0) {
            proList.innerHTML = '<p class="text-muted text-center">No hay profesionales registrados.</p>';
            return;
        }

        proList.innerHTML = '';
        pros.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        pros.forEach(pro => {
            const card = document.createElement('div');
            card.className = 'pro-card';
            const bookingUrl = `${window.location.origin}${window.location.pathname.replace('setup.html', '')}index.html?pro=${pro.id}`;
            const adminUrl = `${window.location.origin}${window.location.pathname.replace('setup.html', '')}admin.html?pro=${pro.id}`;

            card.innerHTML = `
                <div class="pro-list-row">
                    <div class="pro-list-info">
                        <div class="pro-list-name">${sanitize(pro.name)}</div>
                        <div class="pro-list-slug">ID: ${sanitize(pro.id)}</div>
                        ${pro.phone ? `<div class="pro-list-detail">📞 ${sanitize(pro.phone)}</div>` : ''}
                        ${pro.email ? `<div class="pro-list-detail">✉️ ${sanitize(pro.email)}</div>` : ''}
                        <div class="pro-list-links">
                            <a href="${bookingUrl}" target="_blank" class="pro-link">Reserva</a>
                            <a href="${adminUrl}" target="_blank" class="pro-link pro-link--admin">Admin</a>
                        </div>
                    </div>
                    <div class="pro-list-actions">
                        <button class="btn-edit-outline btn-edit-pro" data-id="${pro.id}" data-name="${sanitize(pro.name)}" data-phone="${sanitize(pro.phone || '')}" data-email="${sanitize(pro.email || '')}">Editar</button>
                        <button class="btn-cancel-outline btn-delete-pro" data-id="${pro.id}">Eliminar</button>
                    </div>
                </div>
            `;
            proList.appendChild(card);
        });
    } catch (e) {
        console.error("Error loading professionals:", e);
        proList.innerHTML = '<p class="text-muted text-center">Error al cargar profesionales.</p>';
    }
}

// ── Create professional ─────────────────────────────────────
document.getElementById('btn-create-pro')?.addEventListener('click', async () => {
    const name = document.getElementById('pro-name').value.trim();
    const phone = document.getElementById('pro-phone').value.trim();
    const email = document.getElementById('pro-email').value.trim();
    const slug = document.getElementById('pro-slug').value.trim().toLowerCase();
    const pin = document.getElementById('pro-pin').value.trim();

    if (!name) { showToast("Ingresa el nombre del profesional.", "error"); return; }
    if (!slug || !/^[a-z0-9\-]+$/.test(slug)) {
        showToast("El identificador solo puede contener letras min\u00fasculas, n\u00fameros y guiones.", "error");
        return;
    }
    if (slug.length < 3) { showToast("El identificador debe tener al menos 3 caracteres.", "error"); return; }
    if (!pin || pin.length < 4 || !/^\d+$/.test(pin)) {
        showToast("El PIN debe tener 4-6 d\u00edgitos num\u00e9ricos.", "error");
        return;
    }

    const btn = document.getElementById('btn-create-pro');
    btn.disabled = true;
    btn.innerText = 'Creando...';

    try {
        const existing = await getDoc(doc(db, "professionals", slug));
        if (existing.exists()) {
            showToast("Ya existe un profesional con ese identificador.", "error");
            btn.disabled = false;
            btn.innerText = 'Crear Profesional';
            return;
        }

        await setDoc(doc(db, "professionals", slug), {
            name,
            phone,
            email,
            slug,
            pin,
            settings: { startTime: "", endTime: "", lunchStart: "", lunchEnd: "", slotInterval: 45 },
            services: [],
            createdAt: serverTimestamp()
        });

        showToast("Profesional creado exitosamente.", "success");
        document.getElementById('pro-name').value = '';
        document.getElementById('pro-phone').value = '';
        document.getElementById('pro-email').value = '';
        document.getElementById('pro-slug').value = '';
        document.getElementById('pro-pin').value = '';
        loadProfessionals();
    } catch (e) {
        console.error("Error creating professional:", e);
        showToast("Error al crear el profesional.", "error");
    } finally {
        btn.disabled = false;
        btn.innerText = 'Crear Profesional';
    }
});

// ── Auto-generate slug from name ────────────────────────────
document.getElementById('pro-name')?.addEventListener('input', () => {
    const name = document.getElementById('pro-name').value;
    const slugInput = document.getElementById('pro-slug');
    if (!slugInput._userEdited) {
        slugInput.value = name.toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }
});

document.getElementById('pro-slug')?.addEventListener('input', () => {
    document.getElementById('pro-slug')._userEdited = true;
});

// ── Edit professional ────────────────────────────────────────
const editModal = document.getElementById('edit-modal');

proList.addEventListener('click', (e) => {
    // Edit button
    const editBtn = e.target.closest('.btn-edit-pro');
    if (editBtn) {
        document.getElementById('edit-pro-id').value = editBtn.dataset.id;
        document.getElementById('edit-pro-name').value = editBtn.dataset.name || '';
        document.getElementById('edit-pro-phone').value = editBtn.dataset.phone || '';
        document.getElementById('edit-pro-email').value = editBtn.dataset.email || '';
        document.getElementById('edit-pro-pin').value = '';
        editModal.style.display = 'flex';
        return;
    }

    // Delete button
    const deleteBtn = e.target.closest('.btn-delete-pro');
    if (deleteBtn) {
        document.getElementById('delete-pro-id').value = deleteBtn.dataset.id;
        deleteModal.style.display = 'flex';
    }
});

document.getElementById('btn-edit-cancel')?.addEventListener('click', () => {
    editModal.style.display = 'none';
});

document.getElementById('btn-edit-save')?.addEventListener('click', async () => {
    const proId = document.getElementById('edit-pro-id').value;
    const name = document.getElementById('edit-pro-name').value.trim();
    const phone = document.getElementById('edit-pro-phone').value.trim();
    const email = document.getElementById('edit-pro-email').value.trim();
    const pin = document.getElementById('edit-pro-pin').value.trim();

    if (!name) { showToast("El nombre no puede estar vacío.", "error"); return; }
    if (pin && (pin.length < 4 || !/^\d+$/.test(pin))) {
        showToast("El PIN debe tener 4-6 dígitos numéricos.", "error");
        return;
    }

    const btn = document.getElementById('btn-edit-save');
    btn.disabled = true;
    btn.innerText = 'Guardando...';

    try {
        const updates = { name, phone, email };
        if (pin) updates.pin = pin;

        await updateDoc(doc(db, "professionals", proId), updates);
        showToast("Profesional actualizado.", "success");
        editModal.style.display = 'none';
        loadProfessionals();
    } catch (e) {
        console.error("Error updating professional:", e);
        showToast("Error al actualizar.", "error");
    } finally {
        btn.disabled = false;
        btn.innerText = 'Guardar Cambios';
    }
});

// ── Delete professional ─────────────────────────────────────
const deleteModal = document.getElementById('delete-modal');

document.getElementById('btn-delete-cancel')?.addEventListener('click', () => {
    deleteModal.style.display = 'none';
});

document.getElementById('btn-delete-confirm')?.addEventListener('click', async () => {
    const proId = document.getElementById('delete-pro-id').value;
    const btn = document.getElementById('btn-delete-confirm');
    btn.disabled = true;
    btn.innerText = 'Eliminando...';

    try {
        // Delete subcollections
        const apptSnap = await getDocs(collection(db, "professionals", proId, "appointments"));
        const blockSnap = await getDocs(collection(db, "professionals", proId, "blocks"));

        const batch = writeBatch(db);
        apptSnap.forEach(d => batch.delete(d.ref));
        blockSnap.forEach(d => batch.delete(d.ref));
        batch.delete(doc(db, "professionals", proId));
        await batch.commit();

        showToast("Profesional eliminado.", "success");
        deleteModal.style.display = 'none';
        loadProfessionals();
    } catch (e) {
        console.error("Error deleting professional:", e);
        showToast("Error al eliminar.", "error");
    } finally {
        btn.disabled = false;
        btn.innerText = 'Eliminar';
    }
});

// ── Change master PIN ───────────────────────────────────────
document.getElementById('btn-change-master-pin')?.addEventListener('click', async () => {
    const newPin = document.getElementById('new-master-pin').value.trim();
    const confirmPin = document.getElementById('confirm-master-pin').value.trim();

    if (newPin.length < 4) { showToast("El PIN debe tener al menos 4 d\u00edgitos.", "error"); return; }
    if (newPin !== confirmPin) { showToast("Los PIN no coinciden.", "error"); return; }
    if (!/^\d+$/.test(newPin)) { showToast("El PIN debe contener solo n\u00fameros.", "error"); return; }

    try {
        await setDoc(doc(db, "config", "master"), { pin: newPin, updatedAt: new Date() });
        showToast("PIN maestro actualizado.", "success");
        document.getElementById('new-master-pin').value = '';
        document.getElementById('confirm-master-pin').value = '';
    } catch (e) {
        showToast("Error al cambiar el PIN.", "error");
    }
});

// ── Logout ──────────────────────────────────────────────────
document.getElementById('btn-setup-logout')?.addEventListener('click', () => {
    sessionStorage.removeItem(MASTER_PIN_KEY);
    dashboard.style.display = 'none';
    pinScreen.style.display = 'block';
    pinInput.value = '';
    pinInput.focus();
});
