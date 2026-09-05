function renderSmartAttempt(container, attempt, questions) {
  const escapeHtml = value => {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  const parseOptions = value => {
    if (Array.isArray(value)) return value;

    if (typeof value !== "string" || !value.trim()) {
      return [];
    }

    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const renderQuestion = (question, index) => {
    const type = String(question.question_type || "").toLowerCase();
    const text = escapeHtml(question.question_text || "السؤال");
    const id = Number(question.id);
    const points = Number(question.points) || 1;

    let answerHtml = "";

    if (
      type === "mcq" ||
      type === "multiple_choice" ||
      type === "choice" ||
      type === "single_choice"
    ) {
      const options = parseOptions(question.options_json);

      answerHtml = options.length
        ? `
          <div class="test-options">
            ${options.map((option, optionIndex) => {
              const value =
                typeof option === "object"
                  ? (option.value ?? option.id ?? option.text ?? "")
                  : option;

              const label =
                typeof option === "object"
                  ? (option.label ?? option.text ?? option.value ?? "")
                  : option;

              return `
                <label class="test-option">
                  <input
                    type="radio"
                    name="question_${id}"
                    value="${escapeHtml(value)}"
                  >
                  <span>${escapeHtml(label)}</span>
                </label>
              `;
            }).join("")}
          </div>
        `
        : `
          <input
            class="form-input"
            name="question_${id}"
            type="text"
            autocomplete="off"
            placeholder="اكتب الإجابة"
          >
        `;
    } else if (
      type === "true_false" ||
      type === "boolean"
    ) {
      answerHtml = `
        <div class="test-options">
          <label class="test-option">
            <input
              type="radio"
              name="question_${id}"
              value="true"
            >
            <span>صحيح</span>
          </label>

          <label class="test-option">
            <input
              type="radio"
              name="question_${id}"
              value="false"
            >
            <span>خطأ</span>
          </label>
        </div>
      `;
    } else if (
      type === "oral" ||
      type === "memorization"
    ) {
      answerHtml = `
        <textarea
          class="form-input"
          name="question_${id}"
          rows="4"
          placeholder="سجل إجابة الطالب أو ملاحظات التصحيح اليدوي"
        ></textarea>
        <div class="status-pill">
          هذا السؤال يحتاج إلى تصحيح المعلم.
        </div>
      `;
    } else {
      answerHtml = `
        <textarea
          class="form-input"
          name="question_${id}"
          rows="3"
          placeholder="اكتب الإجابة"
        ></textarea>
      `;
    }

    return `
      <div class="card smart-test-question">
        <div class="section-heading">
          <div>
            <span class="eyebrow">السؤال ${index + 1}</span>
            <h3>${text}</h3>
          </div>
          <span class="status-pill">${points} درجة</span>
        </div>

        ${answerHtml}
      </div>
    `;
  };

  const title =
    attempt?.title ||
    "الاختبار الذكي";

  container.innerHTML = `
    <div class="card">
      <div class="section-heading">
        <div>
          <span class="eyebrow">الاختبار الذكي</span>
          <h3>${escapeHtml(title)}</h3>
          <p>
            أجب عن جميع الأسئلة ثم اضغط «تسليم الاختبار».
          </p>
        </div>

        <div>
          <span class="status-pill">
            عدد الأسئلة: ${questions.length}
          </span>
        </div>
      </div>

      <form id="smart-attempt-form">
        <div id="smart-attempt-questions">
          ${questions.map(renderQuestion).join("")}
        </div>

        <div id="smart-attempt-message"></div>

        <div>
          <button
            class="primary-button"
            type="submit"
            id="submit-smart-attempt"
          >
            تسليم الاختبار
          </button>

          <button
            class="secondary-button"
            type="button"
            id="cancel-smart-attempt"
          >
            إغلاق
          </button>
        </div>
      </form>
    </div>
  `;

  const form = container.querySelector("#smart-attempt-form");
  const message = container.querySelector("#smart-attempt-message");
  const submitButton =
    container.querySelector("#submit-smart-attempt");

  container
    .querySelector("#cancel-smart-attempt")
    ?.addEventListener("click", () => {
      container.innerHTML = "";
    });

  form?.addEventListener("submit", async event => {
    event.preventDefault();

    if (!Number.isInteger(Number(attempt?.id))) {
      message.innerHTML =
        `<div class="status-pill">رقم محاولة الاختبار غير صالح.</div>`;
      return;
    }

    const attemptId = Number(attempt.id);

    const answers = questions.map(question => {
      const questionId = Number(question.id);
      const field =
        form.querySelector(`[name="question_${questionId}"]:checked`) ||
        form.querySelector(`[name="question_${questionId}"]`);

      const value = field?.value ?? "";

      const type =
        String(question.question_type || "").toLowerCase();

      if (
        type === "mcq" ||
        type === "multiple_choice" ||
        type === "choice" ||
        type === "single_choice"
      ) {
        return {
          attempt_question_id: questionId,
          selected_option: value,
          answer_text: ""
        };
      }

      return {
        attempt_question_id: questionId,
        selected_option: "",
        answer_text: value
      };
    });

    const unanswered = answers.filter(answer => {
      return !String(
        answer.selected_option || answer.answer_text || ""
      ).trim();
    }).length;

    if (unanswered > 0) {
      const confirmed = window.confirm(
        `يوجد ${unanswered} سؤال بدون إجابة. هل تريد تسليم الاختبار؟`
      );

      if (!confirmed) {
        return;
      }
    }

    submitButton.disabled = true;
    message.innerHTML =
      `<div class="status-pill">جاري تصحيح الاختبار...</div>`;

    try {
      const response = await fetch(
        "/api/test-engine?action=submit",
        {
          method: "PATCH",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json"
          },
          body: JSON.stringify({
            attempt_id: attemptId,
            answers
          })
        }
      );

      const payload =
        await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          payload?.error ||
          payload?.message ||
          `HTTP ${response.status}`
        );
      }

      const result =
        payload?.data?.result ||
        payload?.result ||
        {};

      const savedAnswers =
        Array.isArray(payload?.data?.answers)
          ? payload.data.answers
          : [];

      const manualPending =
        Boolean(
          result.manual_pending ||
          savedAnswers.some(
            answer => answer.auto_graded === false
          )
        );

      const score =
        Number(result.score);

      const maxScore =
        Number(result.max_score);

      const percentage =
        Number(result.percentage);

      message.innerHTML = `
        <div class="card">
          <div class="section-heading">
            <div>
              <span class="eyebrow">تم التسليم</span>
              <h3>
                ${
                  manualPending
                    ? "تم تسليم الاختبار ويحتاج بعض الأسئلة إلى تصحيح المعلم."
                    : "تم تصحيح الاختبار بنجاح."
                }
              </h3>
            </div>
          </div>

          <div class="form-grid">
            <div class="status-pill">
              الدرجة:
              ${
                Number.isFinite(score)
                  ? score
                  : "—"
              }
              /
              ${
                Number.isFinite(maxScore)
                  ? maxScore
                  : "—"
              }
            </div>

            <div class="status-pill">
              النسبة:
              ${
                Number.isFinite(percentage)
                  ? `${percentage}%`
                  : "—"
              }
            </div>

            ${
              manualPending
                ? `
                  <div class="status-pill">
                    الحالة: بانتظار تصحيح المعلم
                  </div>
                `
                : ""
            }
          </div>
        </div>
      `;

      submitButton.remove();
    } catch (error) {
      message.innerHTML =
        `<div class="status-pill">${escapeHtml(
          error?.message ||
          "تعذر تسليم الاختبار."
        )}</div>`;

      submitButton.disabled = false;
    }
  });
}

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
            ${this.nav("schedule","الجدول","مركز الجدول والمواعيد")}
            ${this.nav("students","الطلاب","إدارة الطلاب")}
            ${this.nav("teachers","المعلمون","فريق الأكاديمية")}
            ${this.nav("circles","الحلقات","الفردية والجماعية")}
            ${this.nav("quran","القرآن والورد","الحفظ والمراجعة")}
            ${this.nav("attendance","الحضور","الحضور والمتابعة")}
            ${this.nav("tests","الاختبارات","اختبارات الطلاب")}
            ${this.nav("question-bank","بنك الأسئلة","إدارة الأسئلة والمواد")}
            ${this.nav("achievements","الإنجازات","النقاط والتحفيز")}
            ${this.nav("competitions","المسابقات","الألعاب والتحديات")}
            ${this.nav("community","المجتمع","الرفقاء والتواصل")}
            ${this.nav("board","السبورة","التعليم التفاعلي")}
            ${this.nav("payments","المالية","المدفوعات والاشتراكات")}
            ${this.nav("reports","التقارير","الإحصائيات والتحليلات")}
            ${this.nav("notifications","الإشعارات","التنبيهات والرسائل")}
            ${this.nav("attendance-excuses","الاعتذارات","مراجعة اعتذارات الغياب والفوترة")}
            ${this.nav("teacher-leaves","إجازات المعلمين","طلبات الإجازات واعتمادها")}
            ${this.nav("documents","المستندات","المستندات والملفات التعليمية")}
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
      schedule: ["الجدول", "مركز الجدول والمواعيد والإجازات"],
      students: ["الطلاب", "إدارة ملفات الطلاب والمتابعة"],
      teachers: ["المعلمون", "إدارة فريق الأكاديمية"],
      circles: ["الحلقات", "الحلقات الفردية والجماعية"],
      quran: ["القرآن والورد", "الحفظ والمراجعة والسرد اليومي"],
      attendance: ["الحضور", "الحضور والمتابعة والتنبيهات"],
    tests: ["الاختبارات", "اختبارات الطلاب والنتائج"],
    "question-bank": ["بنك الأسئلة", "إدارة بنك الأسئلة والمواد التعليمية"],
      payments: ["المالية", "المدفوعات والاشتراكات والفواتير"],
      subscriptions: ["الاشتراكات", "الباقات والاشتراكات"],
      achievements: ["الإنجازات", "النقاط والشارات والمكافآت"],
      competitions: ["المسابقات", "الألعاب والتحديات والتحفيز"],
      community: ["المجتمع", "قنوات التواصل الداخلية"],
      board: ["السبورة", "التعليم التفاعلي داخل الجلسات"],
      reports: ["التقارير", "الإحصائيات والتحليلات"],
      notifications: ["الإشعارات", "التنبيهات والرسائل"],
      "attendance-excuses": ["الاعتذارات", "مراجعة اعتذارات الغياب والفوترة"],
      "teacher-leaves": ["إجازات المعلمين", "طلبات الإجازات واعتمادها"],
      documents: ["المستندات", "المستندات والملفات التعليمية"],
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
      tests: "/api/tests",
      "question-bank": "/api/question-bank",
        payments: "/api/payments",
        subscriptions: "/api/subscriptions",
        today: "/api/sessions",
        schedule: "/api/schedule-center",
        reports: "/api/dashboard",
      "attendance-excuses": "/api/attendance-excuses",
      "teacher-leaves": "/api/teacher-leaves",
      documents: "/api/documents",
      settings: "/api/settings"
      };

      const fields = {
        students: ["full_name", "student_code", "phone", "gender", "status"],
        teachers: ["full_name", "phone", "email", "status"],
        circles: ["name", "type", "status"],
        quran: ["student_name", "surah_name", "progress_type", "amount"],
        attendance: ["student_name", "session_id", "status", "created_at"],
        payments: ["student_name", "amount", "status", "payment_date"],
        subscriptions: ["student_name", "package_name", "status", "start_date"],
        today: ["student_name", "teacher_name", "session_type", "start_time", "status"],
        reports: [],
        "attendance-excuses": [
          "student_name",
          "session_id",
          "excuse_text",
          "status",
          "submitted_at"
        ],
        "teacher-leaves": [
          "teacher_name",
          "leave_type",
          "start_date",
          "end_date",
          "status"
        ],
        documents: [
          "title",
          "document_type",
          "storage_type",
          "status",
          "created_at"
        ],
        settings: [
          "setting_key",
          "setting_value",
          "value_type",
          "scope_type",
          "is_editable"
        ]
      };

      if (page === "schedule") {
        await this.renderScheduleCenter(info[0]);
        return;
      }

      if (page === "reports") {
        await this.renderReportsModule(
          info[0],
          endpoints[page]
        );
        return;
      }

      if (page === "tests") {
        await this.renderTestsModule(info[0]);
        return;
      }

      if (page === "question-bank") {
        await this.renderQuestionBankModule(info[0]);
        return;
      }

      if (page === "attendance-excuses") {
        await this.renderAttendanceExcusesModule(info[0]);
        return;
      }

      if (page === "teacher-leaves") {
        await this.renderTeacherLeavesModule(info[0]);
        return;
      }

      if (page === "documents") {
        await this.renderDocumentsModule(info[0]);
        return;
      }

      if (page === "settings") {
        await this.renderSettingsModule(info[0]);
        return;
      }

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

  async renderReportsModule(title, endpoint) {
    const data = await this.apiGet(endpoint);

    const counts = data?.counts || {};
    const financial = data?.financial || {};

    const content = this.root.querySelector("#module-live-content");
    if (!content) return;

    const cards = [
      ["الطلاب النشطون", counts.students ?? 0, "👨‍🎓"],
      ["المعلمون النشطون", counts.teachers ?? 0, "👩‍🏫"],
      ["الحلقات النشطة", counts.circles ?? 0, "📚"],
      ["جلسات اليوم", counts.today ?? 0, "🗓️"],
      ["طلبات الالتحاق", counts.pending_enrollments ?? 0, "📝"],
      ["قائمة الانتظار", counts.waitlisted ?? 0, "⏳"],
      ["الاشتراكات النشطة", counts.active_subscriptions ?? 0, "✅"],
      ["التجريبية", counts.trial_subscriptions ?? 0, "🧪"],
      ["غياب اليوم", counts.absent_today ?? 0, "❌"],
      ["اعتذارات اليوم", counts.excused_today ?? 0, "📩"],
      ["تأخير اليوم", counts.late_today ?? 0, "⏰"],
      ["الغرامات المعلقة", counts.pending_fines ?? 0, "⚠️"],
      ["الحلقات المكتملة", counts.full_circles ?? 0, "🔒"],
      ["الاشتراكات المنتهية", counts.expired_subscriptions ?? 0, "⌛"]
    ];

    const money = (value) => {
      const amount = Number(value || 0);
      return new Intl.NumberFormat("ar-EG", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(amount);
    };

    content.innerHTML = `
      <div class="reports-grid">
        ${cards.map(([label, value, icon]) => `
          <article class="report-card">
            <div class="report-card-icon">${icon}</div>
            <div class="report-card-body">
              <span class="report-card-label">${this.escape(label)}</span>
              <strong class="report-card-value">${this.escape(String(value))}</strong>
            </div>
          </article>
        `).join("")}
      </div>

      <section class="report-financial-section">
        <div class="section-heading">
          <div>
            <span class="eyebrow">المالية</span>
            <h3>ملخص مالي</h3>
          </div>
        </div>

        <div class="reports-grid reports-financial-grid">
          <article class="report-card">
            <div class="report-card-icon">💳</div>
            <div class="report-card-body">
              <span class="report-card-label">مدفوعات اليوم</span>
              <strong class="report-card-value">${this.escape(money(financial.payments_today))}</strong>
            </div>
          </article>

          <article class="report-card">
            <div class="report-card-icon">📊</div>
            <div class="report-card-body">
              <span class="report-card-label">مدفوعات الشهر</span>
              <strong class="report-card-value">${this.escape(money(financial.payments_this_month))}</strong>
            </div>
          </article>

          <article class="report-card">
            <div class="report-card-icon">⚠️</div>
            <div class="report-card-body">
              <span class="report-card-label">قيمة الغرامات المعلقة</span>
              <strong class="report-card-value">${this.escape(money(financial.pending_fines_amount))}</strong>
            </div>
          </article>
        </div>
      </section>

      <div class="report-footer">
        <span>تاريخ التقرير</span>
        <strong>${this.escape(data?.today || "—")}</strong>
      </div>
    `;
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

  async renderScheduleCenter(title) {
    const content = this.root.querySelector("#app-content");

    content.innerHTML = `
      <section class="schedule-center">
        <div class="schedule-toolbar">
          <div class="schedule-toolbar-group">
            <label>
              <span>التاريخ</span>
              <input id="schedule-date" type="date">
            </label>

            <label>
              <span>العرض</span>
              <select id="schedule-view">
                <option value="day">يومي</option>
                <option value="week">أسبوعي</option>
                <option value="month">شهري</option>
              </select>
            </label>

            <label>
              <span>المعلم</span>
              <select id="schedule-teacher">
                <option value="">كل المعلمين</option>
              </select>
            </label>

            <label>
              <span>الحلقة</span>
              <select id="schedule-circle">
                <option value="">كل الحلقات</option>
              </select>
            </label>

            <label>
              <span>نوع الجلسة</span>
              <select id="schedule-type">
                <option value="">كل الأنواع</option>
                <option value="group">جماعية</option>
                <option value="individual">فردية</option>
                <option value="trial">تجريبية</option>
                <option value="test">اختبار</option>
                <option value="independent_recitation">تسميع</option>
                <option value="scientific">مواد علمية</option>
              </select>
            </label>

            <button
              type="button"
              class="button"
              id="schedule-refresh"
            >
              تحديث
            </button>
          </div>

          <div class="schedule-view-buttons" role="tablist">
            <button type="button" class="active" data-view="day">اليوم</button>
            <button type="button" data-view="week">الأسبوع</button>
            <button type="button" data-view="month">الشهر</button>
          </div>
        </div>

        <div id="schedule-summary" class="schedule-summary"></div>

        <div
          id="schedule-loading"
          class="loading-state"
          style="display:none"
        >
          <div class="loading-spinner"></div>
          <h3>جاري تحميل الجدول...</h3>
        </div>

        <div id="schedule-grid" class="schedule-grid"></div>
      </section>
    `;

    const dateInput =
      content.querySelector("#schedule-date");

    const viewSelect =
      content.querySelector("#schedule-view");

    const teacherSelect =
      content.querySelector("#schedule-teacher");

    const circleSelect =
      content.querySelector("#schedule-circle");

    const typeSelect =
      content.querySelector("#schedule-type");

    const refresh =
      content.querySelector("#schedule-refresh");

    const loading =
      content.querySelector("#schedule-loading");

    const grid =
      content.querySelector("#schedule-grid");

    const summary =
      content.querySelector("#schedule-summary");

    const viewButtons =
      [...content.querySelectorAll("[data-view]")];

    const today =
      new Date().toISOString().slice(0, 10);

    dateInput.value = today;

    let currentView = "day";

    const addDays = (value, amount) => {
      const d =
        new Date(`${value}T12:00:00`);

      d.setDate(d.getDate() + amount);

      return d.toISOString().slice(0, 10);
    };

    const getRange = () => {
      const selected =
        dateInput.value || today;

      if (currentView === "day") {
        return {
          start_date: selected,
          end_date: selected
        };
      }

      const d =
        new Date(`${selected}T12:00:00`);

      if (currentView === "week") {
        const day = d.getDay();

        return {
          start_date: addDays(selected, -day),
          end_date: addDays(selected, 6 - day)
        };
      }

      const first =
        new Date(
          d.getFullYear(),
          d.getMonth(),
          1,
          12
        );

      const last =
        new Date(
          d.getFullYear(),
          d.getMonth() + 1,
          0,
          12
        );

      return {
        start_date:
          first.toISOString().slice(0, 10),
        end_date:
          last.toISOString().slice(0, 10)
      };
    };

    const formatDate = (value) => {
      if (!value) return "—";

      try {
        return new Intl.DateTimeFormat(
          "ar-EG",
          {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric"
          }
        ).format(
          new Date(`${value}T12:00:00`)
        );
      } catch {
        return value;
      }
    };

    const render = async () => {
      loading.style.display = "block";
      grid.innerHTML = "";
      summary.innerHTML = "";

      try {
        const range = getRange();

        const params =
          new URLSearchParams(range);

        if (teacherSelect.value) {
          params.set(
            "teacher_id",
            teacherSelect.value
          );
        }

        if (circleSelect.value) {
          params.set(
            "circle_id",
            circleSelect.value
          );
        }

        if (typeSelect.value) {
          params.set(
            "session_type",
            typeSelect.value
          );
        }

        const response =
          await this.apiGet(
            `/api/schedule-center?${params.toString()}`
          );

        const data =
          response?.data || {};

        const sessions =
          Array.isArray(data.sessions)
            ? data.sessions
            : [];

        const leaves =
          Array.isArray(data.leaves)
            ? data.leaves
            : [];

        if (teacherSelect.options.length === 1) {
          (data.teachers || []).forEach(
            (teacher) => {
              teacherSelect.insertAdjacentHTML(
                "beforeend",
                `<option value="${this.escape(
                  teacher.id
                )}">${this.escape(
                  teacher.full_name
                )}</option>`
              );
            }
          );
        }

        if (circleSelect.options.length === 1) {
          (data.circles || []).forEach(
            (circle) => {
              circleSelect.insertAdjacentHTML(
                "beforeend",
                `<option value="${this.escape(
                  circle.id
                )}">${this.escape(
                  circle.name
                )}</option>`
              );
            }
          );
        }

        const completed =
          sessions.filter(
            (session) =>
              session.status === "completed"
          ).length;

        const cancelled =
          sessions.filter(
            (session) =>
              String(session.status || "")
                .toLowerCase()
                .includes("cancel")
          ).length;

        summary.innerHTML = `
          <div>
            <span>الفترة</span>
            <strong>${this.escape(
              currentView === "day"
                ? formatDate(range.start_date)
                : `${range.start_date} → ${range.end_date}`
            )}</strong>
          </div>

          <div>
            <span>الجلسات</span>
            <strong>${sessions.length}</strong>
          </div>

          <div>
            <span>مكتملة</span>
            <strong>${completed}</strong>
          </div>

          <div>
            <span>ملغاة</span>
            <strong>${cancelled}</strong>
          </div>

          <div>
            <span>إجازات معتمدة</span>
            <strong>${leaves.length}</strong>
          </div>
        `;

        if (!sessions.length && !leaves.length) {
          grid.innerHTML = `
            <div class="empty-state">
              <div class="empty-icon">◷</div>
              <h3>لا توجد جلسات في هذه الفترة</h3>
              <p>يمكنك تغيير التاريخ أو الفلاتر لعرض مواعيد أخرى.</p>
            </div>
          `;
        } else {
          const groups = {};

          sessions.forEach((session) => {
            const key =
              session.session_date || "unknown";

            if (!groups[key]) {
              groups[key] = [];
            }

            groups[key].push(session);
          });

          Object.entries(groups).forEach(
            ([date, daySessions]) => {
              const day =
                document.createElement("section");

              day.className =
                "schedule-day";

              day.innerHTML = `
                <div class="schedule-day-heading">
                  <strong>${this.escape(
                    formatDate(date)
                  )}</strong>
                  <span>${daySessions.length} جلسة</span>
                </div>
              `;

              daySessions.forEach(
                (session) => {
                  const card =
                    document.createElement("article");

                  card.className =
                    "schedule-session";

                  card.innerHTML = `
                    <div class="schedule-time">
                      <strong>${this.escape(
                        session.start_time || "—"
                      )}</strong>
                      <span>${this.escape(
                        session.end_time || "—"
                      )}</span>
                    </div>

                    <div class="schedule-session-main">
                      <strong>${this.escape(
                        session.circle_name ||
                        session.student_name ||
                        "جلسة"
                      )}</strong>

                      <span>
                        ${this.escape(
                          session.teacher_name ||
                          "بدون معلم محدد"
                        )}
                      </span>

                      <small>
                        ${this.escape(
                          session.session_type ||
                          "—"
                        )}
                      </small>
                    </div>

                    <span class="schedule-status status-${this.escape(
                      session.status || "scheduled"
                    )}">
                      ${this.escape(
                        session.status ||
                        "scheduled"
                      )}
                    </span>
                  `;

                  day.appendChild(card);
                }
              );

              grid.appendChild(day);
            }
          );

          leaves.forEach((leave) => {
            const card =
              document.createElement("article");

            card.className =
              "schedule-leave";

            card.innerHTML = `
              <strong>إجازة معتمدة</strong>
              <span>${this.escape(
                leave.teacher_name ||
                "معلم"
              )}</span>
              <small>
                ${this.escape(
                  leave.start_date
                )}
                →
                ${this.escape(
                  leave.end_date
                )}
              </small>
            `;

            grid.appendChild(card);
          });
        }
      } catch (error) {
        grid.innerHTML = `
          <div class="empty-state">
            <h3>تعذر تحميل الجدول</h3>
            <p>${this.escape(
              error.message ||
              "حدث خطأ غير متوقع."
            )}</p>
          </div>
        `;
      } finally {
        loading.style.display = "none";
      }
    };

    viewButtons.forEach((button) => {
      button.addEventListener(
        "click",
        () => {
          viewButtons.forEach(
            (item) =>
              item.classList.remove("active")
          );

          button.classList.add("active");

          currentView =
            button.dataset.view || "day";

          viewSelect.value = currentView;

          render();
        }
      );
    });

    viewSelect.addEventListener(
      "change",
      () => {
        currentView =
          viewSelect.value || "day";

        viewButtons.forEach(
          (button) => {
            button.classList.toggle(
              "active",
              button.dataset.view === currentView
            );
          }
        );

        render();
      }
    );

    [
      dateInput,
      teacherSelect,
      circleSelect,
      typeSelect
    ].forEach((element) => {
      element.addEventListener(
        "change",
        render
      );
    });

    refresh.addEventListener(
      "click",
      render
    );

    await render();
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


  async renderAttendanceExcusesModule(title) {
    const content = this.root.querySelector("#module-live-content");
    if (!content) return;

    const result = await this.apiGet("/api/attendance-excuses");
    const rows = result?.data || [];

    const statusLabel = {
      pending: "قيد المراجعة",
      approved: "مقبول",
      rejected: "مرفوض"
    };

    content.innerHTML = `
      <div class="section-heading">
        <div>
          <span class="eyebrow">المتابعة</span>
          <h3>${this.escape(title)}</h3>
          <p>طلبات الاعتذار المسجلة: <strong>${rows.length}</strong></p>
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
                    <th>الطالب</th>
                    <th>الجلسة</th>
                    <th>الاعتذار</th>
                    <th>الحالة</th>
                    <th>تاريخ الإرسال</th>
                    <th>الإجراء</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows.map(row => `
                    <tr>
                      <td>${this.escape(row.student_name || "—")}</td>
                      <td>${this.escape(row.session_id ?? "—")}</td>
                      <td>${this.escape(row.excuse_text || "—")}</td>
                      <td>
                        <span class="status-pill">
                          ${this.escape(statusLabel[row.status] || row.status || "—")}
                        </span>
                      </td>
                      <td>${this.escape(row.submitted_at || "—")}</td>
                      <td>
                        ${
                          row.status === "pending" &&
                          ["admin","teacher"].includes(this.user?.role)
                            ? `
                              <button
                                class="secondary-button excuse-review"
                                data-id="${this.escape(row.id)}"
                                data-status="approved"
                                type="button"
                              >قبول</button>
                              <button
                                class="secondary-button excuse-review"
                                data-id="${this.escape(row.id)}"
                                data-status="rejected"
                                type="button"
                              >رفض</button>
                            `
                            : "—"
                        }
                      </td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            `
            : `
              <div class="empty-state">
                <div class="empty-icon">✦</div>
                <h3>لا توجد اعتذارات</h3>
                <p>لا توجد طلبات اعتذار مسجلة حاليًا.</p>
              </div>
            `
        }
      </div>
    `;

    content.querySelector("#refresh-module")?.addEventListener(
      "click",
      () => this.renderModule("attendance-excuses")
    );

    content.querySelectorAll(".excuse-review").forEach(button => {
      button.addEventListener("click", async () => {
        button.disabled = true;

        try {
          const response = await fetch(
            "/api/attendance-excuses",
            {
              method: "PATCH",
              credentials: "include",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json"
              },
              body: JSON.stringify({
                id: Number(button.dataset.id),
                status: button.dataset.status
              })
            }
          );

          const data = await response.json().catch(() => ({}));

          if (!response.ok) {
            throw new Error(
              data.error ||
              data.message ||
              "تعذر تحديث الاعتذار."
            );
          }

          await this.renderModule("attendance-excuses");
        } catch (error) {
          alert(error?.message || "حدث خطأ.");
          button.disabled = false;
        }
      });
    });
  }

  async renderTeacherLeavesModule(title) {
    const content = this.root.querySelector("#module-live-content");
    if (!content) return;

    const result = await this.apiGet("/api/teacher-leaves");
    const rows = result?.data || [];

    const statusLabel = {
      pending: "قيد المراجعة",
      approved: "مقبول",
      rejected: "مرفوض",
      cancelled: "ملغي"
    };

    const canReview =
      ["admin", "supervisor"].includes(this.user?.role);

    content.innerHTML = `
      <div class="section-heading">
        <div>
          <span class="eyebrow">الجدولة</span>
          <h3>${this.escape(title)}</h3>
          <p>طلبات الإجازات: <strong>${rows.length}</strong></p>
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
                    <th>المعلم</th>
                    <th>النوع</th>
                    <th>من</th>
                    <th>إلى</th>
                    <th>الحالة</th>
                    <th>الإجراء</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows.map(row => `
                    <tr>
                      <td>${this.escape(row.teacher_name || row.teacher_id || "—")}</td>
                      <td>${this.escape(row.leave_type || "—")}</td>
                      <td>${this.escape(row.start_date || "—")}</td>
                      <td>${this.escape(row.end_date || "—")}</td>
                      <td>
                        <span class="status-pill">
                          ${this.escape(statusLabel[row.status] || row.status || "—")}
                        </span>
                      </td>
                      <td>
                        ${
                          canReview && row.status === "pending"
                            ? `
                              <button
                                class="secondary-button leave-review"
                                data-id="${this.escape(row.id)}"
                                data-status="approved"
                                type="button"
                              >اعتماد</button>
                              <button
                                class="secondary-button leave-review"
                                data-id="${this.escape(row.id)}"
                                data-status="rejected"
                                type="button"
                              >رفض</button>
                            `
                            : "—"
                        }
                      </td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            `
            : `
              <div class="empty-state">
                <div class="empty-icon">✦</div>
                <h3>لا توجد طلبات إجازة</h3>
                <p>لا توجد طلبات مسجلة حاليًا.</p>
              </div>
            `
        }
      </div>
    `;

    content.querySelector("#refresh-module")?.addEventListener(
      "click",
      () => this.renderModule("teacher-leaves")
    );

    content.querySelectorAll(".leave-review").forEach(button => {
      button.addEventListener("click", async () => {
        button.disabled = true;

        try {
          const response = await fetch(
            "/api/teacher-leaves",
            {
              method: "PATCH",
              credentials: "include",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json"
              },
              body: JSON.stringify({
                id: Number(button.dataset.id),
                status: button.dataset.status
              })
            }
          );

          const data = await response.json().catch(() => ({}));

          if (!response.ok) {
            throw new Error(
              data.error ||
              data.message ||
              "تعذر تحديث طلب الإجازة."
            );
          }

          await this.renderModule("teacher-leaves");
        } catch (error) {
          alert(error?.message || "حدث خطأ.");
          button.disabled = false;
        }
      });
    });
  }

  async renderDocumentsModule(title) {
    const content = this.root.querySelector("#module-live-content");
    if (!content) return;

    const result = await this.apiGet("/api/documents");
    const rows = result?.documents || result?.data || [];

    content.innerHTML = `
      <div class="section-heading">
        <div>
          <span class="eyebrow">المستندات</span>
          <h3>${this.escape(title)}</h3>
          <p>المستندات المتاحة لحسابك: <strong>${rows.length}</strong></p>
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
                    <th>العنوان</th>
                    <th>النوع</th>
                    <th>التخزين</th>
                    <th>الحالة</th>
                    <th>التاريخ</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows.map(row => `
                    <tr>
                      <td>${this.escape(row.title || row.file_name || "—")}</td>
                      <td>${this.escape(row.document_type || "—")}</td>
                      <td>${this.escape(row.storage_type || "—")}</td>
                      <td>
                        <span class="status-pill">
                          ${this.escape(row.status || "—")}
                        </span>
                      </td>
                      <td>${this.escape(row.created_at || "—")}</td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            `
            : `
              <div class="empty-state">
                <div class="empty-icon">✦</div>
                <h3>لا توجد مستندات</h3>
                <p>لا توجد مستندات متاحة لهذا الحساب حاليًا.</p>
              </div>
            `
        }
      </div>
    `;

    content.querySelector("#refresh-module")?.addEventListener(
      "click",
      () => this.renderModule("documents")
    );
  }

  async renderTestsModule(title) {
    const content = this.root.querySelector("#module-live-content");
    if (!content) return;

    const canWrite =
      ["admin", "supervisor", "teacher"].includes(this.user?.role);

    content.innerHTML = `
      <div class="section-heading">
        <div>
          <span class="eyebrow">التقييم والمتابعة</span>
          <h3>${this.escape(title)}</h3>
          <p>سجل اختبارات الطلاب والنتائج التراكمية.</p>
        </div>
        <div>
          <button class="secondary-button" id="refresh-module" type="button">
            تحديث
          </button>
          ${
            canWrite
              ? `
                <button class="primary-button" id="new-smart-test" type="button">
                  اختبار ذكي
                </button>
                <button class="secondary-button" id="new-test" type="button">
                  إضافة اختبار يدوي
                </button>
              `
              : ""
          }
        </div>
      </div>

      <div id="test-form-container"></div>

      <div id="tests-module-state">
        <div class="empty-state">
          <div class="empty-icon">…</div>
          <h3>جاري تحميل الاختبارات</h3>
          <p>يرجى الانتظار.</p>
        </div>
      </div>
    `;

    const state = content.querySelector("#tests-module-state");
    const formContainer = content.querySelector("#test-form-container");

    content.querySelector("#new-smart-test")?.addEventListener("click", () => {
      formContainer.innerHTML = `
        <div class="card">
          <form id="smart-test-form">
            <h3>إنشاء اختبار ذكي</h3>
            <p>
              سيتم اختيار الأسئلة تلقائيًا وفق مادة الاختبار وتقدم الطالب.
            </p>

            <div class="form-grid">
              <label>
                رقم الطالب
                <input name="student_id" type="number" min="1" required>
              </label>

              <label>
                المادة
                <select name="subject_type" required>
                  <option value="quran">القرآن الكريم</option>
                  <option value="tajweed">التجويد</option>
                  <option value="tafsir">التفسير</option>
                  <option value="fiqh">الفقه</option>
                  <option value="hadith">الحديث</option>
                  <option value="sirah">السيرة</option>
                  <option value="noorani_qaida">القاعدة النورانية</option>
                </select>
              </label>

              <label>
                نوع الاختبار
                <select name="test_type" required>
                  <option value="daily_quick">اختبار يومي سريع</option>
                  <option value="weekly">اختبار أسبوعي</option>
                  <option value="new_memorization">حفظ جديد</option>
                  <option value="near_revision">مراجعة قريبة</option>
                  <option value="old_review">مراجعة قديمة</option>
                  <option value="consolidation">تثبيت</option>
                  <option value="surah">اختبار سورة</option>
                  <option value="juz">اختبار جزء</option>
                  <option value="khatma">اختبار ختمة</option>
                  <option value="tajweed">اختبار تجويد</option>
                  <option value="noorani_qaida">اختبار القاعدة النورانية</option>
                  <option value="tafsir">اختبار تفسير</option>
                  <option value="fiqh">اختبار فقه</option>
                  <option value="hadith">اختبار حديث</option>
                  <option value="sirah">اختبار سيرة</option>
                </select>
              </label>

              <label>
                عدد الأسئلة
                <input
                  name="question_count"
                  type="number"
                  min="1"
                  max="50"
                  value="10"
                  required
                >
              </label>

              <label>
                عنوان الاختبار
                <input
                  name="title"
                  type="text"
                  placeholder="اختبار ذكي"
                >
              </label>
            </div>

            <div>
              <button class="primary-button" type="submit">
                إنشاء الاختبار
              </button>
              <button class="secondary-button" id="cancel-smart-test" type="button">
                إلغاء
              </button>
            </div>

            <div id="smart-test-form-message"></div>
          </form>
        </div>
      `;

      formContainer.querySelector("#cancel-smart-test")?.addEventListener(
        "click",
        () => {
          formContainer.innerHTML = "";
        }
      );

      formContainer.querySelector("#smart-test-form")?.addEventListener(
        "submit",
        async event => {
          event.preventDefault();

          const form = event.currentTarget;
          const message = form.querySelector("#smart-test-form-message");
          const data = Object.fromEntries(new FormData(form).entries());

          const studentId = Number(data.student_id);
          const questionCount = Number(data.question_count);

          if (
            !Number.isInteger(studentId) ||
            studentId < 1 ||
            !Number.isInteger(questionCount) ||
            questionCount < 1 ||
            questionCount > 50
          ) {
            message.innerHTML =
              `<div class="status-pill">تحقق من رقم الطالب وعدد الأسئلة.</div>`;
            return;
          }

          message.innerHTML =
            `<div class="status-pill">جاري إنشاء الاختبار...</div>`;

          try {
            const response = await fetch("/api/test-engine", {
              method: "POST",
              credentials: "include",
              headers: {
                "Content-Type": "application/json",
                "Accept": "application/json"
              },
              body: JSON.stringify({
                student_id: studentId,
                subject_type: data.subject_type,
                test_type: data.test_type,
                question_count: questionCount,
                title: data.title || null,
                source: "smart"
              })
            });

            const payload = await response.json().catch(() => ({}));

            if (!response.ok) {
              throw new Error(
                payload?.error ||
                payload?.message ||
                `HTTP ${response.status}`
              );
            }

            const attempt = payload?.data || {};
            const attemptId = Number(
              attempt.id ?? attempt.attempt_id
            );

            if (!Number.isInteger(attemptId) || attemptId < 1) {
              throw new Error(
                "تم إنشاء الاختبار ولكن لم يتم استلام رقم المحاولة."
              );
            }

            message.innerHTML =
              `<div class="status-pill">جاري تحميل أسئلة الاختبار...</div>`;

            const detailResponse = await fetch(
              `/api/test-engine?student_id=${encodeURIComponent(studentId)}&attempt_id=${encodeURIComponent(attemptId)}`,
              {
                method: "GET",
                credentials: "include",
                headers: {
                  "Accept": "application/json"
                }
              }
            );

            const detailPayload =
              await detailResponse.json().catch(() => ({}));

            if (!detailResponse.ok) {
              throw new Error(
                detailPayload?.error ||
                detailPayload?.message ||
                `HTTP ${detailResponse.status}`
              );
            }

            const detail = detailPayload?.data || {};
            const questions = Array.isArray(detail.questions)
              ? detail.questions
              : [];

            if (!questions.length) {
              throw new Error(
                "تم إنشاء الاختبار ولكن لا توجد أسئلة متاحة."
              );
            }

            renderSmartAttempt(
              formContainer,
              detail.attempt || attempt,
              questions
            );

            form.reset();
            form.querySelector('[name="question_count"]').value = "10";
          } catch (error) {
            message.innerHTML =
              `<div class="status-pill">${this.escape(
                error?.message || "تعذر إنشاء الاختبار الذكي."
              )}</div>`;
          }
        }
      );
    });

    content.querySelector("#new-test")?.addEventListener("click", () => {
      formContainer.innerHTML = `
        <div class="card">
          <form id="test-form">
            <h3>إضافة اختبار</h3>
            <div class="form-grid">
              <label>
                الطالب
                <input name="student_id" type="number" min="1" required>
              </label>
              <label>
                عنوان الاختبار
                <input name="title" type="text" required>
              </label>
              <label>
                نوع الاختبار
                <select name="test_type">
                  <option value="quran">القرآن الكريم</option>
                  <option value="tajweed">التجويد</option>
                  <option value="tafsir">التفسير</option>
                  <option value="fiqh">الفقه</option>
                  <option value="hadith">الحديث</option>
                  <option value="sirah">السيرة</option>
                  <option value="noorani_qaida">القاعدة النورانية</option>
                </select>
              </label>
              <label>
                الدرجة
                <input name="score" type="number" min="0" step="0.01" required>
              </label>
              <label>
                الدرجة النهائية
                <input name="max_score" type="number" min="0.01" step="0.01" value="100" required>
              </label>
              <label>
                النتيجة
                <input name="result" type="text">
              </label>
              <label>
                ملاحظات
                <textarea name="notes"></textarea>
              </label>
            </div>
            <div>
              <button class="primary-button" type="submit">حفظ الاختبار</button>
              <button class="secondary-button" id="cancel-test" type="button">إلغاء</button>
            </div>
            <div id="test-form-message"></div>
          </form>
        </div>
      `;

      formContainer.querySelector("#cancel-test")?.addEventListener("click", () => {
        formContainer.innerHTML = "";
      });

      formContainer.querySelector("#test-form")?.addEventListener("submit", async event => {
        event.preventDefault();

        const form = event.currentTarget;
        const message = form.querySelector("#test-form-message");
        const data = Object.fromEntries(new FormData(form).entries());

        const score = Number(data.score);
        const maxScore = Number(data.max_score);

        if (!Number.isFinite(score) || !Number.isFinite(maxScore) ||
            maxScore <= 0 || score < 0 || score > maxScore) {
          message.innerHTML = `<div class="status-pill">تحقق من الدرجة والدرجة النهائية.</div>`;
          return;
        }

        try {
          const response = await fetch("/api/tests", {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
              "Accept": "application/json"
            },
            body: JSON.stringify({
              student_id: Number(data.student_id),
              title: data.title,
              test_type: data.test_type,
              score,
              max_score: maxScore,
              result: data.result || null,
              notes: data.notes || null
            })
          });

          const payload = await response.json().catch(() => ({}));

          if (!response.ok) {
            throw new Error(payload?.error || payload?.message || `HTTP ${response.status}`);
          }

          message.innerHTML = `<div class="status-pill">تم حفظ الاختبار بنجاح.</div>`;
          form.reset();
          await this.renderModule("tests");
        } catch (error) {
          message.innerHTML = `<div class="status-pill">${this.escape(error?.message || "تعذر حفظ الاختبار.")}</div>`;
        }
      });
    });

    try {
      const result = await this.apiGet("/api/tests?limit=200");
      const rows = Array.isArray(result?.data)
        ? result.data
        : Array.isArray(result?.tests)
          ? result.tests
          : [];

      const total = rows.length;

      const percentages = rows
        .map(row => Number(row.percentage))
        .filter(value => Number.isFinite(value));

      const average = percentages.length
        ? percentages.reduce((sum, value) => sum + value, 0) / percentages.length
        : 0;

      const passed = rows.filter(row => {
        const value = Number(row.percentage);
        return Number.isFinite(value) && value >= 50;
      }).length;

      state.innerHTML = `
        <div class="report-cards">
          <article class="report-card">
            <div class="report-card-icon">✓</div>
            <div class="report-card-body">
              <span class="report-card-label">إجمالي الاختبارات</span>
              <strong class="report-card-value">${total}</strong>
            </div>
          </article>

          <article class="report-card">
            <div class="report-card-icon">%</div>
            <div class="report-card-body">
              <span class="report-card-label">متوسط النتيجة</span>
              <strong class="report-card-value">
                ${this.escape(average.toFixed(1))}%
              </strong>
            </div>
          </article>

          <article class="report-card">
            <div class="report-card-icon">★</div>
            <div class="report-card-body">
              <span class="report-card-label">اختبارات ناجحة</span>
              <strong class="report-card-value">${passed}</strong>
            </div>
          </article>
        </div>

        ${
          rows.length
            ? `
              <div class="table-wrap">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>الطالب</th>
                      <th>المعلم</th>
                      <th>الاختبار</th>
                      <th>النوع</th>
                      <th>الدرجة</th>
                      <th>النسبة</th>
                      <th>النتيجة</th>
                      <th>التاريخ</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${rows.map(row => `
                      <tr>
                        <td>${this.escape(row.student_name || "—")}</td>
                        <td>${this.escape(row.teacher_name || "—")}</td>
                        <td>${this.escape(row.title || "—")}</td>
                        <td>${this.escape(row.test_type || "—")}</td>
                        <td>
                          ${this.escape(row.score ?? "—")}
                          /
                          ${this.escape(row.max_score ?? "—")}
                        </td>
                        <td>
                          <span class="status-pill">
                            ${this.escape(
                              Number.isFinite(Number(row.percentage))
                                ? `${Number(row.percentage).toFixed(1)}%`
                                : "—"
                            )}
                          </span>
                        </td>
                        <td>${this.escape(row.result || "—")}</td>
                        <td>${this.escape(row.tested_at || "—")}</td>
                      </tr>
                    `).join("")}
                  </tbody>
                </table>
              </div>
            `
            : `
              <div class="empty-state">
                <div class="empty-icon">✦</div>
                <h3>لا توجد اختبارات</h3>
                <p>
                  لا توجد نتائج اختبارات متاحة لهذا الحساب حاليًا.
                </p>
                ${
                  canWrite
                    ? `<p>يمكن لاحقًا إضافة نموذج تسجيل الاختبارات من هذه الصفحة.</p>`
                    : ""
                }
              </div>
            `
        }
      `;
    } catch (error) {
      state.innerHTML = `
        <div class="empty-state premium-empty">
          <div class="empty-icon">!</div>
          <h3>تعذر تحميل الاختبارات</h3>
          <p>${this.escape(error?.message || "حدث خطأ غير متوقع.")}</p>
          <button class="secondary-button" id="retry-tests" type="button">
            إعادة المحاولة
          </button>
        </div>
      `;

      content.querySelector("#retry-tests")?.addEventListener(
        "click",
        () => this.renderModule("tests")
      );
    }

    content.querySelector("#refresh-module")?.addEventListener(
      "click",
      () => this.renderModule("tests")
    );
  }

  async renderQuestionBankModule(title) {
    const content = this.root.querySelector("#module-live-content");
    if (!content) return;

    content.innerHTML = `
      <div class="section-heading">
        <div>
          <span class="eyebrow">المواد التعليمية</span>
          <h3>${this.escape(title)}</h3>
          <p>بنك موحد لأسئلة القرآن والتجويد والتفسير والفقه والحديث والسيرة والقاعدة النورانية.</p>
        </div>
        <button class="secondary-button" id="refresh-module" type="button">
          تحديث
        </button>
      </div>

      <div class="empty-state">
        <div class="empty-icon">…</div>
        <h3>جاري تحميل بنك الأسئلة</h3>
        <p>يرجى الانتظار.</p>
      </div>
    `;

    try {
      const result = await this.apiGet(
        "/api/question-bank?is_active=1&limit=200"
      );

      const rows = Array.isArray(result?.data)
        ? result.data
        : Array.isArray(result?.questions)
          ? result.questions
          : [];

      const subjectLabels = {
        quran: "القرآن الكريم",
        tajweed: "التجويد",
        tafsir: "التفسير",
        fiqh: "الفقه",
        hadith: "الحديث",
        sirah: "السيرة",
        noorani_qaida: "القاعدة النورانية",
        other: "مواد أخرى"
      };

      const typeLabels = {
        multiple_choice: "اختيار من متعدد",
        true_false: "صح أو خطأ",
        short_answer: "إجابة قصيرة",
        essay: "مقالي",
        oral: "شفهي",
        memorization: "حفظ"
      };

      const difficultyLabels = {
        easy: "سهل",
        medium: "متوسط",
        hard: "صعب"
      };

      const visibleRows = rows.map(row => ({
        id: row.id,
        subject:
          subjectLabels[row.subject_type] ||
          row.subject_type ||
          "—",
        type:
          typeLabels[row.question_type] ||
          row.question_type ||
          "—",
        difficulty:
          difficultyLabels[row.difficulty] ||
          row.difficulty ||
          "—",
        text: row.question_text || "—",
        creator: row.creator_name || "—",
        surah: row.surah_number || null,
        ayahStart: row.ayah_start || null,
        ayahEnd: row.ayah_end || null
      }));

      content.innerHTML = `
        <div class="section-heading">
          <div>
            <span class="eyebrow">المواد التعليمية</span>
            <h3>${this.escape(title)}</h3>
            <p>الأسئلة النشطة: <strong>${visibleRows.length}</strong></p>
          </div>
          <button class="secondary-button" id="refresh-module" type="button">
            تحديث
          </button>
        </div>

        ${
          visibleRows.length
            ? `
              <div class="table-wrap">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>المادة</th>
                      <th>نوع السؤال</th>
                      <th>الصعوبة</th>
                      <th>السؤال</th>
                      <th>الموضع القرآني</th>
                      <th>المنشئ</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${visibleRows.map(row => {
                      const quranLocation =
                        row.surah
                          ? `سورة ${row.surah}` +
                            (
                              row.ayahStart
                                ? ` — ${row.ayahStart}${
                                    row.ayahEnd &&
                                    row.ayahEnd !== row.ayahStart
                                      ? `–${row.ayahEnd}`
                                      : ""
                                  }`
                                : ""
                            )
                          : "—";

                      return `
                        <tr>
                          <td>${this.escape(row.id)}</td>
                          <td>${this.escape(row.subject)}</td>
                          <td>${this.escape(row.type)}</td>
                          <td>${this.escape(row.difficulty)}</td>
                          <td>${this.escape(row.text)}</td>
                          <td>${this.escape(quranLocation)}</td>
                          <td>${this.escape(row.creator)}</td>
                        </tr>
                      `;
                    }).join("")}
                  </tbody>
                </table>
              </div>
            `
            : `
              <div class="empty-state">
                <div class="empty-icon">✦</div>
                <h3>بنك الأسئلة فارغ حاليًا</h3>
                <p>لم تتم إضافة أسئلة نشطة بعد.</p>
              </div>
            `
        }
      `;
    } catch (error) {
      content.innerHTML = `
        <div class="empty-state premium-empty">
          <div class="empty-icon">!</div>
          <h3>تعذر تحميل بنك الأسئلة</h3>
          <p>${this.escape(error?.message || "حدث خطأ غير متوقع.")}</p>
          <button class="secondary-button" id="retry-question-bank" type="button">
            إعادة المحاولة
          </button>
        </div>
      `;

      content.querySelector("#retry-question-bank")?.addEventListener(
        "click",
        () => this.renderModule("question-bank")
      );
    }

    content.querySelector("#refresh-module")?.addEventListener(
      "click",
      () => this.renderModule("question-bank")
    );
  }

  async renderSettingsModule(title) {
    const content = this.root.querySelector("#module-live-content");
    if (!content) return;

    if (this.user?.role !== "admin") {
      content.innerHTML = `
        <div class="empty-state premium-empty">
          <div class="empty-icon">!</div>
          <h3>الإعدادات الإدارية</h3>
          <p>هذا القسم متاح لمدير الأكاديمية فقط.</p>
        </div>
      `;
      return;
    }

    const result = await this.apiGet("/api/settings");
    const rows = result?.data || [];

    content.innerHTML = `
      <div class="section-heading">
        <div>
          <span class="eyebrow">إدارة الأكاديمية</span>
          <h3>${this.escape(title)}</h3>
          <p>الإعدادات الحالية: <strong>${rows.length}</strong></p>
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
                    <th>المفتاح</th>
                    <th>القيمة</th>
                    <th>النوع</th>
                    <th>النطاق</th>
                    <th>قابل للتعديل</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows.map(row => `
                    <tr>
                      <td>${this.escape(row.setting_key || "—")}</td>
                      <td>${this.escape(row.setting_value ?? "—")}</td>
                      <td>${this.escape(row.value_type || "—")}</td>
                      <td>${this.escape(row.scope_type || "—")}</td>
                      <td>${Number(row.is_editable) === 1 ? "نعم" : "لا"}</td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            `
            : `
              <div class="empty-state">
                <div class="empty-icon">✦</div>
                <h3>لا توجد إعدادات</h3>
                <p>لم يتم العثور على إعدادات قابلة للعرض.</p>
              </div>
            `
        }
      </div>
    `;

    content.querySelector("#refresh-module")?.addEventListener(
      "click",
      () => this.renderModule("settings")
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
