const DB_NAME = 'NailScheduleDB';
const DB_VERSION = 1;
let db = null;

// ---- IndexedDB ----
function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const d = e.target.result;
            if (!d.objectStoreNames.contains('days')) {
                d.createObjectStore('days', { keyPath: 'date' });
            }
            if (!d.objectStoreNames.contains('clients')) {
                const store = d.createObjectStore('clients', { keyPath: 'id', autoIncrement: true });
                store.createIndex('date', 'date', { unique: false });
            }
        };
        req.onsuccess = (e) => { db = e.target.result; resolve(db); };
        req.onerror = (e) => reject(e.target.error);
    });
}

function dbGet(store, key) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function dbPut(store, data) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        const req = tx.objectStore(store).put(data);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function dbDelete(store, key) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        const req = tx.objectStore(store).delete(key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

function dbGetAllByIndex(store, indexName, key) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readonly');
        const idx = tx.objectStore(store).index(indexName);
        const req = idx.getAll(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function dbGetAll(store) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

// ---- Helpers ----
function dateKey(y, m, d) {
    return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function formatDate(dateStr) {
    const [y, m, d] = dateStr.split('-');
    const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
        'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    return `${parseInt(d)} ${months[parseInt(m) - 1]} ${y}`;
}

function monthName(m) {
    const names = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
        'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
    return names[m];
}

function readFileAsDataURL(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.readAsDataURL(file);
    });
}

// ---- State ----
let currentYear, currentMonth;
let selectedDate = null;
let editingClientId = null;
let tempManicurePhoto = null;
let tempPaymentPhoto = null;

// ---- Calendar ----
async function renderCalendar() {
    const grid = document.getElementById('calendar-grid');
    const title = document.getElementById('month-title');
    title.textContent = `${monthName(currentMonth)} ${currentYear}`;

    const firstDay = new Date(currentYear, currentMonth, 1).getDay();
    const offset = (firstDay === 0 ? 6 : firstDay - 1);
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

    const today = new Date();
    const todayKey = dateKey(today.getFullYear(), today.getMonth(), today.getDate());

    const allDays = await dbGetAll('days');
    const dayMap = {};
    allDays.forEach(d => { dayMap[d.date] = d; });

    const allClients = await dbGetAll('clients');
    const clientCount = {};
    allClients.forEach(c => {
        clientCount[c.date] = (clientCount[c.date] || 0) + 1;
    });

    let html = '';
    for (let i = 0; i < offset; i++) {
        html += '<div class="calendar-day empty"></div>';
    }

    for (let d = 1; d <= daysInMonth; d++) {
        const key = dateKey(currentYear, currentMonth, d);
        const dayData = dayMap[key];
        const isToday = key === todayKey;
        let cls = 'calendar-day';
        if (isToday) cls += ' today';
        if (dayData) cls += ` ${dayData.type}`;

        const count = clientCount[key] || 0;
        const countHtml = count > 0 ? `<span class="client-count">${count} кл.</span>` : '';

        html += `<div class="${cls}" data-date="${key}">${d}${countHtml}</div>`;
    }

    grid.innerHTML = html;

    grid.querySelectorAll('.calendar-day:not(.empty)').forEach(el => {
        el.addEventListener('click', () => openDay(el.dataset.date));
    });
}

document.getElementById('prev-month').addEventListener('click', () => {
    currentMonth--;
    if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    renderCalendar();
});

document.getElementById('next-month').addEventListener('click', () => {
    currentMonth++;
    if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    renderCalendar();
});

// ---- Day Screen ----
async function openDay(dateStr) {
    selectedDate = dateStr;
    document.getElementById('screen-calendar').classList.remove('active');
    document.getElementById('screen-day').classList.add('active');
    document.getElementById('day-title').textContent = formatDate(dateStr);

    const dayData = await dbGet('days', dateStr);
    const type = dayData ? dayData.type : null;

    updateDayTypeUI(type);
    await renderClients();
}

function updateDayTypeUI(type) {
    const btnWork = document.getElementById('btn-working');
    const btnOff = document.getElementById('btn-dayoff');
    const section = document.getElementById('clients-section');

    btnWork.classList.toggle('active', type === 'working');
    btnOff.classList.toggle('active', type === 'dayoff');

    section.classList.toggle('dayoff-mode', type === 'dayoff');
}

document.getElementById('btn-working').addEventListener('click', async () => {
    await dbPut('days', { date: selectedDate, type: 'working' });
    updateDayTypeUI('working');
});

document.getElementById('btn-dayoff').addEventListener('click', async () => {
    const clients = await dbGetAllByIndex('clients', 'date', selectedDate);
    if (clients.length > 0) {
        alert('Нельзя отметить день как выходной, пока есть записанные клиенты. Сначала удалите всех клиентов этого дня.');
        return;
    }

    await dbPut('days', { date: selectedDate, type: 'dayoff' });
    updateDayTypeUI('dayoff');
});

document.getElementById('back-to-calendar').addEventListener('click', () => {
    document.getElementById('screen-day').classList.remove('active');
    document.getElementById('screen-calendar').classList.add('active');
    renderCalendar();
});

// ---- Clients ----
async function renderClients() {
    const list = document.getElementById('clients-list');
    const clients = await dbGetAllByIndex('clients', 'date', selectedDate);

    let totalSum = 0;
    let html = '';

    clients.forEach(c => {
        totalSum += c.amount || 0;
        const payLabel = c.paymentType === 'cash' ? 'Наличные' : 'Безналичные';
        const payClass = c.paymentType === 'cash' ? 'cash' : 'card';
        const thumbHtml = c.manicurePhoto
            ? `<img src="${c.manicurePhoto}" class="client-card-thumb" alt="фото">`
            : '';

        html += `
        <div class="client-card" data-id="${c.id}">
            <div class="client-card-header">
                <span class="client-card-name">${c.name || 'Клиент'}</span>
                <span class="client-card-amount">${(c.amount || 0).toLocaleString('ru')} ₽</span>
            </div>
            <div class="client-card-info">
                ${thumbHtml}
                <span class="client-card-payment ${payClass}">${payLabel}</span>
            </div>
        </div>`;
    });

    list.innerHTML = html;

    document.getElementById('total-sum').textContent = totalSum.toLocaleString('ru') + ' ₽';
    document.getElementById('total-after-deduction').textContent =
        Math.round(totalSum * 0.6).toLocaleString('ru') + ' ₽';

    list.querySelectorAll('.client-card').forEach(el => {
        el.addEventListener('click', () => openClientModal(parseInt(el.dataset.id)));
    });
}

// ---- Client Modal ----
document.getElementById('add-client-btn').addEventListener('click', () => openClientModal(null));

async function openClientModal(clientId) {
    editingClientId = clientId;
    tempManicurePhoto = null;
    tempPaymentPhoto = null;

    const modal = document.getElementById('modal-client');
    const title = document.getElementById('modal-client-title');
    const nameInput = document.getElementById('client-name');
    const amountInput = document.getElementById('client-amount');
    const deleteBtn = document.getElementById('delete-client-btn');

    document.getElementById('manicure-photo').value = '';
    document.getElementById('payment-photo').value = '';
    resetPreview('manicure-preview');
    resetPreview('payment-preview');

    if (clientId) {
        title.textContent = 'Редактирование';
        deleteBtn.classList.remove('hidden');
        const client = await dbGet('clients', clientId);
        if (client) {
            nameInput.value = client.name || '';
            amountInput.value = client.amount || '';
            setPaymentType(client.paymentType || 'cash');

            if (client.manicurePhoto) {
                tempManicurePhoto = client.manicurePhoto;
                showPreview('manicure-preview', client.manicurePhoto);
            }
            if (client.paymentPhoto) {
                tempPaymentPhoto = client.paymentPhoto;
                showPreview('payment-preview', client.paymentPhoto);
            }
        }
    } else {
        title.textContent = 'Новый клиент';
        deleteBtn.classList.add('hidden');
        const clients = await dbGetAllByIndex('clients', 'date', selectedDate);
        nameInput.value = `Клиент ${clients.length + 1}`;
        amountInput.value = '';
        setPaymentType('cash');
    }

    modal.classList.add('active');
}

function resetPreview(previewId) {
    const preview = document.getElementById(previewId);
    preview.classList.remove('has-photo');
    preview.innerHTML = '<span class="upload-icon">📷</span><span>Нажмите для загрузки</span>';
}

function showPreview(previewId, dataUrl) {
    const preview = document.getElementById(previewId);
    preview.classList.add('has-photo');
    preview.innerHTML = `<img src="${dataUrl}" alt="фото">`;
}

function setPaymentType(type) {
    document.getElementById('pay-cash').classList.toggle('active', type === 'cash');
    document.getElementById('pay-card').classList.toggle('active', type === 'card');
    const baseText = type === 'cash' ? 'Фото оплаты' : 'Скриншот из банка';
    document.getElementById('payment-photo-label').innerHTML =
        baseText + ' <span class="required">*</span>';
}

function getPaymentType() {
    return document.getElementById('pay-cash').classList.contains('active') ? 'cash' : 'card';
}

document.getElementById('pay-cash').addEventListener('click', () => setPaymentType('cash'));
document.getElementById('pay-card').addEventListener('click', () => setPaymentType('card'));

document.getElementById('manicure-photo').addEventListener('change', async (e) => {
    if (e.target.files[0]) {
        tempManicurePhoto = await readFileAsDataURL(e.target.files[0]);
        showPreview('manicure-preview', tempManicurePhoto);
    }
});

document.getElementById('payment-photo').addEventListener('change', async (e) => {
    if (e.target.files[0]) {
        tempPaymentPhoto = await readFileAsDataURL(e.target.files[0]);
        showPreview('payment-preview', tempPaymentPhoto);
    }
});

document.getElementById('save-client-btn').addEventListener('click', async () => {
    const name = document.getElementById('client-name').value.trim();
    const amountRaw = document.getElementById('client-amount').value.trim();
    const amount = parseInt(amountRaw, 10);
    const paymentType = getPaymentType();

    const MIN_AMOUNT = 100;
    const MAX_AMOUNT = 10000;

    if (!amountRaw || Number.isNaN(amount) || amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
        alert('Пожалуйста, введите сумму в диапазоне от 100 до 10000');
        return;
    }

    if (!tempManicurePhoto) {
        alert('Пожалуйста, загрузите фото маникюра');
        return;
    }
    if (!tempPaymentPhoto) {
        alert('Пожалуйста, загрузите фото оплаты !');
        return;
    }


    const clientData = {
        date: selectedDate,
        name: name || 'Клиент',
        amount,
        paymentType,
        manicurePhoto: tempManicurePhoto,
        paymentPhoto: tempPaymentPhoto
    };

    if (editingClientId) {
        clientData.id = editingClientId;
    }

    await dbPut('clients', clientData);
    closeClientModal();
    await renderClients();
});

document.getElementById('delete-client-btn').addEventListener('click', async () => {
    if (editingClientId && confirm('Удалить этого клиента?')) {
        await dbDelete('clients', editingClientId);
        closeClientModal();
        await renderClients();
    }
});

function closeClientModal() {
    document.getElementById('modal-client').classList.remove('active');
    editingClientId = null;
    tempManicurePhoto = null;
    tempPaymentPhoto = null;
}

document.getElementById('modal-close').addEventListener('click', closeClientModal);

// ---- Photo Preview Modal ----
document.getElementById('photo-close').addEventListener('click', () => {
    document.getElementById('modal-photo').classList.remove('active');
});

// Click on preview images to view fullscreen
document.addEventListener('click', (e) => {
    const img = e.target.closest('.client-card-thumb');
    if (img) {
        e.stopPropagation();
        document.getElementById('photo-full').src = img.src;
        document.getElementById('modal-photo').classList.add('active');
    }
});

// Close modals on backdrop click
document.getElementById('modal-client').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeClientModal();
});

document.getElementById('modal-photo').addEventListener('click', (e) => {
    if (e.target === e.currentTarget || e.target === e.currentTarget.querySelector('.modal-photo-content')) {
        document.getElementById('modal-photo').classList.remove('active');
    }
});

// ---- Init ----
async function init() {
    await openDB();
    const now = new Date();
    currentYear = now.getFullYear();
    currentMonth = now.getMonth();
    await renderCalendar();
}

init();
