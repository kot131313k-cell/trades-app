/* Автопроверки: суммы, просрочка, номера, сохранение/чтение. Запуск: node tests-core.js */
const Store = require("./storage.js");

let passed = 0, failed = 0;
function ok(cond, name, extra) {
  if (cond) { passed++; console.log("PASS " + name); }
  else { failed++; console.log("FAIL " + name + (extra ? " — " + extra : "")); }
}

// 1. Сумма со скидкой (целые копейки, без float-дрейфа)
{
  const t = Store.calcTotal([{ desc: "a", amount: 100000 }, { desc: "b", amount: 50250 }], 2550);
  ok(t.subtotal === 150250 && t.discount === 2550 && t.total === 147700, "сумма со скидкой", JSON.stringify(t));
  const t2 = Store.calcTotal([{ desc: "a", amount: 1000 }], 99999);
  ok(t2.total === 0 && t2.discount === 1000, "скидка не уводит в минус", JSON.stringify(t2));
  ok(Store.parseMoneyToKopecks("1 500,50") === 150050, "парсинг '1 500,50'");
  ok(Number.isNaN(Store.parseMoneyToKopecks("abc")), "мусор в цене -> NaN");
  ok(Number.isNaN(Store.parseMoneyToKopecks("")), "пустая цена -> NaN");
}

// 2. Просрочка вычисляется при показе
{
  const inv = { status: "issued", dueDate: "2026-01-01", total: 1000, payments: [] };
  ok(Store.isOverdue(inv, "2026-01-02") === true, "вчерашний срок -> просрочен");
  ok(Store.isOverdue(inv, "2026-01-01") === false, "граничная дата: срок сегодня -> не просрочен");
  ok(Store.displayStatus(inv, "2026-01-02") === "Просрочен", "статус 'Просрочен' на показе");
  ok(Store.displayStatus({ status: "draft", dueDate: "2020-01-01", total: 1, payments: [] }, "2026-01-01") === "Черновик", "черновик не просрочен");
}

// 3. Номера счетов без дублей
{
  const db = { clients: [], jobs: [], licenses: [], invoices: [{ number: "2026-001" }], seq: {} };
  const realYear = new Date().getFullYear();
  const n1 = Store.nextInvoiceNumber(db);
  const db2 = { clients: [], jobs: [], licenses: [], invoices: [{ number: n1 }], seq: db.seq };
  const n2 = Store.nextInvoiceNumber(db2);
  ok(n1 !== n2 && new RegExp("^" + realYear + "-\\d{3}$").test(n1), "номера уникальны и формата ГОД-Номер", n1 + " vs " + n2);
}

// 4. Сохранение и чтение (сценарии 1-3, 5 end-to-end через Store)
{
  Store.save({ clients: [], jobs: [], invoices: [], licenses: [], seq: {} }); // сброс in-memory/node
  const rc = Store.saveClient({ name: "Иван", phone: "+79990001122", address: "Ленина 1", note: "" });
  ok(!rc.errors && rc.client.id, "клиент сохраняется");
  const bad = Store.saveClient({ name: "", phone: "" });
  ok(bad.errors && bad.errors.name, "пустое имя отклоняется");
  const rj = Store.saveJob({ clientId: rc.client.id, date: "2026-09-22", desc: "Замена смесителя", priceKop: 400000, materials: [{ name: "Кран", sellKop: 150000 }] });
  ok(!rj.errors, "работа сохраняется");
  const rNeg = Store.saveJob({ clientId: rc.client.id, date: "2026-09-22", desc: "x", priceKop: -5 });
  ok(rNeg.errors && rNeg.errors.price, "отрицательная цена отклоняется");
  const ri = Store.saveInvoice({ clientId: rc.client.id, lines: [{ desc: "Работа", amount: 400000 }, { desc: "Кран", amount: 150000 }], discountKop: 50000, dueDate: "2026-09-29" });
  ok(!ri.errors && ri.invoice.total === 500000, "счёт: строки скопированы, итог верный", JSON.stringify(ri.invoice && ri.invoice.total));
  // Правка работы не меняет выставленный счёт
  Store.saveJob({ id: rj.job.id, clientId: rc.client.id, date: "2026-09-22", desc: "Замена смесителя", priceKop: 999999 });
  const invAgain = Store.getInvoice(ri.invoice.id);
  ok(invAgain.total === 500000, "правка работы не меняет счёт");
  // Частичная + полная оплата
  Store.addPayment(ri.invoice.id, 200000, "2026-09-23", "перевод");
  ok(Store.invoiceBalance(Store.getInvoice(ri.invoice.id)) === 300000, "частичная оплата уменьшает остаток");
  const over = Store.addPayment(ri.invoice.id, 999999999, "2026-09-23", "");
  ok(over.errors, "переплата отклоняется");
  Store.addPayment(ri.invoice.id, 300000, "2026-09-24", "наличные");
  const paidInv = Store.getInvoice(ri.invoice.id);
  ok(paidInv.status === "paid" && Store.listInvoices("unpaid").length === 0, "полная оплата убирает из долгов");
  // Допуск
  const rl = Store.saveLicense({ title: "Допуск", number: "123", issuer: "УЦ", expiresAt: "2026-09-25" });
  ok(!rl.errors && Store.licenseState(rl.license, "2026-09-22") === "soon", "допуск 'скоро истекает' за 3 дня");
  ok(Store.licenseState(rl.license, "2026-09-26") === "expired", "допуск просрочен после даты");
}

console.log("\nИтого: " + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
