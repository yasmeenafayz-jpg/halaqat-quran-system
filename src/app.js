export class App {
  constructor(root) {
    this.root = root;
    this.user = null;
    this.active = "dashboard";
    this.mobileOpen = false;
    this.render();
  }

  async render() {
    this.root.innerHTML = `
      <div class="app-shell" dir="rtl">
        <aside class="sidebar" id="sidebar">
          <div class="brand">
            <div class="brand-mark">أ</div>
            <div>
              <div class="brand-title">الأوَّابين</div>
              <div class="brand-subtitle">أكاديمية القرآن والتعليم</div>
            </div>
          </div>

          <nav class="main-navigation">
            ${this.nav("dashboard","لوحة التحكم","نظرة عامة")}
            ${this.nav("today","جدول اليوم","الجلسات والمواعيد")}
            ${this.nav("students","الطلاب","إدارة الطلاب")}
            ${this.nav("teachers","المعلمون","فريق الأكاديمية")}
            ${this.nav("circles","الحلقات","الفردية والجماعية")}
            ${this.nav("quran","القرآن والورد","الحفظ والمراجعة")}
            ${this.nav("attendance","الحضور","الحضور والمتابعة")}
            ${this.nav("achievements","الإنجازات","النقاط والتحفيز")}
            ${this.nav("competitions","المسابقات","الألعاب والتحديات")}
            ${this.nav("community","المجتمع","الرفقاء والتواصل")}
            ${this.nav("board","السبورة","التعليم التفاعلي")}
            ${this.nav("payments","المالية","المدفوعات والاشتراكات")}
            ${this.nav("reports","التقارير","الإحصائيات والتحليلات")}
            ${this.nav("notifications","الإشعارات","التنبيهات والرسائل")}
            ${this.nav("settings","الإعدادات","إدارة الأكاديمية")}
          </nav>

          <div class="sidebar-footer">
            <div class="security-badge">
              <span>●</span>
              <div>
                <strong>منصة آمنة</strong>
                <small>صلاحيات وحماية متقدمة</small>
              </div>
            </div>
          </div>
        </aside>

        <div class="main-content">
          <header class="topbar">
            <button class="mobile-menu" id="mobile-menu" type="button">☰</button>
            <div class="page-heading">
              <h1 id="page-title">لوحة التحكم</h1>
              <small id="page-subtitle">نظرة شاملة على الأكاديمية</small>
            </div>
            <div class="topbar-actions">
              <button class="icon-button" type="button" title="الإشعارات">🔔</button>
              <div class="topbar-user" id="topbar-user">جاري التحقق...</div>
            </div>
          </header>

          <main class="page-content" id="app-content">
            <div class="loading-state">
              <div class="loading-spinner"></div>
              <h2>جاري تجهيز منصة الأوَّابين...</h2>
              <p>يتم التحقق من جلسة الدخول وتأمين حسابك.</p>
            </div>
          </main>
        </div>
      </div>
    `;

    this.root.querySelector("#mobile-menu").addEventListener("click", () => {
      this.mobileOpen = !this.mobileOpen;
      this.root.querySelector("#sidebar").classList.toggle("open", this.mobileOpen);
    });

    try {
      const response = await fetch("/api/auth?action=me", {
        credentials: "include",
        headers: { Accept: "application/json" }
      });

      const data = await response.json().catch(() => ({}));

      if (response.ok && data.authenticated) {
        this.user = data.user;
        this.updateUser();
        this.renderDashboard();
      } else {
        this.renderLogin();
      }
    } catch {
      this.renderLogin("تعذر الاتصال بخدمة تسجيل الدخول.");
    }
  }

  nav(id, title, subtitle) {
    return `
      <button class="nav-item ${this.active === id ? "active" : ""}" data-page="${id}" type="button">
        <span>${title}</span>
        <small>${subtitle}</small>
      </button>
    `;
  }

  updateUser() {
    const el = this.root.querySelector("#topbar-user");
    if (!el) return;

    const name = this.escape(this.user?.full_name || "المستخدم");
    const role = this.escape(this.user?.role || "");

    el.innerHTML = `<strong>${name}</strong><small>${role}</small>`;
  }

  bindNavigation() {
    this.root.querySelectorAll(".nav-item").forEach((button) => {
      button.addEventListener("click", () => {
        this.active = button.dataset.page;
        this.root.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
        button.classList.add("active");

        const sidebar = this.root.querySelector("#sidebar");
        sidebar?.classList.remove("open");
        this.mobileOpen = false;

        if (this.active === "dashboard") {
          this.renderDashboard();
        } else {
          this.renderModule(this.active);
        }
      });
    });
  }

  renderDashboard() {
    const content = this.root.querySelector("#app-content");
    if (!content) return;

    const name = this.escape(this.user?.full_name || "عضو الأوَّابين");

    this.setHeading("لوحة التحكم", "نظرة شاملة على الأكاديمية");

    content.innerHTML = `
      <section class="dashboard-hero">
        <div>
          <span class="eyebrow">مرحبًا بك في الأوَّابين</span>
          <h2>${name}</h2>
          <p>منصة تعليمية متكاملة لإدارة القرآن، الحلقات، المتابعة، الإنجاز والمجتمع.</p>
        </div>
        <div class="hero-actions">
          <button type="button" data-page-action="today">جدول اليوم</button>
          <button type="button" data-page-action="quran">القرآن والورد</button>
        </div>
      </section>

      <section class="statistics-grid">
        ${this.stat("◷","جلسات اليوم","—","مواعيد اليوم")}
        ${this.stat("◉","الحضور","—","متابعة الطلاب")}
        ${this.stat("◆","الإنجاز","—","التقدم والنتائج")}
        ${this.stat("★","النقاط","—","التحفيز والمكافآت")}
      </section>

      <section class="content-card">
        <div class="section-heading">
          <div>
            <span class="eyebrow">منصة واحدة لكل شيء</span>
            <h2>مركز الأكاديمية</h2>
            <p>كل الخدمات مصممة لتعمل من داخل الأوَّابين.</p>
          </div>
        </div>

        <div class="feature-grid">
          ${this.feature("▣","جدول اليوم","عرض الجلسات والمواعيد وفق صلاحية المستخدم.","today")}
          ${this.feature("☾","القرآن والورد","الحفظ والمراجعة والسرد والمتابعة اليومية.","quran")}
          ${this.feature("♟","الرفقاء","مجتمع داخلي وتواصل آمن بين أعضاء الأكاديمية.","community")}
          ${this.feature("★","الألعاب والمسابقات","نقاط وتحديات ولوحات إنجاز لرفع الحماس.","competitions")}
          ${this.feature("▤","السبورة","تعليم تفاعلي داخل الجلسات.","board")}
          ${this.feature("◈","التقارير","مؤشرات أداء وتحليلات تساعد الإدارة على القرار.","reports")}
        </div>
      </section>

      <section class="content-card">
        <div class="section-heading">
          <div>
            <span class="eyebrow">الخطوة التالية</span>
            <h3>منظومة الأوَّابين المتكاملة</h3>
            <p>الحضور، القرآن، الجلسات، المالية، التحفيز والتواصل في بيئة واحدة.</p>
          </div>
        </div>

        <div class="quick-strip">
          <div><strong>القرآن</strong><span>حفظ ومراجعة وورد</span></div>
          <div><strong>الجلسات</strong><span>فردية وجماعية</span></div>
          <div><strong>التحفيز</strong><span>نقاط وشارات ومسابقات</span></div>
          <div><strong>المجتمع</strong><span>تواصل داخلي آمن</span></div>
        </div>
      </section>

      <button class="logout-button" id="logout-button" type="button">تسجيل الخروج</button>
    `;

    this.bindNavigation();
    this.root.querySelectorAll("[data-page-action]").forEach((button) => {
      button.addEventListener("click", () => {
        this.active = button.dataset.pageAction;
        this.root.querySelectorAll(".nav-item").forEach((item) => {
          item.classList.toggle("active", item.dataset.page === this.active);
        });
        this.renderModule(this.active);
      });
    });

    this.root.querySelector("#logout-button")?.addEventListener("click", () => this.logout());
  }

  stat(icon, label, value, hint) {
    return `
      <article class="stat-card">
        <div class="stat-icon">${icon}</div>
        <span>${label}</span>
        <strong>${value}</strong>
        <small>${hint}</small>
      </article>
    `;
  }

  feature(icon, title, description, page) {
    return `
      <article class="feature-card">
        <div class="feature-icon">${icon}</div>
        <h3>${title}</h3>
        <p>${description}</p>
        <button class="secondary-button" type="button" data-page-action="${page}">فتح القسم</button>
      </article>
    `;
  }

  async renderModule(page) {
    const titles = {
      dashboard: ["لوحة التحكم", "نظرة عامة على الأكاديمية"],
      today: ["جدول اليوم", "الجلسات والمواعيد وفق الصلاحيات"],
      students: ["الطلاب", "إدارة ملفات الطلاب والمتابعة"],
      teachers: ["المعلمون", "إدارة فريق الأكاديمية"],
      circles: ["الحلقات", "الحلقات الفردية والجماعية"],
      quran: ["القرآن والورد", "الحفظ والمراجعة والسرد اليومي"],
      attendance: ["الحضور", "الحضور والمتابعة والتنبيهات"],
      payments: ["المالية", "المدفوعات والاشتراكات والفواتير"],
      subscriptions: ["الاشتراكات", "الباقات والاشتراكات"],
      achievements: ["الإنجازات", "النقاط والشارات والمكافآت"],
      competitions: ["المسابقات", "الألعاب والتحديات والتحفيز"],
      community: ["المجتمع", "قنوات التواصل الداخلية"],
      board: ["السبورة", "التعليم التفاعلي داخل الجلسات"],
      reports: ["التقارير", "الإحصائيات والتحليلات"],
      notifications: ["الإشعارات", "التنبيهات والرسائل"],
      settings: ["الإعدادات", "إدارة إعدادات الأكاديمية"]
    };

    const info = titles[page] || ["الأوَّابين", "قسم الأكاديمية"];
    this.setHeading(info[0], info[1]);

    const content = this.root.querySelector("#app-content");
    if (!content) return;

    content.innerHTML = `
      <section class="module-hero">
        <span class="eyebrow">منصة الأوَّابين</span>
        <h2>${this.escape(info[0])}</h2>
        <p>${this.escape(info[1])}</p>
      </section>

      <section class="content-card" id="module-live-content">
        <div class="loading-state">
          <div class="loading-spinner"></div>
          <h3>جاري تحميل البيانات الفعلية...</h3>
        </div>
      </section>
    `;

    try {
      const endpoints = {
        students: "/api/students",
        teachers: "/api/teachers",
        circles: "/api/circles",
        quran: "/api/quran-progress",
        attendance: "/api/attendance",
        payments: "/api/payments",
        subscriptions: "/api/subscriptions",
        today: "/api/sessions"
      };

      const fields = {
        students: ["full_name", "student_code", "phone", "gender", "status"],
        teachers: ["full_name", "phone", "email", "status"],
        circles: ["name", "type", "status"],
        quran: ["student_name", "surah_name", "progress_type", "amount"],
        attendance: ["student_name", "session_id", "status", "created_at"],
        payments: ["student_name", "amount", "status", "payment_date"],
        subscriptions: ["student_name", "package_name", "status", "start_date"],
        today: ["student_name", "teacher_name", "session_type", "start_time", "status"]
      };

      if (endpoints[page]) {
        await this.renderSimpleListModule(
          info[0],
          endpoints[page],
          fields[page],
          page
        );
        return;
      }

      content.innerHTML = `
        <div class="empty-state premium-empty">
          <div class="empty-icon">✦</div>
          <h3>${this.escape(info[0])}</h3>
          <p>الواجهة الأساسية جاهزة، وسيتم توصيل هذا القسم بالـ API في المرحلة التالية.</p>
          <span class="status-pill">قيد البناء</span>
        </div>
      `;
    } catch (error) {
      content.innerHTML = `
        <div class="empty-state premium-empty">
          <div class="empty-icon">!</div>
          <h3>تعذر تحميل البيانات</h3>
          <p>${this.escape(error?.message || "حدث خطأ غير متوقع")}</p>
          <button class="secondary-button" id="module-retry" type="button">
            إعادة المحاولة
          </button>
        </div>
      `;

      content.querySelector("#module-retry")?.addEventListener(
        "click",
        () => this.renderModule(page)
      );
    }

    this.bindNavigation();
  }

  async apiGet(url) {
    const response = await fetch(url, {
      credentials: "include",
      headers: {
        Accept: "application/json"
      }
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data?.error ||
        data?.message ||
        `HTTP ${response.status}`
      );
    }

    return data;
  }

  async renderSimpleListModule(title, endpoint, fields, page) {
    const data = await this.apiGet(endpoint);

    let rows = Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data?.results)
        ? data.results
        : [];

    const content = this.root.querySelector("#module-live-content");
    if (!content) return;

    const labels = {
      full_name: "الاسم",
      student_code: "كود الطالب",
      phone: "الهاتف",
      email: "البريد",
      gender: "النوع",
      status: "الحالة",
      student_name: "الطالب",
      teacher_name: "المعلم",
      session_type: "نوع الجلسة",
      start_time: "وقت البداية",
      payment_date: "تاريخ الدفع",
      amount: "المبلغ",
      package_name: "الباقة",
      start_date: "تاريخ البداية",
      surah_name: "السورة",
      progress_type: "نوع المتابعة",
      session_id: "الجلسة",
      created_at: "تاريخ الإنشاء",
      type: "النوع",
      name: "الاسم"
    };

    content.innerHTML = `
      <div class="section-heading">
        <div>
          <span class="eyebrow">بيانات فعلية</span>
          <h3>${this.escape(title)}</h3>
          <p>عدد السجلات: <strong>${rows.length}</strong></p>
        </div>

        <button class="secondary-button" id="refresh-module" type="button">
          تحديث
        </button>
      </div>

      <div class="table-wrap">
        ${
          rows.length
            ? `
              <table class="data-table">
                <thead>
                  <tr>
                    ${fields.map((field) => `
                      <th>${this.escape(labels[field] || field)}</th>
                    `).join("")}
                  </tr>
                </thead>

                <tbody>
                  ${rows.map((row) => `
                    <tr>
                      ${fields.map((field) => `
                        <td>${this.escape(
                          row?.[field] === null ||
                          row?.[field] === undefined ||
                          row?.[field] === ""
                            ? "—"
                            : String(row[field])
                        )}</td>
                      `).join("")}
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            `
            : `
              <div class="empty-state">
                <div class="empty-icon">✦</div>
                <h3>لا توجد بيانات</h3>
                <p>تم الاتصال بالـ API بنجاح، ولا توجد سجلات لعرضها حاليًا.</p>
              </div>
            `
        }
      </div>
    `;

    content.querySelector("#refresh-module")?.addEventListener(
      "click",
      () => this.renderModule(page)
    );
  }

  setHeading(title, subtitle) {
    const titleEl = this.root.querySelector("#page-title");
    const subtitleEl = this.root.querySelector("#page-subtitle");
    if (titleEl) titleEl.textContent = title;
    if (subtitleEl) subtitleEl.textContent = subtitle;
  }

  renderLogin(message = "") {
    this.root.innerHTML = `
      <main class="auth-page" dir="rtl">
        <div class="auth-brand">
          <div class="brand-mark large">أ</div>
          <div>
            <strong>الأوَّابين</strong>
            <span>أكاديمية القرآن والتعليم</span>
          </div>
        </div>

        <section class="auth-card">
          <div class="auth-intro">
            <span class="eyebrow">منصة الأوَّابين</span>
            <h1>مرحبًا بك</h1>
            <p>ادخل إلى مساحتك التعليمية الآمنة.</p>
          </div>

          ${message ? `<div class="error-message">${this.escape(message)}</div>` : ""}

          <form id="login-form">
            <label for="identifier">البريد الإلكتروني أو رقم الهاتف</label>
            <input id="identifier" name="identifier" type="text" autocomplete="username" required>

            <label for="password">كلمة المرور</label>
            <input id="password" name="password" type="password" autocomplete="current-password" required>

            <button class="primary-login" type="submit">دخول إلى الأكاديمية</button>
            <p id="login-error" class="error-message" hidden></p>
          </form>

          <div class="auth-footer">
            <span>بيئة تعليمية آمنة</span>
            <span>•</span>
            <span>صلاحيات مخصصة</span>
          </div>
        </section>
      </main>
    `;

    this.root.querySelector("#login-form")?.addEventListener("submit", (event) => this.login(event));
  }

  async login(event) {
    event.preventDefault();

    const form = event.currentTarget;
    const button = form.querySelector("button");
    const error = form.querySelector("#login-error");

    button.disabled = true;
    button.textContent = "جارٍ الدخول...";
    error.hidden = true;

    try {
      const response = await fetch("/api/auth?action=login", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({
          identifier: form.identifier.value.trim(),
          password: form.password.value
        })
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.authenticated) {
        throw new Error(data.message || "بيانات تسجيل الدخول غير صحيحة.");
      }

      this.user = data.user;
      this.active = "dashboard";
      this.render();
    } catch (err) {
      error.textContent = err.message || "حدث خطأ أثناء تسجيل الدخول.";
      error.hidden = false;
      button.disabled = false;
      button.textContent = "دخول إلى الأكاديمية";
    }
  }

  async logout() {
    try {
      await fetch("/api/auth?action=logout", {
        method: "POST",
        credentials: "include",
        headers: { Accept: "application/json" }
      });
    } finally {
      this.user = null;
      this.active = "dashboard";
      this.renderLogin();
    }
  }

  escape(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
}
