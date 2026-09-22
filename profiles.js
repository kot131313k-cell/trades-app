/* Профиль профессии как данные. Экраны читают текущий профиль,
   никаких ветвлений по профессии в коде экранов. */
(function () {
  const PROFILES = {
    plumber: {
      id: "plumber",
      name: "Сантехник",
      mainButton: "Быстрый счёт",
      typicalJobs: [
        { name: "Выезд / вызов", price: 150000 },
        { name: "Срочный выезд (коэф.)", price: 250000 },
        { name: "Ночной тариф", price: 300000 },
        { name: "Прочистка засора", price: 350000 },
        { name: "Замена смесителя", price: 400000 },
        { name: "Устранение течи", price: 300000 },
        { name: "Замена труб (точка)", price: 500000 },
      ],
      jobExtras: ["urgent", "materials", "warranty", "photos"],
      licenseTypes: ["Страховка", "Договор с УК", "Сертификат"],
      invoiceHint: "Имя и телефон можно ввести прямо в счёте — клиент создастся сам.",
    },
    electrician: {
      id: "electrician",
      name: "Электрик",
      mainButton: "Новая работа на объекте",
      typicalJobs: [
        { name: "Выезд / диагностика", price: 150000 },
        { name: "Замена автомата", price: 200000 },
        { name: "Установка розетки/выключателя", price: 150000 },
        { name: "Прокладка линии (м)", price: 80000 },
        { name: "Сборка/ремонт щита", price: 800000 },
        { name: "Поиск неисправности", price: 300000 },
      ],
      jobExtras: ["site", "measurements", "act", "photos"],
      licenseTypes: ["Допуск по электробезопасности", "Сертификат", "Поверка приборов"],
      invoiceHint: "Группируйте работы по объекту (адресу). Номер допуска подставится в шапку счёта.",
    },
  };

  function currentProfile() {
    try {
      const id = localStorage.getItem("trades-app-profile") || "plumber";
      return PROFILES[id] || PROFILES.plumber;
    } catch {
      return PROFILES.plumber;
    }
  }

  function currentProfileId() {
    try {
      return localStorage.getItem("trades-app-profile") || "plumber";
    } catch {
      return "plumber";
    }
  }

  function setProfile(id) {
    try {
      localStorage.setItem("trades-app-profile", id);
    } catch { /* ignore */ }
  }

  const api = { PROFILES, currentProfile, currentProfileId, setProfile };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.AppProfiles = api;
})();
