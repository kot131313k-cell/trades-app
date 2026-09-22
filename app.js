/* Экраны. Данные — только через Store. Различия профессий — из AppProfiles. */
(function () {
  "use strict";
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const state = { screen: "home", clientId: null, invoiceId: null, search: "" };

  function esc(s) {
    return String(s === undefined || s === null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function profile() { return window.AppProfiles.currentProfile(); }
  function extras() { return profile().jobExtras || []; }
  function hasExtra(name) { return extras().indexOf(name) >= 0; }

  // --- modal ---
  const modalBack = $("#modalBack");
  const modalBox = $("#modalBox");
  function openModal(html) {
    modalBox.innerHTML = html;
    modalBack.classList.add("open");
    const first = modalBox.querySelector("input, textarea, select, button");
    if (first) first.focus();
  }
  function closeModal() {
    modalBack.classList.remove("open");
    modalBox.innerHTML = "";
  }
  modalBack.addEventListener("click", (e) => { if (e.target === modalBack) closeModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

  function fieldError(errs, key) {
    return errs && errs[key] ? '<div class="field-error">' + esc(errs[key]) + "</div>" : "";
  }

  // --- router ---
  const SCREENS = ["home", "clients", "client", "invoices", "invoice", "licenses"];
  function show(screen, params) {
    state.screen = screen;
    if (params && params.clientId !== undefined) state.clientId = params.clientId;
    if (params && params.invoiceId !== undefined) state.invoiceId = params.invoiceId;
    SCREENS.forEach((s) => {
      const el = $("#screen-" + s);
      el.classList.toggle("active", s === screen);
      el.classList.toggle("print-invoice", s === screen);
    });
    $$("nav.bottom button").forEach((b) => {
      const map = { home: "home", clients: "clients", client: "clients", invoices: "invoices", invoice: "invoices", licenses: "licenses" };
      b.classList.toggle("active", map[screen] === b.dataset.nav);
    });
    window.scrollTo(0, 0);
    render();
  }

  $$("nav.bottom button").forEach((b) => b.addEventListener("click", () => show(b.dataset.nav)));

  function render() {
    ({ home: renderHome, clients: renderClients, client: renderClientCard, invoices: renderInvoices, invoice: renderInvoiceDetail, licenses: renderLicenses })[state.screen]();
    syncProfileButtons();
  }

  function syncProfileButtons() {
    const id = window.AppProfiles.currentProfileId();
    $("#btnPlumber").classList.toggle("active", id === "plumber");
    $("#btnElectrician").classList.toggle("active", id === "electrician");
    $("#appTitle").textContent = profile().name + " · Счета";
  }
  $("#btnPlumber").addEventListener("click", () => { window.AppProfiles.setProfile("plumber"); render(); });
  $("#btnElectrician").addEventListener("click", () => { window.AppProfiles.setProfile("electrician"); render(); });

  // ================= ГЛАВНАЯ =================
  function renderHome() {
    const el = $("#screen-home");
    const today = Store.todayISO();
    const unpaid = Store.listInvoices("unpaid");
    const debt = Store.debtTotal(today);
    const overdue = unpaid.filter((i) => Store.isOverdue(i, today));
    const licenses = Store.listLicenses();
    const expiring = licenses.filter((l) => Store.licenseState(l, today) !== "ok");
    const p = profile();

    el.innerHTML =
      '<div class="card"><div class="muted">Мне должны</div>' +
      '<div class="debt-big">' + esc(Store.formatMoney(debt)) + "</div>" +
      '<div class="muted">' + unpaid.length + " неоплаченных · " + overdue.length + " просроченных</div>" +
      '<div class="actions"><button type="button" class="btn-primary" id="homeMain">' + esc(p.mainButton) + "</button></div></div>" +
      (overdue.length
        ? '<div class="card"><b>Просроченные счета</b>' + overdue.slice(0, 5).map(invoiceRow).join("") +
          '<div class="actions"><button type="button" class="btn-ghost" data-go="invoices">Все долги →</button></div></div>'
        : "") +
      (expiring.length
        ? '<div class="card"><b>Сроки горят</b>' + expiring.slice(0, 5).map(licenseRow).join("") +
          '<div class="actions"><button type="button" class="btn-ghost" data-go="licenses">Все допуски →</button></div></div>'
        : '<div class="card muted">Просрочек и горящих сроков нет. Так держать.</div>') +
      '<div class="card"><b>Быстрые действия</b><div class="actions two">' +
      '<button type="button" data-act="new-client">+ Клиент</button>' +
      '<button type="button" data-act="new-job">+ Работа</button>' +
      '<button type="button" data-act="new-license">+ Допуск</button>' +
      '<button type="button" data-act="backup">Резерв</button>' +
      "</div>" +
      '<p class="disclaimer">Учёт для себя и напоминания, а не бухгалтерия. Приложение напоминает о сроках, которые вы внесли сами, и не гарантирует соответствие нормам.</p></div>';

    $$("[data-go]", el).forEach((b) => b.addEventListener("click", () => show(b.dataset.go)));
    $("#homeMain", el).addEventListener("click", () => {
      // Главная кнопка профиля: быстрый счёт (сантехник) / работа на объекте (электрик) — один и тот же диалог, разные подсказки.
      openQuickInvoice();
    });
    $('[data-act="new-client"]', el).addEventListener("click", () => openClientForm());
    $('[data-act="new-job"]', el).addEventListener("click", () => openJobForm());
    $('[data-act="new-license"]', el).addEventListener("click", () => openLicenseForm());
    $('[data-act="backup"]', el).addEventListener("click", openBackup);
  }

  function invoiceRow(inv) {
    const c = Store.getClient(inv.clientId);
    const st = Store.displayStatus(inv);
    const cls = st === "Просрочен" ? "overdue" : st === "Оплачен" ? "paid" : "issued";
    return (
      '<button type="button" class="list-item" data-inv="' + inv.id + '">' +
      "<span class='row'><span class='grow'><b>№ " + esc(inv.number) + "</b> · " + esc(c ? c.name : "—") + "</span>" +
      '<span class="badge ' + cls + '">' + esc(st) + "</span></span>" +
      "<small>" + esc(Store.formatMoney(Store.invoiceBalance(inv))) + " из " + esc(Store.formatMoney(inv.total)) +
      " · срок " + esc(Store.formatDate(inv.dueDate)) + "</small></button>"
    );
  }

  function licenseRow(l) {
    const st = Store.licenseState(l);
    const label = st === "expired" ? "Просрочен" : st === "soon" ? "Скоро истекает" : st === "ok" ? "Действует" : "Без срока";
    return (
      '<button type="button" class="list-item" data-lic="' + l.id + '">' +
      "<span class='row'><span class='grow'><b>" + esc(l.title) + "</b></span>" +
      '<span class="badge ' + st + '">' + esc(label) + "</span></span>" +
      "<small>" + esc(l.number || "без номера") + " · до " + esc(Store.formatDate(l.expiresAt) || "—") + "</small></button>"
    );
  }

  document.addEventListener("click", (e) => {
    const invBtn = e.target.closest("[data-inv]");
    if (invBtn) { show("invoice", { invoiceId: invBtn.dataset.inv }); return; }
    const licBtn = e.target.closest("[data-lic]");
    if (licBtn) { show("licenses"); setTimeout(() => openLicenseForm(licBtn.dataset.lic), 0); return; }
    const clBtn = e.target.closest("[data-client]");
    if (clBtn) { show("client", { clientId: clBtn.dataset.client }); }
  });

  // ================= КЛИЕНТЫ =================
  function renderClients() {
    const el = $("#screen-clients");
    const list = Store.listClients(state.search);
    el.innerHTML =
      '<div class="card"><label for="q">Поиск по имени и телефону</label>' +
      '<input id="q" type="search" placeholder="Иван, +7…" value="' + esc(state.search) + '"></div>' +
      (list.length ? list.map((c) =>
        '<button type="button" class="list-item" data-client="' + c.id + '"><b>' + esc(c.name) + "</b><small>" +
        esc(c.phone) + (c.address ? " · " + esc(c.address) : "") + "</small></button>"
      ).join("") : '<div class="card muted">Пока никого. Добавьте первого клиента кнопкой внизу.</div>') +
      '<div class="actions sticky-action"><button type="button" class="btn-primary" id="addClient">+ Клиент</button></div>';
    const q = $("#q", el);
    q.addEventListener("input", () => { state.search = q.value; renderClients(); const nq = $("#q"); nq.focus(); nq.setSelectionRange(nq.value.length, nq.value.length); });
    $("#addClient", el).addEventListener("click", () => openClientForm());
  }

  function openClientForm(id) {
    const c = id ? Store.getClient(id) : { name: "", phone: "", address: "", note: "" };
    openModal(
      "<h2>" + (id ? "Клиент" : "Новый клиент") + "</h2>" +
      '<form id="f"><label>Имя *</label><input name="name" required maxlength="120" value="' + esc(c.name) + '">' +
      '<label>Телефон *</label><input name="phone" inputmode="tel" required value="' + esc(c.phone) + '">' +
      '<label>Адрес объекта</label><input name="address" maxlength="200" value="' + esc(c.address || "") + '">' +
      '<label>Заметка</label><textarea name="note" maxlength="500">' + esc(c.note || "") + "</textarea>" +
      '<div id="err"></div><div class="actions">' +
      '<button class="btn-primary" type="submit">Сохранить</button>' +
      '<button type="button" class="btn-ghost" id="cancel">Отмена</button></div></form>'
    );
    $("#cancel").addEventListener("click", closeModal);
    $("#f").addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const res = Store.saveClient({ id: id || undefined, name: fd.get("name"), phone: fd.get("phone"), address: fd.get("address"), note: fd.get("note") });
      if (res.errors) {
        $("#err").innerHTML = Object.values(res.errors).map((m) => '<div class="field-error">' + esc(m) + "</div>").join("");
        return;
      }
      closeModal();
      show("client", { clientId: res.client.id });
    });
  }

  // ================= КАРТОЧКА КЛИЕНТА =================
  function renderClientCard() {
    const el = $("#screen-client");
    const c = Store.getClient(state.clientId);
    if (!c) { el.innerHTML = '<div class="card">Клиент не найден.</div>'; return; }
    const jobs = Store.listJobs(c.id).filter((j) => !j.billed);
    const billedJobs = Store.listJobs(c.id).filter((j) => j.billed);
    const invoices = Store.listInvoices().filter((i) => i.clientId === c.id);
    el.innerHTML =
      '<div class="card"><div class="row"><div class="grow"><h2 style="margin:0">' + esc(c.name) + "</h2>" +
      '<div class="muted">' + esc(c.phone) + (c.address ? " · " + esc(c.address) : "") + "</div>" +
      (c.note ? "<div>" + esc(c.note) + "</div>" : "") + '</div></div>' +
      '<div class="actions two"><button type="button" id="editClient">Изменить</button>' +
      '<button type="button" class="btn-danger" id="delClient">Удалить</button></div></div>' +
      '<div class="card"><b>Невыставленные работы (' + jobs.length + ")</b>" +
      (jobs.length ? jobs.map(jobRow).join("") : '<div class="muted">Нет новых работ.</div>') +
      '<div class="actions"><button type="button" id="addJob">+ Работа</button>' +
      (jobs.length ? '<button type="button" class="btn-primary" id="makeInv">Счёт из выбранных работ</button>' : "") + "</div></div>" +
      (billedJobs.length ? '<div class="card"><b>Уже в счетах</b>' + billedJobs.map(jobRow).join("") + "</div>" : "") +
      '<div class="card"><b>Счета</b>' + (invoices.length ? invoices.map(invoiceRow).join("") : '<div class="muted">Счетов пока нет.</div>') + "</div>";
    $("#editClient", el).addEventListener("click", () => openClientForm(c.id));
    $("#delClient", el).addEventListener("click", () => {
      if (!confirm("Удалить клиента и все его записи? Сумма: безвозвратно.")) return;
      Store.deleteClient(c.id);
      show("clients");
    });
    $("#addJob", el).addEventListener("click", () => openJobForm(c.id));
    const mk = $("#makeInv", el);
    if (mk) mk.addEventListener("click", () => openInvoiceFromJobs(c, selectedJobIds(el)));
    $$(".job-del", el).forEach((b) => b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (!confirm("Удалить работу?")) return;
      Store.deleteJob(b.dataset.job);
      render();
    }));
    $$(".job-edit", el).forEach((b) => b.addEventListener("click", (ev) => { ev.stopPropagation(); openJobForm(c.id, b.dataset.job); }));
  }

  function selectedJobIds(root) {
    return $$('input[name="jobpick"]:checked', root).map((i) => i.value);
  }

  function jobRow(j) {
    const mats = (j.materials || []).map((m) => esc(m.name) + " +" + esc(Store.formatMoney(m.sellKop))).join(", ");
    return (
      '<div class="list-item"><span class="row"><input type="checkbox" name="jobpick" value="' + j.id + '" style="width:28px;min-height:28px" aria-label="Выбрать"> ' +
      "<span class='grow'><b>" + esc(j.desc) + "</b><small>" + esc(Store.formatDate(j.date)) +
      (j.urgent ? " · ⚡ срочно" : "") + (j.site ? " · " + esc(j.site) : "") +
      (mats ? "<br>Материалы: " + mats : "") +
      (j.warrantyUntil ? "<br>Гарантия до " + esc(Store.formatDate(j.warrantyUntil)) : "") +
      "</small></span><b>" + esc(Store.formatMoney(jobTotal(j))) + "</b></span>" +
      '<span class="row"><button type="button" class="btn-ghost job-edit" data-job="' + j.id + '">Правка</button>' +
      '<button type="button" class="btn-ghost job-del" data-job="' + j.id + '">✕</button></span></div>'
    );
  }

  function jobTotal(j) {
    const mats = (j.materials || []).reduce((s, m) => s + (m.sellKop || 0), 0);
    return (j.priceKop || 0) + mats;
  }

  // ================= РАБОТА =================
  function openJobForm(clientId, jobId) {
    const cid = clientId || state.clientId;
    if (!cid && !jobId) {
      // Нет контекста клиента — выбрать
      const clients = Store.listClients("");
      if (!clients.length) { alert("Сначала добавьте клиента."); show("clients"); return; }
      openModal("<h2>К какому клиенту?</h2>" + clients.slice(0, 50).map((c) =>
        '<button type="button" class="list-item" data-pick="' + c.id + '"><b>' + esc(c.name) + "</b><small>" + esc(c.phone) + "</small></button>"
      ).join("") + '<div class="actions"><button type="button" class="btn-ghost" id="cancel">Отмена</button></div>');
      $("#cancel").addEventListener("click", closeModal);
      $$("[data-pick]").forEach((b) => b.addEventListener("click", () => openJobForm(b.dataset.pick)));
      return;
    }
    const j = jobId ? Store.getJob(jobId) : { date: Store.todayISO(), desc: "", priceKop: NaN, urgent: false, site: "", measurements: "", warrantyUntil: "", materials: [] };
    const p = profile();
    const typical = p.typicalJobs.map((t) =>
      '<button type="button" class="btn-ghost" data-tpl="' + esc(t.name) + '" data-price="' + t.price + '">' + esc(t.name) + " · " + esc(Store.formatMoney(t.price)) + "</button>"
    ).join("");
    openModal(
      "<h2>" + (jobId ? "Работа" : "Новая работа") + "</h2>" +
      '<form id="f"><label>Шаблон: ' + esc(p.name) + "</label>" + typical +
      '<label>Дата</label><input name="date" type="date" value="' + esc(j.date || Store.todayISO()) + '">' +
      '<label>Что сделано *</label><input name="desc" maxlength="500" value="' + esc(j.desc || "") + '" placeholder="Замена смесителя">' +
      '<div class="row"><div class="grow"><label>Часы</label><input name="hours" inputmode="decimal" placeholder="2"></div>' +
      '<div class="grow"><label>Ставка ₽/ч</label><input name="rate" inputmode="decimal" placeholder="1500"></div></div>' +
      '<label>Цена работы, ₽ *</label><input name="price" inputmode="decimal" required placeholder="4000">' +
      (hasExtra("urgent") ? '<label><input type="checkbox" name="urgent" style="width:26px;min-height:26px" ' + (j.urgent ? "checked" : "") + '> Срочный выезд</label>' : "") +
      (hasExtra("site") ? '<label>Объект (адрес/щит)</label><input name="site" maxlength="200" value="' + esc(j.site || "") + '">' : "") +
      (hasExtra("measurements") ? '<label>Замеры</label><textarea name="measurements" maxlength="500">' + esc(j.measurements || "") + "</textarea>" : "") +
      (hasExtra("materials") ? '<label>Материалы (название + цена продажи, ₽)</label><div id="mats"></div><button type="button" class="btn-ghost" id="addMat">+ Материал</button>' : "") +
      (hasExtra("warranty") ? '<label>Гарантия до</label><input name="warrantyUntil" type="date" value="' + esc(j.warrantyUntil || "") + '">' : "") +
      '<div id="err"></div><div class="actions"><button class="btn-primary" type="submit">Сохранить</button>' +
      '<button type="button" class="btn-ghost" id="cancel">Отмена</button></div></form>'
    );
    $("#cancel").addEventListener("click", closeModal);
    $$("[data-tpl]").forEach((b) => b.addEventListener("click", () => {
      const f = $("#f");
      if (!f.desc.value) f.desc.value = b.dataset.tpl;
      f.price.value = (Number(b.dataset.price) / 100).toString();
    }));
    const f = $("#f");
    const recompute = () => {
      const h = parseFloat(String(f.hours.value).replace(",", "."));
      const r = Store.parseMoneyToKopecks(f.rate.value);
      if (Number.isFinite(h) && h > 0 && Number.isFinite(r)) f.price.value = (Math.round(h * r) / 100).toString();
    };
    f.hours.addEventListener("input", recompute);
    f.rate.addEventListener("input", recompute);

    const matsBox = $("#mats");
    const matRows = [];
    function addMatRow(name, sell) {
      const idx = matRows.length;
      matRows.push({});
      const div = document.createElement("div");
      div.className = "row";
      div.innerHTML = '<div class="grow"><input placeholder="Труба, кран…" maxlength="120"></div>' +
        '<div style="width:110px"><input placeholder="₽" inputmode="decimal"></div>';
      const inputs = div.querySelectorAll("input");
      inputs[0].value = name || ""; inputs[1].value = sell || "";
      matsBox.appendChild(div);
    }
    if (matsBox) {
      (j.materials || []).forEach((m) => addMatRow(m.name, (m.sellKop / 100).toString()));
      $("#addMat").addEventListener("click", () => addMatRow("", ""));
    }

    f.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(f);
      const mats = [];
      if (matsBox) {
        $$(".row", matsBox).forEach((row) => {
          const ins = row.querySelectorAll("input");
          const sell = Store.parseMoneyToKopecks(ins[1].value);
          if (ins[0].value.trim()) mats.push({ name: ins[0].value.trim(), sellKop: Number.isFinite(sell) ? Math.max(0, sell) : 0 });
        });
      }
      const res = Store.saveJob({
        id: jobId || undefined,
        clientId: (jobId ? Store.getJob(jobId).clientId : cid),
        date: fd.get("date"), desc: fd.get("desc"),
        priceKop: Store.parseMoneyToKopecks(fd.get("price")),
        urgent: !!fd.get("urgent"),
        site: fd.get("site") || "", measurements: fd.get("measurements") || "",
        warrantyUntil: fd.get("warrantyUntil") || "",
        materials: mats,
      });
      if (res.errors) {
        $("#err").innerHTML = Object.values(res.errors).map((m) => '<div class="field-error">' + esc(m) + "</div>").join("");
        return;
      }
      closeModal();
      show("client", { clientId: res.job.clientId });
    });
  }

  // ================= СЧЁТ =================
  function openInvoiceFromJobs(client, jobIds) {
    if (!jobIds.length) { alert("Выберите работы галочками."); return; }
    const jobs = jobIds.map((id) => Store.getJob(id)).filter(Boolean);
    const lines = jobs.map((j) => ({ desc: j.desc + " (" + Store.formatDate(j.date) + ")", amount: jobTotal(j) }));
    openInvoiceForm(client.id, lines, () => Store.markJobsBilled(jobIds));
  }

  // Быстрый счёт: имя+телефон прямо в форме, клиент создаётся автоматически.
  function openQuickInvoice() {
    const p = profile();
    openModal(
      "<h2>" + esc(p.mainButton) + "</h2>" +
      '<p class="muted">' + esc(p.invoiceHint) + "</p>" +
      '<form id="f"><label>Имя клиента *</label><input name="name" required maxlength="120">' +
      '<label>Телефон *</label><input name="phone" inputmode="tel" required>' +
      '<label>Что сделано *</label><input name="desc" required maxlength="200" placeholder="Устранение течи">' +
      '<label>Сумма, ₽ *</label><input name="price" inputmode="decimal" required placeholder="3500">' +
      '<div id="err"></div><div class="actions"><button class="btn-primary" type="submit">Выставить счёт</button>' +
      '<button type="button" class="btn-ghost" id="cancel">Отмена</button></div></form>'
    );
    $("#cancel").addEventListener("click", closeModal);
    $("#f").addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const amount = Store.parseMoneyToKopecks(fd.get("price"));
      if (!Number.isFinite(amount) || amount <= 0) {
        $("#err").innerHTML = '<div class="field-error">Укажите сумму числом больше нуля</div>';
        return;
      }
      const rc = Store.saveClient({ name: fd.get("name"), phone: fd.get("phone"), address: "", note: "Создан быстрым счётом" });
      if (rc.errors) {
        $("#err").innerHTML = Object.values(rc.errors).map((m) => '<div class="field-error">' + esc(m) + "</div>").join("");
        return;
      }
      closeModal();
      openInvoiceForm(rc.client.id, [{ desc: String(fd.get("desc")), amount }], null);
    });
  }

  function openInvoiceForm(clientId, presetLines, afterSave) {
    const lines = (presetLines || [{ desc: "", amount: 0 }]).slice();
    openModal(
      "<h2>Новый счёт</h2><form id='f'>" +
      '<div id="lines"></div>' +
      '<button type="button" class="btn-ghost" id="addLine">+ Строка</button>' +
      '<label>Скидка, ₽</label><input name="discount" inputmode="decimal" value="0">' +
      '<label>Срок оплаты</label><input name="dueDate" type="date" value="' + esc(Store.addDaysISO(Store.todayISO(), 7)) + '">' +
      (hasExtra("act") || Store.listLicenses().length ? '<label>Допуск в шапке (номер)</label><input name="certRef" maxlength="120" placeholder="№ допуска">' : "") +
      '<div class="total-line" id="total"></div><div id="err"></div>' +
      '<div class="actions"><button class="btn-primary" type="submit" id="saveBtn">Выставить</button>' +
      '<button type="button" class="btn-ghost" id="cancel">Отмена</button></div></form>'
    );
    const box = $("#lines");
    function drawLines() {
      box.innerHTML = "";
      lines.forEach((l, i) => {
        const div = document.createElement("div");
        div.className = "row";
        div.innerHTML = '<div class="grow"><input data-d maxlength="200" placeholder="Строка счёта"></div>' +
          '<div style="width:110px"><input data-a inputmode="decimal" placeholder="₽"></div>' +
          '<button type="button" class="btn-ghost" data-del>✕</button>';
        const di = div.querySelector("[data-d]"), ai = div.querySelector("[data-a]");
        di.value = l.desc; ai.value = l.amount ? (l.amount / 100).toString() : "";
        di.addEventListener("input", () => { l.desc = di.value; updateTotal(); });
        ai.addEventListener("input", () => {
          const v = Store.parseMoneyToKopecks(ai.value);
          l.amount = Number.isFinite(v) ? Math.max(0, v) : 0;
          updateTotal();
        });
        div.querySelector("[data-del]").addEventListener("click", () => { lines.splice(i, 1); drawLines(); });
        box.appendChild(div);
      });
      updateTotal();
    }
    function updateTotal() {
      const d = Store.parseMoneyToKopecks($("#f").discount.value);
      const t = Store.calcTotal(lines, Number.isFinite(d) ? d : 0);
      $("#total").textContent = "Итого: " + Store.formatMoney(t.total) + " (строки " + Store.formatMoney(t.subtotal) + ", скидка " + Store.formatMoney(t.discount) + ")";
      return t;
    }
    $("#addLine").addEventListener("click", () => { if (lines.length >= 50) return; lines.push({ desc: "", amount: 0 }); drawLines(); });
    $("#f").discount.addEventListener("input", updateTotal);
    $("#cancel").addEventListener("click", closeModal);
    drawLines();
    $("#f").addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const t = updateTotal();
      const btn = $("#saveBtn");
      btn.disabled = true;
      btn.textContent = "Итого " + Store.formatMoney(t.total) + " — подтвердить?";
      if (!btn.dataset.armed) { btn.dataset.armed = "1"; btn.disabled = false; return; } // подтверждение суммы (AGENTS.md п.7)
      const res = Store.saveInvoice({
        clientId, lines: lines.filter((l) => l.desc.trim()),
        discountKop: t.discount, dueDate: fd.get("dueDate"),
        certRef: fd.get("certRef") || "",
      });
      if (res.errors) {
        $("#err").innerHTML = Object.values(res.errors).map((m) => '<div class="field-error">' + esc(m) + "</div>").join("");
        btn.disabled = false; btn.textContent = "Выставить"; delete btn.dataset.armed;
        return;
      }
      if (afterSave) afterSave();
      closeModal();
      show("invoice", { invoiceId: res.invoice.id });
    });
  }

  function renderInvoiceDetail() {
    const el = $("#screen-invoice");
    const inv = Store.getInvoice(state.invoiceId);
    if (!inv) { el.innerHTML = '<div class="card">Счёт не найден.</div>'; return; }
    const c = Store.getClient(inv.clientId);
    const paid = Store.invoicePaidTotal(inv);
    const bal = Store.invoiceBalance(inv);
    const st = Store.displayStatus(inv);
    el.innerHTML =
      '<div class="card" id="printArea"><div class="muted">Счёт № ' + esc(inv.number) + ' от ' + esc(Store.formatDate(inv.issueDate)) + "</div>" +
      "<h2 style='margin:4px 0'>" + esc(c ? c.name : "—") + "</h2>" +
      '<div class="muted">' + esc(c ? c.phone : "") + (c && c.address ? " · " + esc(c.address) : "") + "</div>" +
      (inv.certRef ? '<div class="muted">Допуск: ' + esc(inv.certRef) + "</div>" : "") +
      '<table class="lines"><tbody>' + inv.lines.map((l) =>
        "<tr><td>" + esc(l.desc) + "</td><td class='num'>" + esc(Store.formatMoney(l.amount)) + "</td></tr>"
      ).join("") + "</tbody></table>" +
      '<div class="row"><span class="grow">Строки</span><span>' + esc(Store.formatMoney(inv.subtotal)) + "</span></div>" +
      '<div class="row"><span class="grow">Скидка</span><span>' + esc(Store.formatMoney(inv.discount)) + "</span></div>" +
      '<div class="total-line row"><span class="grow">Итого</span><span>' + esc(Store.formatMoney(inv.total)) + "</span></div>" +
      '<div class="row"><span class="grow">Оплачено</span><span>' + esc(Store.formatMoney(paid)) + "</span></div>" +
      '<div class="row"><span class="grow"><b>Остаток</b></span><b>' + esc(Store.formatMoney(bal)) + "</b></div>" +
      '<div class="row"><span class="grow">Срок оплаты: ' + esc(Store.formatDate(inv.dueDate)) + '</span><span class="badge ' +
      (st === "Просрочен" ? "overdue" : st === "Оплачен" ? "paid" : "issued") + '">' + esc(st) + "</span></div>" +
      (inv.payments.length ? "<b>Платежи</b>" + inv.payments.map((p2) =>
        "<div class='muted'>" + esc(Store.formatDate(p2.date)) + " · " + esc(Store.formatMoney(p2.amount)) + (p2.method ? " · " + esc(p2.method) : "") + "</div>"
      ).join("") : "") +
      "</div>" +
      '<div class="card no-print"><div class="actions">' +
      (bal > 0 ? '<button type="button" class="btn-primary" id="pay">Отметить оплату · ' + esc(Store.formatMoney(bal)) + "</button>" : "") +
      '<div class="actions two"><button type="button" id="print">Печать / PDF</button>' +
      '<button type="button" id="msg">Текст для мессенджера</button></div>' +
      '<button type="button" class="btn-ghost" id="back">← К клиенту</button>' +
      "</div></div>";
    const pay = $("#pay", el);
    if (pay) pay.addEventListener("click", () => openPaymentForm(inv));
    $("#print", el).addEventListener("click", () => window.print());
    $("#msg", el).addEventListener("click", () => {
      const text = "Здравствуйте! Счёт № " + inv.number + " на сумму " + Store.formatMoney(inv.total) +
        ", срок оплаты " + Store.formatDate(inv.dueDate) + ". Остаток " + Store.formatMoney(bal) + ". Спасибо!";
      copyText(text);
      alert("Текст скопирован — вставьте в мессенджер.");
    });
    $("#back", el).addEventListener("click", () => show("client", { clientId: inv.clientId }));
  }

  function openPaymentForm(inv) {
    const bal = Store.invoiceBalance(inv);
    openModal(
      "<h2>Оплата · остаток " + esc(Store.formatMoney(bal)) + "</h2><form id='f'>" +
      '<label>Сумма, ₽ *</label><input name="amount" inputmode="decimal" required value="' + (bal / 100).toString() + '">' +
      '<label>Дата</label><input name="date" type="date" value="' + esc(Store.todayISO()) + '">' +
      '<label>Способ</label><input name="method" maxlength="60" placeholder="Наличные / перевод">' +
      '<div id="err"></div><div class="actions"><button class="btn-primary" type="submit">Подтвердить ' + esc(Store.formatMoney(bal)) + "</button>" +
      '<button type="button" class="btn-ghost" id="cancel">Отмена</button></div></form>'
    );
    $("#cancel").addEventListener("click", closeModal);
    $("#f").addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const res = Store.addPayment(inv.id, Store.parseMoneyToKopecks(fd.get("amount")), fd.get("date"), fd.get("method"));
      if (res.errors) {
        $("#err").innerHTML = Object.values(res.errors).map((m) => '<div class="field-error">' + esc(m) + "</div>").join("");
        return;
      }
      closeModal();
      render();
    });
  }

  // ================= ДОЛГИ =================
  function reminderText(inv) {
    const c = Store.getClient(inv.clientId);
    return "Здравствуйте" + (c ? ", " + c.name : "") + "! Напоминаю про счёт № " + inv.number +
      " на " + Store.formatMoney(inv.total) + " (остаток " + Store.formatMoney(Store.invoiceBalance(inv)) +
      ", срок " + Store.formatDate(inv.dueDate) + "). Подскажите, когда удобно оплатить? Спасибо!";
  }

  function renderInvoices() {
    const el = $("#screen-invoices");
    const today = Store.todayISO();
    const unpaid = Store.listInvoices("unpaid");
    const debt = Store.debtTotal(today);
    el.innerHTML =
      '<div class="card"><div class="muted">Всего должны</div><div class="debt-big">' + esc(Store.formatMoney(debt)) + "</div></div>" +
      (unpaid.length ? unpaid.map((inv) => {
        const last = Store.lastReminder(inv);
        const daysAgo = last ? Store.daysUntil(today, last) * -1 : null;
        const canRemind = daysAgo === null || daysAgo >= 3;
        return '<div class="card">' + invoiceRow(inv) +
          '<div class="muted">' + (last ? "Напоминали " + esc(Store.formatDate(last)) + (canRemind ? "" : " · рано повторять") : "Ещё не напоминали") + "</div>" +
          '<div class="actions two"><button type="button" data-remind="' + inv.id + '"' + (canRemind ? "" : " disabled") + ">Напомнить</button>" +
          '<button type="button" class="btn-ghost" data-open="' + inv.id + '">Открыть</button></div></div>';
      }).join("") : '<div class="card muted">Долгов нет.</div>');
    $$("[data-open]", el).forEach((b) => b.addEventListener("click", () => show("invoice", { invoiceId: b.dataset.open })));
    $$("[data-remind]", el).forEach((b) => b.addEventListener("click", () => {
      const inv = Store.getInvoice(b.dataset.remind);
      copyText(reminderText(inv));
      Store.logReminder(inv.id);
      alert("Текст напоминания скопирован. Отправьте его вручную.");
      render();
    }));
  }

  function copyText(t) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).catch(() => fallbackCopy(t));
    else fallbackCopy(t);
  }
  function fallbackCopy(t) {
    const ta = document.createElement("textarea");
    ta.value = t;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch { /* ignore */ }
    document.body.removeChild(ta);
  }

  // ================= ДОПУСКИ =================
  function renderLicenses() {
    const el = $("#screen-licenses");
    const today = Store.todayISO();
    const list = Store.listLicenses();
    el.innerHTML =
      '<div class="card muted">Приложение напоминает о сроках, которые вы внесли сами. Оно не знает требований вашей страны и не гарантирует соответствие нормам.</div>' +
      (list.length ? list.map((l) => {
        const st = Store.licenseState(l, today);
        const label = st === "expired" ? "Просрочен" : st === "soon" ? "Скоро истекает" : st === "ok" ? "Действует" : "Без срока";
        const hist = (l.history || []).length ? "<div class='muted'>Продлений: " + l.history.length + ", прошлый срок " + esc(Store.formatDate(l.history[l.history.length - 1].expiresAt)) + "</div>" : "";
        return '<div class="card"><span class="row"><span class="grow"><b>' + esc(l.title) + "</b><div class='muted'>" +
          esc(l.number || "без номера") + (l.issuer ? " · " + esc(l.issuer) : "") + " · до " + esc(Store.formatDate(l.expiresAt) || "—") + "</div>" + hist +
          (l.fileName ? "<div class='muted'>📎 " + esc(l.fileName) + "</div>" : "") +
          '</span><span class="badge ' + st + '">' + esc(label) + "</span></span>" +
          '<div class="actions two"><button type="button" data-edit-lic="' + l.id + '">Правка / продлить</button>' +
          (l.fileData ? '<button type="button" class="btn-ghost" data-show-file="' + l.id + '">Показать файл</button>' : "") + "</div></div>";
      }).join("") : '<div class="card muted">Допусков пока нет.</div>') +
      '<div class="actions sticky-action"><button type="button" class="btn-primary" id="addLic">+ Допуск</button></div>';
    $("#addLic", el).addEventListener("click", () => openLicenseForm());
    $$("[data-edit-lic]", el).forEach((b) => b.addEventListener("click", () => openLicenseForm(b.dataset.editLic)));
    $$("[data-show-file]", el).forEach((b) => b.addEventListener("click", () => {
      const l = Store.listLicenses().find((x) => x.id === b.dataset.showFile);
      if (l && l.fileData) window.open(l.fileData, "_blank");
    }));
  }

  function openLicenseForm(id) {
    const l = id ? Store.listLicenses().find((x) => x.id === id) : { title: "", number: "", issuer: "", expiresAt: Store.addDaysISO(Store.todayISO(), 30) };
    if (id && !l) return;
    const types = profile().licenseTypes.map((t) => '<option ' + (l.title === t ? "selected" : "") + ">" + esc(t) + "</option>").join("");
    openModal(
      "<h2>" + (id ? "Допуск / продлить" : "Новый допуск") + "</h2><form id='f'>" +
      '<label>Название *</label><input name="title" list="licTypes" required maxlength="120" value="' + esc(l.title || "") + '">' +
      '<datalist id="licTypes">' + types + "</datalist>" +
      '<label>Номер</label><input name="number" maxlength="80" value="' + esc(l.number || "") + '">' +
      '<label>Кем выдан</label><input name="issuer" maxlength="120" value="' + esc(l.issuer || "") + '">' +
      '<label>Действует до</label><input name="expiresAt" type="date" value="' + esc(l.expiresAt || "") + '">' +
      '<label>Фото/файл документа</label><input name="file" type="file" accept="image/*,.pdf">' +
      '<div id="err"></div><div class="actions"><button class="btn-primary" type="submit">Сохранить</button>' +
      '<div class="actions two"><button type="button" class="btn-ghost" id="cancel">Отмена</button>' +
      (id ? '<button type="button" class="btn-danger" id="del">Удалить</button>' : "") + "</div></div></form>"
    );
    $("#cancel").addEventListener("click", closeModal);
    const del = $("#del");
    if (del) del.addEventListener("click", () => {
      if (!confirm("Удалить допуск?")) return;
      Store.deleteLicense(id);
      closeModal();
      render();
    });
    $("#f").addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const file = fd.get("file");
      const done = (fileName, fileData) => {
        const res = Store.saveLicense({
          id: id || undefined, title: fd.get("title"), number: fd.get("number"),
          issuer: fd.get("issuer"), expiresAt: fd.get("expiresAt"),
          fileName: fileData ? fileName : (l.fileName || ""),
          fileData: fileData ? fileData : (l.fileData || ""),
        });
        if (res.errors) {
          $("#err").innerHTML = Object.values(res.errors).map((m) => '<div class="field-error">' + esc(m) + "</div>").join("");
          return;
        }
        closeModal();
        render();
      };
      if (file && file.size) {
        if (file.size > 2 * 1024 * 1024) { $("#err").innerHTML = '<div class="field-error">Файл больше 2 МБ</div>'; return; }
        const r = new FileReader();
        r.onload = () => done(file.name, r.result);
        r.onerror = () => { $("#err").innerHTML = '<div class="field-error">Не удалось прочитать файл</div>'; };
        r.readAsDataURL(file);
      } else done();
    });
  }

  // ================= РЕЗЕРВ =================
  function openBackup() {
    openModal(
      "<h2>Резервная копия</h2><p class='muted'>Единственная защита локальных данных от очистки кэша — выгрузка в файл.</p>" +
      '<div class="actions"><button type="button" class="btn-primary" id="exp">Скачать выгрузку</button>' +
      '<label>Восстановить из файла</label><input type="file" id="imp" accept="application/json">' +
      '<div id="err"></div><button type="button" class="btn-ghost" id="cancel">Закрыть</button></div>'
    );
    $("#cancel").addEventListener("click", closeModal);
    $("#exp").addEventListener("click", () => {
      const blob = new Blob([Store.exportAll()], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "trades-backup-" + Store.todayISO() + ".json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    });
    $("#imp").addEventListener("change", (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        const res = Store.importAll(r.result);
        if (res.errors) { $("#err").innerHTML = '<div class="field-error">' + esc(res.errors._) + "</div>"; return; }
        closeModal();
        render();
      };
      r.readAsText(f);
    });
  }

  show("home");
})();
