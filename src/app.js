import { get } from "./lib/api.js";

const NAVIGATION = [
  {
    id: "dashboard",
    title: "الرئيسية",
    subtitle: "لوحة المؤشرات"
  },
  {
    id: "students",
    title: "الطلاب",
    subtitle: "ملفات الطلاب وولي الأمر"
  },
  {
    id: "teachers",
    title: "المعلمات",
    subtitle: "الملف المهني والجدول"
  },
  {
    id: "circles",
    title: "الحلقات",
    subtitle: "فردية وجماعية والسعة"
  },
  {
    id: "quran",
    title: "المصحف والورد",
    subtitle: "الحفظ والمراجعة والتمكين"
  },
  {
    id: "attendance",
    title: "الحضور",
    subtitle: "الحضور والغياب والتنبيهات"
  },
  {
    id: "calendar",
    title: "التقويم",
    subtitle: "اليومي والأسبوعي والشهري والسنوي"
  },
  {
    id: "subscriptions",
    title: "الباقات والاشتراكات",
    subtitle: "الأسعار والسعات والاشتراكات"
  },
  {
    id: "finance",
    title: "المالية",
    subtitle: "المدفوعات والمتأخرات"
  },
  {
    id: "tests",
    title: "الاختبارات",
    subtitle: "التقييم والنتيجة التراكمية"
  },
  {
    id: "communications",
    title: "التواصل",
    subtitle: "WhatsApp وFacebook وTelegram"
  },
  {
    id: "reports",
    title: "التقارير",
    subtitle: "التقارير التعليمية والمالية"
  },
  {
    id: "settings",
    title: "الإعدادات",
    subtitle: "الصلاحيات والتكاملات والنسخ الاحتياطي"
  }
];

const FEATURES = {
  students: [
    ["ملف الطالب", "البيانات الشخصية والتعليمية والاشتراك والتقدم."],
    ["ولي الأمر", "بيانات ولي الأمر ووسائل التواصل والصلاحيات."],
    ["سجل الطالب", "الحضور والورد والاختبارات والمدفوعات."],
    ["استيراد البيانات", "إضافة الطلاب جماعيًا من ملفات CSV."],
    ["حساب الطالب", "بوابة خاصة بالطالب لعرض بياناته."],
    ["بوابة ولي الأمر", "الحضور والورد والتقارير والتنبيهات."]
  ],

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
    ["سياسة الحذف", "تطبيق قاعدة الغياب الخاصة بالحلقات الجماعية."]
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

export class App {
  constructor(root) {
    this.root = root;
    this.currentPage = "dashboard";
  }

  mount() {
    this.renderShell();
  }

  renderShell() {
    const current = NAVIGATION.find(
      item => item.id === this.currentPage
    );

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
                <span>${item.title}</span>
                <small>${item.subtitle}</small>
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
              <h1>${current.title}</h1>
              <small>${current.subtitle}</small>
            </div>

            <div class="topbar-user">
              <span>الإدارة</span>
            </div>

          </header>

          <section
            id="pageContent"
            class="page-content"
          ></section>

        </main>

      </div>
    `;

    this.bindNavigation();
    this.renderPage();
  }

  bindNavigation() {
    this.root
      .querySelectorAll("[data-page]")
      .forEach(button => {
        button.addEventListener("click", () => {
          this.currentPage =
            button.dataset.page;

          this.renderShell();
        });
      });

    const mobileMenu =
      this.root.querySelector("#mobileMenu");

    const sidebar =
      this.root.querySelector("#sidebar");

    mobileMenu?.addEventListener("click", () => {
      sidebar?.classList.toggle("open");
    });
  }

  async renderPage() {
    const container =
      this.root.querySelector("#pageContent");

    if (!container) {
      return;
    }

    if (this.currentPage === "dashboard") {
      await this.renderDashboard(container);
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

          <button
            type="button"
            data-page="students"
          >
            إضافة طالب
          </button>

          <button
            type="button"
            data-page="calendar"
          >
            جدولة جلسة
          </button>

          <button
            type="button"
            data-page="quran"
          >
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

            <strong id="stat-${index}">
              —
            </strong>

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

    container
      .querySelectorAll("[data-page]")
      .forEach(button => {
        button.addEventListener("click", () => {
          this.currentPage =
            button.dataset.page;

          this.renderShell();
        });
      });

    try {
      const data =
        await get("/dashboard");

      const counts =
        data.counts || {};

      const values = [
        counts.students ?? 0,
        counts.teachers ?? 0,
        counts.circles ?? 0,
        counts.today ?? 0
      ];

      values.forEach((value, index) => {
        const element =
          container.querySelector(
            `#stat-${index}`
          );

        if (element) {
          element.textContent = value;
        }
      });

      const status =
        container.querySelector(
          "#connectionStatus"
        );

      if (status) {
        status.textContent =
          "النظام متصل بقاعدة البيانات.";
      }

    } catch {
      const status =
        container.querySelector(
          "#connectionStatus"
        );

      if (status) {
        status.textContent =
          "الواجهة جاهزة، وسيتم الاتصال بقاعدة البيانات بعد إعداد Cloudflare D1.";
      }
    }
  }

  renderModule(container) {
    const page =
      NAVIGATION.find(
        item => item.id === this.currentPage
      );

    const features =
      FEATURES[this.currentPage] || [];

    container.innerHTML = `
      <section class="content-card">

        <div class="section-heading">

          <div>
            <span class="eyebrow">
              ${page.title}
            </span>

            <h2>
              ${page.subtitle}
            </h2>

            <p>
              إدارة ${page.title} داخل نظام الأوَّابين.
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
                  ${title}
                </h3>

                <p>
                  ${description}
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
