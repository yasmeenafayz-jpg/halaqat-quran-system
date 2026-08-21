import { get, post, put, remove } from "./lib/api.js";

const NAVIGATION = [
  { id: "dashboard", title: "الرئيسية", subtitle: "لوحة المؤشرات" },
  { id: "students", title: "الطلاب", subtitle: "ملفات الطلاب وولي الأمر" },
  { id: "teachers", title: "المعلمات", subtitle: "الملف المهني والجدول" },
  { id: "circles", title: "الحلقات", subtitle: "فردية وجماعية والسعة" },
  { id: "quran", title: "المصحف والورد", subtitle: "الحفظ والمراجعة والتمكين" },
  { id: "attendance", title: "الحضور", subtitle: "الحضور والغياب والتنبيهات" },
  { id: "calendar", title: "التقويم", subtitle: "اليومي والأسبوعي والشهري والسنوي" },
  { id: "subscriptions", title: "الباقات والاشتراكات", subtitle: "الأسعار والسعات والاشتراكات" },
  { id: "finance", title: "المالية", subtitle: "المدفوعات والمتأخرات" },
  { id: "tests", title: "الاختبارات", subtitle: "التقييم والنتيجة التراكمية" },
  { id: "communications", title: "التواصل", subtitle: "WhatsApp وFacebook وTelegram" },
  { id: "reports", title: "التقارير", subtitle: "التقارير التعليمية والمالية" },
  { id: "settings", title: "الإعدادات", subtitle: "الصلاحيات والتكاملات والنسخ الاحتياطي" }
];

const FEATURES = {
  teachers: [
    ["الملف المهني", "التخصص والخبرة والمؤهلات والمواد التي تدرسها المعلمة."],
    ["جدول المعلمة", "عرض يومي وأسبوعي وشهري وسنوي."],
    ["الحلقات", "الحلقات المسندة للمعلمة والطلاب."],
    ["البدائل", "إسناد معلمة بديلة عند الغياب."],
    ["التقييم", "متابعة أداء المعلمة والحضور والجلسات."],
    ["الرواتب", "حساب مستحقات المعلمة حسب قواعد الأكاديمية."]
  ],

  circles: [
    ["الحلقات الفردية", "ربط الحلقة الفردية بباقات الفردي."],
    ["الحلقات الجماعية", "ربط الحلقة الجماعية بباقات الجماعي."],
    ["السعة", "منع تسجيل طلاب جدد عند اكتمال العدد."],
    ["قائمة الانتظار", "إضافة الطالب لقائمة الانتظار بدل رفضه."],
    ["الاجتماع التعريفي", "موعد تعريفي قبل القبول في الحلقة."],
    ["المسارات والمستويات", "مسار القاعدة ونور البيان ثم مستويات الحفظ."]
  ],

  quran: [
    ["الحفظ الجديد", "تسجيل السورة والآيات من وإلى."],
    ["المراجعة", "تسجيل مقدار المراجعة ونتيجتها."],
    ["الحفظ والمراجعة", "تسجيل الاثنين داخل جلسة واحدة."],
    ["التمكين", "متابعة تثبيت المحفوظ."],
    ["السرد التراكمي", "متابعة السرد من بداية المسار."],
    ["مقدار الورد", "ربع وجه، نصف وجه، وجه، ربعين أو مقدار مخصص."],
    ["دقة الآيات", "حساب المتابعة على مستوى السورة والآية."],
    ["التسجيل الصوتي", "ربط التسجيل بالطالب والورد وترتيبه."]
  ],

  attendance: [
    ["الحضور", "حاضر، غائب، متأخر، وملاحظات."],
    ["التأخر", "تسجيل مدة التأخر بالدقائق."],
    ["الغياب المتكرر", "حساب الغياب الشهري تلقائيًا."],
    ["التنبيه", "تنبيه الطالب أو ولي الأمر عند الحاجة."],
    ["سياسة الحذف", "تطبيق قاعدة الغياب الخاصة بالحلقة الجماعية."]
  ],

  calendar: [
    ["تقويم المعلمة", "يومي، أسبوعي، شهري، سنوي."],
    ["الجلسات", "جلسات الحلقة والمواعيد المرتبطة بها."],
    ["إعادة الجدولة", "تعديل الموعد مع تسجيل التغيير."],
    ["الإلغاء", "إلغاء الجلسة مع توثيق السبب."],
    ["Zoom", "تخزين رابط اجتماع Zoom."],
    ["Microsoft Teams", "تخزين رابط اجتماع Teams."]
  ],

  subscriptions: [
    ["الباقات الفردية", "السعر وعدد الجلسات والقواعد."],
    ["الباقات الجماعية", "السعر والسعة وعدد الجلسات."],
    ["قواعد التسجيل", "الشروط الخاصة بكل باقة."],
    ["التجربة", "تفعيل تجربة مجانية لمدة 3 أيام."],
    ["التجديد", "متابعة بداية ونهاية الاشتراك."],
    ["الحالة", "نشط، منتهي، موقوف أو ملغى."]
  ],

  finance: [
    ["المدفوعات", "تسجيل كل عملية دفع وتاريخها."],
    ["التحويل البنكي", "حفظ رقم المرجع وبيانات العملية."],
    ["الدفع بالهاتف", "ربط العملية برقم الهاتف المستخدم."],
    ["الدفع خارج مصر", "دعم طرق الدفع الخارجية حسب المزود."],
    ["الإعفاء", "إعفاء الدفع يظهر للإدارة فقط."],
    ["المتأخرات", "متابعة الأرصدة والمدفوعات المتأخرة."],
    ["المصروفات", "تسجيل مصروفات الأكاديمية."],
    ["الرواتب", "إدارة مستحقات المعلمات."]
  ],

  tests: [
    ["الاختبارات", "إنشاء الاختبار وتسجيل الدرجة."],
    ["التقييم", "تسجيل مستوى الطالب وملاحظات المعلمة."],
    ["النتيجة التراكمية", "تجميع النتائج عبر مراحل الطالب."],
    ["الشهادات", "تجهيز بيانات الشهادة عند استحقاقها."]
  ],

  communications: [
    ["WhatsApp", "رسائل وتنبيهات وقوالب وحالات التسليم."],
    ["Facebook", "ربط صفحة الأكاديمية عبر Meta."],
    ["Telegram Bot", "إشعارات ومراسلات آلية."],
    ["Telegram Mini App", "بوابة الطالب وولي الأمر داخل Telegram."],
    ["القوالب", "قوالب جاهزة قابلة للتعديل."],
    ["الجدولة", "إرسال الرسائل في أوقات محددة."],
    ["Webhooks", "استقبال تحديثات مزودي الاتصال."],
    ["سجل الرسائل", "متابعة حالة الإرسال والأخطاء."]
  ],

  reports: [
    ["تقرير الطالب", "الحفظ والمراجعة والحضور والاختبارات."],
    ["تقرير المعلمة", "الجلسات والحضور والأداء."],
    ["تقرير الحلقة", "عدد الطلاب والسعة والحضور."],
    ["التقرير المالي", "الإيرادات والمتأخرات والمصروفات."],
    ["التقرير الإداري", "مؤشرات الأكاديمية العامة."]
  ],

  settings: [
    ["الصلاحيات", "إدارة، مشرفة، معلمة، طالب، ولي أمر."],
    ["سجل العمليات", "تسجيل العمليات الحساسة داخل النظام."],
    ["النسخ الاحتياطي", "إدارة عمليات النسخ الاحتياطي."],
    ["الاستيراد والتصدير", "استيراد وتصدير البيانات."],
    ["التكاملات", "WhatsApp وMeta وTelegram وZoom وTeams."],
    ["إعدادات الأكاديمية", "الباقات والقواعد والسعات والتنبيهات."]
  ]
};

function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    char =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      })[char]
  );
}

function getStudentName(student) {
  return student?.full_name || student?.name || "بدون اسم";
}

function getStudentsFromResponse(response) {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response?.data)) return response.data;
  if (Array.isArray(response?.students)) return response.students;
  return [];
}

export class App {
  constructor(root) {
    this.root = root;
    this.currentPage = "dashboard";
    this.students = [];
  }

  mount() {
    this.renderShell();
  }

  navigate(page) {
    if (NAVIGATION.some(item => item.id === page)) {
      this.currentPage = page;
    }

    this.renderShell();
  }

  renderShell() {
    const current =
      NAVIGATION.find(item => item.id === this.currentPage) ||
      NAVIGATION[0];

    this.root.innerHTML = `
      <div class="app-shell">

        <aside class="sidebar" id="sidebar">

          <div class="brand">
            <div class="brand-title">الأوَّابين</div>
            <div class="brand-subtitle">
              أكاديمية القرآن الكريم
            </div>
          </div>

          <nav class="main-navigation">
            ${NAVIGATION.map(item => `
              <button
                type="button"
                class="nav-item ${
                  item.id === this.currentPage ? "active" : ""
                }"
                data-page="${item.id}"
              >
                <span>${escapeHtml(item.title)}</span>
                <small>${escapeHtml(item.subtitle)}</small>
              </button>
            `).join("")}
          </nav>

        </aside>

        <main class="main-content">

          <header class="topbar">

            <button
              type="button"
              id="mobileMenu"
              class="mobile-menu"
              aria-label="فتح القائمة"
            >
              ☰
            </button>

            <div class="page-heading">
              <h1>${escapeHtml(current.title)}</h1>
              <small>${escapeHtml(current.subtitle)}</small>
            </div>

            <div class="topbar-user">
              <span>الإدارة</span>
            </div>

          </header>

          <section id="pageContent" class="page-content"></section>

        </main>

      </div>
    `;

    this.bindNavigation();
    this.renderPage();
  }

  bindNavigation() {
    this.root.querySelectorAll("[data-page]").forEach(button => {
      button.addEventListener("click", () => {
        this.navigate(button.dataset.page);
      });
    });

    const mobileMenu = this.root.querySelector("#mobileMenu");
    const sidebar = this.root.querySelector("#sidebar");

    mobileMenu?.addEventListener("click", () => {
      sidebar?.classList.toggle("open");
    });
  }

  async renderPage() {
    const container = this.root.querySelector("#pageContent");

    if (!container) return;

    if (this.currentPage === "dashboard") {
      await this.renderDashboard(container);
      return;
    }

    if (this.currentPage === "students") {
      await this.renderStudents(container);
      return;
    }

    this.renderModule(container);
  }

  async renderDashboard(container) {
    container.innerHTML = `
      <section class="dashboard-hero">

        <div>
          <span class="eyebrow">
            نظام إدارة الأكاديمية
          </span>

          <h2>
            مرحبًا بك في الأوَّابين
          </h2>

          <p id="connectionStatus">
            جاري التحقق من الاتصال...
          </p>
        </div>

        <div class="hero-actions">

          <button type="button" data-page="students">
            إضافة طالب
          </button>

          <button type="button" data-page="calendar">
            جدولة جلسة
          </button>

          <button type="button" data-page="quran">
            تسجيل ورد
          </button>

        </div>

      </section>

      <section class="statistics-grid">

        ${[
          "الطلاب النشطون",
          "المعلمات",
          "الحلقات المفتوحة",
          "جلسات اليوم"
        ].map((title, index) => `
          <article class="stat-card">
            <span>${title}</span>
            <strong id="stat-${index}">—</strong>
          </article>
        `).join("")}

      </section>

      <section class="content-card">

        <div class="section-heading">
          <div>
            <h3>مركز التنبيهات</h3>
            <p>
              أهم الأحداث التي تحتاج إلى متابعة.
            </p>
          </div>
        </div>

        <div class="empty-state">
          لا توجد تنبيهات حرجة حاليًا.
        </div>

      </section>
    `;

    container.querySelectorAll("[data-page]").forEach(button => {
      button.addEventListener("click", () => {
        this.navigate(button.dataset.page);
      });
    });

    try {
      const response = await get("/dashboard");

      const counts =
        response?.counts ||
        response?.data?.counts ||
        {};

      const values = [
        counts.students ?? 0,
        counts.teachers ?? 0,
        counts.circles ?? 0,
        counts.today ?? 0
      ];

      values.forEach((value, index) => {
        const element = container.querySelector(`#stat-${index}`);

        if (element) {
          element.textContent = value;
        }
      });

      const status =
        container.querySelector("#connectionStatus");

      if (status) {
        status.textContent =
          "النظام متصل بقاعدة البيانات.";
      }
    } catch (error) {
      console.error("DASHBOARD_LOAD_FAILED", error);

      const status =
        container.querySelector("#connectionStatus");

      if (status) {
        status.textContent =
          "تعذر الاتصال بقاعدة البيانات حاليًا.";
      }
    }
  }

  async renderStudents(container) {
    container.innerHTML = `
      <section class="content-card">

        <div class="section-heading">

          <div>
            <span class="eyebrow">الطلاب</span>

            <h2>
              إدارة ملفات الطلاب
            </h2>

            <p>
              الطلاب المسجلون حاليًا في النظام.
            </p>
          </div>

          <button
            type="button"
            class="primary-button"
            id="addStudentButton"
          >
            + إضافة طالب
          </button>

        </div>

        <div class="toolbar">

          <input
            id="studentSearch"
            type="search"
            placeholder="بحث بالاسم أو الهاتف أو كود الطالب"
            autocomplete="off"
          />

        </div>

        <div
          id="studentMessage"
          class="student-message"
          aria-live="polite"
        ></div>

        <div id="studentsList" class="feature-grid">
          <div class="empty-state">
            جاري تحميل الطلاب...
          </div>
        </div>

      </section>
    `;

    container
      .querySelector("#addStudentButton")
      ?.addEventListener("click", () => {
        this.renderStudentForm(container);
      });

    container
      .querySelector("#studentSearch")
      ?.addEventListener("input", event => {
        this.filterStudents(container, event.target.value);
      });

    try {
      const response = await get("/students");

      this.students = getStudentsFromResponse(response);

      this.renderStudentList(container, this.students);
    } catch (error) {
      console.error("STUDENTS_LOAD_FAILED", error);

      const list =
        container.querySelector("#studentsList");

      if (list) {
        list.innerHTML = `
          <div class="empty-state">
            تعذر تحميل الطلاب حاليًا.
            <br>
            ${escapeHtml(
              error?.message || "REQUEST_FAILED"
            )}
          </div>
        `;
      }
    }
  }

  filterStudents(container, searchTerm) {
    const term = String(searchTerm || "")
      .trim()
      .toLowerCase();

    if (!term) {
      this.renderStudentList(container, this.students);
      return;
    }

    const filtered = this.students.filter(student => {
      const searchable = [
        student?.full_name,
        student?.student_code,
        student?.phone,
        student?.guardian_name,
        student?.guardian_phone,
        student?.email
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return searchable.includes(term);
    });

    this.renderStudentList(container, filtered);
  }

  renderStudentList(container, students) {
    const list =
      container.querySelector("#studentsList");

    if (!list) return;

    if (!students.length) {
      list.innerHTML = `
        <div class="empty-state">
          لا يوجد طلاب مطابقون للبحث.
        </div>
      `;
      return;
    }

    list.innerHTML = students.map(student => `
      <article class="feature-card">

        <div class="feature-icon">
          👤
        </div>

        <h3>
          ${escapeHtml(getStudentName(student))}
        </h3>

        <p>
          كود الطالب:
          ${escapeHtml(student?.student_code || "—")}
        </p>

        <p>
          الهاتف:
          ${escapeHtml(student?.phone || "—")}
        </p>

        <p>
          الحالة:
          ${escapeHtml(student?.status || "—")}
        </p>

        <button
          type="button"
          class="secondary-button"
          data-student-id="${escapeHtml(student?.id || "")}"
        >
          فتح الملف
        </button>

      </article>
    `).join("");

    list.querySelectorAll("[data-student-id]").forEach(button => {
      button.addEventListener("click", () => {
        this.showStudentDetails(
          container,
          button.dataset.studentId
        );
      });
    });
  }

  renderStudentForm(container) {
    const list =
      container.querySelector("#studentsList");

    if (!list) return;

    list.innerHTML = `
      <article class="feature-card">

        <h3>
          إضافة طالب جديد
        </h3>

        <form id="studentForm" class="student-form">

          <label>
            الاسم الكامل
            <input
              name="full_name"
              required
              autocomplete="name"
            />
          </label>

          <label>
            رقم الهاتف
            <input
              name="phone"
              inputmode="tel"
              autocomplete="tel"
            />
          </label>

          <label>
            البريد الإلكتروني
            <input
              name="email"
              type="email"
              autocomplete="email"
            />
          </label>

          <label>
            اسم ولي الأمر
            <input name="guardian_name" />
          </label>

          <label>
            هاتف ولي الأمر
            <input
              name="guardian_phone"
              inputmode="tel"
            />
          </label>

          <label>
            الدولة
            <input
              name="country"
              value="Egypt"
            />
          </label>

          <label>
            المستوى التعليمي
            <input name="educational_level" />
          </label>

          <label>
            ملاحظات
            <textarea
              name="notes"
              rows="3"
            ></textarea>
          </label>

          <div class="form-actions">

            <button
              type="submit"
              class="primary-button"
            >
              حفظ الطالب
            </button>

            <button
              type="button"
              id="cancelStudent"
              class="secondary-button"
            >
              إلغاء
            </button>

          </div>

        </form>

      </article>
    `;

    list
      .querySelector("#cancelStudent")
      ?.addEventListener("click", () => {
        this.renderStudents(container);
      });

    list
      .querySelector("#studentForm")
      ?.addEventListener("submit", async event => {
        event.preventDefault();

        const form = event.currentTarget;
        const submitButton =
          form.querySelector("[type='submit']");

        const formData = new FormData(form);
        const payload = Object.fromEntries(
          formData.entries()
        );

        payload.full_name =
          String(payload.full_name || "").trim();

        if (!payload.full_name) {
          return;
        }

        if (submitButton) {
          submitButton.disabled = true;
          submitButton.textContent = "جاري الحفظ...";
        }

        try {
          await post("/students", payload);

          await this.renderStudents(container);
        } catch (error) {
          console.error(
            "STUDENT_CREATE_FAILED",
            error
          );

          const message =
            container.querySelector(
              "#studentMessage"
            );

          if (message) {
            message.textContent =
              `تعذر حفظ الطالب: ${
                error?.message || "REQUEST_FAILED"
              }`;
          }

          if (submitButton) {
            submitButton.disabled = false;
            submitButton.textContent = "حفظ الطالب";
          }
        }
      });
  }

  showStudentDetails(container, studentId) {
    const student = this.students.find(
      item =>
        String(item?.id) === String(studentId)
    );

    if (!student) return;

    const list =
      container.querySelector("#studentsList");

    if (!list) return;

    list.innerHTML = `
      <article class="feature-card">

        <span class="eyebrow">
          ملف الطالب
        </span>

        <h3>
          ${escapeHtml(getStudentName(student))}
        </h3>

        <p>
          كود الطالب:
          ${escapeHtml(student?.student_code || "—")}
        </p>

        <p>
          الهاتف:
          ${escapeHtml(student?.phone || "—")}
        </p>

        <p>
          البريد:
          ${escapeHtml(student?.email || "—")}
        </p>

        <p>
          ولي الأمر:
          ${escapeHtml(student?.guardian_name || "—")}
        </p>

        <p>
          هاتف ولي الأمر:
          ${escapeHtml(student?.guardian_phone || "—")}
        </p>

        <p>
          الدولة:
          ${escapeHtml(student?.country || "—")}
        </p>

        <p>
          المستوى:
          ${escapeHtml(
            student?.educational_level || "—"
          )}
        </p>

        <p>
          الحالة:
          ${escapeHtml(student?.status || "—")}
        </p>

        <p>
          الملاحظات:
          ${escapeHtml(student?.notes || "—")}
        </p>

        <button
          type="button"
          class="secondary-button"
          id="backStudents"
        >
          العودة لقائمة الطلاب
        </button>

      </article>
    `;

    list
      .querySelector("#backStudents")
      ?.addEventListener("click", () => {
        this.renderStudents(container);
      });
  }

  renderModule(container) {
    const page =
      NAVIGATION.find(
        item => item.id === this.currentPage
      ) || NAVIGATION[0];

    const features =
      FEATURES[this.currentPage] || [];

    container.innerHTML = `
      <section class="content-card">

        <div class="section-heading">

          <div>
            <span class="eyebrow">
              ${escapeHtml(page.title)}
            </span>

            <h2>
              ${escapeHtml(page.subtitle)}
            </h2>

            <p>
              إدارة ${escapeHtml(page.title)}
              داخل نظام الأوَّابين.
            </p>
          </div>

          <button
            type="button"
            class="primary-button"
          >
            + إضافة
          </button>

        </div>

        <div class="feature-grid">

          ${features.map(
            ([title, description]) => `
              <article class="feature-card">

                <div class="feature-icon">
                  ✓
                </div>

                <h3>
                  ${escapeHtml(title)}
                </h3>

                <p>
                  ${escapeHtml(description)}
                </p>

                <button
                  type="button"
                  class="secondary-button"
                >
                  فتح الوحدة
                </button>

              </article>
            `
          ).join("")}

        </div>

      </section>
    `;
  }
}
