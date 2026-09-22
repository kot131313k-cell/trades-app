/* Единственная точка доступа к данным (AGENTS.md п.1).
   Этапы A–E: localStorage. Этап F: переписать этот файл на базу, экраны не трогать. */
(function () {
  const DB_KEY = "trades-app-v1";

  function blankDb() {
    return { clients: [], jobs: [], invoices: [], licenses: [], seq: {} };
  }

  // In-memory fallback (для node-тестов, приватных режимов и file:// без localStorage)
  let memDb = null;
  let memForced = false;
  const hasLocalStorage = (function () {
    try {
      return typeof localStorage !== "undefined";
    } catch {
      return false;
    }
  })();

  function load() {
    if (memForced) return memDb || blankDb();
    if (!hasLocalStorage) {
      if (!memDb) memDb = blankDb();
      return memDb;
    }
    try {
      const raw = localStorage.getItem(DB_KEY);
      if (!raw) return blankDb();
      const db = JSON.parse(raw);
      db.clients = db.clients || [];
      db.jobs = db.jobs || [];
      db.invoices = db.invoices || [];
      db.licenses = db.licenses || [];
      db.seq = db.seq || {};
      return db;
    } catch {
      return memDb || blankDb();
    }
  }

  function save(db) {
    if (memForced || !hasLocalStorage) {
      memDb = db;
      return;
    }
    try {
      localStorage.setItem(DB_KEY, JSON.stringify(db));
    } catch {
      // Квота/приватный режим: держим данные сессии в памяти
      memForced = true;
      memDb = db;
    }
  }

  function uid(prefix) {
    return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // --- Деньги: только целые копейки ---
  // "1 500,50" / "1500.5" -> 150050. Пустое/мусор -> NaN.
  function parseMoneyToKopecks(input) {
    if (typeof input === "number") {
      if (!Number.isFinite(input)) return NaN;
      return Math.round(input * 100);
    }
    if (input === null || input === undefined) return NaN;
    let s = String(input).trim().replace(/[\s\u00a0]/g, "").replace(",", ".");
    if (s === "") return NaN;
    if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return NaN;
    return Math.round(parseFloat(s) * 100);
  }

  function formatMoney(kopecks) {
    const v = Math.round(Number(kopecks) || 0) / 100;
    return v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₽";
  }

  // --- Даты: хранение ГГГГ-ММ-ДД ---
  function todayISO() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function addDaysISO(iso, days) {
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + days);
    return dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0") + "-" + String(dt.getDate()).padStart(2, "0");
  }

  function formatDate(iso) {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "—";
    const [y, m, d] = iso.split("-");
    return d + "." + m + "." + y;
  }

  function daysUntil(iso, fromISO) {
    const a = new Date((fromISO || todayISO()) + "T00:00:00");
    const b = new Date(iso + "T00:00:00");
    return Math.round((b - a) / 86400000);
  }

  // --- Счета: итоги, статусы ---
  function invoicePaidTotal(inv) {
    return (inv.payments || []).reduce((s, p) => s + (Math.round(p.amount) || 0), 0);
  }

  function invoiceBalance(inv) {
    return Math.round(inv.total) - invoicePaidTotal(inv);
  }

  // Просрочка вычисляется при показе, не хранится.
  function isOverdue(inv, today) {
    if (!inv || inv.status !== "issued") return false;
    const t = today || todayISO();
    return inv.dueDate && inv.dueDate < t && invoiceBalance(inv) > 0;
  }

  function displayStatus(inv, today) {
    if (!inv) return "—";
    if (inv.status === "draft") return "Черновик";
    if (inv.status === "paid" || invoiceBalance(inv) <= 0) return "Оплачен";
    if (isOverdue(inv, today)) return "Просрочен";
    return "Выставлен";
  }

  // Номер ГОД-Порядковый, без дублей (счётчик на год + защита от коллизий).
  function nextInvoiceNumber(db) {
    const year = new Date().getFullYear();
    db.seq = db.seq || {};
    let n = (db.seq[year] || 0) + 1;
    const used = new Set(db.invoices.map((i) => i.number));
    while (used.has(year + "-" + String(n).padStart(3, "0"))) n++;
    db.seq[year] = n;
    return year + "-" + String(n).padStart(3, "0");
  }

  function calcTotal(lines, discountKop) {
    const subtotal = (lines || []).reduce((s, l) => s + (Math.round(l.amount) || 0), 0);
    const d = Math.max(0, Math.min(Math.round(discountKop) || 0, subtotal));
    return { subtotal, discount: d, total: subtotal - d };
  }

  // --- CRUD ---
  function listClients(search) {
    const db = load();
    let list = db.clients.slice().sort((a, b) => (a.name || "").localeCompare(b.name || "", "ru"));
    if (search) {
      const q = search.trim().toLowerCase();
      list = list.filter((c) => (c.name + " " + (c.phone || "")).toLowerCase().includes(q));
    }
    return list;
  }

  function getClient(id) {
    return load().clients.find((c) => c.id === id) || null;
  }

  function validateClient(c) {
    const errors = {};
    if (!c.name || !c.name.trim()) errors.name = "Укажите имя клиента";
    else if (c.name.trim().length > 120) errors.name = "Имя слишком длинное (макс. 120)";
    if (!c.phone || !c.phone.trim()) errors.phone = "Укажите телефон";
    else if (c.phone.replace(/\D/g, "").length < 6) errors.phone = "Телефон слишком короткий";
    if ((c.address || "").length > 200) errors.address = "Адрес слишком длинный (макс. 200)";
    if ((c.note || "").length > 500) errors.note = "Заметка слишком длинная (макс. 500)";
    return errors;
  }

  function saveClient(c) {
    const errors = validateClient(c);
    if (Object.keys(errors).length) return { errors };
    const db = load();
    const clean = {
      name: c.name.trim().slice(0, 120),
      phone: c.phone.trim().slice(0, 40),
      address: (c.address || "").trim().slice(0, 200),
      note: (c.note || "").trim().slice(0, 500),
    };
    if (c.id) {
      const i = db.clients.findIndex((x) => x.id === c.id);
      if (i < 0) return { errors: { _ : "Клиент не найден" } };
      db.clients[i] = Object.assign({}, db.clients[i], clean);
      save(db);
      return { client: db.clients[i] };
    }
    const rec = Object.assign({ id: uid("c") }, clean);
    db.clients.push(rec);
    save(db);
    return { client: rec };
  }

  function deleteClient(id) {
    const db = load();
    db.clients = db.clients.filter((c) => c.id !== id);
    const jobIds = new Set(db.jobs.filter((j) => j.clientId === id).map((j) => j.id));
    db.jobs = db.jobs.filter((j) => j.clientId !== id);
    db.invoices = db.invoices.filter((inv) => inv.clientId !== id);
    void jobIds;
    save(db);
  }

  function listJobs(clientId) {
    return load().jobs
      .filter((j) => !clientId || j.clientId === clientId)
      .slice()
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }

  function getJob(id) {
    return load().jobs.find((j) => j.id === id) || null;
  }

  function validateJob(j) {
    const errors = {};
    if (!j.clientId) errors.clientId = "Нет клиента";
    if (!j.date || !/^\d{4}-\d{2}-\d{2}$/.test(j.date)) errors.date = "Некорректная дата";
    if (!j.desc || !j.desc.trim()) errors.desc = "Опишите работу";
    else if (j.desc.trim().length > 500) errors.desc = "Описание слишком длинное (макс. 500)";
    if (j.priceKop === undefined || j.priceKop === null || Number.isNaN(j.priceKop)) errors.price = "Укажите цену числом";
    else if (j.priceKop < 0) errors.price = "Цена не может быть отрицательной";
    else if (j.priceKop > 100000000) errors.price = "Сумма слишком большая";
    return errors;
  }

  function saveJob(j) {
    const errors = validateJob(j);
    if (Object.keys(errors).length) return { errors };
    const db = load();
    const clean = {
      clientId: j.clientId,
      date: j.date,
      desc: j.desc.trim().slice(0, 500),
      priceKop: Math.round(j.priceKop),
      urgent: !!j.urgent,
      site: (j.site || "").slice(0, 200),
      measurements: (j.measurements || "").slice(0, 500),
      warrantyUntil: j.warrantyUntil && /^\d{4}-\d{2}-\d{2}$/.test(j.warrantyUntil) ? j.warrantyUntil : "",
      materials: Array.isArray(j.materials) ? j.materials.slice(0, 20).map((m) => ({
        name: String(m.name || "").slice(0, 120),
        sellKop: Math.max(0, Math.round(m.sellKop) || 0),
      })).filter((m) => m.name) : [],
      billed: !!j.billed,
    };
    if (j.id) {
      const i = db.jobs.findIndex((x) => x.id === j.id);
      if (i < 0) return { errors: { _: "Работа не найдена" } };
      db.jobs[i] = Object.assign({}, db.jobs[i], clean);
      save(db);
      return { job: db.jobs[i] };
    }
    const rec = Object.assign({ id: uid("j") }, clean);
    db.jobs.push(rec);
    save(db);
    return { job: rec };
  }

  function deleteJob(id) {
    const db = load();
    db.jobs = db.jobs.filter((j) => j.id !== id);
    save(db);
  }

  function markJobsBilled(ids) {
    const db = load();
    db.jobs.forEach((j) => { if (ids.includes(j.id)) j.billed = true; });
    save(db);
  }

  function listInvoices(filter) {
    const db = load();
    let list = db.invoices.slice();
    if (filter === "unpaid") list = list.filter((i) => i.status !== "paid" && invoiceBalance(i) > 0);
    list.sort((a, b) => (a.dueDate || "").localeCompare(b.dueDate || ""));
    return list;
  }

  function getInvoice(id) {
    return load().invoices.find((i) => i.id === id) || null;
  }

  function saveInvoice(inv) {
    const db = load();
    const lines = (inv.lines || []).slice(0, 50).map((l) => ({
      desc: String(l.desc || "").slice(0, 200),
      amount: Math.max(0, Math.round(l.amount) || 0),
    })).filter((l) => l.desc && l.amount >= 0);
    if (!inv.clientId) return { errors: { clientId: "Нет клиента" } };
    if (!lines.length) return { errors: { lines: "Добавьте хотя бы одну строку" } };
    const t = calcTotal(lines, inv.discountKop || 0);
    if (inv.id) {
      const i = db.invoices.findIndex((x) => x.id === inv.id);
      if (i < 0) return { errors: { _: "Счёт не найден" } };
      const prev = db.invoices[i];
      if (prev.status !== "draft") return { errors: { _: "Выставленный счёт менять нельзя — создайте новый" } };
      db.invoices[i] = Object.assign({}, prev, {
        lines, subtotal: t.subtotal, discount: t.discount, total: t.total,
        dueDate: inv.dueDate || prev.dueDate,
        certRef: (inv.certRef || "").slice(0, 120),
        note: (inv.note || "").slice(0, 500),
      });
      save(db);
      return { invoice: db.invoices[i] };
    }
    const rec = {
      id: uid("i"),
      number: nextInvoiceNumber(db),
      clientId: inv.clientId,
      lines,
      subtotal: t.subtotal,
      discount: t.discount,
      total: t.total,
      issueDate: inv.issueDate || todayISO(),
      dueDate: inv.dueDate || addDaysISO(todayISO(), 7),
      status: "issued",
      payments: [],
      reminderLog: [],
      certRef: (inv.certRef || "").slice(0, 120),
      note: (inv.note || "").slice(0, 500),
    };
    db.invoices.push(rec);
    save(db);
    return { invoice: rec };
  }

  function addPayment(invoiceId, amountKop, date, method) {
    if (!Number.isFinite(amountKop) || amountKop <= 0) return { errors: { amount: "Сумма должна быть больше нуля" } };
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { errors: { date: "Некорректная дата" } };
    const db = load();
    const inv = db.invoices.find((x) => x.id === invoiceId);
    if (!inv) return { errors: { _: "Счёт не найден" } };
    if (amountKop > invoiceBalance(inv)) return { errors: { amount: "Сумма больше остатка " + formatMoney(invoiceBalance(inv)) } };
    inv.payments.push({ amount: Math.round(amountKop), date: date || todayISO(), method: (method || "").slice(0, 60) });
    if (invoiceBalance(inv) <= 0) inv.status = "paid";
    save(db);
    return { invoice: inv };
  }

  function logReminder(invoiceId) {
    const db = load();
    const inv = db.invoices.find((x) => x.id === invoiceId);
    if (!inv) return null;
    inv.reminderLog = inv.reminderLog || [];
    inv.reminderLog.push(todayISO());
    save(db);
    return inv;
  }

  function lastReminder(inv) {
    const log = inv.reminderLog || [];
    return log.length ? log[log.length - 1] : null;
  }

  // --- Допуски ---
  function licenseState(lic, today) {
    const t = today || todayISO();
    if (!lic.expiresAt) return "unknown";
    const d = daysUntil(lic.expiresAt, t);
    if (d < 0) return "expired";
    if (d <= 30) return "soon";
    return "ok";
  }

  function listLicenses() {
    return load().licenses.slice().sort((a, b) => (a.expiresAt || "9999").localeCompare(b.expiresAt || "9999"));
  }

  function saveLicense(l) {
    const errors = {};
    if (!l.title || !l.title.trim()) errors.title = "Укажите название";
    if (l.expiresAt && !/^\d{4}-\d{2}-\d{2}$/.test(l.expiresAt)) errors.expiresAt = "Некорректная дата";
    if (Object.keys(errors).length) return { errors };
    const db = load();
    const clean = {
      title: l.title.trim().slice(0, 120),
      number: (l.number || "").slice(0, 80),
      issuer: (l.issuer || "").slice(0, 120),
      expiresAt: l.expiresAt || "",
      fileName: l.fileName || "",
      fileData: l.fileData || "",
    };
    if (l.id) {
      const i = db.licenses.findIndex((x) => x.id === l.id);
      if (i < 0) return { errors: { _: "Не найден" } };
      const prev = db.licenses[i];
      // Продление: старый срок уходит в историю
      let history = prev.history || [];
      if (prev.expiresAt && clean.expiresAt && clean.expiresAt !== prev.expiresAt) {
        history = history.concat([{ expiresAt: prev.expiresAt, changedAt: todayISO() }]).slice(-20);
      }
      db.licenses[i] = Object.assign({}, prev, clean, { history });
      save(db);
      return { license: db.licenses[i] };
    }
    const rec = Object.assign({ id: uid("l"), history: [] }, clean);
    db.licenses.push(rec);
    save(db);
    return { license: rec };
  }

  function deleteLicense(id) {
    const db = load();
    db.licenses = db.licenses.filter((l) => l.id !== id);
    save(db);
  }

  function debtTotal(today) {
    return listInvoices("unpaid").reduce((s, i) => s + invoiceBalance(i), 0);
  }

  function exportAll() {
    return JSON.stringify(load(), null, 2);
  }

  function importAll(json) {
    let db;
    try {
      db = JSON.parse(json);
    } catch {
      return { errors: { _: "Неверный JSON" } };
    }
    if (!db || !Array.isArray(db.clients)) return { errors: { _: "Файл не похож на выгрузку" } };
    save({ clients: db.clients, jobs: db.jobs || [], invoices: db.invoices || [], licenses: db.licenses || [], seq: db.seq || {} });
    return { ok: true };
  }

  const Store = {
    DB_KEY, load, save,
    parseMoneyToKopecks, formatMoney, todayISO, addDaysISO, formatDate, daysUntil,
    invoicePaidTotal, invoiceBalance, isOverdue, displayStatus,
    nextInvoiceNumber, calcTotal,
    listClients, getClient, saveClient, deleteClient,
    listJobs, getJob, saveJob, deleteJob, markJobsBilled,
    listInvoices, getInvoice, saveInvoice, addPayment, logReminder, lastReminder,
    licenseState, listLicenses, saveLicense, deleteLicense,
    debtTotal, exportAll, importAll,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = Store;
  else window.Store = Store;
})();
