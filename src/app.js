
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
    this.classroom = null;
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
            ${this.user?.role === "student" ? this.nav("individual-booking","الحجز الفردي","احجز جلسة فردية وتابع طلباتك") : ""}
            ${this.nav("students","الطلاب","إدارة الطلاب")}
            ${this.nav("teachers","المعلمون","فريق الأكاديمية")}
            ${this.nav("circles","الحلقات","الفردية والجماعية")}
            ${this.nav("quran","القرآن والورد","الحفظ والمراجعة")}
            ${this.nav("attendance","الحضور","الحضور والمتابعة")}
            ${this.nav("tests","الاختبارات","اختبارات الطلاب")}
            ${this.nav("question-bank","بنك الأسئلة","إدارة الأسئلة والمواد")}
            ${this.nav("academic-materials","المواد الأكاديمية","المناهج والدروس والمواد المعتمدة")}
            ${this.nav("achievements","الإنجازات","النقاط والتحفيز")}
            ${this.nav("competitions","المسابقات","الألعاب والتحديات")}
            ${this.nav("community","المجتمع","الرفقاء والتواصل")}
            ${this.nav("board","السبورة","التعليم التفاعلي")}
            ${this.nav("packages","الباقات","إدارة الباقات والأسعار")}
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
              <button class="icon-button notification-topbar-button" id="notification-topbar-button" type="button" title="الإشعارات" aria-label="الإشعارات">
                <span>🔔</span>
                <span class="notification-count-badge" id="notification-count-badge" hidden>0</span>
              </button>
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

    this.root.querySelector("#notification-topbar-button")?.addEventListener("click", () => {
      this.active = "notifications";
      this.root.querySelectorAll(".nav-item").forEach((item) => {
        item.classList.toggle("active", item.dataset.page === "notifications");
      });
      this.renderModule("notifications");
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
        this.refreshNotificationCount();
      } else {
        this.renderLogin();
      }
    } catch {
      this.renderLogin("تعذر الاتصال بخدمة تسجيل الدخول.");
    }
  }

  async renderIndividualBookingModule() {
    const content = this.root.querySelector("#app-content");
    if (!content) return;

    if (this.user?.role !== "student") {
      this.setHeading("الحجز الفردي", "هذه الخدمة مخصصة للطلاب");
      content.innerHTML = "<section class=\"content-card\"><h2>الخدمة مخصصة للطلاب</h2><p>يمكن للطالب حجز جلسة فردية ومتابعة طلباته من هنا.</p></section>";
      return;
    }

    this.setHeading("الحجز الفردي", "احجزي جلسة فردية واختاري الموعد المناسب لك");

    content.innerHTML = `
      <section class="content-card" id="individual-booking-root">
        <div class="section-heading">
          <div>
            <span class="eyebrow">جلسة فردية</span>
            <h2>احجزي جلسة فردية</h2>
            <p>اختاري نوع الجلسة ثم اليوم والموعد المناسب.</p>
          </div>
          <span class="status-pill">الحجز الفردي</span>
        </div>

        <div id="individual-booking-message"></div>

        <div class="form-grid">
          <label>
            نوع الجلسة
            <select id="individual-offering">
              <option value="">جاري تحميل الجلسات...</option>
            </select>
          </label>

          <label>
            اليوم
            <input id="individual-date" type="date">
          </label>
        </div>

        <div id="individual-offering-info"></div>

        <div class="section-heading" style="margin-top:20px">
          <div>
            <span class="eyebrow">المواعيد</span>
            <h3>المواعيد المتاحة</h3>
          </div>
        </div>

        <div id="individual-slots">
          <div class="empty-state">اختاري نوع الجلسة واليوم.</div>
        </div>

        <div class="section-heading" style="margin-top:28px">
          <div>
            <span class="eyebrow">المتابعة</span>
            <h3>طلباتي وحجوزاتي</h3>
          </div>
        </div>

        <div id="individual-my-requests"><div class="empty-state">جاري التحميل...</div></div>
        <div id="individual-my-bookings" style="margin-top:16px"><div class="empty-state">جاري التحميل...</div></div>

        <div class="section-heading" style="margin-top:28px">
          <div>
            <span class="eyebrow">دعم تعليمي سري</span>
            <h3>هل تحتاجين مساعدة في تكلفة الحلقة أو المستوى؟</h3>
            <p>يمكنك إرسال طلب دعم تعليمي بسرية، وتتم مراجعته وفق الحاجة وتوفر التمويل.</p>
          </div>
        </div>

        <div class="content-card" id="educational-support-root">
          <div id="educational-support-message"></div>

          <div class="form-grid">
            <label>
              نوع الدعم
              <select id="support-scope">
                <option value="subscription">اشتراك</option>
                <option value="circle">حلقة</option>
                <option value="level">مستوى</option>
                <option value="other">أخرى</option>
              </select>
            </label>

            <label>
              عدد الأشهر المطلوبة
              <input id="support-months" type="number" min="1" step="1" placeholder="مثال: 1">
            </label>

            <label>
              المبلغ المطلوب إن كان محددًا
              <input id="support-amount" type="number" min="0" step="1" placeholder="اختياري">
            </label>
          </div>

          <label style="display:block;margin-top:14px">
            سبب طلب الدعم
            <textarea id="support-reason" rows="4" maxlength="2000"
              placeholder="اكتبي باختصار ما ترغبين في توضيحه للجنة المراجعة..."></textarea>
          </label>

          <label style="display:block;margin-top:14px">
            ملاحظة عن الالتزام
            <textarea id="support-commitment" rows="3"
              placeholder="اختياري: أي ملاحظة تساعد في توضيح التزامك بالدراسة والمتابعة."></textarea>
          </label>

          <div style="margin-top:14px">
            <button class="primary-button" id="support-submit" type="button">
              إرسال طلب الدعم بسرية
            </button>
          </div>

          <div id="educational-support-history" style="margin-top:18px">
            <div class="empty-state">جاري تحميل طلبات الدعم السابقة...</div>
          </div>
        </div>
      </section>
    `;

    const root = content.querySelector("#individual-booking-root");
    const offeringSelect = root.querySelector("#individual-offering");
    const dateInput = root.querySelector("#individual-date");
    const slotsBox = root.querySelector("#individual-slots");
    const offeringInfo = root.querySelector("#individual-offering-info");
    const messageBox = root.querySelector("#individual-booking-message");
    const requestsBox = root.querySelector("#individual-my-requests");
    const bookingsBox = root.querySelector("#individual-my-bookings");

    const supportRoot = root.querySelector("#educational-support-root");
    const supportMessage = root.querySelector("#educational-support-message");
    const supportScope = root.querySelector("#support-scope");
    const supportMonths = root.querySelector("#support-months");
    const supportAmount = root.querySelector("#support-amount");
    const supportReason = root.querySelector("#support-reason");
    const supportCommitment = root.querySelector("#support-commitment");
    const supportSubmit = root.querySelector("#support-submit");
    const supportHistory = root.querySelector("#educational-support-history");

    const supportStatus = (value) => ({
      pending_review: "قيد المراجعة",
      needs_info: "تحتاج معلومات إضافية",
      approved: "تمت الموافقة",
      partially_approved: "تمت الموافقة جزئيًا",
      waiting_funding: "في انتظار توفر التمويل",
      rejected: "لم تتم الموافقة حاليًا",
      closed: "مغلق"
    }[value] || value || "—");

    const loadSupportRequests = async () => {
      try {
        const response = await this.apiGet("/api/sponsorship-support");
        const rows = Array.isArray(response?.data) ? response.data : [];

        if (!rows.length) {
          supportHistory.innerHTML =
            '<div class="empty-state">لا توجد طلبات دعم سابقة.</div>';
          return;
        }

        supportHistory.innerHTML = `
          <div class="section-heading">
            <div>
              <span class="eyebrow">المتابعة</span>
              <h4>طلبات الدعم السابقة</h4>
            </div>
          </div>
          <div style="display:grid;gap:10px">
            ${rows.map((row) => `
              <div class="content-card" style="padding:12px">
                <strong>${esc(supportStatus(row.status))}</strong>
                <div style="margin-top:6px">${esc(row.public_message || "")}</div>
                <div style="margin-top:6px">
                  النطاق: ${esc({
                    subscription: "اشتراك",
                    circle: "حلقة",
                    level: "مستوى",
                    other: "أخرى"
                  }[row.requested_scope] || row.requested_scope)}
                </div>
                ${row.requested_months ? `<div style="margin-top:4px">المدة المطلوبة: ${esc(row.requested_months)} شهر</div>` : ""}
                ${row.eligibility_review_until ? `<div style="margin-top:4px">المراجعة حتى: ${esc(row.eligibility_review_until)}</div>` : ""}
              </div>
            `).join("")}
          </div>
        `;
      } catch {
        supportHistory.innerHTML =
          '<div class="empty-state">تعذر تحميل طلبات الدعم حاليًا.</div>';
      }
    };

    supportSubmit?.addEventListener("click", async () => {
      const reason = String(supportReason?.value || "").trim();

      if (reason.length < 10) {
        supportMessage.innerHTML =
          '<div class="quick-strip">يرجى كتابة سبب مختصر لطلب الدعم.</div>';
        supportReason?.focus();
        return;
      }

      supportSubmit.disabled = true;
      supportMessage.innerHTML =
        '<div class="quick-strip">جاري إرسال الطلب بسرية...</div>';

      try {
        const payload = {
          action: "request_support",
          requested_scope: supportScope?.value || "subscription",
          requested_months: supportMonths?.value || null,
          requested_amount: supportAmount?.value || null,
          reason,
          commitment_note: String(supportCommitment?.value || "").trim()
        };

        const response = await this.apiPost(
          "/api/sponsorship-support",
          payload
        );

        supportMessage.innerHTML =
          `<div class="quick-strip">${esc(
            response?.data?.public_message ||
            "تم استلام طلبك وسيتم مراجعته بسرية."
          )}</div>`;

        if (supportMonths) supportMonths.value = "";
        if (supportAmount) supportAmount.value = "";
        if (supportReason) supportReason.value = "";
        if (supportCommitment) supportCommitment.value = "";

        await loadSupportRequests();
      } catch (error) {
        const code = String(error?.message || "");
        const errors = {
          SPONSORSHIP_SEATS_CLOSED:
            "التقديم على الدعم مغلق حاليًا من إدارة الأكاديمية.",
          ACTIVE_SUPPORT_REQUEST_EXISTS:
            "لديك طلب دعم قائم بالفعل، ويمكنك متابعة حالته في الأسفل.",
          SUPPORT_REASON_REQUIRED:
            "يرجى كتابة سبب طلب الدعم.",
          SUPPORT_REASON_TOO_LONG:
            "سبب الطلب أطول من الحد المسموح."
        };

        supportMessage.innerHTML =
          `<div class="quick-strip">${esc(
            errors[code] || "تعذر إرسال طلب الدعم حاليًا."
          )}</div>`;

        await loadSupportRequests();
      } finally {
        supportSubmit.disabled = false;
      }
    });

    const now = new Date();
    const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
      .toISOString().slice(0, 10);
    dateInput.value = today;
    dateInput.min = today;

    const esc = (value) => this.escape(String(value ?? "—"));

    const message = (text) => {
      messageBox.innerHTML = `<div class="content-card" style="margin:12px 0;padding:12px">${esc(text)}</div>`;
    };

    const money = (amount, currency = "EGP") => {
      const value = Number(amount);
      if (!Number.isFinite(value)) return "—";
      return `${value.toLocaleString("ar-EG")} ${esc(currency)}`;
    };

    const status = (value) => ({
      pending: "قيد المراجعة",
      confirmed: "مؤكد",
      completed: "مكتمل",
      cancelled: "ملغى",
      rejected: "مرفوض"
    }[value] || value || "—");

    let offerings = [];

    const renderOffering = () => {
      const selected = offerings.find((o) => String(o.id) === String(offeringSelect.value));
      if (!selected) {
        offeringInfo.innerHTML = "";
        return;
      }
      offeringInfo.innerHTML = `<div class="content-card" style="margin-top:14px"><span class="eyebrow">تفاصيل الجلسة</span><h4>${esc(selected.name)}</h4>${selected.description ? `<p>${esc(selected.description)}</p>` : ""}<strong>${money(selected.price, selected.currency)}</strong><span style="margin-inline-start:10px">${esc(selected.duration_minutes)} دقيقة</span></div>`;
    };

    const loadOfferings = async () => {
      const response = await this.apiGet("/api/individual-session-offerings");
      offerings = Array.isArray(response?.data) ? response.data : [];

      if (!offerings.length) {
        offeringSelect.innerHTML = "<option value=\"\">لا توجد جلسات متاحة حاليًا</option>";
        offeringInfo.innerHTML = "<div class=\"empty-state\">لا توجد عروض جلسات فردية متاحة حاليًا.</div>";
        return;
      }

      offeringSelect.innerHTML =
        "<option value=\"\">اختاري نوع الجلسة</option>" +
        offerings.map((o) => `<option value="${esc(o.id)}">${esc(o.name)} — ${money(o.price, o.currency)} — ${esc(o.duration_minutes)} دقيقة</option>`).join("");
      renderOffering();
    };

    const loadRequests = async () => {
      try {
        const response = await this.apiGet("/api/individual-scheduling?type=requests");
        const rows = Array.isArray(response?.data) ? response.data : [];
        if (!rows.length) {
          requestsBox.innerHTML = "<div class=\"empty-state\">لا توجد طلبات حجز حتى الآن.</div>";
          return;
        }
        requestsBox.innerHTML = `<div class="content-card"><div class="section-heading"><h4>طلباتي</h4><span class="status-pill">${rows.length} طلب</span></div><div style="display:grid;gap:10px">${rows.map((r) => `<div class="content-card" style="padding:12px"><strong>${esc(r.teacher_name || "المعلم")}</strong><div>${esc(r.requested_date)} — ${esc(r.requested_start_time)} إلى ${esc(r.requested_end_time)}</div><div style="margin-top:6px">الحالة: <strong>${esc(status(r.status))}</strong></div>${r.teacher_response_note ? `<div style="margin-top:6px">ملاحظة: ${esc(r.teacher_response_note)}</div>` : ""}</div>`).join("")}</div></div>`;
      } catch {
        requestsBox.innerHTML = "<div class=\"empty-state\">تعذر تحميل طلبات الحجز.</div>";
      }
    };

    const loadBookings = async () => {
      try {
        const response = await this.apiGet("/api/individual-scheduling?type=bookings");
        const rows = Array.isArray(response?.data) ? response.data : [];
        if (!rows.length) {
          bookingsBox.innerHTML = "<div class=\"empty-state\">لا توجد حجوزات مؤكدة حتى الآن.</div>";
          return;
        }
        bookingsBox.innerHTML = `<div class="content-card"><div class="section-heading"><h4>جلساتي الفردية</h4></div><div style="display:grid;gap:10px">${rows.map((b) => { const o = offerings.find((x) => String(x.id) === String(b.offering_id)); return `<div class="content-card" style="padding:12px"><strong>${esc(b.teacher_name || "المعلم")}</strong><div>${esc(b.booking_date)} — ${esc(b.start_time)} إلى ${esc(b.end_time)}</div>${o ? `<div style="margin-top:6px">الجلسة: ${esc(o.name)}</div><div style="margin-top:6px">المبلغ: <strong>${money(o.price, o.currency)}</strong></div>` : ""}<div style="margin-top:6px">حالة الجلسة: <strong>${esc(status(b.status))}</strong></div></div>`; }).join("")}</div></div>`;
      } catch {
        bookingsBox.innerHTML = "<div class=\"empty-state\">تعذر تحميل الحجوزات.</div>";
      }
    };

    const minutes = (time) => {
      const parts = String(time || "").split(":");
      if (parts.length < 2) return NaN;
      return Number(parts[0]) * 60 + Number(parts[1]);
    };

    const addMinutes = (time, amount) => {
      const value = minutes(time) + Number(amount);
      if (!Number.isFinite(value)) return time;
      const h = Math.floor(value / 60) % 24;
      const m = value % 60;
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    };

    const loadSlots = async () => {
      const offering = offerings.find((o) => String(o.id) === String(offeringSelect.value));
      if (!offering || !dateInput.value) {
        slotsBox.innerHTML = "<div class=\"empty-state\">اختاري نوع الجلسة واليوم.</div>";
        return;
      }

      slotsBox.innerHTML = "<div class=\"empty-state\">جاري تحميل المواعيد...</div>";

      try {
        const response = await this.apiGet("/api/individual-scheduling?type=slots&date=" + encodeURIComponent(dateInput.value));
        const rows = Array.isArray(response?.data) ? response.data : [];
        const duration = Number(offering.duration_minutes);

        const usable = rows.filter((slot) => {
          const start = slot.start_time || slot.startTime;
          const end = slot.end_time || slot.endTime;
          return start && end && Number.isFinite(duration) && minutes(end) - minutes(start) >= duration;
        });

        if (!usable.length) {
          slotsBox.innerHTML = "<div class=\"empty-state\">لا يوجد موعد مناسب لمدة الجلسة المختارة في هذا اليوم.</div>";
          return;
        }

        slotsBox.innerHTML = `<div style="display:grid;gap:10px">${usable.map((slot) => {
          const teacherId = slot.teacher_id ?? slot.teacherId;
          const teacherName = slot.teacher_name ?? slot.teacherName ?? slot.teacher?.full_name ?? "المعلم";
          const start = slot.start_time ?? slot.startTime;
          const slotId = slot.id ?? slot.slot_id ?? slot.availability_slot_id;
          const end = addMinutes(start, duration);
          return `<button type="button" class="secondary-button individual-slot-btn" data-slot-id="${esc(slotId)}" data-teacher-id="${esc(teacherId)}" data-start="${esc(start)}" data-end="${esc(end)}" style="text-align:right;padding:14px"><strong>${esc(teacherName)}</strong><br>${esc(start)} — ${esc(end)}<br><small>${esc(duration)} دقيقة</small></button>`;
        }).join("")}</div>`;

        slotsBox.querySelectorAll(".individual-slot-btn").forEach((button) => {
          button.addEventListener("click", async () => {
            button.disabled = true;
            try {
              await this.apiPost("/api/individual-scheduling", {
                action: "request",
                availability_slot_id: Number(button.dataset.slotId),
                teacher_id: Number(button.dataset.teacherId),
                offering_id: Number(offering.id),
                requested_date: dateInput.value,
                requested_start_time: button.dataset.start,
                requested_end_time: button.dataset.end
              });
              message("تم إرسال طلب الحجز بنجاح. ستظهر حالة الطلب في قسم طلباتي.");
              await loadRequests();
              await loadBookings();
              await loadSlots();
            } catch (error) {
              const code = String(error?.message || "");
              const errors = {
                INDIVIDUAL_BOOKING_CLOSED: "الحجز الفردي مغلق حاليًا من إدارة الأكاديمية.",
                TIME_ALREADY_BOOKED: "هذا الموعد تم حجزه بالفعل.",
                TIME_ALREADY_REQUESTED: "يوجد طلب آخر على هذا الموعد.",
                SLOT_NOT_AVAILABLE: "هذا الموعد لم يعد متاحًا.",
                REQUEST_DURATION_MUST_MATCH_OFFERING: "مدة الموعد لا تطابق مدة الجلسة المختارة."
              };
              message(errors[code] || "تعذر إرسال طلب الحجز. قد يكون الموعد حُجز قبل الإرسال.");
            } finally {
              button.disabled = false;
            }
          });
        });
      } catch {
        slotsBox.innerHTML = "<div class=\"empty-state\">تعذر تحميل المواعيد المتاحة.</div>";
      }
    };

    offeringSelect.addEventListener("change", async () => {
      renderOffering();
      await loadSlots();
    });
    dateInput.addEventListener("change", loadSlots);

    try {
      await loadOfferings();
      await Promise.all([
        loadRequests(),
        loadBookings(),
        loadSupportRequests()
      ]);
    } catch {
      message("تعذر تحميل بيانات الحجز الفردي حاليًا.");
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


  async renderMotivationModule(page = "achievements") {
    const title =
      page === "competitions"
        ? "المسابقات والتحديات"
        : "المسار التحفيزي";

    const subtitle =
      page === "competitions"
        ? "تحديات تشجيعية مرتبطة بالتقدم الحقيقي."
        : "رحلة نقاط وإنجازات تشجع الاستمرار في القرآن والتعلم.";

    this.root.innerHTML = `
      <section class="aw-motivation">
        <div class="aw-motivation-hero">
          <div>
            <span class="aw-motivation-kicker">أكاديمية الأوابين</span>
            <h2>${title}</h2>
            <p>${subtitle}</p>
          </div>
          <div class="aw-motivation-icon">★</div>
        </div>

        <div id="aw-motivation-content">
          <div class="aw-motivation-loading">
            جاري تحميل المسار التحفيزي...
          </div>
        </div>
      </section>
    `;

    try {
      const data = await this.apiGet(
        "/api/motivation"
      );

      const content =
        document.getElementById(
          "aw-motivation-content"
        );

      if (!content) return;

      if (!data?.success || !data.summary) {
        content.innerHTML = `
          <div class="aw-motivation-empty">
            <strong>المسار التحفيزي</strong>
            <p>
              ${data?.message || "لا توجد بيانات تحفيزية لهذا الحساب حاليًا."}
            </p>
          </div>
        `;
        return;
      }

      const summary = data.summary;

      const points =
        Number(summary.points?.totalPoints || 0);

      const level =
        summary.level || null;

      const nextLevel =
        summary.nextLevel || null;

      const nextPoints =
        nextLevel
          ? Number(nextLevel.min_points || 0)
          : null;

      const currentLevelPoints =
        level
          ? Number(level.min_points || 0)
          : 0;

      const progress =
        nextPoints !== null &&
        nextPoints > currentLevelPoints
          ? Math.max(
              0,
              Math.min(
                100,
                ((points - currentLevelPoints) /
                  (nextPoints - currentLevelPoints)) *
                  100
              )
            )
          : 100;

      const achievements =
        Array.isArray(summary.achievements)
          ? summary.achievements
          : [];

      const recentEvents =
        Array.isArray(summary.recentEvents)
          ? summary.recentEvents
          : [];

      const challenges =
        Array.isArray(summary.activeChallenges)
          ? summary.activeChallenges
          : [];

      const availableChallenges =
        Array.isArray(summary.availableChallenges)
          ? summary.availableChallenges
          : [];

      const eventTotals =
        Array.isArray(summary.eventTotals)
          ? summary.eventTotals
          : [];

      content.innerHTML = `
        <div class="aw-motivation-summary">

          <article class="aw-motivation-card aw-motivation-points">
            <span>الرصيد التحفيزي</span>
            <strong>${points}</strong>
            <small>نقطة</small>
          </article>

          <article class="aw-motivation-card">
            <span>المستوى التحفيزي</span>
            <strong>
              ${level?.icon || "🌱"}
              ${level?.name || "البداية المباركة"}
            </strong>
            <small>
              ${level?.description || "بداية رحلة الاستمرار والإنجاز."}
            </small>
          </article>

          <article class="aw-motivation-card">
            <span>الإنجازات</span>
            <strong>${achievements.length}</strong>
            <small>شارات مكتسبة</small>
          </article>

        </div>

        <article class="aw-motivation-panel">

          <div class="aw-motivation-panel-head">
            <div>
              <h3>طريق التقدم</h3>
              <p>
                النقاط هنا للتشجيع فقط، وليست درجة أكاديمية.
              </p>
            </div>

            ${
              nextLevel
                ? `<strong>${nextPoints} نقطة للمستوى التالي</strong>`
                : `<strong>أعلى مستوى تحفيزي</strong>`
            }
          </div>

          <div class="aw-motivation-progress">
            <span style="width:${progress}%"></span>
          </div>

          <div class="aw-motivation-progress-labels">
            <span>${currentLevelPoints} نقطة</span>
            <span>${nextLevel ? nextPoints : points} نقطة</span>
          </div>

        </article>

        <div class="aw-motivation-grid">

          <article class="aw-motivation-panel">

            <div class="aw-motivation-panel-head">
              <h3>الشارات والإنجازات</h3>
              <span>${achievements.length}</span>
            </div>

            ${
              achievements.length
                ? `
                  <div class="aw-achievements">
                    ${achievements.map((item) => `
                      <div class="aw-achievement">

                        <div class="aw-achievement-icon">
                          ${item.icon || "★"}
                        </div>

                        <div>
                          <strong>
                            ${item.name || "إنجاز"}
                          </strong>

                          <p>
                            ${item.description || ""}
                          </p>
                        </div>

                      </div>
                    `).join("")}
                  </div>
                `
                : `
                  <div class="aw-motivation-empty">
                    لم تُسجل شارات بعد.
                    كل تقدم حقيقي في الرحلة يمكن أن يصنع إنجازًا جديدًا.
                  </div>
                `
            }

          </article>

          <article class="aw-motivation-panel">

            <div class="aw-motivation-panel-head">
              <h3>مصادر النقاط</h3>
            </div>

            ${
              eventTotals.length
                ? `
                  <div class="aw-motivation-source-list">

                    ${eventTotals.map((item) => `
                      <div class="aw-motivation-source">
                        <span>
                          ${this.motivationEventLabel(item.event_type)}
                        </span>

                        <strong>
                          ${Number(item.points || 0)} نقطة
                        </strong>
                      </div>
                    `).join("")}

                  </div>
                `
                : `
                  <div class="aw-motivation-empty">
                    لم تُسجل أحداث نقاط بعد.
                  </div>
                `
            }

          </article>

        </div>

        <article class="aw-motivation-panel">

          <div class="aw-motivation-panel-head">
            <div>
              <h3>التحديات الحالية</h3>
              <p>
                تحديات تشجيعية اختيارية مرتبطة بالتقدم.
              </p>
            </div>
          </div>

          ${
            challenges.length
              ? `
                <div class="aw-challenge-list">

                  ${challenges.map((item) => `
                    <div class="aw-challenge">

                      <div>
                        <strong>
                          ${item.title || "تحدٍ"}
                        </strong>

                        <p>
                          ${item.description || ""}
                        </p>
                      </div>

                      <div class="aw-challenge-value">
                        ${Number(item.progress_value || 0)}
                        ${
                          item.target_value !== null &&
                          item.target_value !== undefined
                            ? ` / ${Number(item.target_value)}`
                            : ""
                        }
                      </div>

                    </div>
                  `).join("")}

                </div>
              `
              : `
                <div class="aw-motivation-empty">
                  لا توجد تحديات نشطة حاليًا.
                </div>
              `
          }

        </article>

        <article class="aw-motivation-panel">

          <div class="aw-motivation-panel-head">
            <div>
              <h3>تحديات متاحة</h3>
              <p>
                يمكنك اختيار التحديات المناسبة والانضمام إليها.
              </p>
            </div>
          </div>

          ${
            availableChallenges.length
              ? `
                <div class="aw-challenge-list">

                  ${availableChallenges.map((item) => `
                    <div class="aw-challenge">

                      <div>
                        <strong>
                          ${item.title || "تحدٍ جديد"}
                        </strong>

                        <p>
                          ${item.description || ""}
                        </p>

                        ${
                          item.end_date
                            ? `
                              <small>
                                ينتهي في ${item.end_date}
                              </small>
                            `
                            : ""
                        }
                      </div>

                      <div>
                        <div class="aw-challenge-value">
                          ${
                            item.reward_points !== null &&
                            item.reward_points !== undefined
                              ? `${Number(item.reward_points)} نقطة`
                              : "تحدٍ تحفيزي"
                          }
                        </div>

                        <button
                          class="secondary-button aw-challenge-join"
                          type="button"
                          data-challenge-id="${Number(item.id)}"
                        >
                          انضمام للتحدي
                        </button>
                      </div>

                    </div>
                  `).join("")}

                </div>
              `
              : `
                <div class="aw-motivation-empty">
                  لا توجد تحديات جديدة متاحة لك حاليًا.
                </div>
              `
          }

        </article>

        <article class="aw-motivation-panel">

          <div class="aw-motivation-panel-head">

            <div>
              <h3>آخر الإنجازات</h3>
              <p>
                سجل شفاف للأحداث التي أضافت إلى الرصيد.
              </p>
            </div>

          </div>

          ${
            recentEvents.length
              ? `
                <div class="aw-motivation-events">

                  ${recentEvents.map((item) => `
                    <div class="aw-motivation-event">

                      <div>
                        <strong>
                          ${item.reason || "إنجاز تحفيزي"}
                        </strong>

                        <small>
                          ${this.motivationEventLabel(item.event_type)}
                        </small>
                      </div>

                      <strong class="aw-event-points">
                        ${Number(item.points || 0) > 0 ? "+" : ""}
                        ${Number(item.points || 0)}
                      </strong>

                    </div>
                  `).join("")}

                </div>
              `
              : `
                <div class="aw-motivation-empty">
                  سيظهر هنا سجل التقدم التحفيزي.
                </div>
              `
          }

        </article>
      `;

      content
        .querySelectorAll(".aw-challenge-join")
        .forEach((button) => {
          button.addEventListener("click", async () => {
            const challengeId =
              Number(button.dataset.challengeId);

            if (!Number.isInteger(challengeId) || challengeId <= 0) {
              return;
            }

            const originalText = button.textContent;

            button.disabled = true;
            button.textContent = "جارٍ الانضمام...";

            try {
              const result = await this.apiPost(
                "/api/motivation",
                {
                  action: "join_challenge",
                  challenge_id: challengeId,
                }
              );

              if (!result?.success) {
                throw new Error(
                  result?.message ||
                  "تعذر الانضمام إلى التحدي."
                );
              }

              await this.renderMotivationModule(page);
            } catch (error) {
              console.error(
                "Challenge join error",
                error
              );

              button.disabled = false;
              button.textContent = originalText;

              alert(
                error?.message ||
                "تعذر الانضمام إلى التحدي."
              );
            }
          });
        });

    } catch (error) {
      console.error(
        "Motivation module error",
        error
      );

      const content =
        document.getElementById(
          "aw-motivation-content"
        );

      if (content) {
        content.innerHTML = `
          <div class="aw-motivation-empty">
            تعذر تحميل المسار التحفيزي حاليًا.
          </div>
        `;
      }
    }
  }

  motivationEventLabel(type) {
    const labels = {
      quran_progress: "تقدم قرآني",
      wird_completion: "إتمام الورد",
      buddy_followup: "متابعة مع الرفيقة",
      attendance: "حضور",
      test: "اختبار",
    };

    return labels[type] || "إنجاز تحفيزي";
  }

  async renderModule(page) {
    if (page === "individual-booking") {
      await this.renderIndividualBookingModule();
      return;
    }


    const titles = {
      dashboard: ["لوحة التحكم", "نظرة عامة على الأكاديمية"],
      today: ["جدول اليوم", "الجلسات والمواعيد وفق الصلاحيات"],
      schedule: ["الجدول", "مركز الجدول والمواعيد والإجازات"],
      "individual-booking": ["الحجز الفردي", "احجز جلسة فردية وتابع طلباتك وحجوزاتك"],
      students: ["الطلاب", "إدارة ملفات الطلاب والمتابعة"],
      teachers: ["المعلمون", "إدارة فريق الأكاديمية"],
      circles: ["الحلقات", "الحلقات الفردية والجماعية"],
      quran: ["القرآن والورد", "الحفظ والمراجعة والسرد اليومي"],
      attendance: ["الحضور", "الحضور والمتابعة والتنبيهات"],
    tests: ["الاختبارات", "اختبارات الطلاب والنتائج"],
    "question-bank": ["بنك الأسئلة", "إدارة بنك الأسئلة والمواد التعليمية"],
      "academic-materials": ["المواد الأكاديمية", "المناهج والدروس والمواد العلمية المعتمدة"],
      payments: ["المالية", "المدفوعات والاشتراكات والفواتير"],
      packages: ["الباقات", "إدارة الباقات والأسعار والجلسات"],
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
      "academic-materials": "/api/academic-materials",
        payments: "/api/payments",
      "packages": "/api/packages",
        subscriptions: "/api/subscriptions",
        today: "/api/sessions",
        schedule: "/api/schedule-center",
        reports: "/api/dashboard",
        notifications: "/api/notifications",
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
        notifications: [],
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

        if (
      page === "achievements" ||
      page === "competitions"
    ) {
      await this.renderMotivationModule(page);
      return;
    }

    if (page === "packages") {
          await this.renderPackagesModule(info[0]);
          return;
        }

      if (page === "schedule") {
        await this.renderScheduleCenter(info[0]);
        return;
      }

      if (page === "circles") {
        await this.renderCirclesModule(info[0]);
        return;
      }

      if (page === "today") {
        await this.renderTodayModule(info[0]);
        return;
      }

      if (page === "community") {
        await this.renderCommunityModule(info[0]);
        return;
      }

      if (page === "quran") {
        await this.renderQuranModule(info[0]);
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

      if (page === "academic-materials") {
        await this.renderAcademicMaterialsModule(info[0]);
        return;
      }

      if (page === "attendance") {
      await this.renderAttendanceModule(info[0]);
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

      if (page === "students") {
        await this.renderStudentsModule(info[0]);
        return;
      }

      if (page === "teachers") {
        await this.renderTeachersModule(info[0]);
        return;
      }

      if (page === "notifications") {
        await this.renderNotificationsModule(info[0]);
        return;
      }

      if (page === "payments") {
        await this.renderPaymentsModule(info[0]);
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

  async renderPackagesModule(title) {
    const root = document.querySelector("#module-live-content");
    if (!root) return;

    root.innerHTML = `
      <section class="module-section">
        <div class="section-header">
          <div>
            <h2>إدارة الباقات</h2>
            <p>إدارة الباقات الفردية والجماعية والأسعار والجلسات.</p>
          </div>

          <button
            type="button"
            class="primary-button"
            data-package-action="new"
          >
            إضافة باقة
          </button>
        </div>

        <div id="package-form-container" style="display:none;"></div>

        <div id="packages-list">
          <p>جارٍ تحميل الباقات...</p>
        </div>
      </section>
    `;

    const newButton = root.querySelector('[data-package-action="new"]');
    const formContainer = root.querySelector("#package-form-container");

    if (newButton && formContainer) {
      newButton.addEventListener("click", () => {
        formContainer.style.display = "block";

        formContainer.innerHTML = `
          <div class="card" style="margin-top:16px;">
            <div class="section-heading">
              <div>
                <h3>إضافة باقة جديدة</h3>
                <p>أدخل بيانات الباقة ثم احفظها.</p>
              </div>
            </div>

            <form id="package-create-form">
              <div class="form-grid">

                <label>
                  اسم الباقة
                  <input
                    type="text"
                    name="name"
                    required
                    maxlength="120"
                    placeholder="مثال: باقة الحفظ الجماعية"
                  >
                </label>

                <label>
                  نوع الباقة
                  <select name="package_type" required>
                    <option value="group">جماعية</option>
                    <option value="individual">فردية</option>
                  </select>
                </label>

                <label>
                  السعر
                  <input
                    type="number"
                    name="price"
                    min="0"
                    step="0.01"
                    value="0"
                    required
                  >
                </label>

                <label>
                  العملة
                  <input
                    type="text"
                    name="currency"
                    value="EGP"
                    maxlength="10"
                  >
                </label>

                <label>
                  عدد الجلسات شهريًا
                  <input
                    type="number"
                    name="sessions_per_month"
                    min="0"
                    step="1"
                    value="0"
                    required
                  >
                </label>

                <label>
                  مدة الجلسة بالدقائق
                  <input
                    type="number"
                    name="duration_minutes"
                    min="1"
                    step="1"
                    value="30"
                    required
                  >
                </label>

                <label>
                  سعة الحلقة
                  <input
                    type="number"
                    name="capacity"
                    min="1"
                    step="1"
                    placeholder="اتركها فارغة للفردية"
                  >
                </label>

                <label>
                  مدة التجربة بالأيام
                  <input
                    type="number"
                    name="trial_days"
                    min="0"
                    step="1"
                    value="0"
                    required
                  >
                </label>

                <label style="grid-column:1/-1;">
                  وصف الباقة
                  <textarea
                    name="description"
                    rows="3"
                    placeholder="وصف مختصر للباقة"
                  ></textarea>
                </label>

                <label style="grid-column:1/-1;">
                  قواعد الباقة
                  <textarea
                    name="rules"
                    rows="4"
                    placeholder="شروط وقواعد الباقة"
                  ></textarea>
                </label>

              </div>

              <div
                id="package-form-message"
                style="margin-top:12px;"
              ></div>

              <div
                style="
                  display:flex;
                  gap:8px;
                  margin-top:16px;
                  flex-wrap:wrap;
                "
              >
                <button
                  type="submit"
                  class="primary-button"
                >
                  حفظ الباقة
                </button>

                <button
                  type="button"
                  class="secondary-button"
                  data-package-action="cancel"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        `;

        const form = formContainer.querySelector("#package-create-form");
        const cancelButton =
          formContainer.querySelector('[data-package-action="cancel"]');
        const message =
          formContainer.querySelector("#package-form-message");

        if (cancelButton) {
          cancelButton.addEventListener("click", () => {
            formContainer.style.display = "none";
            formContainer.innerHTML = "";
          });
        }

        if (form) {
          const typeSelect = form.querySelector('[name="package_type"]');
          const capacityInput = form.querySelector('[name="capacity"]');

          const syncCapacity = () => {
            if (!typeSelect || !capacityInput) return;

            if (typeSelect.value === "individual") {
              capacityInput.value = "";
              capacityInput.disabled = true;
              capacityInput.placeholder = "غير مطلوبة للفردية";
            } else {
              capacityInput.disabled = false;
              capacityInput.placeholder = "مثال: 10";
            }
          };

          if (typeSelect) {
            typeSelect.addEventListener("change", syncCapacity);
            syncCapacity();
          }

          form.addEventListener("submit", async (event) => {
            event.preventDefault();

            if (message) {
              message.innerHTML = "<p>جارٍ حفظ الباقة...</p>";
            }

            const data = new FormData(form);

            const packageType = data.get("package_type");
            const capacityValue = data.get("capacity");

            const payload = {
              name: String(data.get("name") || "").trim(),
              package_type: packageType,
              price: Number(data.get("price") || 0),
              currency:
                String(data.get("currency") || "EGP").trim() || "EGP",
              sessions_per_month:
                Number(data.get("sessions_per_month") || 0),
              duration_minutes:
                Number(data.get("duration_minutes") || 30),
              capacity:
                packageType === "individual" || capacityValue === ""
                  ? null
                  : Number(capacityValue),
              trial_days:
                Number(data.get("trial_days") || 0),
              description:
                String(data.get("description") || "").trim() || null,
              rules:
                String(data.get("rules") || "").trim() || null
            };

            try {
              const response = await fetch("/api/packages", {
                method: "POST",
                credentials: "include",
                headers: {
                  "Content-Type": "application/json",
                  "Accept": "application/json"
                },
                body: JSON.stringify(payload)
              });

              const result = await response.json().catch(() => ({}));

              if (!response.ok) {
                throw new Error(
                  result.error ||
                  result.message ||
                  `HTTP ${response.status}`
                );
              }

              if (!result.success) {
                throw new Error(
                  result.error || "تعذر حفظ الباقة"
                );
              }

              if (message) {
                message.innerHTML =
                  "<p>تم حفظ الباقة بنجاح.</p>";
              }

              formContainer.style.display = "none";
              formContainer.innerHTML = "";

              await this.loadPackages();

            } catch (error) {
              if (message) {
                message.innerHTML = `
                  <div class="empty-state">
                    <p>تعذر حفظ الباقة.</p>
                    <small>
                      ${this.escape(
                        error.message || "خطأ غير معروف"
                      )}
                    </small>
                  </div>
                `;
              }
            }
          });
        }
      });
    }

    await this.loadPackages();
  }

  async loadPackages() {
    const root = document.querySelector("#packages-list");
    if (!root) return;

    try {
      const data = await this.apiGet("/api/packages");

      if (!data.success) {
        throw new Error(data.error || "تعذر تحميل الباقات");
      }

      const packages = data.packages || [];

      if (!packages.length) {
        root.innerHTML = `
          <div class="empty-state">
            <p>لا توجد باقات مضافة حاليًا.</p>
          </div>
        `;
        return;
      }

      root.innerHTML = packages.map((pkg) => `
        <article class="card" style="margin-top:12px;">
          <h3>${this.escape(pkg.name || "—")}</h3>
          <p>
            النوع:
            ${pkg.package_type === "group" ? "جماعية" : "فردية"}
          </p>
          <p>
            السعر:
            ${this.escape(String(pkg.price ?? 0))}
            ${this.escape(pkg.currency || "EGP")}
          </p>
          <p>
            الجلسات شهريًا:
            ${this.escape(String(pkg.sessions_per_month ?? 0))}
          </p>
          <p>
            مدة الجلسة:
            ${this.escape(String(pkg.duration_minutes ?? 30))}
            دقيقة
          </p>
          <p>
            السعة:
            ${
              pkg.capacity == null
                ? "غير محددة"
                : this.escape(String(pkg.capacity))
            }
          </p>
          <p>
            التجربة:
            ${this.escape(String(pkg.trial_days ?? 0))}
            يوم
          </p>
          <p>
            الحالة:
            ${pkg.status === "active" ? "نشطة" : "غير نشطة"}
          </p>
        </article>
      `).join("");
    } catch (error) {
      root.innerHTML = `
        <div class="empty-state">
          <p>تعذر تحميل الباقات.</p>
          <small>
            ${this.escape(error.message || "خطأ غير معروف")}
          </small>
        </div>
      `;
    }
  }

  async renderCommunityModule(title) {
    const content = this.root.querySelector("#module-live-content");
    if (!content) return;

    content.innerHTML = `
      <div class="section-heading">
        <div>
          <span class="eyebrow">الرفيقة</span>
          <h3>${this.escape(title)}</h3>
          <p>المتابعة اليومية بين الطالبة ورفيقتها دون تسجيل صوتي.</p>
        </div>
        <button class="secondary-button" id="community-refresh" type="button">
          تحديث
        </button>
      </div>

      <div id="community-content">
        <div class="loading-state">
          <div class="loading-spinner"></div>
          <h3>جاري تحميل الرفقاء...</h3>
        </div>
      </div>
    `;

    content.querySelector("#community-refresh")?.addEventListener(
      "click",
      () => this.renderCommunityModule(title)
    );

    const area = content.querySelector("#community-content");

    try {
      const data = await this.apiGet("/api/buddy");
      const pairs = Array.isArray(data?.pairs) ? data.pairs : [];

      if (!pairs.length) {
        area.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">♢</div>
            <h3>لا توجد رفيقة نشطة</h3>
            <p>سيظهر الزوج النشط هنا بعد اعتماده من المعلم أو الإدارة.</p>
          </div>
        `;
        return;
      }

      area.innerHTML = pairs.map((pair) => `
        <article class="content-card" style="margin-bottom:16px;">
          <div class="section-heading">
            <div>
              <span class="eyebrow">رفيقة نشطة</span>
              <h3>
                ${this.escape(pair.student_name || "طالب")}
              </h3>
              <p>
                الرفيقة:
                <strong>
                  ${this.escape(pair.buddy_name || "غير محددة")}
                </strong>
              </p>
            </div>

            <span class="status-pill">
              ${this.escape(pair.status || "active")}
            </span>
          </div>

          <label style="display:block;margin-top:14px;">
            <span>ملاحظة المتابعة اليومية</span>
            <textarea
              id="buddy-note-${pair.id}"
              rows="3"
              style="width:100%;margin-top:8px;"
              placeholder="اختياري"
            ></textarea>
          </label>

          <div style="margin-top:12px;">
            <button
              type="button"
              class="secondary-button"
              data-buddy-followup="${pair.id}"
            >
              تسجيل تأكيدي اليوم
            </button>
          </div>

          <p
            id="buddy-result-${pair.id}"
            style="margin-top:10px;"
          ></p>
        </article>
      `).join("");

      area.querySelectorAll("[data-buddy-followup]").forEach(
        (button) => {
          button.addEventListener("click", async () => {
            const pairId = Number(
              button.getAttribute("data-buddy-followup")
            );

            const note =
              area.querySelector(`#buddy-note-${pairId}`)
                ?.value
                ?.trim() || "";

            const result =
              area.querySelector(`#buddy-result-${pairId}`);

            button.disabled = true;
            result.textContent = "جاري تسجيل تأكيدك...";

            try {
              await this.apiPost("/api/buddy", {
                action: "followup",
                pair_id: pairId,
                note
              });

              result.textContent =
                "تم تسجيل تأكيدك اليوم. اكتمال المتابعة يتطلب تأكيد الطرف الآخر أيضًا.";
            } catch (error) {
              result.textContent =
                `تعذر تسجيل المتابعة: ${error?.message || "خطأ غير متوقع"}`;
              button.disabled = false;
            }
          });
        }
      );
    } catch (error) {
      area.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">!</div>
          <h3>تعذر تحميل الرفقاء</h3>
          <p>${this.escape(error?.message || "حدث خطأ غير متوقع")}</p>
        </div>
      `;
    }
  }

  async renderQuranModule(title) {
    const content = this.root.querySelector("#module-live-content");
    if (!content) return;

    const canManageQuran =
      this.user?.role === "admin" ||
      this.user?.role === "supervisor" ||
      this.user?.role === "teacher";

    content.innerHTML = `
      <div class="section-heading">
        <div>
          <span class="eyebrow">المتابعة القرآنية</span>
          <h3>${this.escape(title)}</h3>
          <p>اختر الطالب لعرض الحفظ والمراجعة والورد والنتيجة التراكمية.</p>
        </div>
        <button class="secondary-button" id="quran-refresh" type="button">تحديث</button>
      </div>

      <section class="content-card">
        <label style="display:block;margin-bottom:16px">
          <span>الطالب</span>
          <select id="quran-student" style="width:100%;padding:12px">
            <option value="">جاري تحميل الطلاب...</option>
          </select>
        </label>

        <div id="quran-student-content">
          <div class="loading-state">
            <div class="loading-spinner"></div>
            <h3>جاري تحميل الطلاب...</h3>
          </div>
        </div>
      </section>
    `;

    const select = content.querySelector("#quran-student");
    const area = content.querySelector("#quran-student-content");

    try {
      const isStudent = this.user?.role === "student";

      let active = [];

      if (isStudent) {
        const ownStudentId = Number(this.user?.student_id || 0);

        if (!ownStudentId) {
          throw new Error("لم يتم العثور على ملف الطالب المرتبط بالحساب.");
        }

        active = [{
          id: ownStudentId,
          full_name: this.user?.full_name || "الطالب",
          status: "active"
        }];

        select.innerHTML = `
          <option value="${this.escape(String(ownStudentId))}">
            ${this.escape(this.user?.full_name || "ملفي التعليمي")}
          </option>
        `;

        select.disabled = true;
      } else {
        const result = await this.apiGet("/api/students");

        const students = Array.isArray(result?.data)
          ? result.data
          : Array.isArray(result?.results)
            ? result.results
            : [];

        active = students.filter(
          (s) => !s?.status || s.status === "active"
        );

        select.innerHTML =
          '<option value="">اختر الطالب</option>' +
          active.map((s) => `
            <option value="${this.escape(String(s.id))}">
              ${this.escape(s.full_name || s.name || `طالب #${s.id}`)}
            </option>
          `).join("");
      }

      const loadStudent = async () => {
        const id = Number(select.value || 0);

        if (!id) {
          area.innerHTML = `
            <div class="empty-state">
              <div class="empty-icon">☾</div>
              <h3>اختر طالبًا</h3>
              <p>سيتم عرض سجل الحفظ والمراجعة والورد.</p>
            </div>
          `;
          return;
        }

        area.innerHTML = `
          <div class="loading-state">
            <div class="loading-spinner"></div>
            <h3>جاري تحميل بيانات الطالب...</h3>
          </div>
        `;

        try {
          const data = await this.apiGet(
            "/api/quran-progress?student_id=" +
            encodeURIComponent(id)
          );

          const rows = Array.isArray(data?.data) ? data.data : [];
          const summary = data?.summary || {};
          const student = active.find((s) => Number(s.id) === id);

          let learningPlanData = null;
          try {
            learningPlanData = await this.apiGet(
              "/api/learning-plan?student_id=" +
              encodeURIComponent(id)
            );
          } catch (_) {
            learningPlanData = null;
          }

          const learningPlan = learningPlanData?.plan || null;
          const learningGoals = Array.isArray(learningPlanData?.goals)
            ? learningPlanData.goals
            : [];
          const learningToday = Array.isArray(learningPlanData?.today)
            ? learningPlanData.today
            : [];
          const learningStats = learningPlanData?.stats || {};

          const planStatus = {
            draft: "مسودة",
            active: "نشطة",
            paused: "متوقفة مؤقتًا",
            completed: "مكتملة",
            cancelled: "ملغاة"
          };

          const goalTypes = {
            memorization: "حفظ جديد",
            review: "مراجعة",
            memorization_review: "حفظ + مراجعة",
            tamkeen: "تمكين وتثبيت",
            cumulative_recitation: "سرد تراكمي",
            tajweed: "تجويد",
            test: "اختبار",
            attendance: "حضور",
            skill: "مهارة",
            custom: "هدف مخصص"
          };

          const goalProgress = (goal) => {
            const target = Number(goal?.target_value);
            const progress = Number(goal?.progress_value || 0);

            if (Number.isFinite(target) && target > 0) {
              return Math.max(
                0,
                Math.min(100, Math.round((progress / target) * 100))
              );
            }

            return goal?.status === "completed" ? 100 : 0;
          };

          const goalTypeLabels = {
            memorization: "حفظ",
            review: "مراجعة",
            memorization_review: "حفظ + مراجعة",
            tamkeen: "تمكين وتثبيت",
            cumulative_recitation: "تسميع تراكمي",
            tajweed: "تجويد",
            test: "اختبار",
            attendance: "حضور",
            skill: "مهارة",
            custom: "هدف مخصص"
          };

          const goalStatusLabels = {
            pending: "لم يبدأ",
            in_progress: "جارٍ",
            completed: "مكتمل",
            skipped: "متجاوز",
            cancelled: "ملغى"
          };

          const learningGoalsHtml = learningGoals.length
            ? `
              <div style="display:grid;gap:12px;margin-top:14px;">
                ${learningGoals.map((goal) => {
                  const progress = Number(goal?.progress_value || 0);
                  const target = Number(goal?.target_value);
                  const percent = goalProgress(goal);

                  const targetText =
                    Number.isFinite(target) && target > 0
                      ? `${progress} / ${target}`
                      : String(progress);

                  const canEdit =
                    this.user?.role === "student"
                      ? Number(this.user?.student_id) === id
                      : true;

                  return `
                    <article
                      class="content-card"
                      style="padding:14px;"
                    >
                      <div style="
                        display:flex;
                        justify-content:space-between;
                        gap:12px;
                        align-items:flex-start;
                        flex-wrap:wrap;
                      ">
                        <div style="min-width:0;flex:1;">
                          <div style="
                            display:flex;
                            gap:7px;
                            align-items:center;
                            flex-wrap:wrap;
                            margin-bottom:6px;
                          ">
                            <strong>
                              ${this.escape(goal?.title || "هدف تعليمي")}
                            </strong>

                            <span style="
                              padding:4px 8px;
                              border-radius:999px;
                              background:rgba(120,90,160,.10);
                              font-size:11px;
                            ">
                              ${this.escape(
                                goalTypeLabels[goal?.goal_type] ||
                                goal?.goal_type ||
                                "هدف"
                              )}
                            </span>

                            <span style="
                              padding:4px 8px;
                              border-radius:999px;
                              background:rgba(0,0,0,.05);
                              font-size:11px;
                            ">
                              ${this.escape(
                                goalStatusLabels[goal?.status] ||
                                goal?.status ||
                                "لم يبدأ"
                              )}
                            </span>
                          </div>

                          ${
                            goal?.description
                              ? `
                                <p style="
                                  margin:0 0 7px;
                                  font-size:13px;
                                  opacity:.78;
                                ">
                                  ${this.escape(goal.description)}
                                </p>
                              `
                              : ""
                          }

                          ${
                            goal?.surah_name
                              ? `
                                <div style="
                                  font-size:12px;
                                  opacity:.75;
                                ">
                                  السورة:
                                  ${this.escape(goal.surah_name)}
                                  ${
                                    goal?.from_ayah || goal?.to_ayah
                                      ? `
                                        — الآيات
                                        ${this.escape(
                                          String(goal.from_ayah || "—")
                                        )}
                                        →
                                        ${this.escape(
                                          String(goal.to_ayah || "—")
                                        )}
                                      `
                                      : ""
                                  }
                                </div>
                              `
                              : ""
                          }
                        </div>

                        <strong style="font-size:18px;">
                          ${percent}%
                        </strong>
                      </div>

                      <div style="
                        height:8px;
                        background:rgba(0,0,0,.08);
                        border-radius:999px;
                        overflow:hidden;
                        margin:12px 0;
                      ">
                        <div style="
                          width:${percent}%;
                          height:100%;
                          background:currentColor;
                          border-radius:999px;
                        "></div>
                      </div>

                      <div style="
                        display:flex;
                        justify-content:space-between;
                        gap:8px;
                        flex-wrap:wrap;
                        align-items:center;
                        margin-bottom:10px;
                        font-size:12px;
                      ">
                        <span>
                          الإنجاز:
                          <strong>${this.escape(targetText)}</strong>
                        </span>

                        ${
                          goal?.due_date
                            ? `
                              <span>
                                الموعد:
                                ${this.escape(goal.due_date)}
                              </span>
                            `
                            : ""
                        }
                      </div>

                      ${
                        canEdit && goal?.status !== "completed"
                          ? `
                            <div style="
                              display:flex;
                              gap:8px;
                              flex-wrap:wrap;
                              align-items:center;
                            ">
                              <input
                                class="form-control"
                                type="number"
                                min="0"
                                step="any"
                                value="${this.escape(String(progress))}"
                                ${
                                  Number.isFinite(target) && target > 0
                                    ? `max="${this.escape(String(target))}"`
                                    : ""
                                }
                                data-learning-goal-progress="${this.escape(
                                  String(goal.id)
                                )}"
                                aria-label="مقدار الإنجاز"
                                style="max-width:130px;"
                              />

                              <button
                                type="button"
                                class="btn btn-primary"
                                data-learning-goal-save="${this.escape(
                                  String(goal.id)
                                )}"
                              >
                                حفظ الإنجاز
                              </button>

                              <button
                                type="button"
                                class="btn btn-secondary"
                                data-learning-goal-complete="${this.escape(
                                  String(goal.id)
                                )}"
                              >
                                تم الإنجاز
                              </button>
                            </div>
                          `
                          : goal?.status === "completed"
                            ? `
                              <div style="
                                padding:9px 12px;
                                border-radius:10px;
                                background:rgba(46,125,50,.08);
                                font-size:13px;
                              ">
                                ✓ تم إنجاز هذا الهدف
                              </div>
                            `
                            : ""
                      }
                    </article>
                  `;
                }).join("")}
              </div>
            `
            : `
              <div style="
                padding:14px;
                border-radius:12px;
                background:rgba(0,0,0,.04);
                margin-top:12px;
                font-size:13px;
              ">
                لا توجد أهداف تعليمية مضافة حاليًا.
              </div>
            `;

          const quranDateShortcutsStyle = `
            <style>
              .quran-date-shortcuts {
                display:flex;
                flex-wrap:wrap;
                gap:6px;
                margin-top:7px;
              }

              .quran-date-shortcuts .secondary-button {
                padding:6px 10px;
                min-height:34px;
                font-size:12px;
              }

              .quran-date-shortcuts button {
                cursor:pointer;
              }
            </style>
          `;

          const quranManagementHtml = canManageQuran
            ? `
              ${quranDateShortcutsStyle}
              <section class="content-card" style="margin-bottom:16px;">
                <div class="section-heading">
                  <div>
                    <span class="eyebrow">إدارة التعلم</span>
                    <h4>إعداد الخطة والمتابعة القرآنية</h4>
                    <p>
                      إنشاء خطة تعليمية أو تسجيل إنجاز قرآني للطالب المحدد.
                    </p>
                  </div>
                </div>

                <div style="
                  display:grid;
                  grid-template-columns:repeat(auto-fit,minmax(280px,1fr));
                  gap:16px;
                ">

                  <form id="quran-create-plan-form" style="
                    padding:16px;
                    border:1px solid rgba(0,0,0,.08);
                    border-radius:16px;
                  ">
                    <strong>خطة تعليمية جديدة</strong>

                    <label style="display:block;margin-top:12px">
                      <span>عنوان الخطة</span>
                      <input
                        name="title"
                        required
                        placeholder="مثال: خطة حفظ ومراجعة سورة البقرة"
                        style="width:100%;padding:11px;margin-top:6px"
                      >
                    </label>

                    <label style="display:block;margin-top:12px">
                      <span>الهدف العام</span>
                      <textarea
                        name="goal"
                        rows="3"
                        placeholder="الهدف من الخطة..."
                        style="width:100%;padding:11px;margin-top:6px;resize:vertical"
                      ></textarea>
                    </label>

                    <div style="
                      display:grid;
                      grid-template-columns:1fr 1fr;
                      gap:10px;
                      margin-top:12px;
                    ">
                      <label>
                        <span>تاريخ البداية</span>
                        <input
                          type="date"
                          name="start_date"
                          id="quran-plan-start-date"
                          required
                          value="${this.escape(new Date().toISOString().slice(0,10))}"
                          style="width:100%;padding:11px;margin-top:6px"
                        >
                        <div class="quran-date-shortcuts">
                          <button type="button" class="secondary-button quran-date-start-today">اليوم</button>
                        </div>
                      </label>

                      <label>
                        <span>النهاية المستهدفة</span>
                        <input
                          type="date"
                          name="target_end_date"
                          id="quran-plan-end-date"
                          style="width:100%;padding:11px;margin-top:6px"
                        >
                        <div class="quran-date-shortcuts">
                          <button type="button" class="secondary-button quran-date-end-30">30 يوم</button>
                          <button type="button" class="secondary-button quran-date-end-90">3 أشهر</button>
                          <button type="button" class="secondary-button quran-date-end-year">نهاية العام</button>
                        </div>
                      </label>
                    </div>

                    <label style="display:block;margin-top:12px">
                      <span>حالة الخطة</span>
                      <select
                        name="status"
                        style="width:100%;padding:11px;margin-top:6px"
                      >
                        <option value="draft">مسودة</option>
                        <option value="active" selected>نشطة</option>
                        <option value="paused">متوقفة مؤقتًا</option>
                      </select>
                    </label>

                    <button
                      type="submit"
                      class="primary-button"
                      style="margin-top:14px;width:100%"
                    >
                      إنشاء الخطة
                    </button>
                  </form>

                  <form id="quran-record-progress-form" style="
                    padding:16px;
                    border:1px solid rgba(0,0,0,.08);
                    border-radius:16px;
                  ">
                    <strong>تسجيل متابعة قرآنية</strong>

                    <label style="display:block;margin-top:12px">
                      <span>نوع النشاط</span>
                      <select
                        name="activity_type"
                        required
                        style="width:100%;padding:11px;margin-top:6px"
                      >
                        <option value="new_memorization">حفظ جديد</option>
                        <option value="review">مراجعة</option>
                        <option value="memorization_review">حفظ + مراجعة</option>
                        <option value="tamkeen">تمكين وتثبيت</option>
                        <option value="cumulative_recitation">تسميع تراكمي</option>
                      </select>
                    </label>

                    <label style="display:block;margin-top:12px">
                      <span>السورة</span>
                      <input
                        name="surah_name"
                        placeholder="مثال: البقرة"
                        style="width:100%;padding:11px;margin-top:6px"
                      >
                    </label>

                    <div style="
                      display:grid;
                      grid-template-columns:1fr 1fr;
                      gap:10px;
                      margin-top:12px;
                    ">
                      <label>
                        <span>رقم السورة</span>
                        <input
                          type="number"
                          name="surah_number"
                          min="1"
                          max="114"
                          required
                          style="width:100%;padding:11px;margin-top:6px"
                        >
                      </label>

                      <label>
                        <span>الكمية / الوصف</span>
                        <input
                          name="amount_label"
                          placeholder="ربع حزب / صفحة..."
                          style="width:100%;padding:11px;margin-top:6px"
                        >
                      </label>
                    </div>

                    <div style="
                      display:grid;
                      grid-template-columns:1fr 1fr;
                      gap:10px;
                      margin-top:12px;
                    ">
                      <label>
                        <span>من آية</span>
                        <input
                          type="number"
                          name="from_ayah"
                          min="1"
                          style="width:100%;padding:11px;margin-top:6px"
                        >
                      </label>

                      <label>
                        <span>إلى آية</span>
                        <input
                          type="number"
                          name="to_ayah"
                          min="1"
                          style="width:100%;padding:11px;margin-top:6px"
                        >
                      </label>
                    </div>

                    <label style="display:block;margin-top:12px">
                      <span>درجة الجودة</span>
                      <input
                        type="number"
                        name="quality_score"
                        min="0"
                        max="100"
                        placeholder="من 100"
                        style="width:100%;padding:11px;margin-top:6px"
                      >
                    </label>

                    <label style="display:block;margin-top:12px">
                      <span>ملاحظة المعلم</span>
                      <textarea
                        name="teacher_note"
                        rows="2"
                        style="width:100%;padding:11px;margin-top:6px;resize:vertical"
                      ></textarea>
                    </label>

                    <button
                      type="submit"
                      class="primary-button"
                      style="margin-top:14px;width:100%"
                    >
                      تسجيل المتابعة
                    </button>
                  </form>

                  <form id="quran-create-goal-form" style="
                    padding:16px;
                    border:1px solid rgba(0,0,0,.08);
                    border-radius:16px;
                  ">
                    <strong>إضافة هدف للخطة</strong>

                    ${
                      learningPlan
                        ? `
                          <label style="display:block;margin-top:12px">
                            <span>نوع الهدف</span>
                            <select
                              name="goal_type"
                              required
                              style="width:100%;padding:11px;margin-top:6px"
                            >
                              <option value="memorization">حفظ</option>
                              <option value="review">مراجعة</option>
                              <option value="memorization_review">حفظ + مراجعة</option>
                              <option value="tamkeen">تمكين وتثبيت</option>
                              <option value="cumulative_recitation">تسميع تراكمي</option>
                              <option value="tajweed">تجويد</option>
                              <option value="test">اختبار</option>
                              <option value="attendance">حضور</option>
                              <option value="skill">مهارة</option>
                              <option value="custom">هدف مخصص</option>
                            </select>
                          </label>

                          <label style="display:block;margin-top:12px">
                            <span>عنوان الهدف</span>
                            <input
                              name="title"
                              required
                              placeholder="مثال: حفظ ربع من سورة البقرة"
                              style="width:100%;padding:11px;margin-top:6px"
                            >
                          </label>

                          <div style="
                            display:grid;
                            grid-template-columns:1fr 1fr;
                            gap:10px;
                            margin-top:12px;
                          ">
                            <label>
                              <span>القيمة المستهدفة</span>
                              <input
                                type="number"
                                name="target_value"
                                min="0"
                                step="0.01"
                                style="width:100%;padding:11px;margin-top:6px"
                              >
                            </label>

                            <label>
                              <span>وحدة القياس</span>
                              <input
                                name="target_unit"
                                placeholder="آية / صفحة / حزب"
                                style="width:100%;padding:11px;margin-top:6px"
                              >
                            </label>
                          </div>

                          <label style="display:block;margin-top:12px">
                            <span>تاريخ الاستحقاق</span>
                            <input
                              type="date"
                              name="due_date"
                              id="quran-goal-due-date"
                              style="width:100%;padding:11px;margin-top:6px"
                            >
                            <div class="quran-date-shortcuts">
                              <button type="button" class="secondary-button quran-goal-due-today">اليوم</button>
                              <button type="button" class="secondary-button quran-goal-due-7">7 أيام</button>
                              <button type="button" class="secondary-button quran-goal-due-30">30 يوم</button>
                            </div>
                          </label>

                          <label style="display:block;margin-top:12px">
                            <span>ملاحظات</span>
                            <textarea
                              name="notes"
                              rows="2"
                              style="width:100%;padding:11px;margin-top:6px;resize:vertical"
                            ></textarea>
                          </label>

                          <button
                            type="submit"
                            class="primary-button"
                            style="margin-top:14px;width:100%"
                          >
                            إضافة الهدف
                          </button>
                        `
                        : `
                          <div style="
                            margin-top:14px;
                            padding:14px;
                            border-radius:12px;
                            background:rgba(0,0,0,.04);
                            font-size:13px;
                          ">
                            أنشئ الخطة التعليمية أولًا، ثم أضف أهدافها.
                          </div>
                        `
                    }
                  </form>

                </div>
              </section>
            `
            : "";

          const learningPlanHtml = `
            <section class="content-card" style="margin-bottom:16px;">
              <div class="section-heading">
                <div>
                  <span class="eyebrow">خطتي التعليمية</span>
                  <h3>
                    ${this.escape(
                      learningPlan?.title || "الخطة التعليمية"
                    )}
                  </h3>
                  <p>
                    ${
                      learningPlan
                        ? this.escape(
                            learningPlan.goal ||
                            "متابعة أهداف الطالب التعليمية."
                          )
                        : "لا توجد خطة تعليمية مضافة لهذا الطالب حاليًا."
                    }
                  </p>
                </div>

                ${
                  learningPlan
                    ? `
                      <span style="
                        padding:6px 10px;
                        border-radius:999px;
                        background:rgba(120,90,160,.10);
                        font-size:12px;
                      ">
                        ${this.escape(
                          planStatus[learningPlan.status] ||
                          learningPlan.status ||
                          "—"
                        )}
                      </span>
                    `
                    : ""
                }
              </div>

              ${
                learningPlan
                  ? `
                    <div class="reports-grid">
                      <article class="report-card">
                        <div class="report-card-icon">🎯</div>
                        <div class="report-card-body">
                          <span class="report-card-label">إنجاز الخطة</span>
                          <strong class="report-card-value">
                            ${Number(learningStats.progress_percent || 0)}%
                          </strong>
                        </div>
                      </article>

                      <article class="report-card">
                        <div class="report-card-icon">✓</div>
                        <div class="report-card-body">
                          <span class="report-card-label">الأهداف المكتملة</span>
                          <strong class="report-card-value">
                            ${Number(learningStats.completed_goals || 0)}
                            /
                            ${Number(learningStats.total_goals || 0)}
                          </strong>
                        </div>
                      </article>

                      <article class="report-card">
                        <div class="report-card-icon">◷</div>
                        <div class="report-card-body">
                          <span class="report-card-label">قيد التنفيذ</span>
                          <strong class="report-card-value">
                            ${Number(learningStats.in_progress_goals || 0)}
                          </strong>
                        </div>
                      </article>

                      <article class="report-card">
                        <div class="report-card-icon">📅</div>
                        <div class="report-card-body">
                          <span class="report-card-label">مدة الخطة</span>
                          <strong class="report-card-value" style="font-size:13px;">
                            ${this.escape(
                              learningPlan.start_date ||
                              "—"
                            )}
                            ${
                              learningPlan.target_end_date
                                ? " → " + this.escape(learningPlan.target_end_date)
                                : ""
                            }
                          </strong>
                        </div>
                      </article>
                    </div>

                    <div style="margin-top:16px;">
                      <div style="
                        display:flex;
                        justify-content:space-between;
                        margin-bottom:7px;
                        font-size:13px;
                      ">
                        <span>التقدم الكلي</span>
                        <strong>
                          ${Number(learningStats.progress_percent || 0)}%
                        </strong>
                      </div>

                      <div style="
                        height:10px;
                        border-radius:999px;
                        background:rgba(0,0,0,.08);
                        overflow:hidden;
                      ">
                        <div style="
                          width:${Math.max(
                            0,
                            Math.min(
                              100,
                              Number(learningStats.progress_percent || 0)
                            )
                          )}%;
                          height:100%;
                          border-radius:999px;
                          background:currentColor;
                          opacity:.75;
                        "></div>
                      </div>
                    </div>

                    ${
                      learningPlan.path_name || learningPlan.level_name
                        ? `
                          <div style="
                            display:flex;
                            flex-wrap:wrap;
                            gap:8px;
                            margin-top:16px;
                          ">
                            ${
                              learningPlan.path_name
                                ? `
                                  <span style="
                                    padding:6px 10px;
                                    border-radius:999px;
                                    background:rgba(0,0,0,.05);
                                    font-size:12px;
                                  ">
                                    المسار:
                                    ${this.escape(learningPlan.path_name)}
                                  </span>
                                `
                                : ""
                            }

                            ${
                              learningPlan.level_name
                                ? `
                                  <span style="
                                    padding:6px 10px;
                                    border-radius:999px;
                                    background:rgba(0,0,0,.05);
                                    font-size:12px;
                                  ">
                                    المستوى:
                                    ${this.escape(learningPlan.level_name)}
                                  </span>
                                `
                                : ""
                            }
                          </div>
                        `
                        : ""
                    }
                  `
                  : `
                    <div class="empty-state" style="margin-top:8px;">
                      <div class="empty-icon">🎯</div>
                      <h4>لا توجد خطة تعليمية بعد</h4>
                      <p>
                        يمكن للإدارة أو المعلم المخول إنشاء خطة تعليمية لهذا الطالب.
                      </p>
                    </div>
                  `
              }

              ${
                learningToday.length
                  ? `
                    <div style="margin-top:18px;">
                      <div class="section-heading">
                        <div>
                          <span class="eyebrow">مطلوب اليوم</span>
                          <h4>أهداف اليوم</h4>
                        </div>
                        <strong>${learningToday.length}</strong>
                      </div>

                      <div style="
                        display:grid;
                        grid-template-columns:repeat(auto-fit,minmax(220px,1fr));
                        gap:12px;
                      ">
                        ${learningToday.map((goal) => `
                          <article style="
                            padding:14px;
                            border-radius:14px;
                            background:rgba(120,90,160,.07);
                          ">
                            <strong>
                              ${this.escape(
                                goal.title ||
                                goalTypes[goal.goal_type] ||
                                "هدف"
                              )}
                            </strong>

                            <div style="
                              margin-top:5px;
                              font-size:12px;
                              opacity:.75;
                            ">
                              ${this.escape(
                                goalTypes[goal.goal_type] ||
                                goal.goal_type ||
                                "هدف"
                              )}
                            </div>

                            <div style="
                              margin-top:10px;
                              font-size:13px;
                            ">
                              الإنجاز ${goalProgress(goal)}%
                            </div>
                          </article>
                        `).join("")}
                      </div>
                    </div>
                  `
                  : ""
              }

              ${
                learningGoals.length
                  ? `
                    <div style="margin-top:18px;">
                      <div class="section-heading">
                        <div>
                          <span class="eyebrow">أهداف الخطة</span>
                          <h4>مسار التعلم</h4>
                        </div>
                      </div>

                      <div style="
                        display:grid;
                        grid-template-columns:repeat(auto-fit,minmax(240px,1fr));
                        gap:12px;
                      ">
                        ${learningGoals.map((goal) => {
                          const p = goalProgress(goal);

                          return `
                            <article style="
                              padding:14px;
                              border:1px solid rgba(0,0,0,.08);
                              border-radius:14px;
                            ">
                              <strong>
                                ${this.escape(
                                  goal.title ||
                                  goalTypes[goal.goal_type] ||
                                  "هدف"
                                )}
                              </strong>

                              <div style="
                                margin-top:5px;
                                font-size:12px;
                                opacity:.75;
                              ">
                                ${this.escape(
                                  goalTypes[goal.goal_type] ||
                                  goal.goal_type ||
                                  "هدف"
                                )}
                              </div>

                              <div style="
                                margin-top:10px;
                                height:8px;
                                border-radius:999px;
                                background:rgba(0,0,0,.08);
                                overflow:hidden;
                              ">
                                <div style="
                                  width:${p}%;
                                  height:100%;
                                  border-radius:999px;
                                  background:currentColor;
                                  opacity:.75;
                                "></div>
                              </div>

                              <div style="
                                margin-top:7px;
                                font-size:12px;
                              ">
                                الإنجاز ${p}%
                              </div>
                            </article>
                          `;
                        }).join("")}
                      </div>
                    </div>
                  `
                  : ""
              }
            </section>
          `;

          let wirdData = null;
          try {
            wirdData = await this.apiGet("/api/wird");
          } catch (_) {
            wirdData = null;
          }

          const weeklyWirds =
            Array.isArray(wirdData?.wirds)
              ? wirdData.wirds
              : [];

          const dailyTasks =
            Array.isArray(wirdData?.tasks)
              ? wirdData.tasks
              : [];

          const wirdHtml = `
            <section class="content-card" style="margin-bottom:16px;">
              <div class="section-heading">
                <div>
                  <span class="eyebrow">الورد</span>
                  <h4>الورد الأسبوعي والمهام اليومية</h4>
                </div>
              </div>

              ${
                weeklyWirds.length
                  ? weeklyWirds.slice(0, 5).map((wird) => `
                      <div style="padding:10px 0;border-bottom:1px solid #ddd;">
                        <strong>
                          ${this.escape(
                            wird.title ||
                            wird.surah_name ||
                            "ورد أسبوعي"
                          )}
                        </strong>

                        ${
                          wird.amount_label
                            ? `<p>${this.escape(wird.amount_label)}</p>`
                            : ""
                        }

                        ${
                          wird.from_ayah &&
                          wird.to_ayah
                            ? `
                              <p>
                                من الآية
                                ${this.escape(String(wird.from_ayah))}
                                إلى
                                ${this.escape(String(wird.to_ayah))}
                              </p>
                            `
                            : ""
                        }
                      </div>
                    `).join("")
                  : `
                    <p>لا يوجد ورد أسبوعي ظاهر لهذا الحساب.</p>
                  `
              }

              ${
                dailyTasks.length
                  ? `
                    <div style="margin-top:16px;">
                      <h5>المهام اليومية</h5>

                      ${dailyTasks.slice(0, 10).map((task) => `
                        <div style="padding:8px 0;">
                          <strong>
                            ${this.escape(task.task_date || "—")}
                          </strong>
                          —
                          ${this.escape(task.task_type || "مهمة")}
                          —
                          ${this.escape(task.status || "pending")}
                        </div>
                      `).join("")}
                    </div>
                  `
                  : ""
              }
            </section>
          `;

          const labels = {
            new_memorization: "حفظ جديد",
            review: "مراجعة",
            memorization_review: "حفظ + مراجعة",
            tamkeen: "تمكين وتثبيت",
            cumulative_recitation: "سرد تراكمي"
          };

          area.innerHTML = `
            ${quranManagementHtml}
            ${learningPlanHtml}

            <section class="content-card" style="margin-top:16px;">
              <div class="section-heading">
                <div>
                  <span class="eyebrow">الأهداف التعليمية</span>
                  <h3>إنجاز أهدافي</h3>
                  <p>
                    سجّل مقدار ما أنجزته، وسيتم تحديث نسبة الإنجاز تلقائيًا.
                  </p>
                </div>

                <strong>
                  ${this.escape(
                    String(learningStats.progress_percent ?? 0)
                  )}%
                </strong>
              </div>

              ${learningGoalsHtml}
            </section>

            ${wirdHtml}

            <div class="reports-grid">
              <article class="report-card">
                <div class="report-card-icon">📖</div>
                <div class="report-card-body">
                  <span class="report-card-label">الطالب</span>
                  <strong class="report-card-value">
                    ${this.escape(student?.full_name || student?.name || `طالب #${id}`)}
                  </strong>
                </div>
              </article>

              <article class="report-card">
                <div class="report-card-icon">📚</div>
                <div class="report-card-body">
                  <span class="report-card-label">الأجزاء المحفوظة</span>
                  <strong class="report-card-value">
                    ${this.escape(String(summary.memorized_juz_count ?? 0))}
                  </strong>
                </div>
              </article>

              <article class="report-card">
                <div class="report-card-icon">⭐</div>
                <div class="report-card-body">
                  <span class="report-card-label">النتيجة التراكمية</span>
                  <strong class="report-card-value">
                    ${this.escape(String(summary.cumulative_score ?? 0))}
                  </strong>
                </div>
              </article>

              <article class="report-card">
                <div class="report-card-icon">📝</div>
                <div class="report-card-body">
                  <span class="report-card-label">سجلات المتابعة</span>
                  <strong class="report-card-value">${rows.length}</strong>
                </div>
              </article>
            </div>

            <div class="section-heading" style="margin-top:24px">
              <div>
                <span class="eyebrow">سجل المتابعة</span>
                <h3>الحفظ والمراجعة والسرد</h3>
              </div>
            </div>

            ${
              rows.length
                ? `
                  <div class="table-wrap">
                    <table class="data-table">
                      <thead>
                        <tr>
                          <th>النشاط</th>
                          <th>السورة</th>
                          <th>الآيات</th>
                          <th>المقدار</th>
                          <th>الجودة</th>
                          <th>التاريخ</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${rows.map((row) => `
                          <tr>
                            <td>${this.escape(labels[row.activity_type] || row.activity_type || "—")}</td>
                            <td>${this.escape(row.surah_name || "—")}</td>
                            <td>${this.escape(
                              row.from_ayah || row.to_ayah
                                ? `${row.from_ayah || "—"} → ${row.to_ayah || "—"}`
                                : "—"
                            )}</td>
                            <td>${this.escape(
                              row.amount_label || String(row.amount_value ?? "—")
                            )}</td>
                            <td>${this.escape(
                              row.quality_score == null ? "—" : `${row.quality_score}%`
                            )}</td>
                            <td>${this.escape(row.recorded_at || "—")}</td>
                          </tr>
                        `).join("")}
                      </tbody>
                    </table>
                  </div>
                `
                : `
                  <div class="empty-state">
                    <div class="empty-icon">✦</div>
                    <h3>لا توجد متابعة مسجلة</h3>
                    <p>لم يُسجل للطالب نشاط قرآني حتى الآن.</p>
                  </div>
                `
            }
          `;
        } catch (error) {
          area.innerHTML = `
            <div class="empty-state premium-empty">
              <div class="empty-icon">!</div>
              <h3>تعذر تحميل بيانات الطالب</h3>
              <p>${this.escape(error?.message || "حدث خطأ غير متوقع")}</p>
              <button class="secondary-button" id="quran-retry" type="button">
                إعادة المحاولة
              </button>
            </div>
          `;
          area.querySelector("#quran-retry")?.addEventListener(
            "click",
            loadStudent
          );
        }

        const bindQuranManagementForms = () => {
          if (!canManageQuran) return;

          const formatQuranDate = (date) => {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, "0");
            const day = String(date.getDate()).padStart(2, "0");

            return `${year}-${month}-${day}`;
          };

          const quranAddDays = (date, days) => {
            const result = new Date(date);
            result.setDate(result.getDate() + days);
            return result;
          };

          const quranAddMonths = (date, months) => {
            const result = new Date(date);
            result.setMonth(result.getMonth() + months);
            return result;
          };

          const startDateInput =
            content.querySelector("#quran-plan-start-date");

          const endDateInput =
            content.querySelector("#quran-plan-end-date");

          const goalDueInput =
            content.querySelector("#quran-goal-due-date");

          const syncEndDate = () => {
            if (!startDateInput || !endDateInput) return;

            endDateInput.min = startDateInput.value || "";

            if (
              startDateInput.value &&
              endDateInput.value &&
              endDateInput.value < startDateInput.value
            ) {
              endDateInput.value = startDateInput.value;
            }
          };

          startDateInput?.addEventListener("change", syncEndDate);

          content
            .querySelector(".quran-date-start-today")
            ?.addEventListener("click", () => {
              if (!startDateInput) return;

              startDateInput.value = formatQuranDate(new Date());
              syncEndDate();
            });

          content
            .querySelector(".quran-date-end-30")
            ?.addEventListener("click", () => {
              if (!endDateInput) return;

              const base = startDateInput?.value
                ? new Date(`${startDateInput.value}T12:00:00`)
                : new Date();

              endDateInput.value =
                formatQuranDate(quranAddDays(base, 30));

              syncEndDate();
            });

          content
            .querySelector(".quran-date-end-90")
            ?.addEventListener("click", () => {
              if (!endDateInput) return;

              const base = startDateInput?.value
                ? new Date(`${startDateInput.value}T12:00:00`)
                : new Date();

              endDateInput.value =
                formatQuranDate(quranAddMonths(base, 3));

              syncEndDate();
            });

          content
            .querySelector(".quran-date-end-year")
            ?.addEventListener("click", () => {
              if (!endDateInput) return;

              const base = startDateInput?.value
                ? new Date(`${startDateInput.value}T12:00:00`)
                : new Date();

              endDateInput.value = formatQuranDate(
                new Date(base.getFullYear(), 11, 31)
              );

              syncEndDate();
            });

          content
            .querySelector(".quran-goal-due-today")
            ?.addEventListener("click", () => {
              if (!goalDueInput) return;

              goalDueInput.value =
                formatQuranDate(new Date());
            });

          content
            .querySelector(".quran-goal-due-7")
            ?.addEventListener("click", () => {
              if (!goalDueInput) return;

              goalDueInput.value =
                formatQuranDate(
                  quranAddDays(new Date(), 7)
                );
            });

          content
            .querySelector(".quran-goal-due-30")
            ?.addEventListener("click", () => {
              if (!goalDueInput) return;

              goalDueInput.value =
                formatQuranDate(
                  quranAddDays(new Date(), 30)
                );
            });

          syncEndDate();

          const formNumber = (value) => {
            const text = String(value ?? "").trim();

            if (!text) return null;

            const number = Number(text);

            return Number.isFinite(number)
              ? number
              : null;
          };

          const setBusy = (button, busyText) => {
            if (!button) return () => {};

            const originalText = button.textContent;

            button.disabled = true;
            button.textContent = busyText;

            return () => {
              button.disabled = false;
              button.textContent = originalText;
            };
          };

          // إنشاء خطة تعليمية
          const planForm =
            area.querySelector("#quran-create-plan-form");

          planForm?.addEventListener(
            "submit",
            async (event) => {
              event.preventDefault();

              const form = event.currentTarget;
              const button =
                form.querySelector('button[type="submit"]');

              const fd = new FormData(form);
              const studentId = Number(select.value);

              if (
                !Number.isFinite(studentId) ||
                studentId <= 0
              ) {
                alert("اختر الطالب أولًا.");
                return;
              }

              const title =
                String(fd.get("title") || "").trim();

              const startDate =
                String(fd.get("start_date") || "").trim();

              if (!title || !startDate) {
                alert("أدخل عنوان الخطة وتاريخ البداية.");
                return;
              }

              const restore =
                setBusy(button, "جارٍ إنشاء الخطة...");

              try {
                const result =
                  await this.apiPost(
                    "/api/learning-plan",
                    {
                      action: "create_plan",
                      student_id: studentId,
                      title,
                      goal:
                        String(fd.get("goal") || "").trim(),
                      start_date: startDate,
                      target_end_date:
                        String(
                          fd.get("target_end_date") || ""
                        ).trim() || null,
                      status:
                        String(
                          fd.get("status") || "active"
                        ).trim()
                    }
                  );

                if (!result?.success) {
                  throw new Error(
                    result?.error ||
                    result?.message ||
                    "تعذر إنشاء الخطة."
                  );
                }

                await loadStudent();
              } catch (error) {
                alert(
                  error?.message ||
                  "تعذر إنشاء الخطة."
                );

                restore();
              }
            }
          );

          // إضافة هدف للخطة
          const goalForm =
            area.querySelector("#quran-create-goal-form");

          goalForm?.addEventListener(
            "submit",
            async (event) => {
              event.preventDefault();

              if (!learningPlan?.id) {
                alert("أنشئ الخطة التعليمية أولًا.");
                return;
              }

              const form = event.currentTarget;
              const button =
                form.querySelector('button[type="submit"]');

              const fd = new FormData(form);

              const title =
                String(fd.get("title") || "").trim();

              const goalType =
                String(
                  fd.get("goal_type") || ""
                ).trim();

              if (!title || !goalType) {
                alert("أدخل نوع الهدف وعنوانه.");
                return;
              }

              const restore =
                setBusy(button, "جارٍ إضافة الهدف...");

              try {
                const result =
                  await this.apiPost(
                    "/api/learning-plan",
                    {
                      action: "create_goal",
                      plan_id:
                        Number(learningPlan.id),
                      goal_type: goalType,
                      title,
                      target_value:
                        String(
                          fd.get("target_value") || ""
                        ).trim() || null,
                      target_unit:
                        String(
                          fd.get("target_unit") || ""
                        ).trim(),
                      due_date:
                        String(
                          fd.get("due_date") || ""
                        ).trim() || null,
                      notes:
                        String(
                          fd.get("notes") || ""
                        ).trim()
                    }
                  );

                if (!result?.success) {
                  throw new Error(
                    result?.error ||
                    result?.message ||
                    "تعذر إضافة الهدف."
                  );
                }

                await loadStudent();
              } catch (error) {
                alert(
                  error?.message ||
                  "تعذر إضافة الهدف."
                );

                restore();
              }
            }
          );

          // تسجيل متابعة قرآنية
          const progressForm =
            area.querySelector(
              "#quran-record-progress-form"
            );

          progressForm?.addEventListener(
            "submit",
            async (event) => {
              event.preventDefault();

              const form = event.currentTarget;
              const button =
                form.querySelector('button[type="submit"]');

              const fd = new FormData(form);

              const studentId =
                Number(select.value);

              const activityType =
                String(
                  fd.get("activity_type") || ""
                ).trim();

              const surahNumber =
                formNumber(fd.get("surah_number"));

              if (
                !Number.isFinite(studentId) ||
                studentId <= 0
              ) {
                alert("اختر الطالب أولًا.");
                return;
              }

              if (
                !activityType ||
                !Number.isFinite(surahNumber) ||
                surahNumber < 1 ||
                surahNumber > 114
              ) {
                alert(
                  "أدخل نوع النشاط ورقم السورة بشكل صحيح."
                );
                return;
              }

              const fromAyah =
                formNumber(fd.get("from_ayah"));

              const toAyah =
                formNumber(fd.get("to_ayah"));

              if (
                fromAyah !== null &&
                toAyah !== null &&
                toAyah < fromAyah
              ) {
                alert(
                  "الآية الأخيرة لا يمكن أن تسبق الآية الأولى."
                );
                return;
              }

              const qualityScore =
                formNumber(
                  fd.get("quality_score")
                );

              if (
                qualityScore !== null &&
                (
                  qualityScore < 0 ||
                  qualityScore > 100
                )
              ) {
                alert(
                  "درجة الجودة يجب أن تكون بين 0 و100."
                );
                return;
              }

              const restore =
                setBusy(
                  button,
                  "جارٍ تسجيل المتابعة..."
                );

              try {
                const result =
                  await this.apiPost(
                    "/api/quran-progress",
                    {
                      student_id: studentId,
                      activity_type: activityType,
                      surah_number: surahNumber,
                      surah_name:
                        String(
                          fd.get("surah_name") || ""
                        ).trim() || null,
                      from_ayah: fromAyah,
                      to_ayah: toAyah,
                      amount_label:
                        String(
                          fd.get("amount_label") || ""
                        ).trim() || null,
                      quality_score: qualityScore,
                      teacher_note:
                        String(
                          fd.get("teacher_note") || ""
                        ).trim() || null
                    }
                  );

                if (!result?.success) {
                  throw new Error(
                    result?.error ||
                    result?.message ||
                    "تعذر تسجيل المتابعة."
                  );
                }

                await loadStudent();
              } catch (error) {
                alert(
                  error?.message ||
                  "تعذر تسجيل المتابعة القرآنية."
                );

                restore();
              }
            }
          );
        };

        bindQuranManagementForms();

        area
          .querySelectorAll("[data-learning-goal-save]")
          .forEach((button) => {
            button.addEventListener("click", async () => {
              const goalId = Number(
                button.getAttribute("data-learning-goal-save")
              );

              const input = area.querySelector(
                `[data-learning-goal-progress="${goalId}"]`
              );

              const progressValue = Number(input?.value);

              if (
                !Number.isFinite(progressValue) ||
                progressValue < 0
              ) {
                alert("أدخل قيمة إنجاز صحيحة.");
                return;
              }

              const originalText = button.textContent;

              button.disabled = true;
              button.textContent = "جارٍ الحفظ...";

              try {
                const result = await this.apiPost(
                  "/api/learning-plan",
                  {
                    action: "update_goal_progress",
                    goal_id: goalId,
                    progress_value: progressValue
                  }
                );

                if (!result?.success) {
                  throw new Error(
                    result?.error ||
                    result?.message ||
                    "تعذر حفظ الإنجاز."
                  );
                }

                await loadStudent();
              } catch (error) {
                alert(
                  error?.message ||
                  "تعذر حفظ إنجاز الهدف."
                );

                button.disabled = false;
                button.textContent = originalText;
              }
            });
          });

        area
          .querySelectorAll("[data-learning-goal-complete]")
          .forEach((button) => {
            button.addEventListener("click", async () => {
              const goalId = Number(
                button.getAttribute("data-learning-goal-complete")
              );

              if (!Number.isFinite(goalId) || goalId <= 0) {
                return;
              }

              const originalText = button.textContent;

              button.disabled = true;
              button.textContent = "جارٍ الإكمال...";

              try {
                const result = await this.apiPost(
                  "/api/learning-plan",
                  {
                    action: "complete_goal",
                    goal_id: goalId
                  }
                );

                if (!result?.success) {
                  throw new Error(
                    result?.error ||
                    result?.message ||
                    "تعذر إكمال الهدف."
                  );
                }

                await loadStudent();
              } catch (error) {
                alert(
                  error?.message ||
                  "تعذر إكمال الهدف."
                );

                button.disabled = false;
                button.textContent = originalText;
              }
            });
          });
      };

      select.addEventListener("change", loadStudent);

      if (isStudent) {
        await loadStudent();
      } else if (active.length === 1) {
        select.value = String(active[0].id);
        await loadStudent();
      } else {
        area.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">☾</div>
            <h3>اختر طالبًا</h3>
            <p>اختر الطالب لعرض الحفظ والمراجعة والورد والخطة التعليمية.</p>
          </div>
        `;
      }

      content.querySelector("#quran-refresh")?.addEventListener(
        "click",
        () => this.renderQuranModule(title)
      );

      if (!active.length) {
        area.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">☾</div>
            <h3>لا يوجد طلاب نشطون</h3>
            <p>أضف طالبًا أولًا ثم ارجع إلى القرآن والورد.</p>
          </div>
        `;
      }

    } catch (error) {
      area.innerHTML = `
        <div class="empty-state premium-empty">
          <div class="empty-icon">!</div>
          <h3>تعذر تحميل الطلاب</h3>
          <p>${this.escape(error?.message || "حدث خطأ غير متوقع")}</p>
        </div>
      `;
    }
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

  async apiPost(url, body = {}) {
    const response = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
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

  async apiPatch(url, body = {}) {
    const response = await fetch(url, {
      method: "PATCH",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
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

  async refreshNotificationCount() {
    const badge = this.root.querySelector("#notification-count-badge");
    if (!badge) return;

    try {
      const data = await this.apiGet("/api/notifications?limit=1&unread=1");
      const count = Number(data?.unread_count || 0);

      if (count > 0) {
        badge.textContent = count > 99 ? "99+" : String(count);
        badge.hidden = false;
      } else {
        badge.textContent = "0";
        badge.hidden = true;
      }
    } catch {
      badge.hidden = true;
    }
  }

  async renderPaymentsModule(title) {
    const content = this.root.querySelector("#module-live-content");
    if (!content) return;

    content.innerHTML = [
      "<div class=\"section-heading\">",
      "<div>",
      "<span class=\"eyebrow\">المركز المالي</span>",
      "<h3>" + this.escape(title) + "</h3>",
      "<p>المدفوعات والاشتراكات وكفالة مقاعد الطلاب داخل أكاديمية الأوَّابين.</p>",
      "</div>",
      "<div class=\"hero-actions\">",
      "<button class=\"secondary-button\" id=\"finance-refresh\" type=\"button\">تحديث</button>",
      "<button class=\"primary-button\" id=\"sponsorship-create\" type=\"button\">إنشاء كفالة</button>",
      "</div>",
      "</div>",

      "<div class=\"reports-grid\">",
      "<article class=\"report-card\"><div class=\"report-card-icon\">🤲</div><div class=\"report-card-body\"><span class=\"report-card-label\">عدد الكفالات</span><strong class=\"report-card-value\" id=\"sp-count\">—</strong></div></article>",
      "<article class=\"report-card\"><div class=\"report-card-icon\">💰</div><div class=\"report-card-body\"><span class=\"report-card-label\">المبلغ المموّل</span><strong class=\"report-card-value\" id=\"sp-funded\">—</strong></div></article>",
      "<article class=\"report-card\"><div class=\"report-card-icon\">📌</div><div class=\"report-card-body\"><span class=\"report-card-label\">المبلغ المخصص</span><strong class=\"report-card-value\" id=\"sp-allocated\">—</strong></div></article>",
      "<article class=\"report-card\"><div class=\"report-card-icon\">🌱</div><div class=\"report-card-body\"><span class=\"report-card-label\">المبلغ المتبقي</span><strong class=\"report-card-value\" id=\"sp-remaining\">—</strong></div></article>",
      "</div>",

      "<div id=\"sponsorship-modal\"></div>",

      "<section class=\"content-card\" style=\"margin-top:18px;\">",
      "<div class=\"section-heading\">",
      "<div>",
      "<span class=\"eyebrow\">كفالة الطلاب</span>",
      "<h3>الكفالات</h3>",
      "<p>عرض الكفالات المسجلة ومتابعة الرصيد والتخصيص.</p>",
      "</div>",
      "</div>",
      "<div id=\"sponsorship-list\"><div class=\"loading-state\"><div class=\"loading-spinner\"></div><h3>جاري تحميل الكفالات...</h3></div></div>",
      "</section>"
    ].join("");

    const money = (value) => new Intl.NumberFormat("ar-EG", {
      style: "currency",
      currency: "EGP",
      maximumFractionDigits: 2
    }).format(Number(value || 0));

    const modal = this.root.querySelector("#sponsorship-modal");

    const closeModal = () => {
      if (modal) modal.innerHTML = "";
    };

    const load = async () => {
      const list = this.root.querySelector("#sponsorship-list");
      if (!list) return;

      list.innerHTML =
        "<div class=\"loading-state\"><div class=\"loading-spinner\"></div><h3>جاري تحميل الكفالات...</h3></div>";

      try {
        const result = await this.apiGet("/api/sponsorships");
        const items = Array.isArray(result?.data) ? result.data : [];

        let funded = 0;
        let allocated = 0;
        let remaining = 0;

        for (const item of items) {
          funded += Number(item.funded_amount || 0);
          allocated += Number(item.allocated_amount || 0);
          remaining += Math.max(
            0,
            Number(
              item.available_amount ??
              (Number(item.funded_amount || 0) -
               Number(item.allocated_amount || 0))
            )
          );
        }

        const count = this.root.querySelector("#sp-count");
        const fundedEl = this.root.querySelector("#sp-funded");
        const allocatedEl = this.root.querySelector("#sp-allocated");
        const remainingEl = this.root.querySelector("#sp-remaining");

        if (count) count.textContent = String(items.length);
        if (fundedEl) fundedEl.textContent = money(funded);
        if (allocatedEl) allocatedEl.textContent = money(allocated);
        if (remainingEl) remainingEl.textContent = money(remaining);

        if (!items.length) {
          list.innerHTML =
            "<div class=\"empty-state premium-empty\"><div class=\"empty-icon\">🤲</div><h3>لا توجد كفالات بعد</h3><p>سيظهر هنا سجل الكفالات التي يتم إنشاؤها وإدارتها.</p></div>";
          return;
        }

        const scopeLabels = {
          student: "طالب محدد",
          seats: "مقاعد",
          months: "أشهر",
          level: "مستوى"
        };

        list.innerHTML =
          "<div style=\"overflow-x:auto;\"><table class=\"data-table\"><thead><tr>" +
          "<th>الكفالة</th>" +
          "<th>النطاق</th>" +
          "<th>المموّل</th>" +
          "<th>المخصص</th>" +
          "<th>المتاح</th>" +
          "<th>الحالة</th>" +
          "<th>إجراء</th>" +
          "</tr></thead><tbody>" +

          items.map((item) => {
            const available = Math.max(
              0,
              Number(item.available_amount ??
                (Number(item.funded_amount || 0) -
                 Number(item.allocated_amount || 0)))
            );

            return (
              "<tr>" +
              "<td><strong>" +
              this.escape(item.title || item.sponsor_name || "كفالة") +
              "</strong></td>" +

              "<td>" +
              this.escape(scopeLabels[item.scope_type] || item.scope_type || "—") +
              "</td>" +

              "<td>" +
              this.escape(money(item.funded_amount)) +
              "</td>" +

              "<td>" +
              this.escape(money(item.allocated_amount)) +
              "</td>" +

              "<td>" +
              this.escape(money(available)) +
              "</td>" +

              "<td><span class=\"status-pill\">" +
              this.escape(item.status || "—") +
              "</span></td>" +

              "<td>" +
              "<button class=\"secondary-button sponsorship-fund-btn\" " +
              "data-id=\"" + Number(item.id) + "\" type=\"button\">" +
              "تمويل</button>" +
              "</td>" +

              "</tr>"
            );
          }).join("") +

          "</tbody></table></div>";

        list.querySelectorAll(".sponsorship-fund-btn").forEach((button) => {
          button.addEventListener("click", () => {
            openFundModal(Number(button.dataset.id));
          });
        });

      } catch (error) {
        list.innerHTML =
          "<div class=\"empty-state premium-empty\"><div class=\"empty-icon\">!</div><h3>تعذر تحميل الكفالات</h3><p>" +
          this.escape(error?.message || "حدث خطأ أثناء تحميل الكفالات.") +
          "</p></div>";
      }
    };

    const openCreateModal = () => {
      if (!modal) return;

      modal.innerHTML = `
        <div class="content-card sponsorship-modal-card" style="margin-top:18px;">
          <div class="section-heading">
            <div>
              <span class="eyebrow">كفالة الطلاب</span>
              <h3>إنشاء كفالة جديدة</h3>
            </div>
            <button class="secondary-button" id="sponsorship-close-modal" type="button">
              إغلاق
            </button>
          </div>

          <form id="sponsorship-create-form">
            <div class="form-grid">

              <label>
                اسم الكافل
                <input name="sponsor_name" required>
              </label>

              <label>
                عنوان الكفالة
                <input name="title" placeholder="مثال: كفالة طالب لمدة شهر">
              </label>

              <label>
                نوع الكفالة
                <select name="scope_type" required>
                  <option value="student">طالب محدد</option>
                  <option value="seats">عدد مقاعد</option>
                  <option value="months">عدد أشهر</option>
                  <option value="level">مستوى كامل</option>
                </select>
              </label>

              <label>
                رقم الطالب
                <input name="target_student_id" type="number" min="1">
              </label>

              <label>
                رقم المستوى
                <input name="target_level_id" type="number" min="1">
              </label>

              <label>
                عدد المقاعد
                <input name="allocated_seats" type="number" min="1">
              </label>

              <label>
                عدد الأشهر
                <input name="allocated_months" type="number" min="1">
              </label>

              <label>
                الهاتف
                <input name="sponsor_phone">
              </label>

              <label>
                البريد الإلكتروني
                <input name="sponsor_email" type="email">
              </label>

              <label>
                تاريخ البداية
                <input name="start_date" type="date">
              </label>

              <label>
                تاريخ النهاية
                <input name="end_date" type="date">
              </label>

              <label class="checkbox-field">
                <input name="is_anonymous" type="checkbox">
                كفالة مجهولة للطلاب
              </label>

            </div>

            <label>
              ملاحظات
              <textarea name="notes" rows="3"></textarea>
            </label>

            <div class="section-heading">
              <span></span>
              <button class="primary-button" type="submit">
                إنشاء الكفالة
              </button>
            </div>

            <div id="sponsorship-create-message"></div>
          </form>
        </div>
      `;

      modal.querySelector("#sponsorship-close-modal")
        ?.addEventListener("click", closeModal);

      modal.querySelector("#sponsorship-create-form")
        ?.addEventListener("submit", async (event) => {
          event.preventDefault();

          const form = event.currentTarget;
          const data = Object.fromEntries(new FormData(form).entries());

          data.is_anonymous =
            form.querySelector("[name=is_anonymous]")?.checked === true;

          [
            "target_student_id",
            "target_level_id",
            "allocated_seats",
            "allocated_months"
          ].forEach((key) => {
            if (data[key] === "") delete data[key];
          });

          const message =
            form.querySelector("#sponsorship-create-message");

          try {
            const response = await fetch("/api/sponsorships", {
              method: "POST",
              credentials: "same-origin",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                action: "create",
                ...data
              })
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
              throw new Error(result?.error || "CREATE_FAILED");
            }

            message.innerHTML =
              "<div class=\"quick-strip\">تم إنشاء الكفالة بنجاح.</div>";

            form.reset();

            await load();

          } catch (error) {
            message.innerHTML =
              "<div class=\"quick-strip\">تعذر إنشاء الكفالة: " +
              this.escape(error?.message || "CREATE_FAILED") +
              "</div>";
          }
        });
    };

    const openFundModal = (sponsorshipId) => {
      if (!modal) return;

      modal.innerHTML = `
        <div class="content-card sponsorship-modal-card" style="margin-top:18px;">
          <div class="section-heading">
            <div>
              <span class="eyebrow">كفالة الطلاب</span>
              <h3>تمويل الكفالة #${Number(sponsorshipId)}</h3>
            </div>

            <button class="secondary-button" id="sponsorship-close-fund" type="button">
              إغلاق
            </button>
          </div>

          <form id="sponsorship-fund-form">

            <label>
              مبلغ التمويل
              <input
                name="amount"
                type="number"
                min="0.01"
                step="0.01"
                required
              >
            </label>

            <label>
              رقم عملية الدفع — اختياري
              <input name="payment_id" type="number" min="1">
            </label>

            <label>
              ملاحظات
              <textarea name="notes" rows="3"></textarea>
            </label>

            <button class="primary-button" type="submit">
              تسجيل التمويل
            </button>

            <div id="sponsorship-fund-message"></div>
          </form>
        </div>
      `;

      modal.querySelector("#sponsorship-close-fund")
        ?.addEventListener("click", closeModal);

      modal.querySelector("#sponsorship-fund-form")
        ?.addEventListener("submit", async (event) => {
          event.preventDefault();

          const form = event.currentTarget;
          const data = Object.fromEntries(new FormData(form).entries());

          if (data.payment_id === "") {
            delete data.payment_id;
          }

          const message =
            form.querySelector("#sponsorship-fund-message");

          try {
            const response = await fetch("/api/sponsorships", {
              method: "POST",
              credentials: "same-origin",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                action: "fund",
                sponsorship_id: sponsorshipId,
                ...data
              })
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
              throw new Error(result?.error || "FUNDING_FAILED");
            }

            message.innerHTML =
              "<div class=\"quick-strip\">تم تسجيل التمويل بنجاح.</div>";

            form.reset();

            await load();

          } catch (error) {
            message.innerHTML =
              "<div class=\"quick-strip\">تعذر تسجيل التمويل: " +
              this.escape(error?.message || "FUNDING_FAILED") +
              "</div>";
          }
        });
    };

    this.root.querySelector("#finance-refresh")
      ?.addEventListener("click", load);

    this.root.querySelector("#sponsorship-create")
      ?.addEventListener("click", openCreateModal);

    await load();
  }

  async renderNotificationsModule(title) {
    const content = this.root.querySelector("#module-live-content");
    if (!content) return;

    content.innerHTML = `
      <div class="section-heading">
        <div>
          <span class="eyebrow">مركز التنبيهات</span>
          <h3>${this.escape(title)}</h3>
          <p>تنبيهاتك ورسائلك داخل أكاديمية الأوَّابين.</p>
        </div>

        <div class="hero-actions">
          <button class="secondary-button" id="notifications-refresh" type="button">
            تحديث
          </button>
          <button class="primary-button" id="notifications-mark-all" type="button">
            تحديد الكل كمقروء
          </button>
        </div>
      </div>

      <div id="notifications-summary" class="quick-strip">
        <div>
          <strong>غير المقروء</strong>
          <span id="notifications-unread-count">—</span>
        </div>
        <div>
          <strong>الإشعارات المعروضة</strong>
          <span id="notifications-total-count">—</span>
        </div>
      </div>

      <div id="notifications-list">
        <div class="loading-state">
          <div class="loading-spinner"></div>
          <h3>جاري تحميل الإشعارات...</h3>
        </div>
      </div>
    `;

    const load = async () => {
      const list = this.root.querySelector("#notifications-list");
      const unreadEl = this.root.querySelector("#notifications-unread-count");
      const totalEl = this.root.querySelector("#notifications-total-count");

      if (!list) return;

      list.innerHTML = `
        <div class="loading-state">
          <div class="loading-spinner"></div>
          <h3>جاري تحميل الإشعارات...</h3>
        </div>
      `;

      try {
        const data = await this.apiGet("/api/notifications?limit=100");
        const notifications = Array.isArray(data?.notifications)
          ? data.notifications
          : [];

        const unreadCount = Number(data?.unread_count || 0);

        if (unreadEl) unreadEl.textContent = String(unreadCount);
        if (totalEl) totalEl.textContent = String(notifications.length);

        if (!notifications.length) {
          list.innerHTML = `
            <div class="empty-state premium-empty">
              <div class="empty-icon">🔔</div>
              <h3>لا توجد إشعارات حاليًا</h3>
              <p>ستظهر هنا التنبيهات والرسائل المهمة الخاصة بحسابك.</p>
            </div>
          `;
          await this.refreshNotificationCount();
          return;
        }

        list.innerHTML = `
          <div class="content-card notification-list-card">
            <div class="notification-list">
              ${notifications.map((notification) => {
                const unread = !notification.read_at;

                const priorityLabels = {
                  urgent: "عاجل",
                  high: "مهم",
                  normal: "عادي",
                  low: "منخفض"
                };

                const priority = priorityLabels[notification.priority] || "عادي";

                return `
                  <article
                    class="notification-item ${unread ? "notification-unread" : ""}"
                    data-notification-id="${this.escape(notification.id)}"
                  >
                    <div class="notification-item-icon">
                      ${notification.priority === "urgent" ? "⚠️" : "🔔"}
                    </div>

                    <div class="notification-item-body">
                      <div class="notification-item-header">
                        <div>
                          <h3>${this.escape(notification.title || "تنبيه")}</h3>
                          <span class="status-pill">${this.escape(priority)}</span>
                        </div>

                        ${
                          unread
                            ? `<button
                                class="secondary-button notification-read-button"
                                type="button"
                                data-notification-id="${this.escape(notification.id)}"
                              >تحديد كمقروء</button>`
                            : `<span class="notification-read-label">مقروء</span>`
                        }
                      </div>

                      <p>${this.escape(notification.message || "")}</p>

                      <div class="notification-meta">
                        <span>${this.escape(notification.created_at || "—")}</span>
                        ${
                          notification.source_type
                            ? `<span>${this.escape(notification.source_type)}</span>`
                            : ""
                        }
                      </div>
                    </div>
                  </article>
                `;
              }).join("")}
            </div>
          </div>
        `;

        this.root.querySelectorAll(".notification-read-button").forEach((button) => {
          button.addEventListener("click", async () => {
            const id = Number(button.dataset.notificationId);
            if (!Number.isFinite(id)) return;

            button.disabled = true;
            button.textContent = "جارٍ التحديث...";

            try {
              await this.apiPatch("/api/notifications", { id });
              await load();
            } catch (error) {
              button.disabled = false;
              button.textContent = "تحديد كمقروء";
              alert(error?.message || "تعذر تحديث الإشعار.");
            }
          });
        });

        await this.refreshNotificationCount();
      } catch (error) {
        if (unreadEl) unreadEl.textContent = "—";
        if (totalEl) totalEl.textContent = "—";

        list.innerHTML = `
          <div class="empty-state premium-empty">
            <div class="empty-icon">!</div>
            <h3>تعذر تحميل الإشعارات</h3>
            <p>${this.escape(error?.message || "حدث خطأ أثناء تحميل الإشعارات.")}</p>
            <button class="secondary-button" id="notifications-retry" type="button">
              إعادة المحاولة
            </button>
          </div>
        `;

        this.root.querySelector("#notifications-retry")?.addEventListener("click", load);
      }
    };

    this.root.querySelector("#notifications-refresh")?.addEventListener("click", load);

    this.root.querySelector("#notifications-mark-all")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = "جارٍ التحديث...";

      try {
        await this.apiPatch("/api/notifications", {
          action: "mark_all_read"
        });
        await load();
      } catch (error) {
        alert(error?.message || "تعذر تحديث الإشعارات.");
      } finally {
        button.disabled = false;
        button.textContent = "تحديد الكل كمقروء";
      }
    });

    await load();
  }

  async renderTodayModule(title) {
    const content = this.root.querySelector("#module-live-content");
    if (!content) return;

    content.innerHTML = `
      <div class="section-heading">
        <div>
          <span class="eyebrow">جلسات اليوم</span>
          <h3>${this.escape(title)}</h3>
          <p>الجلسات والمواعيد وتسجيل الطلاب وترتيب التسميع.</p>
        </div>
        <button class="secondary-button" id="today-refresh" type="button">
          تحديث
        </button>
      </div>

      <div id="today-sessions">
        <div class="loading-state">
          <div class="loading-spinner"></div>
          <h3>جاري تحميل جلسات اليوم...</h3>
        </div>
      </div>
    `;

    content.querySelector("#today-refresh")?.addEventListener(
      "click",
      () => this.renderTodayModule(title)
    );

    const area = content.querySelector("#today-sessions");

    try {
      const data = await this.apiGet("/api/sessions");

      const sessions =
        Array.isArray(data?.sessions) ? data.sessions :
        Array.isArray(data?.data) ? data.data :
        Array.isArray(data?.results) ? data.results :
        [];

      if (!sessions.length) {
        area.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">◷</div>
            <h3>لا توجد جلسات</h3>
            <p>لا توجد جلسات ظاهرة حاليًا.</p>
          </div>
        `;
        return;
      }

      area.innerHTML = sessions.map((session) => {
        const id = Number(session.id);

        return `
          <article class="content-card" style="margin-bottom:16px;">
            <div class="section-heading">
              <div>
                <span class="eyebrow">
                  ${this.escape(session.session_type || "جلسة")}
                </span>
                <h3>
                  ${this.escape(
                    session.circle_name ||
                    session.title ||
                    session.student_name ||
                    "جلسة"
                  )}
                </h3>
              </div>

              <span class="status-pill">
                ${this.escape(session.status || "scheduled")}
              </span>
            </div>

            <div class="reports-grid">
              <div>
                <strong>التاريخ</strong>
                <p>${this.escape(session.session_date || "—")}</p>
              </div>

              <div>
                <strong>الوقت</strong>
                <p>
                  ${this.escape(session.start_time || "—")}
                  ${
                    session.end_time
                      ? ` — ${this.escape(session.end_time)}`
                      : ""
                  }
                </p>
              </div>

              ${
                session.teacher_name
                  ? `
                    <div>
                      <strong>المعلم</strong>
                      <p>${this.escape(session.teacher_name)}</p>
                    </div>
                  `
                  : ""
              }
            </div>

            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">
              <button
                type="button"
                class="primary-button"
                data-open-classroom="${id}"
              >
                فتح الفصل الحي
              </button>

              ${
                session.meeting_url
                  ? `
                    <a
                      href="${this.escape(session.meeting_url)}"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="secondary-button"
                    >
                      فتح رابط الجلسة
                    </a>
                  `
                  : ""
              }
            </div>

            <div
              id="today-registration-${id}"
              style="margin-top:16px;"
            >
              <div class="loading-state">
                <h3>جاري تحميل التسجيل...</h3>
              </div>
            </div>
          </article>
        `;
      }).join("");

      for (const session of sessions) {
        const id = Number(session.id);
        if (!Number.isFinite(id)) continue;

        const box = area.querySelector(`#today-registration-${id}`);
        if (!box) continue;

        try {
          const reg = await this.apiGet(
            `/api/session-registration?session_id=${encodeURIComponent(id)}`
          );

          const registrations =
            Array.isArray(reg?.registrations)
              ? reg.registrations
              : [];

          const turns =
            Array.isArray(reg?.turns)
              ? reg.turns
              : [];

          const window = reg?.window || null;
          const isOpen = reg?.registration_open === true;

          const sortedTurns = [...turns].sort(
            (a, b) =>
              Number(a.turn_number || 0) -
              Number(b.turn_number || 0)
          );

          const role = this.user?.role || "";
          const isStudent = role === "student";
          const canManageTurns = ["admin", "supervisor", "teacher"].includes(role);

          const ownRegistration = registrations.find(
            (r) =>
              isStudent &&
              Number(r.student_id) === Number(this.user?.student_id) &&
              r.status === "registered"
          );

          const ownTurn = turns.find(
            (t) =>
              isStudent &&
              Number(t.student_id) === Number(this.user?.student_id)
          );

          box.innerHTML = `
            <div class="content-card">
              <div class="section-heading">
                <div>
                  <span class="eyebrow">تسجيل الجلسة</span>
                  <h4>
                    ${
                      isOpen
                        ? "التسجيل مفتوح"
                        : "التسجيل مغلق"
                    }
                  </h4>
                </div>

                <span class="status-pill">
                  المسجلون: ${registrations.length}
                </span>
              </div>

              ${
                window
                  ? `
                    <p>
                      نافذة التسجيل:
                      ${this.escape(window.opens_at || "—")}
                      —
                      ${this.escape(window.closes_at || "—")}
                    </p>
                  `
                  : ""
              }
              ${
                isStudent
                  ? `
                    <div style="margin-top:14px;">
                      ${
                        ownRegistration
                          ? `
                            <p><strong>حالتك:</strong> مسجل</p>
                            ${
                              ownTurn
                                ? `<p><strong>رقم دورك:</strong> ${this.escape(String(ownTurn.turn_number || "—"))}</p>`
                                : ""
                            }
                            ${
                              isOpen
                                ? `<button type="button" class="secondary-button" data-cancel-registration="${ownRegistration.id}">إلغاء التسجيل</button>`
                                : ""
                            }
                          `
                          : isOpen
                            ? `<button type="button" class="primary-button" data-register-session="${id}">تسجيل اسمي في الجلسة</button>`
                            : `<p>التسجيل مغلق حاليًا.</p>`
                      }
                    </div>
                  `
                  : ""
              }

              ${
                sortedTurns.length
                  ? `
                    <div style="margin-top:16px;">
                      <h4>ترتيب التسميع</h4>
                      <ol>
                        ${sortedTurns.map((turn) => `
                          <li style="margin-bottom:8px;">
                            <strong>
                              ${this.escape(
                                turn.student_name ||
                                `طالب #${turn.student_id || ""}`
                              )}
                            </strong>
                            —
                            ${this.escape(
                              turn.status || "waiting"
                            )}

                            ${
                              canManageTurns
                                ? `
                                  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
                                    ${
                                      turn.status === "waiting"
                                        ? `<button type="button" class="secondary-button" data-turn-action="call_turn" data-turn-id="${turn.id}">استدعاء</button>`
                                        : ""
                                    }

                                    ${
                                      turn.status === "called"
                                        ? `<button type="button" class="secondary-button" data-turn-action="start_turn" data-turn-id="${turn.id}">بدء التسميع</button>`
                                        : ""
                                    }

                                    ${
                                      turn.status === "reciting"
                                        ? `<button type="button" class="primary-button" data-turn-action="complete_turn" data-turn-id="${turn.id}">إنهاء التسميع</button>`
                                        : ""
                                    }

                                    ${
                                      ["waiting","called"].includes(turn.status)
                                        ? `
                                          <button type="button" class="secondary-button" data-turn-action="skip_turn" data-turn-id="${turn.id}">تخطي</button>
                                          <button type="button" class="secondary-button" data-turn-action="absent_turn" data-turn-id="${turn.id}">غياب</button>
                                        `
                                        : ""
                                    }
                                  </div>
                                `
                                : ""
                            }
                          </li>
                        `).join("")}
                      </ol>
                    </div>
                  `
                  : `
                    <p style="margin-top:12px;">
                      لا يوجد ترتيب تسميع حتى الآن.
                    </p>
                  `
              }
            </div>
          `;
        } catch (error) {
          const message = String(error?.message || "");

          if (message.includes("REGISTRATION_WINDOW_NOT_FOUND")) {
            box.innerHTML = `
              <div class="content-card">
                <p>لم تُفتح نافذة التسجيل لهذه الجلسة بعد.</p>
              </div>
            `;
          } else {
            box.innerHTML = `
              <div class="content-card">
                <p>تعذر تحميل بيانات تسجيل الجلسة.</p>
              </div>
            `;
          }
        }
      }
      await this.wireTodaySessionActions(title);
    } catch (error) {
      area.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">!</div>
          <h3>تعذر تحميل جلسات اليوم</h3>
          <p>${this.escape(error?.message || "حدث خطأ غير متوقع")}</p>
        </div>
      `;
    }
  }

  async openLiveClassroom(sessionId) {
    const id = Number(sessionId || 0);

    if (!Number.isInteger(id) || id < 1) {
      throw new Error("SESSION_ID_REQUIRED");
    }

    const { Classroom } = await import("./live/classroom.js");

    if (this.classroom) {
      this.classroom.destroy();
      this.classroom = null;
    }

    const content = this.root.querySelector("#app-content");

    if (!content) {
      throw new Error("APP_CONTENT_NOT_FOUND");
    }

    content.innerHTML = `
      <section class="content-card" style="margin-bottom:16px;">
        <button
          type="button"
          class="secondary-button"
          id="close-live-classroom"
        >
          ← العودة إلى جدول اليوم
        </button>
      </section>

      <div id="live-classroom-root"></div>
    `;

    const classroomRoot =
      content.querySelector("#live-classroom-root");

    if (!classroomRoot) {
      throw new Error("CLASSROOM_ROOT_NOT_FOUND");
    }

    this.classroom = new Classroom({
      root: classroomRoot,
      sessionId: id,
      user: this.user
    });

    content
      .querySelector("#close-live-classroom")
      ?.addEventListener("click", async () => {
        if (this.classroom) {
          this.classroom.destroy();
          this.classroom = null;
        }

        this.active = "today";
        await this.renderModule("today");
      });

    await this.classroom.mount();
  }

  async wireTodaySessionActions(title) {
    const content = this.root.querySelector("#module-live-content");
    if (!content) return;

    const postAction = async (body) => {
      const response = await fetch("/api/session-registration", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify(body)
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || data.success === false) {
        throw new Error(
          data.error ||
          data.message ||
          "تعذر تنفيذ العملية"
        );
      }

      return data;
    };

    content.querySelectorAll("[data-open-classroom]").forEach((button) => {
      button.addEventListener("click", async () => {
        const sessionId = Number(button.dataset.openClassroom || 0);

        if (!Number.isInteger(sessionId) || sessionId < 1) {
          return;
        }

        button.disabled = true;

        try {
          await this.openLiveClassroom(sessionId);
        } catch (error) {
          button.disabled = false;
          alert(
            error?.message ||
            "تعذر فتح الفصل الحي"
          );
        }
      });
    });

    content.querySelectorAll("[data-register-session]").forEach((button) => {
      button.addEventListener("click", async () => {
        const sessionId = button.dataset.registerSession;
        if (!sessionId) return;

        button.disabled = true;

        try {
          await postAction({
            action: "register",
            session_id: Number(sessionId)
          });

          await this.renderTodayModule(title);
        } catch (error) {
          button.disabled = false;
          alert(error?.message || "تعذر تسجيل الاسم");
        }
      });
    });

    content.querySelectorAll("[data-cancel-registration]").forEach((button) => {
      button.addEventListener("click", async () => {
        const registrationId = button.dataset.cancelRegistration;
        if (!registrationId) return;

        if (!confirm("هل تريد إلغاء تسجيلك في هذه الجلسة؟")) {
          return;
        }

        button.disabled = true;

        try {
          await postAction({
            action: "cancel_registration",
            registration_id: Number(registrationId)
          });

          await this.renderTodayModule(title);
        } catch (error) {
          button.disabled = false;
          alert(error?.message || "تعذر إلغاء التسجيل");
        }
      });
    });

    content.querySelectorAll("[data-turn-action]").forEach((button) => {
      button.addEventListener("click", async () => {
        const action = button.dataset.turnAction;
        const turnId = button.dataset.turnId;

        if (!action || !turnId) return;

        const labels = {
          call_turn: "استدعاء الطالب",
          start_turn: "بدء التسميع",
          complete_turn: "إنهاء التسميع",
          skip_turn: "تخطي الدور",
          absent_turn: "تسجيل الغياب"
        };

        const label = labels[action] || "تنفيذ العملية";

        if (
          ["skip_turn", "absent_turn"].includes(action) &&
          !confirm(`هل تريد ${label}؟`)
        ) {
          return;
        }

        button.disabled = true;

        try {
          await postAction({
            action,
            turn_id: Number(turnId)
          });

          await this.renderTodayModule(title);
        } catch (error) {
          button.disabled = false;
          alert(error?.message || `تعذر ${label}`);
        }
      });
    });
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

            <button
              type="button"
              class="primary-button"
              id="schedule-new-session"
            >
              إضافة جلسة
            </button>

            <button
              type="button"
              class="secondary-button"
              id="schedule-new-series"
            >
              إضافة جدول متكرر
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


    const sessionFormContainer = document.createElement("div");
    sessionFormContainer.id = "schedule-session-form-container";
    sessionFormContainer.style.display = "none";
    sessionFormContainer.style.margin = "16px 0";

    content
      .querySelector(".schedule-toolbar")
      ?.insertAdjacentElement(
        "afterend",
        sessionFormContainer
      );

    const closeSessionForm = () => {
      sessionFormContainer.style.display = "none";
      sessionFormContainer.innerHTML = "";
    };

    const openSessionForm = async () => {
      const button =
        content.querySelector("#schedule-new-session");

      if (button) {
        button.disabled = true;
        button.textContent = "جاري التحميل...";
      }

      try {
        const [teachersResult, circlesResult, studentsResult] =
          await Promise.all([
            this.apiGet("/api/teachers"),
            this.apiGet("/api/circles"),
            this.apiGet("/api/students")
          ]);

        const teachers = Array.isArray(teachersResult?.data)
          ? teachersResult.data
          : [];

        const circles = Array.isArray(circlesResult?.data)
          ? circlesResult.data
          : [];

        const students = Array.isArray(studentsResult?.data)
          ? studentsResult.data
          : [];

        const selectedDate =
          dateInput.value ||
          new Date().toLocaleDateString(
            "en-CA",
            { timeZone: "Africa/Cairo" }
          );

        sessionFormContainer.innerHTML = `
          <div class="card">
            <div class="section-heading">
              <div>
                <span class="eyebrow">التشغيل</span>
                <h3>إضافة جلسة جديدة</h3>
              </div>

              <button
                type="button"
                class="secondary-button"
                id="session-form-close"
              >
                إغلاق
              </button>
            </div>

            <form id="schedule-session-form">

              <div style="
                display:grid;
                grid-template-columns:
                  repeat(auto-fit,minmax(220px,1fr));
                gap:12px;
              ">

                <label>
                  <span>الحلقة</span>
                  <select
                    id="new-session-circle"
                    class="form-input"
                  >
                    <option value="">بدون حلقة</option>
                    ${circles.map(c => `
                      <option
                        value="${this.escape(c.id)}"
                        data-teacher-id="${this.escape(c.teacher_id ?? "")}"
                      >
                        ${this.escape(c.name || "حلقة")}
                      </option>
                    `).join("")}
                  </select>
                </label>

                <label>
                  <span>المعلم</span>
                  <select
                    id="new-session-teacher"
                    class="form-input"
                  >
                    <option value="">تلقائي من الحلقة</option>
                    ${teachers.map(t => `
                      <option value="${this.escape(t.id)}">
                        ${this.escape(t.full_name || "معلم")}
                      </option>
                    `).join("")}
                  </select>
                </label>

                <label>
                  <span>الطالب</span>
                  <select
                    id="new-session-student"
                    class="form-input"
                  >
                    <option value="">بدون طالب محدد</option>
                    ${students.map(st => `
                      <option value="${this.escape(st.id)}">
                        ${this.escape(st.full_name || "طالب")}
                      </option>
                    `).join("")}
                  </select>
                </label>

                <label>
                  <span>نوع الجلسة</span>
                  <select
                    id="new-session-type"
                    class="form-input"
                  >
                    <option value="quran">قرآن</option>
                    <option value="noorani">قاعدة نورانية</option>
                    <option value="tafsir">تفسير</option>
                    <option value="fiqh">فقه</option>
                    <option value="hadith">حديث</option>
                    <option value="sirah">سيرة</option>
                    <option value="group">جماعية</option>
                    <option value="individual">فردية</option>
                    <option value="trial">تجريبية</option>
                    <option value="test">اختبار</option>
                    <option value="independent_recitation">
                      تسميع مستقل
                    </option>
                    <option value="scientific">مادة علمية</option>
                  </select>
                </label>

                <label>
                  <span>التاريخ</span>
                  <input
                    id="new-session-date"
                    class="form-input"
                    type="date"
                    value="${this.escape(selectedDate)}"
                    required
                  >
                </label>

                <label>
                  <span>وقت البداية</span>
                  <input
                    id="new-session-start"
                    class="form-input"
                    type="time"
                    required
                  >
                </label>

                <label>
                  <span>وقت النهاية</span>
                  <input
                    id="new-session-end"
                    class="form-input"
                    type="time"
                    required
                  >
                </label>

                <label>
                  <span>منصة الاجتماع</span>
                  <select
                    id="new-session-provider"
                    class="form-input"
                  >
                    <option value="">بدون منصة</option>
                    <option value="zoom">Zoom</option>
                    <option value="teams">
                      Microsoft Teams
                    </option>
                    <option value="other">أخرى</option>
                  </select>
                </label>

                <label>
                  <span>رابط الاجتماع</span>
                  <input
                    id="new-session-url"
                    class="form-input"
                    type="url"
                    placeholder="رابط الاجتماع"
                  >
                </label>

                <label style="grid-column:1/-1;">
                  <span>ملاحظات</span>
                  <textarea
                    id="new-session-notes"
                    class="form-input"
                    rows="2"
                  ></textarea>
                </label>

              </div>

              <div
                id="new-session-error"
                class="error-message"
                style="display:none;margin-top:12px;"
              ></div>

              <div style="
                display:flex;
                gap:10px;
                margin-top:16px;
              ">
                <button
                  type="submit"
                  class="primary-button"
                  id="new-session-submit"
                >
                  إنشاء الجلسة
                </button>

                <button
                  type="button"
                  class="secondary-button"
                  id="new-session-cancel"
                >
                  إلغاء
                </button>
              </div>

            </form>
          </div>
        `;

        sessionFormContainer.style.display = "block";

        const form =
          sessionFormContainer.querySelector(
            "#schedule-session-form"
          );

        const circle =
          sessionFormContainer.querySelector(
            "#new-session-circle"
          );

        const teacher =
          sessionFormContainer.querySelector(
            "#new-session-teacher"
          );

        const provider =
          sessionFormContainer.querySelector(
            "#new-session-provider"
          );

        const url =
          sessionFormContainer.querySelector(
            "#new-session-url"
          );

        const syncTeacher = () => {
          const option =
            circle.options[circle.selectedIndex];

          const teacherId =
            option?.dataset?.teacherId || "";

          teacher.value = teacherId;
        };

        circle.addEventListener(
          "change",
          syncTeacher
        );

        sessionFormContainer
          .querySelector("#session-form-close")
          ?.addEventListener(
            "click",
            closeSessionForm
          );

        sessionFormContainer
          .querySelector("#new-session-cancel")
          ?.addEventListener(
            "click",
            closeSessionForm
          );

        form.addEventListener(
          "submit",
          async event => {
            event.preventDefault();

            const errorBox =
              sessionFormContainer.querySelector(
                "#new-session-error"
              );

            const submit =
              sessionFormContainer.querySelector(
                "#new-session-submit"
              );

            errorBox.style.display = "none";
            submit.disabled = true;
            submit.textContent = "جاري الإنشاء...";

            try {
              const payload = {
                circle_id: circle.value
                  ? Number(circle.value)
                  : null,

                teacher_id: teacher.value
                  ? Number(teacher.value)
                  : null,

                student_id:
                  sessionFormContainer.querySelector(
                    "#new-session-student"
                  )?.value
                    ? Number(
                        sessionFormContainer.querySelector(
                          "#new-session-student"
                        ).value
                      )
                    : null,

                session_type:
                  sessionFormContainer.querySelector(
                    "#new-session-type"
                  ).value,

                session_date:
                  sessionFormContainer.querySelector(
                    "#new-session-date"
                  ).value,

                start_time:
                  sessionFormContainer.querySelector(
                    "#new-session-start"
                  ).value,

                end_time:
                  sessionFormContainer.querySelector(
                    "#new-session-end"
                  ).value,

                meeting_provider:
                  provider.value || null,

                meeting_url:
                  url.value.trim() || null,

                status: "scheduled",

                notes:
                  sessionFormContainer.querySelector(
                    "#new-session-notes"
                  ).value.trim() || null
              };

              if (
                payload.meeting_provider &&
                !payload.meeting_url
              ) {
                throw new Error(
                  "يجب إدخال رابط الاجتماع عند اختيار منصة."
                );
              }

              if (
                !payload.session_date ||
                !payload.start_time ||
                !payload.end_time
              ) {
                throw new Error(
                  "التاريخ ووقت البداية والنهاية مطلوبة."
                );
              }

              await this.apiPost(
                "/api/sessions",
                payload
              );

              alert("تم إنشاء الجلسة بنجاح.");

              closeSessionForm();

              dateInput.value =
                payload.session_date;

              currentView = "day";

              if (viewSelect) {
                viewSelect.value = "day";
              }

              viewButtons.forEach(
                item =>
                  item.classList.toggle(
                    "active",
                    item.dataset.view === "day"
                  )
              );

              await render();

            } catch (errorValue) {
              errorBox.textContent =
                errorValue?.message ||
                "تعذر إنشاء الجلسة.";

              errorBox.style.display = "block";

              submit.disabled = false;
              submit.textContent = "إنشاء الجلسة";
            }
          }
        );

        syncTeacher();

      } catch (errorValue) {
        sessionFormContainer.innerHTML = `
          <div class="error-message">
            ${this.escape(
              errorValue?.message ||
              "تعذر تحميل بيانات نموذج الجلسة."
            )}
          </div>
        `;

        sessionFormContainer.style.display = "block";

      } finally {
        if (button) {
          button.disabled = false;
          button.textContent = "إضافة جلسة";
        }
      }
    };

    content
      .querySelector("#schedule-new-session")
      ?.addEventListener(
        "click",
        openSessionForm
      );

    const openRecurringScheduleForm = async () => {
      const button =
        content.querySelector("#schedule-new-series");

      if (button) {
        button.disabled = true;
        button.textContent = "جاري التحميل...";
      }

      try {
        const [teachersResult, circlesResult, studentsResult] =
          await Promise.all([
            this.apiGet("/api/teachers"),
            this.apiGet("/api/circles"),
            this.apiGet("/api/students")
          ]);

        const teachers =
          Array.isArray(teachersResult?.data)
            ? teachersResult.data
            : [];

        const circles =
          Array.isArray(circlesResult?.data)
            ? circlesResult.data
            : [];

        const students =
          Array.isArray(studentsResult?.data)
            ? studentsResult.data
            : [];

        let box =
          content.querySelector("#schedule-series-form-container");

        if (!box) {
          box = document.createElement("div");
          box.id = "schedule-series-form-container";
          content.appendChild(box);
        }

        const esc = value => this.escape(value);

        box.innerHTML = `
          <div class="card" style="margin-top:16px;">
            <div class="section-heading">
              <div>
                <span class="eyebrow">الجدولة</span>
                <h4>إضافة جدول متكرر</h4>
                <p>
                  إنشاء جدول رسمي وتوليد جلساته تلقائيًا.
                </p>
              </div>
            </div>

            <form id="schedule-series-form">
              <div
                style="
                  display:grid;
                  grid-template-columns:repeat(auto-fit,minmax(220px,1fr));
                  gap:14px;
                "
              >
                <label>
                  <span>عنوان الجدول</span>
                  <input
                    id="series-title"
                    class="form-input"
                    type="text"
                    placeholder="مثال: حلقة نور البيان"
                    required
                  >
                </label>

                <label>
                  <span>الحلقة</span>
                  <select id="series-circle" class="form-input">
                    <option value="">بدون حلقة</option>
                    ${circles.map(row => `
                      <option
                        value="${esc(row.id)}"
                        data-teacher-id="${esc(
                          row.teacher_id ??
                          row.teacherId ??
                          ""
                        )}"
                      >
                        ${esc(
                          row.name ||
                          row.title ||
                          `حلقة #${row.id}`
                        )}
                      </option>
                    `).join("")}
                  </select>
                </label>

                <label>
                  <span>المعلم</span>
                  <select
                    id="series-teacher"
                    class="form-input"
                    required
                  >
                    <option value="">اختر المعلم</option>
                    ${teachers.map(row => `
                      <option value="${esc(row.id)}">
                        ${esc(
                          row.name ||
                          row.full_name ||
                          `معلم #${row.id}`
                        )}
                      </option>
                    `).join("")}
                  </select>
                </label>

                <label>
                  <span>الطالب — اختياري</span>
                  <select
                    id="series-student"
                    class="form-input"
                  >
                    <option value="">بدون طالب محدد</option>
                    ${students.map(row => `
                      <option value="${esc(row.id)}">
                        ${esc(
                          row.name ||
                          row.full_name ||
                          `طالب #${row.id}`
                        )}
                      </option>
                    `).join("")}
                  </select>
                </label>

                <label>
                  <span>نوع الجلسة</span>
                  <select
                    id="series-session-type"
                    class="form-input"
                  >
                    <option value="quran">قرآن</option>
                    <option value="noorani">قاعدة نورانية</option>
                    <option value="tafsir">تفسير</option>
                    <option value="fiqh">فقه</option>
                    <option value="hadith">حديث</option>
                    <option value="sirah">سيرة</option>
                    <option value="group">جماعية</option>
                    <option value="individual">فردية</option>
                    <option value="trial">تجريبية</option>
                    <option value="test">اختبار</option>
                    <option value="independent_recitation">تسميع</option>
                    <option value="scientific">مواد علمية</option>
                  </select>
                </label>

                <label>
                  <span>نوع التكرار</span>
                  <select
                    id="series-recurrence"
                    class="form-input"
                  >
                    <option value="weekly">أسبوعي</option>
                    <option value="biweekly">كل أسبوعين</option>
                    <option value="daily">يومي</option>
                    <option value="monthly">شهري</option>
                    <option value="once">مرة واحدة</option>
                    <option value="custom">مخصص</option>
                  </select>
                </label>

                <label>
                  <span>الفاصل</span>
                  <input
                    id="series-interval"
                    class="form-input"
                    type="number"
                    min="1"
                    value="1"
                    required
                  >
                </label>

                <label>
                  <span>من تاريخ</span>
                  <input
                    id="series-start-date"
                    class="form-input"
                    type="date"
                    required
                  >
                </label>



                <label>
                  <span>وقت البداية</span>
                  <input
                    id="series-start-time"
                    class="form-input"
                    type="time"
                    required
                  >
                </label>

                <label>
                  <span>وقت النهاية</span>
                  <input
                    id="series-end-time"
                    class="form-input"
                    type="time"
                    required
                  >
                </label>

                <div
                  id="series-weekdays"
                  style="grid-column:1/-1;"
                >
                  <span>أيام الأسبوع</span>
                  <div
                    style="
                      display:flex;
                      flex-wrap:wrap;
                      gap:12px;
                      margin-top:8px;
                    "
                  >
                    <label><input type="checkbox" name="series-day" value="0"> الأحد</label>
                    <label><input type="checkbox" name="series-day" value="1"> الإثنين</label>
                    <label><input type="checkbox" name="series-day" value="2"> الثلاثاء</label>
                    <label><input type="checkbox" name="series-day" value="3"> الأربعاء</label>
                    <label><input type="checkbox" name="series-day" value="4"> الخميس</label>
                    <label><input type="checkbox" name="series-day" value="5"> الجمعة</label>
                    <label><input type="checkbox" name="series-day" value="6"> السبت</label>
                  </div>
                </div>

                <label style="grid-column:1/-1;">
                  <span>ملاحظات</span>
                  <textarea
                    id="series-notes"
                    class="form-input"
                    rows="2"
                  ></textarea>
                </label>
              </div>

              <div
                id="series-error"
                style="display:none;margin-top:12px;"
              ></div>

              <div
                id="series-result"
                style="display:none;margin-top:12px;"
              ></div>

              <div
                style="
                  display:flex;
                  gap:10px;
                  margin-top:16px;
                  flex-wrap:wrap;
                "
              >
                <button
                  type="submit"
                  class="primary-button"
                  id="series-submit"
                >
                  إنشاء الجدول وتوليد الجلسات
                </button>

                <button
                  type="button"
                  class="secondary-button"
                  id="series-cancel"
                >
                  إلغاء
                </button>
              </div>
            </form>
          </div>
        `;

        box.style.display = "block";

        const form = box.querySelector("#schedule-series-form");
        const circle = box.querySelector("#series-circle");
        const teacher = box.querySelector("#series-teacher");
        const recurrence = box.querySelector("#series-recurrence");
        const weekdays = box.querySelector("#series-weekdays");
        const startDate = box.querySelector("#series-start-date");

        const errorBox = box.querySelector("#series-error");
        const resultBox = box.querySelector("#series-result");
        const submit = box.querySelector("#series-submit");

        const today =
          new Date().toLocaleDateString(
            "en-CA",
            { timeZone: "Africa/Cairo" }
          );

        startDate.value = today;

        const sync = () => {
          const needsDays =
            ["weekly", "biweekly", "custom"]
              .includes(recurrence.value);

          weekdays.style.display =
            needsDays ? "block" : "none";
        };

        circle.addEventListener("change", () => {
          const option =
            circle.options[circle.selectedIndex];

          const teacherId =
            option?.dataset?.teacherId || "";

          if (teacherId) {
            teacher.value = teacherId;
          }
        });

        recurrence.addEventListener("change", sync);

        box.querySelector("#series-cancel")
          ?.addEventListener("click", () => {
            box.innerHTML = "";
            box.style.display = "none";
          });

        form.addEventListener("submit", async event => {
          event.preventDefault();

          errorBox.style.display = "none";
          resultBox.style.display = "none";
          submit.disabled = true;
          submit.textContent = "جاري الإنشاء...";

          try {
            if (!startDate.value) {
              throw new Error(
                "اختر تاريخ بداية الجدول."
              );
            }

            const selectedDays =
              [...box.querySelectorAll(
                'input[name="series-day"]:checked'
              )].map(item => Number(item.value));

            if (
              ["weekly", "biweekly", "custom"]
                .includes(recurrence.value) &&
              !selectedDays.length
            ) {
              throw new Error(
                "اختر يومًا واحدًا على الأقل."
              );
            }

            const payload = {
              title:
                box.querySelector("#series-title")
                  .value.trim(),

              circle_id:
                circle.value
                  ? Number(circle.value)
                  : null,

              teacher_id:
                teacher.value
                  ? Number(teacher.value)
                  : null,

              student_id:
                box.querySelector("#series-student").value
                  ? Number(
                      box.querySelector("#series-student").value
                    )
                  : null,

              session_type:
                box.querySelector("#series-session-type").value,

              recurrence_type:
                recurrence.value,

              interval_value:
                Math.max(
                  1,
                  Number(
                    box.querySelector("#series-interval").value || 1
                  )
                ),

              start_date:
                startDate.value,

              start_time:
                box.querySelector("#series-start-time").value,

              end_time:
                box.querySelector("#series-end-time").value,

              weekdays:
                selectedDays,

              timezone:
                "Africa/Cairo",

              status:
                "active",

              notes:
                box.querySelector("#series-notes")
                  .value.trim() || null
            };

            const created =
              await this.apiPost(
                "/api/schedule-series",
                payload
              );

            const seriesId =
              created?.data?.id ??
              created?.id ??
              created?.series?.id;

            if (!seriesId) {
              throw new Error(
                "تم إنشاء الجدول لكن لم يتم إرجاع رقم الجدول."
              );
            }

            const generated =
              await this.apiPost(
                "/api/schedule-generate",
                {
                  series_id: Number(seriesId),
                  start_date: startDate.value,
                }
              );

            const count =
              generated?.data?.created?.length ??
              generated?.created?.length ??
              0;

            resultBox.innerHTML = `
              <div class="success-message">
                تم إنشاء الجدول بنجاح.
                تم توليد ${esc(count)} جلسة.
              </div>
            `;

            resultBox.style.display = "block";

            await this.renderScheduleCenter(title);

          } catch (error) {
            errorBox.textContent =
              error?.message ||
              "تعذر إنشاء الجدول.";

            errorBox.style.display = "block";

          } finally {
            submit.disabled = false;
            submit.textContent =
              "إنشاء الجدول وتوليد الجلسات";

            if (button) {
              button.disabled = false;
              button.textContent =
                "إضافة جدول متكرر";
            }
          }
        });

        sync();

      } catch (error) {
        alert(
          error?.message ||
          "تعذر تحميل بيانات الجدولة."
        );

        if (button) {
          button.disabled = false;
          button.textContent =
            "إضافة جدول متكرر";
        }
      }
    };

    content
      .querySelector("#schedule-new-series")
      ?.addEventListener(
        "click",
        openRecurringScheduleForm
      );



    const viewButtons =
      [...content.querySelectorAll("[data-view]")];

    const today =
      new Date().toLocaleDateString(
        "en-CA",
        { timeZone: "Africa/Cairo" }
      );

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

  async renderCirclesModule(title) {
    const content = this.root.querySelector("#module-live-content");
    if (!content) return;

    let circles = [];

    const load = async () => {
      const result = await this.apiGet("/api/circles");
      circles = Array.isArray(result?.data) ? result.data : [];
    };

    const render = () => {
      const typeLabel = {
        individual: "فردية",
        group: "جماعية"
      };

      const statusLabel = {
        active: "نشطة",
        inactive: "غير نشطة",
        full: "مكتملة",
        archived: "مؤرشفة"
      };

      content.innerHTML = `
        <div class="section-heading">
          <div>
            <span class="eyebrow">إدارة الحلقات</span>
            <h3>${this.escape(title)}</h3>
            <p>الحلقات الفردية والجماعية — ${circles.length} سجل</p>
          </div>

          <div style="display:flex;gap:10px;flex-wrap:wrap;">
            <button type="button" class="primary-button" id="circle-new">
              إضافة حلقة
            </button>
            <button type="button" class="secondary-button" id="circle-refresh">
              تحديث
            </button>
          </div>
        </div>

        <div id="circle-form-container"
             style="display:none;margin:16px 0;"></div>

        <div class="table-wrap">
          ${
            circles.length
              ? `
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>الحلقة</th>
                      <th>النوع</th>
                      <th>المعلم</th>
                      <th>السعة</th>
                      <th>المستوى</th>
                      <th>المسار</th>
                      <th>الحالة</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${circles.map(c => `
                      <tr>
                        <td>${this.escape(c.name || "—")}</td>
                        <td>${this.escape(typeLabel[c.circle_type] || c.circle_type || "—")}</td>
                        <td>${this.escape(c.teacher_name || "—")}</td>
                        <td>${this.escape(c.capacity ?? "—")}</td>
                        <td>${this.escape(c.level_name || "—")}</td>
                        <td>${this.escape(c.path_name || "—")}</td>
                        <td>${this.escape(statusLabel[c.status] || c.status || "—")}</td>
                      </tr>
                    `).join("")}
                  </tbody>
                </table>
              `
              : `
                <div class="empty-state">
                  <strong>لا توجد حلقات</strong>
                  <p>ابدئي بإنشاء أول حلقة من زر «إضافة حلقة».</p>
                </div>
              `
          }
        </div>
      `;

      content.querySelector("#circle-refresh")?.addEventListener(
        "click",
        async () => {
          await load();
          render();
        }
      );

      content.querySelector("#circle-new")?.addEventListener(
        "click",
        () => this.openCircleCreationForm(content)
      );
    };

    await load();
    render();
  }

  async openCircleCreationForm(content) {
    const box = content.querySelector("#circle-form-container");
    if (!box) return;

    box.innerHTML = `
      <div class="card">
        <div class="section-heading">
          <div>
            <span class="eyebrow">تشغيل</span>
            <h3>إضافة حلقة جديدة</h3>
          </div>
          <button type="button"
                  class="secondary-button"
                  id="circle-form-close">
            إغلاق
          </button>
        </div>

        <form id="circle-create-form">
          <div style="
            display:grid;
            grid-template-columns:repeat(auto-fit,minmax(220px,1fr));
            gap:12px;
          ">
            <label>
              <span>اسم الحلقة</span>
              <input id="circle-name" class="form-input" required>
            </label>

            <label>
              <span>نوع الحلقة</span>
              <select id="circle-type" class="form-input">
                <option value="group">جماعية</option>
                <option value="individual">فردية</option>
              </select>
            </label>

            <label>
              <span>الباقة</span>
              <select id="circle-package" class="form-input" required>
                <option value="">جاري التحميل...</option>
              </select>
            </label>

            <label>
              <span>المعلم</span>
              <select id="circle-teacher" class="form-input">
                <option value="">بدون تحديد</option>
              </select>
            </label>

            <label>
              <span>السعة</span>
              <input id="circle-capacity"
                     class="form-input"
                     type="number"
                     min="1"
                     value="10">
            </label>

            <label>
              <span>المستوى</span>
              <input id="circle-level" class="form-input">
            </label>

            <label>
              <span>المسار</span>
              <input id="circle-path" class="form-input">
            </label>

            <label style="grid-column:1/-1;">
              <span>ملاحظة الجدول</span>
              <textarea id="circle-schedule-note"
                        class="form-input"
                        rows="2"></textarea>
            </label>
          </div>

          <div id="circle-create-error"
               class="error-message"
               style="display:none;margin-top:12px;"></div>

          <div style="
            display:flex;
            gap:10px;
            margin-top:16px;
          ">
            <button type="submit"
                    class="primary-button"
                    id="circle-create-submit">
              إنشاء الحلقة
            </button>
            <button type="button"
                    class="secondary-button"
                    id="circle-create-cancel">
              إلغاء
            </button>
          </div>
        </form>
      </div>
    `;

    box.style.display = "block";

    const [packagesResult, teachersResult] = await Promise.all([
      this.apiGet("/api/packages"),
      this.apiGet("/api/teachers")
    ]);

    const packages = Array.isArray(packagesResult?.packages)
      ? packagesResult.packages
      : [];

    const teachers = Array.isArray(teachersResult?.data)
      ? teachersResult.data
      : [];

    const packageSelect = box.querySelector("#circle-package");
    const teacherSelect = box.querySelector("#circle-teacher");

    packageSelect.innerHTML = `
      <option value="">اختر الباقة</option>
      ${packages
        .filter(p => p.status === "active")
        .map(p => `
          <option value="${this.escape(p.id)}">
            ${this.escape(p.name)} — ${this.escape(p.price)} ${this.escape(p.currency || "EGP")}
          </option>
        `).join("")}
    `;

    teacherSelect.innerHTML += teachers.map(t => `
      <option value="${this.escape(t.id)}">
        ${this.escape(t.full_name || "معلم")}
      </option>
    `).join("");

    box.querySelector("#circle-form-close")?.addEventListener(
      "click",
      () => {
        box.style.display = "none";
        box.innerHTML = "";
      }
    );

    box.querySelector("#circle-create-cancel")?.addEventListener(
      "click",
      () => {
        box.style.display = "none";
        box.innerHTML = "";
      }
    );

    box.querySelector("#circle-create-form")?.addEventListener(
      "submit",
      async event => {
        event.preventDefault();

        const error = box.querySelector("#circle-create-error");
        const submit = box.querySelector("#circle-create-submit");

        error.style.display = "none";
        submit.disabled = true;
        submit.textContent = "جاري الإنشاء...";

        try {
          const type = box.querySelector("#circle-type").value;

          await this.apiPost("/api/circles", {
            name: box.querySelector("#circle-name").value.trim(),
            circle_type: type,
            package_id: Number(packageSelect.value),
            teacher_id: teacherSelect.value
              ? Number(teacherSelect.value)
              : null,
            capacity: type === "individual"
              ? 1
              : Number(box.querySelector("#circle-capacity").value),
            level_name: box.querySelector("#circle-level").value.trim() || null,
            path_name: box.querySelector("#circle-path").value.trim() || null,
            schedule_note:
              box.querySelector("#circle-schedule-note").value.trim() || null,
            status: "active"
          });

          alert("تم إنشاء الحلقة بنجاح.");

          const refresh = content.querySelector("#circle-refresh");
          refresh?.click();
        } catch (errorValue) {
          error.textContent =
            errorValue?.message || "تعذر إنشاء الحلقة.";
          error.style.display = "block";
          submit.disabled = false;
          submit.textContent = "إنشاء الحلقة";
        }
      }
    );
  }

  async renderStudentsModule(title) {
    const content = this.root.querySelector("#module-live-content");
    if (!content) return;

    let students = [];

    const loadStudents = async (search = "", status = "") => {
      const params = new URLSearchParams();

      if (search.trim()) {
        params.set("search", search.trim());
      }

      if (status) {
        params.set("status", status);
      }

      const query = params.toString();
      const result = await this.apiGet(
        `/api/students${query ? `?${query}` : ""}`
      );

      return Array.isArray(result?.data)
        ? result.data
        : [];
    };

    const statusLabels = {
      active: "نشط",
      inactive: "غير نشط",
      suspended: "موقوف",
      graduated: "متخرج",
      deleted: "محذوف"
    };

    const render = () => {
      content.innerHTML = `
        <div class="section-heading">
          <div>
            <span class="eyebrow">إدارة الطلاب</span>
            <h3>${this.escape(title)}</h3>
            <p>
              إدارة ملفات الطلاب والبيانات الأساسية والحالة.
              <strong>عدد السجلات: ${students.length}</strong>
            </p>
          </div>

          <button
            class="primary-button"
            type="button"
            id="student-new"
          >
            إضافة طالب
          </button>
        </div>

        <div class="card">
          <div style="display:grid;grid-template-columns:minmax(0,1fr) 180px auto;gap:10px;align-items:end;">
            <div>
              <label for="student-search">بحث</label>
              <input
                id="student-search"
                class="form-input"
                type="search"
                placeholder="الاسم أو الكود أو الهاتف..."
                autocomplete="off"
              >
            </div>

            <div>
              <label for="student-status-filter">الحالة</label>
              <select
                id="student-status-filter"
                class="form-input"
              >
                <option value="">كل الحالات</option>
                <option value="active">نشط</option>
                <option value="inactive">غير نشط</option>
                <option value="suspended">موقوف</option>
                <option value="graduated">متخرج</option>
                <option value="deleted">محذوف</option>
              </select>
            </div>

            <button
              class="secondary-button"
              type="button"
              id="student-search-button"
            >
              بحث
            </button>
          </div>
        </div>

        <div id="student-form-container" style="display:none;"></div>

        <div class="table-wrap">
          ${
            students.length
              ? `
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>الاسم</th>
                      <th>الكود</th>
                      <th>الهاتف</th>
                      <th>ولي الأمر</th>
                      <th>المستوى</th>
                      <th>الحالة</th>
                      <th>إجراء</th>
                    </tr>
                  </thead>

                  <tbody>
                    ${students.map((student) => `
                      <tr>
                        <td>${this.escape(student.full_name || "—")}</td>
                        <td>${this.escape(student.student_code || "—")}</td>
                        <td>${this.escape(student.phone || "—")}</td>
                        <td>${this.escape(student.guardian_name || "—")}</td>
                        <td>${this.escape(student.educational_level || "—")}</td>
                        <td>
                          <span class="status-pill">
                            ${this.escape(
                              statusLabels[student.status] ||
                              student.status ||
                              "—"
                            )}
                          </span>
                        </td>
                        <td>
                          <button
                            class="secondary-button"
                            type="button"
                            data-student-edit="${Number(student.id)}"
                          >
                            تعديل
                          </button>
                        </td>
                      </tr>
                    `).join("")}
                  </tbody>
                </table>
              `
              : `
                <div class="empty-state">
                  <div class="empty-icon">✦</div>
                  <h3>لا توجد بيانات</h3>
                  <p>لا توجد سجلات طلاب مطابقة للبحث الحالي.</p>
                </div>
              `
          }
        </div>
      `;

      const searchInput =
        this.root.querySelector("#student-search");

      const statusFilter =
        this.root.querySelector("#student-status-filter");

      const searchButton =
        this.root.querySelector("#student-search-button");

      const newButton =
        this.root.querySelector("#student-new");

      searchButton?.addEventListener("click", async () => {
        try {
          searchButton.disabled = true;
          searchButton.textContent = "جارٍ البحث...";

          students = await loadStudents(
            searchInput?.value || "",
            statusFilter?.value || ""
          );

          render();
        } catch (error) {
          content.innerHTML = `
            <div class="error-message">
              ${this.escape(
                error?.message || "تعذر تحميل الطلاب."
              )}
            </div>
          `;
        }
      });

      searchInput?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          searchButton?.click();
        }
      });

      newButton?.addEventListener("click", () => {
        this.renderStudentForm();
      });

      this.root
        .querySelectorAll("[data-student-edit]")
        .forEach((button) => {
          button.addEventListener("click", () => {
            this.renderStudentForm(
              Number(button.dataset.studentEdit)
            );
          });
        });
    };

    try {
      students = await loadStudents();
      render();
    } catch (error) {
      content.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">!</div>
          <h3>تعذر تحميل الطلاب</h3>
          <p>${this.escape(
            error?.message || "حدث خطأ أثناء تحميل بيانات الطلاب."
          )}</p>
          <button
            class="secondary-button"
            type="button"
            id="students-retry"
          >
            إعادة المحاولة
          </button>
        </div>
      `;

      this.root
        .querySelector("#students-retry")
        ?.addEventListener(
          "click",
          () => this.renderStudentsModule(title)
        );
    }
  }

  async renderStudentForm(studentId = null) {
    const container =
      this.root.querySelector("#student-form-container");

    if (!container) return;

    let student = null;

    if (studentId) {
      try {
        const result = await this.apiGet(
          `/api/students?id=${encodeURIComponent(studentId)}`
        );

        student = Array.isArray(result?.data)
          ? result.data[0] || null
          : result?.data || null;

        if (!student) {
          throw new Error("لم يتم العثور على الطالب.");
        }
      } catch (error) {
        alert(error?.message || "تعذر تحميل بيانات الطالب.");
        return;
      }
    }

    const value = (key) =>
      this.escape(
        student?.[key] ??
        ""
      );

    container.style.display = "block";

    container.innerHTML = `
      <div class="card" style="margin:16px 0;">
        <div class="section-heading">
          <div>
            <span class="eyebrow">
              ${studentId ? "تعديل بيانات الطالب" : "طالب جديد"}
            </span>
            <h3>
              ${studentId ? "تعديل ملف الطالب" : "إضافة طالب"}
            </h3>
            <p>
              أدخل البيانات الأساسية للطالب وبيانات ولي الأمر.
            </p>
          </div>
        </div>

        <form id="student-form" class="student-form">
          <div
            style="
              display:grid;
              grid-template-columns:repeat(auto-fit,minmax(220px,1fr));
              gap:12px;
            "
          >
            <div>
              <label for="student-full-name">اسم الطالب *</label>
              <input
                id="student-full-name"
                class="form-input"
                type="text"
                name="full_name"
                required
                value="${value("full_name")}"
              >
            </div>

            <div>
              <label for="student-code">كود الطالب</label>
              <input
                id="student-code"
                class="form-input"
                type="text"
                name="student_code"
                value="${value("student_code")}"
                placeholder="يُنشأ تلقائيًا إذا تُرك فارغًا"
              >
            </div>

            <div>
              <label for="student-phone">هاتف الطالب</label>
              <input
                id="student-phone"
                class="form-input"
                type="tel"
                name="phone"
                value="${value("phone")}"
              >
            </div>

            <div>
              <label for="student-email">البريد الإلكتروني</label>
              <input
                id="student-email"
                class="form-input"
                type="email"
                name="email"
                value="${value("email")}"
              >
            </div>

            <div>
              <label for="student-gender">النوع</label>
              <select
                id="student-gender"
                class="form-input"
                name="gender"
              >
                <option value="">غير محدد</option>
                <option value="male" ${student?.gender === "male" ? "selected" : ""}>
                  ذكر
                </option>
                <option value="female" ${student?.gender === "female" ? "selected" : ""}>
                  أنثى
                </option>
              </select>
            </div>

            <div>
              <label for="student-birth-date">تاريخ الميلاد</label>
              <input
                id="student-birth-date"
                class="form-input"
                type="date"
                name="birth_date"
                value="${value("birth_date")}"
              >
            </div>

            <div>
              <label for="student-guardian-name">اسم ولي الأمر</label>
              <input
                id="student-guardian-name"
                class="form-input"
                type="text"
                name="guardian_name"
                value="${value("guardian_name")}"
              >
            </div>

            <div>
              <label for="student-guardian-phone">هاتف ولي الأمر</label>
              <input
                id="student-guardian-phone"
                class="form-input"
                type="tel"
                name="guardian_phone"
                value="${value("guardian_phone")}"
              >
            </div>

            <div>
              <label for="student-guardian-email">بريد ولي الأمر</label>
              <input
                id="student-guardian-email"
                class="form-input"
                type="email"
                name="guardian_email"
                value="${value("guardian_email")}"
              >
            </div>

            <div>
              <label for="student-country">الدولة</label>
              <input
                id="student-country"
                class="form-input"
                type="text"
                name="country"
                value="${value("country") || "مصر"}"
              >
            </div>

            <div>
              <label for="student-educational-level">المستوى التعليمي</label>
              <input
                id="student-educational-level"
                class="form-input"
                type="text"
                name="educational_level"
                value="${value("educational_level")}"
              >
            </div>

            <div>
              <label for="student-status">الحالة</label>
              <select
                id="student-status"
                class="form-input"
                name="status"
              >
                <option value="active" ${(!student?.status || student?.status === "active") ? "selected" : ""}>
                  نشط
                </option>
                <option value="inactive" ${student?.status === "inactive" ? "selected" : ""}>
                  غير نشط
                </option>
                <option value="suspended" ${student?.status === "suspended" ? "selected" : ""}>
                  موقوف
                </option>
                <option value="graduated" ${student?.status === "graduated" ? "selected" : ""}>
                  متخرج
                </option>
                <option value="deleted" ${student?.status === "deleted" ? "selected" : ""}>
                  محذوف
                </option>
              </select>
            </div>

            <div style="grid-column:1/-1;">
              <label for="student-address">العنوان</label>
              <input
                id="student-address"
                class="form-input"
                type="text"
                name="address"
                value="${value("address")}"
              >
            </div>

            <div style="grid-column:1/-1;">
              <label for="student-notes">ملاحظات</label>
              <textarea
                id="student-notes"
                class="form-input"
                name="notes"
                rows="4"
              >${value("notes")}</textarea>
            </div>
          </div>

          <div
            id="student-form-message"
            style="margin-top:12px;"
          ></div>

          <div
            style="
              display:flex;
              gap:10px;
              margin-top:16px;
              flex-wrap:wrap;
            "
          >
            <button
              class="primary-button"
              type="submit"
              id="student-save"
            >
              ${studentId ? "حفظ التعديلات" : "إضافة الطالب"}
            </button>

            <button
              class="secondary-button"
              type="button"
              id="student-cancel"
            >
              إلغاء
            </button>
          </div>
        </form>
      </div>
    `;

    const form =
      this.root.querySelector("#student-form");

    const saveButton =
      this.root.querySelector("#student-save");

    const cancelButton =
      this.root.querySelector("#student-cancel");

    const message =
      this.root.querySelector("#student-form-message");

    cancelButton?.addEventListener("click", () => {
      container.innerHTML = "";
      container.style.display = "none";
    });

    form?.addEventListener("submit", async (event) => {
      event.preventDefault();

      const formData =
        new FormData(form);

      const body = {
        full_name:
          String(formData.get("full_name") || "").trim(),

        student_code:
          String(formData.get("student_code") || "").trim() || null,

        gender:
          String(formData.get("gender") || "").trim() || null,

        birth_date:
          String(formData.get("birth_date") || "").trim() || null,

        phone:
          String(formData.get("phone") || "").trim() || null,

        email:
          String(formData.get("email") || "").trim() || null,

        guardian_name:
          String(formData.get("guardian_name") || "").trim() || null,

        guardian_phone:
          String(formData.get("guardian_phone") || "").trim() || null,

        guardian_email:
          String(formData.get("guardian_email") || "").trim() || null,

        address:
          String(formData.get("address") || "").trim() || null,

        country:
          String(formData.get("country") || "").trim() || "مصر",

        educational_level:
          String(formData.get("educational_level") || "").trim() || null,

        notes:
          String(formData.get("notes") || "").trim() || null,

        status:
          String(formData.get("status") || "active")
      };

      if (!body.full_name) {
        message.innerHTML = `
          <div class="error-message">
            اسم الطالب مطلوب.
          </div>
        `;
        return;
      }

      saveButton.disabled = true;
      saveButton.textContent = "جارٍ الحفظ...";

      try {
        let response;

        if (studentId) {
          response = await fetch(
            "/api/students",
            {
              method: "PATCH",
              credentials: "include",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json"
              },
              body: JSON.stringify({
                id: Number(studentId),
                ...body
              })
            }
          );
        } else {
          response = await fetch(
            "/api/students",
            {
              method: "POST",
              credentials: "include",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json"
              },
              body: JSON.stringify(body)
            }
          );
        }

        const data =
          await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(
            data?.error ||
            data?.message ||
            "تعذر حفظ بيانات الطالب."
          );
        }

        container.innerHTML = "";
        container.style.display = "none";

        await this.renderStudentsModule(title);
      } catch (error) {
        message.innerHTML = `
          <div class="error-message">
            ${this.escape(
              error?.message ||
              "حدث خطأ أثناء حفظ بيانات الطالب."
            )}
          </div>
        `;

        saveButton.disabled = false;
        saveButton.textContent =
          studentId
            ? "حفظ التعديلات"
            : "إضافة الطالب";
      }
    });
  }

  async renderTeachersModule(title) {
    const content =
      this.root.querySelector("#module-live-content");

    if (!content) return;

    let rows = [];

    const load = async () => {
      const search =
        this.root.querySelector("#teacher-search")?.value?.trim() || "";

      const status =
        this.root.querySelector("#teacher-status-filter")?.value || "";

      const params = new URLSearchParams();

      if (search) params.set("search", search);
      if (status) params.set("status", status);

      const endpoint =
        params.toString()
          ? `/api/teachers?${params.toString()}`
          : "/api/teachers";

      const data = await this.apiGet(endpoint);

      rows = Array.isArray(data?.data)
        ? data.data
        : Array.isArray(data?.results)
          ? data.results
          : [];

      render();
    };

    const statusLabel = (status) => ({
      active: "نشط",
      inactive: "غير نشط",
      suspended: "موقوف"
    }[status] || status || "—");

    const render = () => {
      content.innerHTML = `
        <div class="section-heading">
          <div>
            <span class="eyebrow">إدارة فريق الأكاديمية</span>
            <h3>${this.escape(title)}</h3>
            <p>
              إضافة المعلمين وتعديل بياناتهم وحالاتهم.
              عدد السجلات: <strong>${rows.length}</strong>
            </p>
          </div>

          <div style="display:flex;gap:10px;flex-wrap:wrap;">
            <button
              class="primary-button"
              id="teacher-new"
              type="button"
            >
              إضافة معلم
            </button>

            <button
              class="secondary-button"
              id="teacher-refresh"
              type="button"
            >
              تحديث
            </button>
          </div>
        </div>

        <div
          style="
            display:grid;
            grid-template-columns:minmax(220px,1fr) 220px;
            gap:12px;
            margin:16px 0;
          "
        >
          <input
            id="teacher-search"
            class="form-input"
            type="search"
            placeholder="بحث بالاسم أو الكود أو الهاتف أو البريد"
            value="${this.escape(
              this.root.querySelector("#teacher-search")?.value || ""
            )}"
          >

          <select
            id="teacher-status-filter"
            class="form-input"
          >
            <option value="">كل الحالات</option>
            <option value="active">نشط</option>
            <option value="inactive">غير نشط</option>
            <option value="suspended">موقوف</option>
          </select>
        </div>

        <div id="teacher-form-container" style="display:none;"></div>

        <div class="table-wrap">
          ${
            rows.length
              ? `
                <table class="data-table">
                  <thead>
                    <tr>
                      <th>الاسم</th>
                      <th>الكود</th>
                      <th>الهاتف</th>
                      <th>البريد</th>
                      <th>التخصص</th>
                      <th>الخبرة</th>
                      <th>الحالة</th>
                      <th>إجراء</th>
                    </tr>
                  </thead>

                  <tbody>
                    ${rows.map((row) => `
                      <tr>
                        <td>${this.escape(row?.full_name || "—")}</td>
                        <td>${this.escape(row?.teacher_code || "—")}</td>
                        <td>${this.escape(row?.phone || "—")}</td>
                        <td>${this.escape(row?.email || "—")}</td>
                        <td>${this.escape(row?.specialization || "—")}</td>
                        <td>
                          ${this.escape(
                            row?.experience_years === null ||
                            row?.experience_years === undefined
                              ? "0"
                              : String(row.experience_years)
                          )}
                        </td>
                        <td>${this.escape(statusLabel(row?.status))}</td>
                        <td>
                          <div style="display:flex;gap:6px;flex-wrap:wrap;">
                            <button
                              type="button"
                              class="secondary-button teacher-profile"
                              data-id="${this.escape(String(row?.id ?? ""))}"
                            >
                              الملف
                            </button>
                            <button
                              type="button"
                              class="secondary-button teacher-edit"
                              data-id="${this.escape(String(row?.id ?? ""))}"
                            >
                              تعديل
                            </button>
                          </div>
                        </td>
                      </tr>
                    `).join("")}
                  </tbody>
                </table>
              `
              : `
                <div class="empty-state">
                  <div class="empty-icon">✦</div>
                  <h3>لا يوجد معلمون</h3>
                  <p>
                    لا توجد سجلات مطابقة حاليًا.
                    يمكنك إضافة أول معلم من زر «إضافة معلم».
                  </p>
                </div>
              `
          }
        </div>
      `;

      const statusFilter =
        content.querySelector("#teacher-status-filter");

      statusFilter.value = "";

      const currentStatus =
        new URLSearchParams(window.location.search).get(
          "teacher_status"
        );

      if (currentStatus) {
        statusFilter.value = currentStatus;
      }

      content.querySelector("#teacher-new")?.addEventListener(
        "click",
        () => this.renderTeacherForm()
      );

      content.querySelector("#teacher-refresh")?.addEventListener(
        "click",
        () => load()
      );

      content.querySelectorAll(".teacher-profile").forEach((button) => {
        button.addEventListener("click", () => {
          this.renderTeacherProfile(
            Number(button.dataset.id)
          );
        });
      });

      content.querySelectorAll(".teacher-edit").forEach((button) => {
        button.addEventListener("click", () => {
          this.renderTeacherForm(
            Number(button.dataset.id)
          );
        });
      });

      content.querySelector("#teacher-search")?.addEventListener(
        "keydown",
        (event) => {
          if (event.key === "Enter") {
            load();
          }
        }
      );

      statusFilter?.addEventListener(
        "change",
        () => load()
      );
    };

    try {
      await load();
    } catch (error) {
      content.innerHTML = `
        <div class="error-message">
          ${this.escape(
            error?.message ||
            "تعذر تحميل بيانات المعلمين."
          )}
        </div>
      `;
    }
  }

  async renderTeacherProfile(teacherId) {
    const container =
      this.root.querySelector("#teacher-form-container");

    if (!container || !teacherId) return;

    container.style.display = "block";
    container.innerHTML = `
      <div class="card" style="margin:16px 0;">
        <div class="section-heading">
          <div>
            <span class="eyebrow">ملف المعلم</span>
            <h3>جاري تحميل الملف...</h3>
            <p>ملف المعلم 360° — البيانات المهنية والأكاديمية والتشغيلية.</p>
          </div>
        </div>
      </div>
    `;

    try {
      const result = await this.apiGet(
        `/api/teachers?id=${encodeURIComponent(teacherId)}`
      );

      const teacher = Array.isArray(result?.data)
        ? result.data[0] || null
        : result?.data || null;

      if (!teacher) {
        throw new Error("لم يتم العثور على المعلم.");
      }

      const esc = (value) =>
        this.escape(value ?? "—");

      const statusLabels = {
        active: "نشط",
        inactive: "غير نشط",
        suspended: "موقوف"
      };

      container.innerHTML = `
        <div class="card" style="margin:16px 0;">
          <div class="section-heading">
            <div>
              <span class="eyebrow">Teacher 360°</span>
              <h3>${esc(teacher.full_name)}</h3>
              <p>
                ${esc(teacher.teacher_code || "بدون كود")}
                · ${esc(statusLabels[teacher.status] || teacher.status)}
              </p>
            </div>

            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button
                type="button"
                class="secondary-button"
                id="teacher-profile-edit"
              >
                تعديل الملف
              </button>

              <button
                type="button"
                class="secondary-button"
                id="teacher-profile-close"
              >
                إغلاق
              </button>
            </div>
          </div>

          <div
            style="
              display:grid;
              grid-template-columns:repeat(auto-fit,minmax(180px,1fr));
              gap:12px;
              margin-top:16px;
            "
          >
            <div class="card">
              <strong>الهاتف</strong>
              <div>${esc(teacher.phone)}</div>
            </div>

            <div class="card">
              <strong>البريد الإلكتروني</strong>
              <div>${esc(teacher.email)}</div>
            </div>

            <div class="card">
              <strong>التخصص</strong>
              <div>${esc(teacher.specialization)}</div>
            </div>

            <div class="card">
              <strong>سنوات الخبرة</strong>
              <div>${esc(teacher.experience_years ?? 0)}</div>
            </div>
          </div>

          <div style="margin-top:16px;">
            <h4>البيانات المهنية</h4>
            <p><strong>المؤهلات:</strong> ${esc(teacher.qualifications)}</p>
            <p><strong>نبذة:</strong> ${esc(teacher.bio)}</p>
            <p><strong>ملاحظات إدارية:</strong> ${esc(teacher.notes)}</p>
          </div>

          <div
            style="
              display:grid;
              grid-template-columns:repeat(auto-fit,minmax(180px,1fr));
              gap:12px;
              margin-top:20px;
            "
          >
            <button
              type="button"
              class="secondary-button teacher-profile-section"
              data-section="circles"
            >
              الحلقات
            </button>

            <button
              type="button"
              class="secondary-button teacher-profile-section"
              data-section="students"
            >
              الطلاب
            </button>

            <button
              type="button"
              class="secondary-button teacher-profile-section"
              data-section="sessions"
            >
              الجلسات
            </button>

            <button
              type="button"
              class="secondary-button teacher-profile-section"
              data-section="schedule"
            >
              الجدول
            </button>

            <button
              type="button"
              class="secondary-button teacher-profile-section"
              data-section="leaves"
            >
              الإجازات
            </button>

            <button
              type="button"
              class="secondary-button teacher-profile-section"
              data-section="documents"
            >
              المستندات
            </button>
          </div>

          <div
            id="teacher-profile-live"
            style="margin-top:20px;"
          >
            <div class="empty-state">
              <h3>مركز ملف المعلم</h3>
              <p>
                اختر أحد الأقسام لعرض بياناته من الأنظمة الحالية.
              </p>
            </div>
          </div>
        </div>
      `;

      container.querySelector("#teacher-profile-close")?.addEventListener(
        "click",
        () => {
          container.innerHTML = "";
          container.style.display = "none";
        }
      );

      container.querySelector("#teacher-profile-edit")?.addEventListener(
        "click",
        () => this.renderTeacherForm(Number(teacherId))
      );

      container.querySelectorAll(".teacher-profile-section").forEach(
        (button) => {
          button.addEventListener("click", async () => {
            const target =
              container.querySelector("#teacher-profile-live");

            if (!target) return;

            const section = button.dataset.section;

            target.innerHTML = `
              <div class="card">
                <h4>جارٍ تحميل ${esc(button.textContent)}...</h4>
              </div>
            `;

            try {
              if (section === "circles") {
                const result = await this.apiGet(
                  `/api/circles?teacher_id=${encodeURIComponent(teacherId)}`
                );

                const rows = Array.isArray(result?.data)
                  ? result.data
                  : [];

                const typeLabels = {
                  individual: "فردية",
                  group: "جماعية"
                };

                const statusLabels = {
                  active: "نشطة",
                  inactive: "غير نشطة",
                  full: "مكتملة",
                  archived: "مؤرشفة"
                };

                target.innerHTML = `
                  <div class="card">
                    <div class="section-heading">
                      <div>
                        <span class="eyebrow">التكليف الأكاديمي</span>
                        <h4>حلقات المعلم</h4>
                        <p>الحلقات المرتبطة بهذا المعلم من النظام الحالي.</p>
                      </div>
                      <strong>${rows.length}</strong>
                    </div>

                    ${
                      rows.length
                        ? `
                          <div class="table-wrap">
                            <table class="data-table">
                              <thead>
                                <tr>
                                  <th>الحلقة</th>
                                  <th>النوع</th>
                                  <th>المستوى</th>
                                  <th>المسار</th>
                                  <th>السعة</th>
                                  <th>الحالة</th>
                                </tr>
                              </thead>
                              <tbody>
                                ${rows.map((row) => `
                                  <tr>
                                    <td>${esc(row.name)}</td>
                                    <td>${esc(typeLabels[row.circle_type] || row.circle_type)}</td>
                                    <td>${esc(row.level_name)}</td>
                                    <td>${esc(row.path_name)}</td>
                                    <td>${esc(row.capacity ?? "—")}</td>
                                    <td>${esc(statusLabels[row.status] || row.status)}</td>
                                  </tr>
                                `).join("")}
                              </tbody>
                            </table>
                          </div>
                        `
                        : `
                          <div class="empty-state">
                            <h3>لا توجد حلقات</h3>
                            <p>لا توجد حلقات مرتبطة بهذا المعلم حاليًا.</p>
                          </div>
                        `
                    }
                  </div>
                `;

                return;
              }

              if (section === "sessions") {
                const result = await this.apiGet(
                  `/api/sessions?teacher_id=${encodeURIComponent(teacherId)}`
                );

                const rows = Array.isArray(result?.data)
                  ? result.data
                  : [];

                const typeLabels = {
                  quran: "قرآن",
                  noorani: "قاعدة نورانية",
                  tafsir: "تفسير",
                  fiqh: "فقه",
                  hadith: "حديث",
                  sirah: "سيرة",
                  group: "جماعية",
                  individual: "فردية",
                  trial: "تجريبية",
                  test: "اختبار",
                  independent_recitation: "تسميع مستقل",
                  scientific: "مادة علمية",
                  admin_meeting: "اجتماع إداري",
                  teacher_leave: "إجازة معلم",
                  closed_slot: "فترة مغلقة"
                };

                const statusLabels = {
                  scheduled: "مجدولة",
                  started: "بدأت",
                  completed: "مكتملة",
                  cancelled: "ملغاة",
                  postponed: "مؤجلة",
                  no_show: "لم يحضر",
                  substitute: "بديل",
                  rescheduled: "معاد جدولتها"
                };

                target.innerHTML = `
                  <div class="card">
                    <div class="section-heading">
                      <div>
                        <span class="eyebrow">السجل التشغيلي</span>
                        <h4>جلسات المعلم</h4>
                        <p>الجلسات المسجلة للمعلم في النظام الحالي.</p>
                      </div>
                      <strong>${rows.length}</strong>
                    </div>

                    ${
                      rows.length
                        ? `
                          <div class="table-wrap">
                            <table class="data-table">
                              <thead>
                                <tr>
                                  <th>التاريخ</th>
                                  <th>الوقت</th>
                                  <th>النوع</th>
                                  <th>الحلقة</th>
                                  <th>الحالة</th>
                                </tr>
                              </thead>
                              <tbody>
                                ${rows.map((row) => `
                                  <tr>
                                    <td>${esc(row.session_date)}</td>
                                    <td>${esc(row.start_time)} — ${esc(row.end_time)}</td>
                                    <td>${esc(typeLabels[row.session_type] || row.session_type)}</td>
                                    <td>${esc(row.circle_name)}</td>
                                    <td>${esc(statusLabels[row.status] || row.status)}</td>
                                  </tr>
                                `).join("")}
                              </tbody>
                            </table>
                          </div>
                        `
                        : `
                          <div class="empty-state">
                            <h3>لا توجد جلسات</h3>
                            <p>لا توجد جلسات مسجلة لهذا المعلم حاليًا.</p>
                          </div>
                        `
                    }
                  </div>
                `;

                return;
              }

              if (section === "schedule") {
                const today =
                  new Date().toLocaleDateString(
                    "en-CA",
                    { timeZone: "Africa/Cairo" }
                  );

                const response = await this.apiGet(
                  `/api/schedule-center?teacher_id=${encodeURIComponent(
                    teacherId
                  )}&start_date=${encodeURIComponent(
                    today
                  )}&end_date=${encodeURIComponent(
                    today
                  )}`
                );

                const data =
                  response?.data || {};

                const sessions =
                  Array.isArray(data.sessions)
                    ? data.sessions
                    : [];

                const series =
                  Array.isArray(data.series)
                    ? data.series
                    : [];

                const leaves =
                  Array.isArray(data.leaves)
                    ? data.leaves
                    : [];

                const typeLabels = {
                  quran: "قرآن",
                  noorani: "قاعدة نورانية",
                  tafsir: "تفسير",
                  fiqh: "فقه",
                  hadith: "حديث",
                  sirah: "سيرة",
                  group: "جماعية",
                  individual: "فردية",
                  trial: "تجريبية",
                  test: "اختبار",
                  independent_recitation: "تسميع مستقل",
                  scientific: "مادة علمية",
                  admin_meeting: "اجتماع إداري",
                  teacher_leave: "إجازة معلم",
                  closed_slot: "فترة مغلقة"
                };

                const statusLabels = {
                  scheduled: "مجدولة",
                  started: "بدأت",
                  completed: "مكتملة",
                  cancelled: "ملغاة",
                  postponed: "مؤجلة",
                  no_show: "لم يحضر",
                  substitute: "بديل",
                  rescheduled: "معاد جدولتها"
                };

                const recurrenceLabels = {
                  once: "مرة واحدة",
                  daily: "يومي",
                  weekly: "أسبوعي",
                  biweekly: "كل أسبوعين",
                  monthly: "شهري",
                  custom: "مخصص"
                };

                const formatDate = (value) => {
                  if (!value) return "—";

                  try {
                    return new Intl.DateTimeFormat(
                      "ar-EG",
                      {
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

                const sessionRows = sessions
                  .map((row) => `
                    <tr>
                      <td>${esc(formatDate(row.session_date))}</td>
                      <td>
                        ${esc(row.start_time || "—")}
                        —
                        ${esc(row.end_time || "—")}
                      </td>
                      <td>
                        ${esc(
                          typeLabels[row.session_type] ||
                          row.session_type ||
                          "—"
                        )}
                      </td>
                      <td>
                        ${esc(
                          row.circle_name ||
                          row.student_name ||
                          "—"
                        )}
                      </td>
                      <td>
                        ${esc(
                          statusLabels[row.status] ||
                          row.status ||
                          "—"
                        )}
                      </td>
                    </tr>
                  `)
                  .join("");

                const seriesRows = series
                  .map((row) => `
                    <tr>
                      <td>${esc(row.title || "جدول متكرر")}</td>
                      <td>
                        ${esc(
                          typeLabels[row.session_type] ||
                          row.session_type ||
                          "—"
                        )}
                      </td>
                      <td>
                        ${esc(
                          row.circle_name ||
                          row.student_name ||
                          "—"
                        )}
                      </td>
                      <td>
                        ${esc(
                          recurrenceLabels[row.recurrence_type] ||
                          row.recurrence_type ||
                          "—"
                        )}
                      </td>
                      <td>
                        ${esc(formatDate(row.start_date))}
                        ${
                          row.end_date
                            ? ` — ${esc(formatDate(row.end_date))}`
                            : ""
                        }
                      </td>
                      <td>
                        ${esc(row.start_time || "—")}
                        —
                        ${esc(row.end_time || "—")}
                      </td>
                      <td>
                        ${esc(row.status || "—")}
                      </td>
                    </tr>
                  `)
                  .join("");

                const leaveRows = leaves
                  .map((leave) => `
                    <tr>
                      <td>${esc(leave.leave_type || "إجازة")}</td>
                      <td>${esc(formatDate(leave.start_date))}</td>
                      <td>${esc(formatDate(leave.end_date))}</td>
                      <td>${esc(leave.reason || "—")}</td>
                      <td>معتمدة</td>
                    </tr>
                  `)
                  .join("");

                target.innerHTML = `
                  <div class="card">
                    <div class="section-heading">
                      <div>
                        <span class="eyebrow">الجدولة التشغيلية</span>
                        <h4>جدول المعلم</h4>
                        <p>
                          بيانات الجدول من مركز الجدولة الرسمي في النظام،
                          مع عدم إنشاء مصدر بيانات موازٍ.
                        </p>
                      </div>

                      <strong>
                        ${sessions.length + series.length}
                      </strong>
                    </div>

                    <div class="schedule-summary">
                      <div>
                        <span>جلسات اليوم</span>
                        <strong>${sessions.length}</strong>
                      </div>

                      <div>
                        <span>جداول متكررة</span>
                        <strong>${series.length}</strong>
                      </div>

                      <div>
                        <span>إجازات معتمدة</span>
                        <strong>${leaves.length}</strong>
                      </div>
                    </div>

                    <div class="card" style="margin-top:16px;">
                      <div class="section-heading">
                        <div>
                          <span class="eyebrow">الجلسات</span>
                          <h4>جلسات اليوم</h4>
                        </div>
                        <strong>${sessions.length}</strong>
                      </div>

                      ${
                        sessions.length
                          ? `
                            <div class="table-wrap">
                              <table class="data-table">
                                <thead>
                                  <tr>
                                    <th>التاريخ</th>
                                    <th>الوقت</th>
                                    <th>النوع</th>
                                    <th>الحلقة / الطالب</th>
                                    <th>الحالة</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  ${sessionRows}
                                </tbody>
                              </table>
                            </div>
                          `
                          : `
                            <div class="empty-state">
                              <h3>لا توجد جلسات اليوم</h3>
                              <p>
                                لا توجد جلسات مسجلة لهذا المعلم في تاريخ اليوم.
                              </p>
                            </div>
                          `
                      }
                    </div>

                    <div class="card" style="margin-top:16px;">
                      <div class="section-heading">
                        <div>
                          <span class="eyebrow">التكرار</span>
                          <h4>الجداول المتكررة</h4>
                        </div>
                        <strong>${series.length}</strong>
                      </div>

                      ${
                        series.length
                          ? `
                            <div class="table-wrap">
                              <table class="data-table">
                                <thead>
                                  <tr>
                                    <th>العنوان</th>
                                    <th>النوع</th>
                                    <th>الحلقة / الطالب</th>
                                    <th>التكرار</th>
                                    <th>الفترة</th>
                                    <th>الوقت</th>
                                    <th>الحالة</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  ${seriesRows}
                                </tbody>
                              </table>
                            </div>
                          `
                          : `
                            <div class="empty-state">
                              <h3>لا توجد جداول متكررة</h3>
                              <p>
                                لا توجد سلسلة مواعيد مرتبطة بهذا المعلم حاليًا.
                              </p>
                            </div>
                          `
                      }
                    </div>

                    <div class="card" style="margin-top:16px;">
                      <div class="section-heading">
                        <div>
                          <span class="eyebrow">الإجازات</span>
                          <h4>الإجازات المعتمدة</h4>
                        </div>
                        <strong>${leaves.length}</strong>
                      </div>

                      ${
                        leaves.length
                          ? `
                            <div class="table-wrap">
                              <table class="data-table">
                                <thead>
                                  <tr>
                                    <th>النوع</th>
                                    <th>من</th>
                                    <th>إلى</th>
                                    <th>السبب</th>
                                    <th>الحالة</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  ${leaveRows}
                                </tbody>
                              </table>
                            </div>
                          `
                          : `
                            <div class="empty-state">
                              <h3>لا توجد إجازات معتمدة</h3>
                              <p>
                                لا توجد إجازات معتمدة ظاهرة لهذا المعلم حاليًا.
                              </p>
                            </div>
                          `
                      }
                    </div>
                  </div>
                `;

                return;
              }

              if (section === "leaves") {
                const result = await this.apiGet(
                  `/api/teacher-leaves?teacher_id=${encodeURIComponent(
                    teacherId
                  )}`
                );

                const rows = Array.isArray(result?.data)
                  ? result.data
                  : [];

                const typeLabels = {
                  annual: "سنوية",
                  sick: "مرضية",
                  personal: "شخصية",
                  emergency: "طارئة",
                  academic: "دراسية",
                  other: "أخرى"
                };

                const statusLabels = {
                  pending: "قيد المراجعة",
                  approved: "معتمدة",
                  rejected: "مرفوضة",
                  cancelled: "ملغاة"
                };

                const formatDate = (value) => {
                  if (!value) return "—";

                  try {
                    return new Intl.DateTimeFormat(
                      "ar-EG",
                      {
                        year: "numeric",
                        month: "short",
                        day: "numeric"
                      }
                    ).format(
                      new Date(`${value}T12:00:00`)
                    );
                  } catch {
                    return value;
                  }
                };

                const statusClass = (status) => {
                  const allowed = [
                    "pending",
                    "approved",
                    "rejected",
                    "cancelled"
                  ];

                  return allowed.includes(status)
                    ? status
                    : "pending";
                };

                const leaveRows = rows
                  .map((row) => `
                    <tr>
                      <td>
                        ${esc(
                          typeLabels[row.leave_type] ||
                          row.leave_type ||
                          "—"
                        )}
                      </td>

                      <td>
                        ${esc(
                          formatDate(row.start_date)
                        )}
                      </td>

                      <td>
                        ${esc(
                          formatDate(row.end_date)
                        )}
                      </td>

                      <td>
                        ${esc(row.reason || "—")}
                      </td>

                      <td>
                        <span class="schedule-status status-${esc(
                          statusClass(row.status)
                        )}">
                          ${esc(
                            statusLabels[row.status] ||
                            row.status ||
                            "—"
                          )}
                        </span>
                      </td>
                    </tr>
                  `)
                  .join("");

                const pending =
                  rows.filter(
                    (row) => row.status === "pending"
                  ).length;

                const approved =
                  rows.filter(
                    (row) => row.status === "approved"
                  ).length;

                const rejected =
                  rows.filter(
                    (row) => row.status === "rejected"
                  ).length;

                target.innerHTML = `
                  <div class="card">
                    <div class="section-heading">
                      <div>
                        <span class="eyebrow">إدارة الإجازات</span>
                        <h4>سجل إجازات المعلم</h4>
                        <p>
                          البيانات مأخوذة مباشرة من نظام إجازات المعلمين
                          الرسمي.
                        </p>
                      </div>

                      <strong>${rows.length}</strong>
                    </div>

                    <div class="schedule-summary">
                      <div>
                        <span>إجمالي الطلبات</span>
                        <strong>${rows.length}</strong>
                      </div>

                      <div>
                        <span>قيد المراجعة</span>
                        <strong>${pending}</strong>
                      </div>

                      <div>
                        <span>معتمدة</span>
                        <strong>${approved}</strong>
                      </div>

                      <div>
                        <span>مرفوضة</span>
                        <strong>${rejected}</strong>
                      </div>
                    </div>

                    ${
                      rows.length
                        ? `
                          <div class="table-wrap" style="margin-top:16px;">
                            <table class="data-table">
                              <thead>
                                <tr>
                                  <th>النوع</th>
                                  <th>من</th>
                                  <th>إلى</th>
                                  <th>السبب</th>
                                  <th>الحالة</th>
                                </tr>
                              </thead>

                              <tbody>
                                ${leaveRows}
                              </tbody>
                            </table>
                          </div>
                        `
                        : `
                          <div class="empty-state" style="margin-top:16px;">
                            <h3>لا توجد طلبات إجازة</h3>
                            <p>
                              لا توجد طلبات إجازة مسجلة لهذا المعلم حاليًا.
                            </p>
                          </div>
                        `
                    }
                  </div>
                `;

                return;
              }

              if (section === "students") {
                /*
                 * مصدر الطلاب الرسمي:
                 * teacher -> circles -> circle_enrollments -> students
                 *
                 * لا نعتمد على سجل الجلسات لإثبات علاقة الطالب بالمعلم،
                 * ولا نكرر منطق الصلاحيات في الواجهة.
                 */
                const circlesResult = await this.apiGet(
                  `/api/circles?teacher_id=${encodeURIComponent(teacherId)}`
                );

                const circles = Array.isArray(circlesResult?.data)
                  ? circlesResult.data
                  : [];

                if (!circles.length) {
                  target.innerHTML = `
                    <div class="card">
                      <div class="section-heading">
                        <div>
                          <span class="eyebrow">التكليف الأكاديمي</span>
                          <h4>طلاب المعلم</h4>
                          <p>الطلاب المرتبطون بالحلقات الحالية لهذا المعلم.</p>
                        </div>
                        <strong>0</strong>
                      </div>

                      <div class="empty-state">
                        <h3>لا يوجد طلاب مرتبطون</h3>
                        <p>لا توجد حلقات مرتبطة بهذا المعلم حاليًا.</p>
                      </div>
                    </div>
                  `;

                  return;
                }

                const enrollmentResults =
                  await Promise.all(
                    circles.map(async (circle) => {
                      try {
                        const result = await this.apiGet(
                          `/api/enrollments?circle_id=${encodeURIComponent(circle.id)}`
                        );

                        return {
                          circle,
                          rows: Array.isArray(result?.data)
                            ? result.data
                            : []
                        };
                      } catch {
                        return {
                          circle,
                          rows: []
                        };
                      }
                    })
                  );

                const enrollmentMap = new Map();

                enrollmentResults.forEach(({ circle, rows }) => {
                  rows.forEach((row) => {
                    const studentId = Number(row.student_id);

                    if (!Number.isInteger(studentId) || studentId <= 0) {
                      return;
                    }

                    const key = `${studentId}`;

                    if (!enrollmentMap.has(key)) {
                      enrollmentMap.set(key, {
                        student_id: studentId,
                        student_name: row.student_name,
                        student_code: row.student_code || "",
                        status: row.status,
                        circles: []
                      });
                    }

                    const student = enrollmentMap.get(key);

                    student.circles.push({
                      circle_name:
                        row.circle_name ||
                        circle.name ||
                        "—",
                      circle_type:
                        row.circle_type ||
                        circle.circle_type ||
                        "",
                      status: row.status || "",
                      start_date: row.start_date || "",
                      end_date: row.end_date || ""
                    });
                  });
                });

                const students = Array.from(
                  enrollmentMap.values()
                ).sort((a, b) =>
                  String(a.student_name || "").localeCompare(
                    String(b.student_name || ""),
                    "ar"
                  )
                );

                const statusLabels = {
                  pending: "قيد الانتظار",
                  active: "نشط",
                  paused: "موقوف مؤقتًا",
                  completed: "مكتمل",
                  cancelled: "ملغى"
                };

                const typeLabels = {
                  individual: "فردية",
                  group: "جماعية"
                };

                target.innerHTML = `
                  <div class="card">
                    <div class="section-heading">
                      <div>
                        <span class="eyebrow">التكليف الأكاديمي</span>
                        <h4>طلاب المعلم</h4>
                        <p>
                          الطلاب المرتبطون فعليًا بحلقات هذا المعلم
                          من سجل التسجيلات الرسمي.
                        </p>
                      </div>
                      <strong>${students.length}</strong>
                    </div>

                    ${
                      students.length
                        ? `
                          <div class="table-wrap">
                            <table class="data-table">
                              <thead>
                                <tr>
                                  <th>الطالب</th>
                                  <th>الحلقات</th>
                                  <th>نوع الحلقة</th>
                                  <th>حالة التسجيل</th>
                                  <th>بداية التسجيل</th>
                                </tr>
                              </thead>
                              <tbody>
                                ${students.map((student) => {
                                  const firstCircle =
                                    student.circles[0] || {};

                                  const circleNames =
                                    student.circles
                                      .map((circle) => circle.circle_name)
                                      .filter(Boolean)
                                      .join("، ");

                                  const circleTypes =
                                    [...new Set(
                                      student.circles
                                        .map((circle) =>
                                          typeLabels[circle.circle_type] ||
                                          circle.circle_type
                                        )
                                        .filter(Boolean)
                                    )].join("، ");

                                  const statuses =
                                    [...new Set(
                                      student.circles
                                        .map((circle) =>
                                          statusLabels[circle.status] ||
                                          circle.status
                                        )
                                        .filter(Boolean)
                                    )].join("، ");

                                  const startDates =
                                    [...new Set(
                                      student.circles
                                        .map((circle) => circle.start_date)
                                        .filter(Boolean)
                                    )].join("، ");

                                  return `
                                    <tr>
                                      <td>
                                        <strong>${esc(student.student_name)}</strong>
                                        ${
                                          student.student_code
                                            ? `<div class="muted">${esc(student.student_code)}</div>`
                                            : ""
                                        }
                                      </td>
                                      <td>${esc(circleNames || "—")}</td>
                                      <td>${esc(circleTypes || "—")}</td>
                                      <td>${esc(statuses || "—")}</td>
                                      <td>${esc(startDates || firstCircle.start_date || "—")}</td>
                                    </tr>
                                  `;
                                }).join("")}
                              </tbody>
                            </table>
                          </div>
                        `
                        : `
                          <div class="empty-state">
                            <h3>لا يوجد طلاب مسجلون</h3>
                            <p>
                              لا توجد تسجيلات طلاب مرتبطة بحلقات هذا المعلم حاليًا.
                            </p>
                          </div>
                        `
                    }
                  </div>
                `;

                return;
              }

              target.innerHTML = `
                <div class="card">
                  <h4>${esc(button.textContent)}</h4>
                  <p>
                    هذا القسم موجود في بنية الملف وسيتم ربطه بالـAPI الأصلي
                    دون إنشاء نظام مكرر.
                  </p>
                </div>
              `;
            } catch (error) {
              target.innerHTML = `
                <div class="error-message">
                  ${this.escape(
                    error?.message ||
                    "تعذر تحميل بيانات القسم."
                  )}
                </div>
              `;
            }
          });
        }
      )
    } catch (error) {
      container.innerHTML = `
        <div class="error-message">
          ${this.escape(
            error?.message ||
            "تعذر تحميل ملف المعلم."
          )}
        </div>
      `;
    }
  }

  async renderTeacherForm(teacherId = null) {
    const container =
      this.root.querySelector("#teacher-form-container");

    if (!container) return;

    let teacher = null;

    if (teacherId) {
      try {
        const result = await this.apiGet(
          `/api/teachers?id=${encodeURIComponent(teacherId)}`
        );

        teacher = Array.isArray(result?.data)
          ? result.data[0] || null
          : result?.data || null;

        if (!teacher) {
          throw new Error("لم يتم العثور على المعلم.");
        }
      } catch (error) {
        alert(
          error?.message ||
          "تعذر تحميل بيانات المعلم."
        );
        return;
      }
    }

    const value = (key) =>
      this.escape(
        teacher?.[key] ??
        ""
      );

    container.style.display = "block";

    container.innerHTML = `
      <div class="card" style="margin:16px 0;">
        <div class="section-heading">
          <div>
            <span class="eyebrow">
              ${teacherId ? "تعديل بيانات المعلم" : "معلم جديد"}
            </span>
            <h3>
              ${teacherId ? "تعديل ملف المعلم" : "إضافة معلم"}
            </h3>
            <p>
              البيانات الأساسية والمهنية للمعلم.
            </p>
          </div>
        </div>

        <form id="teacher-form">
          <div
            style="
              display:grid;
              grid-template-columns:repeat(auto-fit,minmax(220px,1fr));
              gap:12px;
            "
          >
            <div>
              <label for="teacher-full-name">اسم المعلم *</label>
              <input
                id="teacher-full-name"
                class="form-input"
                type="text"
                name="full_name"
                required
                value="${value("full_name")}"
              >
            </div>

            <div>
              <label for="teacher-code">كود المعلم</label>
              <input
                id="teacher-code"
                class="form-input"
                type="text"
                name="teacher_code"
                value="${value("teacher_code")}"
                placeholder="يُنشأ تلقائيًا عند الإضافة"
              >
            </div>

            <div>
              <label for="teacher-phone">الهاتف</label>
              <input
                id="teacher-phone"
                class="form-input"
                type="tel"
                name="phone"
                value="${value("phone")}"
              >
            </div>

            <div>
              <label for="teacher-email">البريد الإلكتروني</label>
              <input
                id="teacher-email"
                class="form-input"
                type="email"
                name="email"
                value="${value("email")}"
              >
            </div>

            <div>
              <label for="teacher-specialization">التخصص</label>
              <input
                id="teacher-specialization"
                class="form-input"
                type="text"
                name="specialization"
                value="${value("specialization")}"
              >
            </div>

            <div>
              <label for="teacher-experience">سنوات الخبرة</label>
              <input
                id="teacher-experience"
                class="form-input"
                type="number"
                name="experience_years"
                min="0"
                step="1"
                value="${value("experience_years") || "0"}"
              >
            </div>

            <div>
              <label for="teacher-status">الحالة</label>
              <select
                id="teacher-status"
                class="form-input"
                name="status"
              >
                <option
                  value="active"
                  ${(!teacher?.status || teacher?.status === "active") ? "selected" : ""}
                >
                  نشط
                </option>

                <option
                  value="inactive"
                  ${teacher?.status === "inactive" ? "selected" : ""}
                >
                  غير نشط
                </option>

                <option
                  value="suspended"
                  ${teacher?.status === "suspended" ? "selected" : ""}
                >
                  موقوف
                </option>
              </select>
            </div>

            <div style="grid-column:1/-1;">
              <label for="teacher-qualifications">المؤهلات</label>
              <textarea
                id="teacher-qualifications"
                class="form-input"
                name="qualifications"
                rows="3"
              >${value("qualifications")}</textarea>
            </div>

            <div style="grid-column:1/-1;">
              <label for="teacher-bio">نبذة</label>
              <textarea
                id="teacher-bio"
                class="form-input"
                name="bio"
                rows="3"
              >${value("bio")}</textarea>
            </div>

            <div style="grid-column:1/-1;">
              <label for="teacher-notes">ملاحظات</label>
              <textarea
                id="teacher-notes"
                class="form-input"
                name="notes"
                rows="3"
              >${value("notes")}</textarea>
            </div>
          </div>

          <div
            id="teacher-form-message"
            style="margin-top:12px;"
          ></div>

          <div
            style="
              display:flex;
              gap:10px;
              margin-top:16px;
              flex-wrap:wrap;
            "
          >
            <button
              class="primary-button"
              type="submit"
              id="teacher-save"
            >
              ${teacherId ? "حفظ التعديلات" : "إضافة المعلم"}
            </button>

            <button
              class="secondary-button"
              type="button"
              id="teacher-cancel"
            >
              إلغاء
            </button>
          </div>
        </form>
      </div>
    `;

    const form =
      this.root.querySelector("#teacher-form");

    const saveButton =
      this.root.querySelector("#teacher-save");

    const cancelButton =
      this.root.querySelector("#teacher-cancel");

    const message =
      this.root.querySelector("#teacher-form-message");

    cancelButton?.addEventListener(
      "click",
      () => {
        container.innerHTML = "";
        container.style.display = "none";
      }
    );

    form?.addEventListener(
      "submit",
      async (event) => {
        event.preventDefault();

        const formData =
          new FormData(form);

        const experienceRaw =
          String(
            formData.get("experience_years") || "0"
          ).trim();

        const body = {
          full_name:
            String(
              formData.get("full_name") || ""
            ).trim(),

          teacher_code:
            String(
              formData.get("teacher_code") || ""
            ).trim() || null,

          phone:
            String(
              formData.get("phone") || ""
            ).trim() || null,

          email:
            String(
              formData.get("email") || ""
            ).trim() || null,

          specialization:
            String(
              formData.get("specialization") || ""
            ).trim() || null,

          qualifications:
            String(
              formData.get("qualifications") || ""
            ).trim() || null,

          experience_years:
            experienceRaw === ""
              ? 0
              : Number(experienceRaw),

          bio:
            String(
              formData.get("bio") || ""
            ).trim() || null,

          notes:
            String(
              formData.get("notes") || ""
            ).trim() || null,

          status:
            String(
              formData.get("status") || "active"
            )
        };

        if (!body.full_name) {
          message.innerHTML = `
            <div class="error-message">
              اسم المعلم مطلوب.
            </div>
          `;
          return;
        }

        if (
          !Number.isFinite(body.experience_years) ||
          body.experience_years < 0
        ) {
          message.innerHTML = `
            <div class="error-message">
              سنوات الخبرة يجب أن تكون رقمًا صحيحًا غير سالب.
            </div>
          `;
          return;
        }

        saveButton.disabled = true;
        saveButton.textContent = "جارٍ الحفظ...";

        try {
          let response;

          if (teacherId) {
            response = await fetch(
              "/api/teachers",
              {
                method: "PATCH",
                credentials: "include",
                headers: {
                  "Content-Type": "application/json",
                  Accept: "application/json"
                },
                body: JSON.stringify({
                  id: Number(teacherId),
                  ...body
                })
              }
            );
          } else {
            response = await fetch(
              "/api/teachers",
              {
                method: "POST",
                credentials: "include",
                headers: {
                  "Content-Type": "application/json",
                  Accept: "application/json"
                },
                body: JSON.stringify(body)
              }
            );
          }

          const data =
            await response.json().catch(() => ({}));

          if (!response.ok) {
            throw new Error(
              data?.error ||
              data?.message ||
              "تعذر حفظ بيانات المعلم."
            );
          }

          container.innerHTML = "";
          container.style.display = "none";

          await this.renderTeachersModule(title);
        } catch (error) {
          message.innerHTML = `
            <div class="error-message">
              ${this.escape(
                error?.message ||
                "حدث خطأ أثناء حفظ بيانات المعلم."
              )}
            </div>
          `;

          saveButton.disabled = false;
          saveButton.textContent =
            teacherId
              ? "حفظ التعديلات"
              : "إضافة المعلم";
        }
      }
    );
  }

  async renderAttendanceModule(title) {
    const root = document.querySelector("#app");
    if (!root) return;

    root.innerHTML = `
      <section class="attendance-module">
        <div class="attendance-header">
          <div>
            <div class="attendance-eyebrow">أكاديمية الأوَّابين</div>
            <h1>${title || "الحضور"}</h1>
            <p class="attendance-subtitle">
              تسجيل ومراجعة حضور الطلاب للجلسات
            </p>
          </div>
        </div>

        <div class="attendance-toolbar">
          <label>
            <span>التاريخ</span>
            <input type="date" data-attendance-date>
          </label>
        </div>

        <div class="attendance-empty">
          <h2>وحدة الحضور</h2>
          <p>تم فتح شاشة الحضور بنجاح.</p>
        </div>
      </section>
    `;

    const dateInput = root.querySelector("[data-attendance-date]");

    const loadSessions = async () => {
      const response = await fetch(
        `/api/sessions?session_date=${encodeURIComponent(dateInput.value)}`,
        {
          credentials: "include",
          headers: {
            Accept: "application/json",
          },
        }
      );

      let data = null;

      try {
        data = await response.json();
      } catch {
        data = null;
      }

      if (!response.ok) {
        throw new Error(
          data?.error ||
          data?.message ||
          `HTTP ${response.status}`
        );
      }

      if (Array.isArray(data)) return data;
      if (Array.isArray(data?.sessions)) return data.sessions;
      if (Array.isArray(data?.data)) return data.data;
      if (Array.isArray(data?.items)) return data.items;

      return [];
    };

    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Cairo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());

    const get = (type) =>
      parts.find((part) => part.type === type)?.value || "";

    dateInput.value =
      `${get("year")}-${get("month")}-${get("day")}`;

    const sessionBox = document.createElement("div");
    sessionBox.className = "attendance-session-select";

    sessionBox.innerHTML = `
      <label>
        <span>الجلسة</span>
        <select data-attendance-session>
          <option value="">اختاري الجلسة</option>
        </select>
      </label>
    `;

    dateInput.parentElement.parentElement.appendChild(sessionBox);

    let selectedSessionId = 0;
    let attendanceRows = [];
    let roster = [];

    const normalizeArray = (data, keys = []) => {
      if (Array.isArray(data)) return data;

      for (const key of keys) {
        if (Array.isArray(data?.[key])) {
          return data[key];
        }
      }

      return [];
    };

    const getStudentId = (student) =>
      Number(
        student?.student_id ||
        student?.id ||
        0
      );

    const getStudentName = (student) =>
      student?.student_name ||
      student?.name ||
      student?.full_name ||
      `طالب #${getStudentId(student)}`;

    const loadSelectedAttendance = async () => {
      attendanceRows = [];

      if (!selectedSessionId) return;

      const data = await loadJson(
        `/api/attendance?session_id=${encodeURIComponent(
          selectedSessionId
        )}`
      );

      attendanceRows = normalizeArray(data, [
        "attendance",
        "data",
        "items",
      ]).filter(Boolean);
    };

    const loadSelectedRoster = async (sessions) => {
      roster = [];

      const session = sessions.find(
        (item) =>
          Number(
            item?.id ||
            item?.session_id ||
            0
          ) === selectedSessionId
      );

      if (!session) return;

      const circleId = Number(
        session?.circle_id || 0
      );

      if (circleId) {
        const data = await loadJson(
          `/api/enrollments?circle_id=${encodeURIComponent(
            circleId
          )}`
        );

        roster = normalizeArray(data, [
          "enrollments",
          "students",
          "data",
          "items",
        ])
          .filter(Boolean)
          .filter((row) => {
            const status = String(
              row.status || "active"
            ).toLowerCase();

            return [
              "active",
              "pending",
              "paused",
            ].includes(status);
          });

        return;
      }

      const studentId = Number(
        session?.student_id || 0
      );

      if (studentId) {
        roster = [
          {
            student_id: studentId,
            student_name:
              session?.student_name ||
              session?.name ||
              `طالب #${studentId}`,
          },
        ];
      }
    };

    const renderAttendancePreview = () => {
      const box = root.querySelector(
        ".attendance-empty"
      );

      if (!box) return;

      const session = window.__alawabinAttendanceSessions?.find(
        (item) =>
          Number(
            item?.id ||
            item?.session_id ||
            0
          ) === selectedSessionId
      );

      if (!selectedSessionId || !session) {
        box.innerHTML = `
          <h2>اختاري جلسة</h2>
          <p>
            اختاري جلسة لبدء عرض كشف الحضور.
          </p>
        `;
        return;
      }

      const recorded = new Map(
        attendanceRows.map((row) => [
          Number(row.student_id),
          row,
        ])
      );

      const statusLabels = {
        present: "حاضر",
        late: "متأخر",
        absent: "غائب",
        excused: "بعذر",
      };

      const rows = roster
        .map((student) => {
          const id = getStudentId(student);
          const existing = recorded.get(id);
          const currentStatus =
            existing?.status || "";

          return `
            <tr
              data-attendance-row
              data-student-id="${id}"
            >
              <td>
                <strong>
                  ${String(
                    getStudentName(student)
                  )}
                </strong>
              </td>

              <td>
                <div class="attendance-statuses">
                  ${Object.entries(statusLabels)
                    .map(
                      ([status, label]) => `
                        <button
                          type="button"
                          class="attendance-status-btn ${
                            currentStatus === status
                              ? "is-selected"
                              : ""
                          }"
                          data-attendance-status="${status}"
                        >
                          ${label}
                        </button>
                      `
                    )
                    .join("")}
                </div>
              </td>

              <td>
                <input
                  type="number"
                  min="0"
                  max="600"
                  class="attendance-late-minutes"
                  data-attendance-late-minutes
                  value="${
                    existing?.late_minutes ??
                    ""
                  }"
                  placeholder="0"
                />
              </td>

              <td>
                <input
                  type="text"
                  maxlength="500"
                  class="attendance-note"
                  data-attendance-note
                  value="${
                    existing?.note || ""
                  }"
                  placeholder="ملاحظة اختيارية"
                />
              </td>

              <td>
                <span
                  class="attendance-record-state ${
                    existing
                      ? "is-recorded"
                      : ""
                  }"
                  data-attendance-record-state
                >
                  ${
                    existing
                      ? "مسجل"
                      : "غير مسجل"
                  }
                </span>
              </td>
            </tr>
          `;
        })
        .join("");

      box.innerHTML = `
        <div class="attendance-preview">
          <h2>
            ${String(
              session?.title ||
              session?.name ||
              session?.circle_name ||
              session?.session_type ||
              `جلسة #${selectedSessionId}`
            )}
          </h2>

          <p>
            عدد الطلاب:
            <strong>${roster.length}</strong>
          </p>

          ${
            roster.length
              ? `
                <div class="attendance-actions">
                  <button
                    type="button"
                    class="btn primary"
                    data-attendance-save-all
                  >
                    حفظ الحضور
                  </button>

                  <button
                    type="button"
                    class="btn secondary"
                    data-attendance-mark-unmarked
                  >
                    تعليم غير المسجلين غائبًا
                  </button>

                  <span
                    class="attendance-save-message"
                    data-attendance-save-message
                  ></span>
                </div>

                <div class="attendance-table-wrap">
                  <table class="attendance-table">
                    <thead>
                      <tr>
                        <th>الطالب</th>
                        <th>الحالة</th>
                        <th>دقائق التأخير</th>
                        <th>ملاحظة</th>
                        <th>حالة التسجيل</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${rows}
                    </tbody>
                  </table>
                </div>
              `
              : `
                <p>
                  لا يوجد كشف طلاب مرتبط بهذه الجلسة.
                </p>
              `
          }
        </div>
      `;
    };

    const renderSessions = (sessions) => {
      window.__alawabinAttendanceSessions = sessions;

      const select = root.querySelector(
        "[data-attendance-session]"
      );

      if (!select) return;

      if (!sessions.length) {
        select.innerHTML = `
          <option value="">لا توجد جلسات لهذا التاريخ</option>
        `;
        return;
      }

      select.innerHTML = `
        <option value="">اختاري الجلسة</option>
        ${sessions
          .map((session) => {
            const id =
              session?.id ||
              session?.session_id ||
              "";

            const title =
              session?.title ||
              session?.name ||
              session?.circle_name ||
              session?.session_type ||
              `جلسة #${id}`;

            return `
              <option value="${String(id)}">
                ${String(title)}
              </option>
            `;
          })
          .join("")}
      `;
    };

    const loadAndRenderSessions = async () => {
      const box = root.querySelector(".attendance-empty");

      try {
        if (box) {
          box.innerHTML = `
            <h2>جارٍ تحميل الجلسات...</h2>
            <p>يتم جلب جلسات التاريخ المحدد.</p>
          `;
        }

        const sessions = await loadSessions();

        renderSessions(sessions);

        if (box) {
          box.innerHTML = sessions.length
            ? `
              <h2>اختاري جلسة</h2>
              <p>
                تم العثور على
                <strong>${sessions.length}</strong>
                جلسة لهذا التاريخ.
              </p>
            `
            : `
              <h2>لا توجد جلسات</h2>
              <p>لا توجد جلسات مسجلة لهذا التاريخ.</p>
            `;
        }
      } catch (error) {
        const box = root.querySelector(".attendance-empty");

        if (box) {
          box.innerHTML = `
            <h2>تعذر تحميل الجلسات</h2>
            <p>${String(error.message || error)}</p>
          `;
        }
      }
    };

    const saveAttendanceRow = async (row) => {
      const studentId = Number(
        row.dataset.studentId || 0
      );

      if (!selectedSessionId || !studentId) {
        throw new Error(
          "بيانات الطالب أو الجلسة غير صحيحة."
        );
      }

      const selectedButton = row.querySelector(
        "[data-attendance-status].is-selected"
      );

      if (!selectedButton) {
        throw new Error(
          "اختاري حالة الحضور أولًا."
        );
      }

      const status =
        selectedButton.dataset.attendanceStatus;

      const lateInput = row.querySelector(
        "[data-attendance-late-minutes]"
      );

      const noteInput = row.querySelector(
        "[data-attendance-note]"
      );

      const lateMinutes =
        status === "late"
          ? Number(lateInput?.value || 0)
          : 0;

      const note =
        noteInput?.value?.trim() || null;

      const recorded = attendanceRows.find(
        (item) =>
          Number(item.student_id) === studentId
      );

      const method = recorded ? "PATCH" : "POST";

      const body = recorded
        ? {
            id: Number(recorded.id),
            status,
            late_minutes: lateMinutes,
            note,
          }
        : {
            session_id: selectedSessionId,
            student_id: studentId,
            status,
            late_minutes: lateMinutes,
            note,
          };

      const response = await fetch(
        "/api/attendance",
        {
          method,
          credentials: "include",
          headers: {
            "Content-Type":
              "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(body),
        }
      );

      let data = null;

      try {
        data = await response.json();
      } catch {
        data = null;
      }

      if (!response.ok) {
        throw new Error(
          data?.error ||
          data?.message ||
          `HTTP ${response.status}`
        );
      }

      return data;
    };

    const saveAllAttendance = async () => {
      if (!selectedSessionId) {
        throw new Error(
          "اختاري جلسة أولًا."
        );
      }

      const rows = Array.from(
        root.querySelectorAll(
          "[data-attendance-row]"
        )
      );

      const selectedRows = rows.filter(
        (row) =>
          row.querySelector(
            "[data-attendance-status].is-selected"
          )
      );

      if (!selectedRows.length) {
        throw new Error(
          "لم يتم اختيار حالة لأي طالب."
        );
      }

      const results = [];

      for (const row of selectedRows) {
        const state = row.querySelector(
          "[data-attendance-record-state]"
        );

        if (state) {
          state.textContent =
            "جارٍ الحفظ...";
        }

        try {
          const result =
            await saveAttendanceRow(row);

          results.push({
            ok: true,
            row,
            result,
          });

          if (state) {
            state.textContent = "تم الحفظ";
          }
        } catch (error) {
          results.push({
            ok: false,
            row,
            error,
          });

          if (state) {
            state.textContent =
              "تعذر الحفظ";
          }
        }
      }

      const failed =
        results.filter(
          (item) => !item.ok
        );

      if (failed.length) {
        throw new Error(
          `تم حفظ ${
            results.length - failed.length
          } سجل، وتعذر حفظ ${
            failed.length
          } سجل.`
        );
      }

      await loadSelectedAttendance();
      renderAttendancePreview();
    };

    root.addEventListener("click", async (event) => {
      const saveButton = event.target.closest(
        "[data-attendance-save-all]"
      );

      if (saveButton) {
        const message = root.querySelector(
          "[data-attendance-save-message]"
        );

        saveButton.disabled = true;
        saveButton.textContent =
          "جارٍ الحفظ...";

        if (message) {
          message.textContent = "";
        }

        try {
          await saveAllAttendance();

          if (message) {
            message.textContent =
              "تم حفظ الحضور بنجاح.";
          }
        } catch (error) {
          if (message) {
            message.textContent =
              error.message || String(error);
          }
        } finally {
          saveButton.disabled = false;
          saveButton.textContent =
            "حفظ الحضور";
        }

        return;
      }

      const markButton = event.target.closest(
        "[data-attendance-mark-unmarked]"
      );

      if (markButton) {
        root
          .querySelectorAll(
            "[data-attendance-row]"
          )
          .forEach((row) => {
            const alreadyRecorded =
              row.querySelector(
                "[data-attendance-record-state]"
              )?.textContent ===
              "مسجل";

            if (alreadyRecorded) return;

            const absentButton =
              row.querySelector(
                '[data-attendance-status="absent"]'
              );

            absentButton?.click();
          });

        return;
      }

      const button = event.target.closest(
        "[data-attendance-status]"
      );

      if (!button) return;

      const row = button.closest(
        "[data-attendance-row]"
      );

      if (!row) return;

      row
        .querySelectorAll(
          "[data-attendance-status]"
        )
        .forEach((item) => {
          item.classList.remove(
            "is-selected"
          );
        });

      button.classList.add("is-selected");

      const state = row.querySelector(
        "[data-attendance-record-state]"
      );

      if (state) {
        state.textContent = "جاهز للحفظ";
        state.classList.add(
          "is-recorded"
        );
      }

      const lateInput = row.querySelector(
        "[data-attendance-late-minutes]"
      );

      if (
        lateInput &&
        button.dataset.attendanceStatus !== "late"
      ) {
        lateInput.value = "";
      }
    });

    root
      .querySelector("[data-attendance-session]")
      ?.addEventListener("change", async (event) => {
        selectedSessionId = Number(
          event.target.value || 0
        );

        const box = root.querySelector(
          ".attendance-empty"
        );

        if (!selectedSessionId) {
          renderAttendancePreview();
          return;
        }

        try {
          if (box) {
            box.innerHTML = `
              <h2>جارٍ تحميل كشف الحضور...</h2>
              <p>
                يتم تحميل الطلاب والحضور المسجل.
              </p>
            `;
          }

          const sessions =
            window.__alawabinAttendanceSessions || [];

          await loadSelectedAttendance();
          await loadSelectedRoster(sessions);

          renderAttendancePreview();
        } catch (error) {
          if (box) {
            box.innerHTML = `
              <h2>تعذر تحميل كشف الحضور</h2>
              <p>
                ${String(
                  error.message || error
                )}
              </p>
            `;
          }
        }
      });

    dateInput.addEventListener("change", loadAndRenderSessions);

    loadAndRenderSessions();
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
                <select name="test_type" id="smart-test-type" required>
                  <option value="daily_quick">اختبار يومي سريع</option>
                  <option value="weekly">اختبار أسبوعي</option>
                  <option value="new_memorization">اختبار الحفظ الجديد</option>
                  <option value="near_revision">اختبار المراجعة القريبة</option>
                  <option value="old_review">اختبار المراجعة القديمة</option>
                  <option value="consolidation">اختبار التثبيت</option>
                  <option value="surah">اختبار سورة</option>
                  <option value="juz">اختبار جزء</option>
                  <option value="khatma">اختبار ختمة</option>
                  <option value="tajweed">اختبار التجويد</option>
                  <option value="noorani_qaida">اختبار القاعدة النورانية</option>
                  <option value="tafsir">اختبار التفسير</option>
                  <option value="fiqh">اختبار الفقه</option>
                  <option value="hadith">اختبار الحديث</option>
                  <option value="sirah">اختبار السيرة</option>
                </select>
              </label>

              <label id="smart-quran-scope-field">
                نطاق اختبار القرآن
                <select name="quran_scope" id="smart-quran-scope">
                  <option value="progress">حسب تقدم الطالب</option>
                  <option value="surah">اختبار سورة محددة</option>
                  <option value="juz">اختبار جزء محدد</option>
                  <option value="khatma">اختبار شامل في المحفوظ</option>
                </select>
              </label>

              <label id="smart-quran-surah-field" hidden>
                السورة
                <select
                  name="quran_surah_number"
                  id="smart-quran-surah"
                >
                  <option value="">اختاري السورة</option>
                  <option value="1">1 - الفاتحة</option>
                  <option value="2">2 - البقرة</option>
                  <option value="3">3 - آل عمران</option>
                  <option value="4">4 - النساء</option>
                  <option value="5">5 - المائدة</option>
                  <option value="6">6 - الأنعام</option>
                  <option value="7">7 - الأعراف</option>
                  <option value="8">8 - الأنفال</option>
                  <option value="9">9 - التوبة</option>
                  <option value="10">10 - يونس</option>
                  <option value="11">11 - هود</option>
                  <option value="12">12 - يوسف</option>
                  <option value="13">13 - الرعد</option>
                  <option value="14">14 - إبراهيم</option>
                  <option value="15">15 - الحجر</option>
                  <option value="16">16 - النحل</option>
                  <option value="17">17 - الإسراء</option>
                  <option value="18">18 - الكهف</option>
                  <option value="19">19 - مريم</option>
                  <option value="20">20 - طه</option>
                  <option value="21">21 - الأنبياء</option>
                  <option value="22">22 - الحج</option>
                  <option value="23">23 - المؤمنون</option>
                  <option value="24">24 - النور</option>
                  <option value="25">25 - الفرقان</option>
                  <option value="26">26 - الشعراء</option>
                  <option value="27">27 - النمل</option>
                  <option value="28">28 - القصص</option>
                  <option value="29">29 - العنكبوت</option>
                  <option value="30">30 - الروم</option>
                  <option value="31">31 - لقمان</option>
                  <option value="32">32 - السجدة</option>
                  <option value="33">33 - الأحزاب</option>
                  <option value="34">34 - سبأ</option>
                  <option value="35">35 - فاطر</option>
                  <option value="36">36 - يس</option>
                  <option value="37">37 - الصافات</option>
                  <option value="38">38 - ص</option>
                  <option value="39">39 - الزمر</option>
                  <option value="40">40 - غافر</option>
                  <option value="41">41 - فصلت</option>
                  <option value="42">42 - الشورى</option>
                  <option value="43">43 - الزخرف</option>
                  <option value="44">44 - الدخان</option>
                  <option value="45">45 - الجاثية</option>
                  <option value="46">46 - الأحقاف</option>
                  <option value="47">47 - محمد</option>
                  <option value="48">48 - الفتح</option>
                  <option value="49">49 - الحجرات</option>
                  <option value="50">50 - ق</option>
                  <option value="51">51 - الذاريات</option>
                  <option value="52">52 - الطور</option>
                  <option value="53">53 - النجم</option>
                  <option value="54">54 - القمر</option>
                  <option value="55">55 - الرحمن</option>
                  <option value="56">56 - الواقعة</option>
                  <option value="57">57 - الحديد</option>
                  <option value="58">58 - المجادلة</option>
                  <option value="59">59 - الحشر</option>
                  <option value="60">60 - الممتحنة</option>
                  <option value="61">61 - الصف</option>
                  <option value="62">62 - الجمعة</option>
                  <option value="63">63 - المنافقون</option>
                  <option value="64">64 - التغابن</option>
                  <option value="65">65 - الطلاق</option>
                  <option value="66">66 - التحريم</option>
                  <option value="67">67 - الملك</option>
                  <option value="68">68 - القلم</option>
                  <option value="69">69 - الحاقة</option>
                  <option value="70">70 - المعارج</option>
                  <option value="71">71 - نوح</option>
                  <option value="72">72 - الجن</option>
                  <option value="73">73 - المزمل</option>
                  <option value="74">74 - المدثر</option>
                  <option value="75">75 - القيامة</option>
                  <option value="76">76 - الإنسان</option>
                  <option value="77">77 - المرسلات</option>
                  <option value="78">78 - النبأ</option>
                  <option value="79">79 - النازعات</option>
                  <option value="80">80 - عبس</option>
                  <option value="81">81 - التكوير</option>
                  <option value="82">82 - الانفطار</option>
                  <option value="83">83 - المطففين</option>
                  <option value="84">84 - الانشقاق</option>
                  <option value="85">85 - البروج</option>
                  <option value="86">86 - الطارق</option>
                  <option value="87">87 - الأعلى</option>
                  <option value="88">88 - الغاشية</option>
                  <option value="89">89 - الفجر</option>
                  <option value="90">90 - البلد</option>
                  <option value="91">91 - الشمس</option>
                  <option value="92">92 - الليل</option>
                  <option value="93">93 - الضحى</option>
                  <option value="94">94 - الشرح</option>
                  <option value="95">95 - التين</option>
                  <option value="96">96 - العلق</option>
                  <option value="97">97 - القدر</option>
                  <option value="98">98 - البينة</option>
                  <option value="99">99 - الزلزلة</option>
                  <option value="100">100 - العاديات</option>
                  <option value="101">101 - القارعة</option>
                  <option value="102">102 - التكاثر</option>
                  <option value="103">103 - العصر</option>
                  <option value="104">104 - الهمزة</option>
                  <option value="105">105 - الفيل</option>
                  <option value="106">106 - قريش</option>
                  <option value="107">107 - الماعون</option>
                  <option value="108">108 - الكوثر</option>
                  <option value="109">109 - الكافرون</option>
                  <option value="110">110 - النصر</option>
                  <option value="111">111 - المسد</option>
                  <option value="112">112 - الإخلاص</option>
                  <option value="113">113 - الفلق</option>
                  <option value="114">114 - الناس</option>
                </select>
              </label>

              <label id="smart-quran-juz-field" hidden>
                الجزء
                <select
                  name="quran_juz_number"
                  id="smart-quran-juz"
                >
                  <option value="">اختاري الجزء</option>
                  <option value="1">الجزء 1</option>
                  <option value="2">الجزء 2</option>
                  <option value="3">الجزء 3</option>
                  <option value="4">الجزء 4</option>
                  <option value="5">الجزء 5</option>
                  <option value="6">الجزء 6</option>
                  <option value="7">الجزء 7</option>
                  <option value="8">الجزء 8</option>
                  <option value="9">الجزء 9</option>
                  <option value="10">الجزء 10</option>
                  <option value="11">الجزء 11</option>
                  <option value="12">الجزء 12</option>
                  <option value="13">الجزء 13</option>
                  <option value="14">الجزء 14</option>
                  <option value="15">الجزء 15</option>
                  <option value="16">الجزء 16</option>
                  <option value="17">الجزء 17</option>
                  <option value="18">الجزء 18</option>
                  <option value="19">الجزء 19</option>
                  <option value="20">الجزء 20</option>
                  <option value="21">الجزء 21</option>
                  <option value="22">الجزء 22</option>
                  <option value="23">الجزء 23</option>
                  <option value="24">الجزء 24</option>
                  <option value="25">الجزء 25</option>
                  <option value="26">الجزء 26</option>
                  <option value="27">الجزء 27</option>
                  <option value="28">الجزء 28</option>
                  <option value="29">الجزء 29</option>
                  <option value="30">الجزء 30</option>
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

      const smartSubjectSelect =
        formContainer.querySelector('[name="subject_type"]');

      const smartScopeField =
        formContainer.querySelector("#smart-quran-scope-field");

      const smartScopeSelect =
        formContainer.querySelector("#smart-quran-scope");

      const smartSurahField =
        formContainer.querySelector("#smart-quran-surah-field");

      const smartSurahSelect =
        formContainer.querySelector("#smart-quran-surah");

      const smartTestTypeSelect =
        formContainer.querySelector("#smart-test-type");

      const smartJuzField =
        formContainer.querySelector("#smart-quran-juz-field");

      const smartJuzSelect =
        formContainer.querySelector("#smart-quran-juz");

      const updateSmartQuranScope = () => {
        const isQuran =
          smartSubjectSelect?.value === "quran";

        const testType =
          smartTestTypeSelect?.value || "";

        const isSurahTest =
          isQuran && testType === "surah";

        const isJuzTest =
          isQuran && testType === "juz";

        const isKhatmaTest =
          isQuran && testType === "khatma";

        if (smartScopeField) {
          smartScopeField.hidden = !isQuran;
        }

        if (isSurahTest && smartScopeSelect) {
          smartScopeSelect.value = "surah";
        }

        if (isJuzTest && smartScopeSelect) {
          smartScopeSelect.value = "juz";
        }

        if (isKhatmaTest && smartScopeSelect) {
          smartScopeSelect.value = "khatma";
        }

        if (smartSurahField) {
          smartSurahField.hidden =
            !isQuran ||
            smartScopeSelect?.value !== "surah";
        }

        if (smartJuzField) {
          smartJuzField.hidden =
            !isQuran ||
            smartScopeSelect?.value !== "juz";
        }

        if (
          !isQuran ||
          smartScopeSelect?.value !== "surah"
        ) {
          if (smartSurahSelect) {
            smartSurahSelect.value = "";
          }
        }

        if (
          !isQuran ||
          smartScopeSelect?.value !== "juz"
        ) {
          if (smartJuzSelect) {
            smartJuzSelect.value = "";
          }
        }
      };

      smartSubjectSelect?.addEventListener(
        "change",
        updateSmartQuranScope
      );

      smartTestTypeSelect?.addEventListener(
        "change",
        updateSmartQuranScope
      );

      smartScopeSelect?.addEventListener(
        "change",
        updateSmartQuranScope
      );

      updateSmartQuranScope();

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
                  quran_scope:
                    data.subject_type === "quran"
                      ? (data.quran_scope || "progress")
                      : "progress",
                  quran_surah_number:
                    data.subject_type === "quran" &&
                    data.quran_scope === "surah"
                      ? (data.quran_surah_number || null)
                      : null,
                  quran_juz_number:
                    data.subject_type === "quran" &&
                    data.quran_scope === "juz"
                      ? (data.quran_juz_number || null)
                      : null,
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

    const canManage =
      ["admin", "supervisor", "teacher"].includes(this.user?.role);

    const subjectLabels = {
      quran: "القرآن الكريم",
      tajweed: "التجويد",
      tafsir: "التفسير",
      fiqh: "الفقه",
      hadith: "الحديث",
      sirah: "السيرة",
      noorani_qaida: "القاعدة النورانية"
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

    content.innerHTML = `
      <div class="section-heading">
        <div>
          <span class="eyebrow">المواد التعليمية</span>
          <h3>${this.escape(title)}</h3>
          <p>بنك موحد لأسئلة القرآن والمواد العلمية المعتمدة.</p>
        </div>

        <div class="section-actions">
          ${
            canManage
              ? `<button class="primary-button" id="add-question-bank-question" type="button">
                   ➕ إضافة سؤال
                 </button>`
              : ""
          }
          <button class="secondary-button" id="refresh-module" type="button">
            تحديث
          </button>
        </div>
      </div>

      ${
        canManage
          ? `
            <section class="content-card" id="question-bank-form-card" hidden>
              <div class="section-heading">
                <div>
                  <span class="eyebrow">بنك الأسئلة</span>
                  <h3>إضافة سؤال جديد</h3>
                </div>
                <button class="secondary-button" id="cancel-question-bank-form" type="button">
                  إلغاء
                </button>
              </div>

              <form id="question-bank-create-form">
                <div class="form-grid">

                  <label>
                    <span>المادة</span>
                    <select name="subject_type" required>
                      ${Object.entries(subjectLabels).map(
                        ([value, label]) =>
                          `<option value="${value}">${label}</option>`
                      ).join("")}
                    </select>
                  </label>

                  <label>
                    <span>نوع السؤال</span>
                    <select name="question_type" required>
                      ${Object.entries(typeLabels).map(
                        ([value, label]) =>
                          `<option value="${value}">${label}</option>`
                      ).join("")}
                    </select>
                  </label>

                  <label>
                    <span>الصعوبة</span>
                    <select name="difficulty" required>
                      ${Object.entries(difficultyLabels).map(
                        ([value, label]) =>
                          `<option value="${value}" ${
                            value === "medium" ? "selected" : ""
                          }>${label}</option>`
                      ).join("")}
                    </select>
                  </label>

                  <label id="academic-lesson-field" class="form-grid-full" hidden>
                    <span>الدرس الأكاديمي المرتبط</span>
                    <select name="academic_material_lesson_id" id="academic-material-lesson-select">
                      <option value="">اختاري الدرس</option>
                    </select>
                    <small class="muted">
                      تظهر فقط دروس المواد المعتمدة والمؤهلة للاختبارات.
                    </small>
                  </label>

                  <label id="quran-location-fields" class="form-grid-full">
                    <span>الموضع القرآني</span>
                    <div class="form-grid">
                      <label>
                        <span>اسم السورة</span>
                        <select name="surah_number" id="question-surah-select">
                          <option value="">اختاري السورة</option>
                          <option value="1">1 - الفاتحة</option>
                          <option value="2">2 - البقرة</option>
                          <option value="3">3 - آل عمران</option>
                          <option value="4">4 - النساء</option>
                          <option value="5">5 - المائدة</option>
                          <option value="6">6 - الأنعام</option>
                          <option value="7">7 - الأعراف</option>
                          <option value="8">8 - الأنفال</option>
                          <option value="9">9 - التوبة</option>
                          <option value="10">10 - يونس</option>
                          <option value="11">11 - هود</option>
                          <option value="12">12 - يوسف</option>
                          <option value="13">13 - الرعد</option>
                          <option value="14">14 - إبراهيم</option>
                          <option value="15">15 - الحجر</option>
                          <option value="16">16 - النحل</option>
                          <option value="17">17 - الإسراء</option>
                          <option value="18">18 - الكهف</option>
                          <option value="19">19 - مريم</option>
                          <option value="20">20 - طه</option>
                          <option value="21">21 - الأنبياء</option>
                          <option value="22">22 - الحج</option>
                          <option value="23">23 - المؤمنون</option>
                          <option value="24">24 - النور</option>
                          <option value="25">25 - الفرقان</option>
                          <option value="26">26 - الشعراء</option>
                          <option value="27">27 - النمل</option>
                          <option value="28">28 - القصص</option>
                          <option value="29">29 - العنكبوت</option>
                          <option value="30">30 - الروم</option>
                          <option value="31">31 - لقمان</option>
                          <option value="32">32 - السجدة</option>
                          <option value="33">33 - الأحزاب</option>
                          <option value="34">34 - سبأ</option>
                          <option value="35">35 - فاطر</option>
                          <option value="36">36 - يس</option>
                          <option value="37">37 - الصافات</option>
                          <option value="38">38 - ص</option>
                          <option value="39">39 - الزمر</option>
                          <option value="40">40 - غافر</option>
                          <option value="41">41 - فصلت</option>
                          <option value="42">42 - الشورى</option>
                          <option value="43">43 - الزخرف</option>
                          <option value="44">44 - الدخان</option>
                          <option value="45">45 - الجاثية</option>
                          <option value="46">46 - الأحقاف</option>
                          <option value="47">47 - محمد</option>
                          <option value="48">48 - الفتح</option>
                          <option value="49">49 - الحجرات</option>
                          <option value="50">50 - ق</option>
                          <option value="51">51 - الذاريات</option>
                          <option value="52">52 - الطور</option>
                          <option value="53">53 - النجم</option>
                          <option value="54">54 - القمر</option>
                          <option value="55">55 - الرحمن</option>
                          <option value="56">56 - الواقعة</option>
                          <option value="57">57 - الحديد</option>
                          <option value="58">58 - المجادلة</option>
                          <option value="59">59 - الحشر</option>
                          <option value="60">60 - الممتحنة</option>
                          <option value="61">61 - الصف</option>
                          <option value="62">62 - الجمعة</option>
                          <option value="63">63 - المنافقون</option>
                          <option value="64">64 - التغابن</option>
                          <option value="65">65 - الطلاق</option>
                          <option value="66">66 - التحريم</option>
                          <option value="67">67 - الملك</option>
                          <option value="68">68 - القلم</option>
                          <option value="69">69 - الحاقة</option>
                          <option value="70">70 - المعارج</option>
                          <option value="71">71 - نوح</option>
                          <option value="72">72 - الجن</option>
                          <option value="73">73 - المزمل</option>
                          <option value="74">74 - المدثر</option>
                          <option value="75">75 - القيامة</option>
                          <option value="76">76 - الإنسان</option>
                          <option value="77">77 - المرسلات</option>
                          <option value="78">78 - النبأ</option>
                          <option value="79">79 - النازعات</option>
                          <option value="80">80 - عبس</option>
                          <option value="81">81 - التكوير</option>
                          <option value="82">82 - الانفطار</option>
                          <option value="83">83 - المطففين</option>
                          <option value="84">84 - الانشقاق</option>
                          <option value="85">85 - البروج</option>
                          <option value="86">86 - الطارق</option>
                          <option value="87">87 - الأعلى</option>
                          <option value="88">88 - الغاشية</option>
                          <option value="89">89 - الفجر</option>
                          <option value="90">90 - البلد</option>
                          <option value="91">91 - الشمس</option>
                          <option value="92">92 - الليل</option>
                          <option value="93">93 - الضحى</option>
                          <option value="94">94 - الشرح</option>
                          <option value="95">95 - التين</option>
                          <option value="96">96 - العلق</option>
                          <option value="97">97 - القدر</option>
                          <option value="98">98 - البينة</option>
                          <option value="99">99 - الزلزلة</option>
                          <option value="100">100 - العاديات</option>
                          <option value="101">101 - القارعة</option>
                          <option value="102">102 - التكاثر</option>
                          <option value="103">103 - العصر</option>
                          <option value="104">104 - الهمزة</option>
                          <option value="105">105 - الفيل</option>
                          <option value="106">106 - قريش</option>
                          <option value="107">107 - الماعون</option>
                          <option value="108">108 - الكوثر</option>
                          <option value="109">109 - الكافرون</option>
                          <option value="110">110 - النصر</option>
                          <option value="111">111 - المسد</option>
                          <option value="112">112 - الإخلاص</option>
                          <option value="113">113 - الفلق</option>
                          <option value="114">114 - الناس</option>
                        </select>
                      </label>
                      <label>
                        <span>من الآية</span>
                        <input name="ayah_start" type="number" min="1">
                      </label>
                      <label>
                        <span>إلى الآية</span>
                        <input name="ayah_end" type="number" min="1">
                      </label>
                    </div>
                  </label>

                  <label class="form-grid-full">
                    <span>نص السؤال</span>
                    <textarea name="question_text" rows="4" required></textarea>
                  </label>

                  <div
                    id="question-options-editor"
                    class="form-grid-full question-options-editor"
                    hidden
                  >
                    <div class="question-options-header">
                      <div>
                        <strong>الاختيارات</strong>
                        <small class="muted">
                          أضيفي الاختيارات وحددي الإجابة الصحيحة مباشرة.
                        </small>
                      </div>

                      <button
                        type="button"
                        class="secondary-button"
                        id="add-question-option"
                      >
                        ＋ إضافة خيار
                      </button>
                    </div>

                    <div
                      id="question-options-list"
                      class="question-options-list"
                    ></div>

                    <input
                      type="hidden"
                      name="options_json"
                      id="question-options-json"
                    />

                    <input
                      type="hidden"
                      name="correct_answer"
                      id="question-correct-answer"
                    />

                    <small class="muted question-options-hint">
                      اختاري الدائرة بجوار الخيار الذي يمثل الإجابة الصحيحة.
                    </small>
                  </div>

                  <label class="form-grid-full">
                    <span>الشرح</span>
                    <textarea name="explanation" rows="3"></textarea>
                  </label>

                </div>

                <div class="section-actions">
                  <button class="primary-button" type="submit">
                    حفظ السؤال
                  </button>
                  <button
                    class="secondary-button"
                    id="cancel-question-bank-form-bottom"
                    type="button"
                  >
                    إلغاء
                  </button>
                </div>

                <div id="question-bank-form-message"></div>
              </form>
            </section>
          `
          : ""
      }

      <section id="question-bank-list">
        <div class="loading-state">
          <h3>جاري تحميل بنك الأسئلة...</h3>
        </div>
      </section>
    `;

    const formCard = content.querySelector("#question-bank-form-card");
    const form = content.querySelector("#question-bank-create-form");
    const lessonField = content.querySelector("#academic-lesson-field");
    const lessonSelect =
      content.querySelector("#academic-material-lesson-select");
    const quranFields =
      content.querySelector("#quran-location-fields");
    const message =
      content.querySelector("#question-bank-form-message");

    const optionsEditor =
      content.querySelector("#question-options-editor");

    const optionsList =
      content.querySelector("#question-options-list");

    const optionsJsonInput =
      content.querySelector("#question-options-json");

    const correctAnswerInput =
      content.querySelector("#question-correct-answer");

    const addOptionButton =
      content.querySelector("#add-question-option");

    let questionOptions = [];
    let correctOptionIndex = null;

    const questionTypeSelect =
      form?.querySelector('[name="question_type"]');

    const isChoiceQuestion = () =>
      String(questionTypeSelect?.value || "").trim() ===
      "multiple_choice";

    const syncQuestionOptions = () => {
      const cleanOptions = questionOptions
        .map(item => String(item || "").trim());

      optionsJsonInput.value =
        cleanOptions.length
          ? JSON.stringify(cleanOptions)
          : "";

      if (
        Number.isInteger(correctOptionIndex) &&
        cleanOptions[correctOptionIndex]
      ) {
        correctAnswerInput.value =
          cleanOptions[correctOptionIndex];
      } else {
        correctAnswerInput.value = "";
      }
    };

    const renderQuestionOptions = () => {
      if (!optionsList) return;

      optionsList.innerHTML = questionOptions.length
        ? questionOptions.map((option, index) => `
            <div
              class="question-option-row ${
                index === correctOptionIndex
                  ? "is-correct"
                  : ""
              }"
              data-option-index="${index}"
            >
              <span class="question-option-number">
                ${index + 1}
              </span>

              <input
                type="radio"
                class="question-option-correct"
                name="question-correct-option"
                value="${index}"
                ${
                  index === correctOptionIndex
                    ? "checked"
                    : ""
                }
                aria-label="تحديد الخيار ${index + 1} كإجابة صحيحة"
              />

              <input
                type="text"
                class="question-option-input"
                value="${escapeHtml(option)}"
                placeholder="اكتبي نص الخيار ${index + 1}"
                autocomplete="off"
              />

              <button
                type="button"
                class="question-option-delete secondary-button"
                data-delete-option="${index}"
                aria-label="حذف الخيار ${index + 1}"
                ${
                  questionOptions.length <= 2
                    ? "disabled"
                    : ""
                }
              >
                ×
              </button>
            </div>
          `).join("")
        : `
            <div class="empty-state">
              <p>لم تتم إضافة أي خيارات بعد.</p>
              <small class="muted">
                أضيفي خيارين على الأقل لهذا النوع من الأسئلة.
              </small>
            </div>
          `;

      syncQuestionOptions();
    };

    const addQuestionOption = value => {
      const text = String(value || "").trim();

      questionOptions.push(text);

      if (
        correctOptionIndex === null &&
        questionOptions.length === 1
      ) {
        correctOptionIndex = 0;
      }

      renderQuestionOptions();
    };

    const updateOptionsVisibility = () => {
      if (!optionsEditor) return;

      const shouldShow = isChoiceQuestion();

      optionsEditor.hidden = !shouldShow;

      if (!shouldShow) {
        questionOptions = [];
        correctOptionIndex = null;

        if (optionsList) {
          optionsList.innerHTML = "";
        }

        if (optionsJsonInput) {
          optionsJsonInput.value = "";
        }

        if (correctAnswerInput) {
          correctAnswerInput.value = "";
        }

        return;
      }

      if (!questionOptions.length) {
        questionOptions = [
          "",
          ""
        ];

        correctOptionIndex = 0;
      }

      renderQuestionOptions();
    };

    addOptionButton?.addEventListener("click", () => {
      addQuestionOption("");
    });

    optionsList?.addEventListener("input", event => {
      const input =
        event.target.closest(".question-option-input");

      if (!input) return;

      const row =
        input.closest(".question-option-row");

      const index =
        Number(row?.dataset.optionIndex);

      if (!Number.isInteger(index)) return;

      questionOptions[index] = input.value;

      syncQuestionOptions();
    });

    optionsList?.addEventListener("change", event => {
      const radio =
        event.target.closest(".question-option-correct");

      if (!radio) return;

      const index = Number(radio.value);

      if (!Number.isInteger(index)) return;

      correctOptionIndex = index;

      renderQuestionOptions();
    });

    optionsList?.addEventListener("click", event => {
      const button =
        event.target.closest("[data-delete-option]");

      if (!button) return;

      if (questionOptions.length <= 2) {
        return;
      }

      const index =
        Number(button.dataset.deleteOption);

      if (!Number.isInteger(index)) return;

      questionOptions.splice(index, 1);

      if (correctOptionIndex === index) {
        correctOptionIndex = null;
      } else if (
        Number.isInteger(correctOptionIndex) &&
        correctOptionIndex > index
      ) {
        correctOptionIndex -= 1;
      }

      if (
        correctOptionIndex === null &&
        questionOptions.length
      ) {
        correctOptionIndex = 0;
      }

      renderQuestionOptions();
    });

    questionTypeSelect?.addEventListener(
      "change",
      updateOptionsVisibility
    );

    updateOptionsVisibility();


    const loadLessons = async subjectType => {
      if (!lessonField || !lessonSelect) return;

      if (subjectType === "quran") {
        lessonField.hidden = true;
        lessonSelect.required = false;
        quranFields.hidden = false;
        return;
      }

      lessonField.hidden = false;
      lessonSelect.required = true;
      quranFields.hidden = true;
      lessonSelect.innerHTML =
        `<option value="">جاري تحميل الدروس...</option>`;

      const materialsResult =
        await this.apiGet("/api/academic-materials");

      const materials = Array.isArray(materialsResult?.data)
        ? materialsResult.data
        : [];

      const approved = materials.filter(material =>
        String(material.subject_type) === subjectType &&
        String(material.status).toLowerCase() === "approved" &&
        Number(material.test_eligible) === 1
      );

      const lessons = [];

      for (const material of approved) {
        const unitsResult = await this.apiGet(
          `/api/academic-materials?action=units&material_id=${encodeURIComponent(material.id)}`
        );

        const units = Array.isArray(unitsResult?.data)
          ? unitsResult.data
          : [];

        for (const unit of units) {
          if (String(unit.status || "active").toLowerCase() !== "active") {
            continue;
          }

          const lessonsResult = await this.apiGet(
            `/api/academic-materials?action=lessons&unit_id=${encodeURIComponent(unit.id)}`
          );

          const unitLessons = Array.isArray(lessonsResult?.data)
            ? lessonsResult.data
            : [];

          for (const lesson of unitLessons) {
            if (String(lesson.status || "active").toLowerCase() === "active") {
              lessons.push({ material, unit, lesson });
            }
          }
        }
      }

      if (!lessons.length) {
        lessonSelect.innerHTML =
          `<option value="">لا توجد دروس معتمدة لهذه المادة</option>`;
        return;
      }

      lessonSelect.innerHTML = `
        <option value="">اختاري الدرس</option>
        ${lessons.map(({ material, unit, lesson }) => `
          <option value="${this.escape(lesson.id)}">
            ${this.escape(material.title || "مادة")} —
            ${this.escape(unit.title || "وحدة")} —
            ${this.escape(lesson.title || "درس")}
          </option>
        `).join("")}
      `;
    };

    const closeForm = () => {
      if (!formCard) return;
      formCard.hidden = true;
      form?.reset();
      if (lessonField) lessonField.hidden = true;
      if (quranFields) quranFields.hidden = false;
      if (message) message.innerHTML = "";
    };

    content
      .querySelector("#add-question-bank-question")
      ?.addEventListener("click", async () => {
        formCard.hidden = false;
        form.reset();

        const subjectSelect =
          form.querySelector('[name="subject_type"]');

        subjectSelect.value = "quran";

        questionOptions = [];
        correctOptionIndex = null;

        if (optionsJsonInput) {
          optionsJsonInput.value = "";
        }

        if (correctAnswerInput) {
          correctAnswerInput.value = "";
        }

        await loadLessons("quran");
        updateOptionsVisibility();

        formCard.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      });

    content
      .querySelector("#cancel-question-bank-form")
      ?.addEventListener("click", closeForm);

    content
      .querySelector("#cancel-question-bank-form-bottom")
      ?.addEventListener("click", closeForm);

    form
      ?.querySelector('[name="subject_type"]')
      ?.addEventListener("change", async event => {
        try {
          await loadLessons(String(event.target.value || "quran"));
        } catch (error) {
          if (message) {
            message.innerHTML = `
              <div class="error-state">
                ${this.escape(error?.message || "تعذر تحميل الدروس.")}
              </div>
            `;
          }
        }
      });

    form?.addEventListener("submit", async event => {
      event.preventDefault();
      if (!message) return;

      const data =
        Object.fromEntries(new FormData(form).entries());

      const subjectType = String(data.subject_type || "").trim();
      const lessonId =
        String(data.academic_material_lesson_id || "").trim();

      if (subjectType !== "quran" && !lessonId) {
        message.innerHTML = `
          <div class="error-state">
            يجب اختيار الدرس الأكاديمي المرتبط بالسؤال العلمي.
          </div>
        `;
        return;
      }

      let optionsJson = null;

      if (isChoiceQuestion()) {
        const cleanOptions = questionOptions
          .map(item => String(item || "").trim());

        if (cleanOptions.length < 2) {
          message.innerHTML = `
            <div class="error-state">
              يجب إضافة خيارين على الأقل.
            </div>
          `;
          return;
        }

        if (cleanOptions.some(item => !item)) {
          message.innerHTML = `
            <div class="error-state">
              يرجى كتابة نص جميع الاختيارات قبل الحفظ.
            </div>
          `;
          return;
        }

        if (!Number.isInteger(correctOptionIndex)) {
          message.innerHTML = `
            <div class="error-state">
              يرجى تحديد الإجابة الصحيحة.
            </div>
          `;
          return;
        }

        if (!cleanOptions[correctOptionIndex]) {
          message.innerHTML = `
            <div class="error-state">
              الإجابة الصحيحة المحددة غير صالحة.
            </div>
          `;
          return;
        }

        questionOptions = cleanOptions;

        syncQuestionOptions();

        optionsJson =
          JSON.stringify(cleanOptions);
      }

      message.innerHTML =
        `<div class="loading-state">جاري حفظ السؤال...</div>`;

      try {
        const response = await fetch("/api/question-bank", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            subject_type: subjectType,
            question_type: String(data.question_type || ""),
            difficulty: String(data.difficulty || "medium"),
            question_text: String(data.question_text || "").trim(),
            options_json: optionsJson,
            correct_answer:
              String(data.correct_answer || "").trim() || null,
            explanation:
              String(data.explanation || "").trim() || null,
            surah_number:
              subjectType === "quran" && data.surah_number
                ? Number(data.surah_number)
                : null,
            ayah_start:
              subjectType === "quran" && data.ayah_start
                ? Number(data.ayah_start)
                : null,
            ayah_end:
              subjectType === "quran" && data.ayah_end
                ? Number(data.ayah_end)
                : null,
            academic_material_lesson_id:
              subjectType === "quran"
                ? null
                : Number(lessonId)
          })
        });

        const result =
          await response.json().catch(() => null);

        if (!response.ok || result?.success === false) {
          throw new Error(
            result?.message ||
            result?.error ||
            "تعذر حفظ السؤال."
          );
        }

        await this.renderQuestionBankModule(title);
      } catch (error) {
        message.innerHTML = `
          <div class="error-state">
            ${this.escape(
              error?.message || "تعذر حفظ السؤال."
            )}
          </div>
        `;
      }
    });

    const list =
      content.querySelector("#question-bank-list");

    try {
      const result = await this.apiGet(
        "/api/question-bank?is_active=1&limit=200"
      );

      const rows = Array.isArray(result?.data)
        ? result.data
        : Array.isArray(result?.questions)
          ? result.questions
          : [];

      list.innerHTML = rows.length
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
                  <th>الدرس</th>
                  <th>الموضع القرآني</th>
                  <th>المنشئ</th>
                </tr>
              </thead>
              <tbody>
                ${rows.map(row => `
                  <tr>
                    <td>${this.escape(row.id)}</td>
                    <td>${this.escape(
                      subjectLabels[row.subject_type] ||
                      row.subject_type ||
                      "—"
                    )}</td>
                    <td>${this.escape(
                      typeLabels[row.question_type] ||
                      row.question_type ||
                      "—"
                    )}</td>
                    <td>${this.escape(
                      difficultyLabels[row.difficulty] ||
                      row.difficulty ||
                      "—"
                    )}</td>
                    <td>${this.escape(row.question_text || "—")}</td>
                    <td>${this.escape(
                      row.academic_material_lesson_title ||
                      row.lesson_title ||
                      "—"
                    )}</td>
                    <td>${row.surah_number
                      ? `سورة ${this.escape(row.surah_number)}${
                          row.ayah_start
                            ? ` — ${this.escape(row.ayah_start)}${
                                row.ayah_end &&
                                row.ayah_end !== row.ayah_start
                                  ? `–${this.escape(row.ayah_end)}`
                                  : ""
                              }`
                            : ""
                        }`
                      : "—"}</td>
                    <td>${this.escape(row.creator_name || "—")}</td>
                  </tr>
                `).join("")}
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
        `;
    } catch (error) {
      list.innerHTML = `
        <div class="empty-state premium-empty">
          <div class="empty-icon">!</div>
          <h3>تعذر تحميل بنك الأسئلة</h3>
          <p>${this.escape(
            error?.message || "حدث خطأ غير متوقع."
          )}</p>
        </div>
      `;
    }

    content.querySelector("#refresh-module")?.addEventListener(
      "click",
      () => this.renderModule("question-bank")
    );
  }
  async renderAcademicMaterialsModule(title) {
    const content = this.root.querySelector("#module-live-content");
    if (!content) return;

    const canManage =
      ["admin", "supervisor", "teacher"].includes(this.user?.role);

    content.innerHTML = `
      <div class="section-heading">
        <div>
          <span class="eyebrow">📚 المنهج الأكاديمي</span>
          <h3>${this.escape(title)}</h3>
          <p>المواد العلمية والوحدات والدروس المعتمدة التي يمكن بناء الاختبارات منها.</p>
        </div>

        <div class="section-actions">
          ${
            canManage
              ? `<button class="primary-button" id="add-academic-material" type="button">
                  ➕ إضافة مادة
                </button>`
              : ""
          }

          <button class="secondary-button" id="refresh-academic-materials" type="button">
            تحديث
          </button>
        </div>
      </div>

      <div id="academic-materials-list">
        <div class="loading-state">
          <div class="loading-spinner"></div>
          <h3>جاري تحميل المواد الأكاديمية...</h3>
        </div>
      </div>
    `;

    const subjectLabels = {
      tajweed: "التجويد",
      tafsir: "التفسير",
      fiqh: "الفقه",
      hadith: "الحديث",
      sirah: "السيرة",
      noorani_qaida: "القاعدة النورانية",
      other: "مواد أخرى"
    };

    const loadMaterials = async () => {
      const list = content.querySelector("#academic-materials-list");
      if (!list) return;

      try {
        const result = await this.apiGet("/api/academic-materials");
        const rows = Array.isArray(result?.data)
          ? result.data
          : Array.isArray(result?.materials)
            ? result.materials
            : [];

        if (!rows.length) {
          list.innerHTML = `
            <div class="empty-state">
              <div class="empty-icon">📚</div>
              <h3>لا توجد مواد أكاديمية بعد</h3>
              <p>ابدئي بإضافة مادة علمية، ثم أضيفي وحداتها ودروسها.</p>
            </div>
          `;
          return;
        }

        list.innerHTML = `
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>المادة</th>
                  <th>التخصص</th>
                  <th>الحالة</th>
                  <th>الاختبارات</th>
                  <th>المنشئ</th>
                </tr>
              </thead>
              <tbody>
                ${rows.map(row => `
                  <tr
                    class="academic-material-row"
                    data-material-id="${this.escape(row.id)}"
                    style="cursor:pointer;"
                    title="فتح المادة"
                  >
                    <td>${this.escape(row.id)}</td>
                    <td>
                      <strong>${this.escape(row.title || "—")}</strong>
                      ${
                        row.description
                          ? `<div class="muted">${this.escape(row.description)}</div>`
                          : ""
                      }
                    </td>
                    <td>
                      ${this.escape(
                        subjectLabels[row.subject_type] ||
                        row.subject_type ||
                        "—"
                      )}
                    </td>
                    <td>
                      ${
                        row.status === "approved"
                          ? "✅ معتمدة"
                          : row.status === "archived"
                            ? "📦 مؤرشفة"
                            : "📝 مسودة"
                      }
                    </td>
                    <td>
                      ${
                        Number(row.test_eligible)
                          ? "✅ مؤهلة"
                          : "—"
                      }
                    </td>
                    <td>${this.escape(row.creator_name || "—")}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        `;

        list
          .querySelectorAll(".academic-material-row")
          .forEach(row => {
            row.addEventListener("click", () => {
              const materialId = Number(row.dataset.materialId);

              if (!Number.isInteger(materialId) || materialId <= 0) {
                return;
              }

              this.openAcademicMaterialEditor(
                materialId,
                subjectLabels
              );
            });
          });
      } catch (error) {
        list.innerHTML = `
          <div class="empty-state premium-empty">
            <div class="empty-icon">!</div>
            <h3>تعذر تحميل المواد الأكاديمية</h3>
            <p>${this.escape(error?.message || "حدث خطأ غير متوقع.")}</p>
            <button class="secondary-button" id="retry-academic-materials" type="button">
              إعادة المحاولة
            </button>
          </div>
        `;

        list.querySelector("#retry-academic-materials")?.addEventListener(
          "click",
          loadMaterials
        );
      }
    };

    content.querySelector("#refresh-academic-materials")?.addEventListener(
      "click",
      loadMaterials
    );

    content.querySelector("#add-academic-material")?.addEventListener(
      "click",
      () => this.openAcademicMaterialEditor(null, subjectLabels)
    );

    await loadMaterials();
  }

  async openAcademicMaterialEditor(materialId, subjectLabels) {
    const content = this.root.querySelector("#module-live-content");
    if (!content) return;

    const isNew = !materialId;
    let material = null;

    if (materialId) {
      try {
        const result = await this.apiGet("/api/academic-materials");
        const rows = Array.isArray(result?.data) ? result.data : [];
        material =
          rows.find(row => Number(row.id) === Number(materialId)) || null;
      } catch (error) {
        content.innerHTML = `
          <div class="empty-state premium-empty">
            <h3>تعذر فتح المادة</h3>
            <p>${this.escape(error?.message || "حدث خطأ غير متوقع.")}</p>
            <button class="secondary-button" id="back-academic-materials" type="button">
              العودة
            </button>
          </div>
        `;
        content.querySelector("#back-academic-materials")?.addEventListener(
          "click",
          () => this.renderModule("academic-materials")
        );
        return;
      }
    }

    const subjectOptions = Object.entries(subjectLabels)
      .map(([value, label]) => `
        <option value="${value}" ${
          material?.subject_type === value ? "selected" : ""
        }>${label}</option>
      `)
      .join("");

    content.innerHTML = `
      <div class="section-heading">
        <div>
          <span class="eyebrow">📚 المادة الأكاديمية</span>
          <h3>${isNew ? "إضافة مادة جديدة" : this.escape(material?.title || "تعديل المادة")}</h3>
          <p>المادة تُنشأ كمسودة، ولا تدخل الاختبارات إلا بعد اعتمادها من الإدارة.</p>
        </div>

        <button class="secondary-button" id="back-academic-materials" type="button">
          ← العودة
        </button>
      </div>

      <form class="content-card" id="academic-material-form">
        <div class="form-grid">

          <label>
            <span>عنوان المادة</span>
            <input
              name="title"
              required
              value="${this.escape(material?.title || "")}"
              placeholder="مثال: أحكام النون الساكنة والتنوين"
            />
          </label>

          <label>
            <span>نوع المادة</span>
            <select name="subject_type" required>
              ${subjectOptions}
            </select>
          </label>

          <label class="form-grid-full">
            <span>وصف المادة</span>
            <textarea
              name="description"
              rows="3"
              placeholder="وصف مختصر للمادة وأهدافها"
            >${this.escape(material?.description || "")}</textarea>
          </label>

          <label class="form-grid-full">
            <span>المحتوى العام</span>
            <textarea
              name="content"
              rows="7"
              placeholder="المحتوى العلمي العام للمادة..."
            >${this.escape(material?.content || "")}</textarea>
          </label>

          <label class="form-grid-full">
            <span>رابط خارجي اختياري</span>
            <input
              name="external_url"
              type="url"
              value="${this.escape(material?.external_url || "")}"
              placeholder="https://..."
            />
          </label>

        </div>

        <div class="section-actions">
          <button class="primary-button" type="submit">
            ${isNew ? "حفظ المادة كمسودة" : "حفظ التعديلات"}
          </button>

          ${
            materialId && ["admin", "supervisor"].includes(this.user?.role) &&
            String(material?.status || "draft").toLowerCase() !== "approved"
              ? `
                <button
                  class="primary-button"
                  id="approve-academic-material"
                  type="button"
                >
                  ✅ اعتماد المادة
                </button>
              `
              : ""
          }

          <button class="secondary-button" id="cancel-academic-material" type="button">
            إلغاء
          </button>
        </div>

        <div id="academic-material-form-message"></div>

        ${
          materialId
            ? `
              <div class="content-card" style="margin-top:12px;">
                <strong>حالة المادة:</strong>
                ${
                  String(material?.status || "draft").toLowerCase() === "approved"
                    ? "🟢 معتمدة — ✅ مؤهلة للاختبارات"
                    : "📝 مسودة — تنتظر اعتماد الإدارة"
                }
              </div>
            `
            : ""
        }
      </form>

      ${
        materialId
          ? `
            <section class="content-card" id="academic-material-structure">
              <div class="loading-state">
                <div class="loading-spinner"></div>
                <h3>جاري تحميل الوحدات...</h3>
              </div>
            </section>
          `
          : ""
      }
    `;

    content.querySelector("#back-academic-materials")?.addEventListener(
      "click",
      () => this.renderModule("academic-materials")
    );

    content.querySelector("#cancel-academic-material")?.addEventListener(
      "click",
      () => this.renderModule("academic-materials")
    );

    content.querySelector("#approve-academic-material")?.addEventListener(
      "click",
      async () => {
        const button = content.querySelector("#approve-academic-material");
        const message = content.querySelector(
          "#academic-material-form-message"
        );

        if (!button || !materialId) return;

        if (!["admin", "supervisor"].includes(this.user?.role)) {
          return;
        }

        button.disabled = true;
        button.textContent = "جاري اعتماد المادة...";

        try {
          const response = await fetch(
            `/api/academic-materials?id=${encodeURIComponent(materialId)}`,
            {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json"
              },
              credentials: "include",
              body: JSON.stringify({
                id: materialId,
                status: "approved"
              })
            }
          );

          const data = await response.json().catch(() => null);

          if (!response.ok || data?.success === false) {
            throw new Error(
              data?.message ||
              data?.error ||
              "تعذر اعتماد المادة."
            );
          }

          if (message) {
            message.innerHTML = `
              <div class="success-state">
                تم اعتماد المادة بنجاح، وأصبحت مؤهلة للاختبارات.
              </div>
            `;
          }

          setTimeout(() => {
            this.openAcademicMaterialEditor(
              Number(materialId),
              subjectLabels
            );
          }, 400);
        } catch (error) {
          button.disabled = false;
          button.textContent = "✅ اعتماد المادة";

          if (message) {
            message.innerHTML = `
              <div class="error-state">
                ${this.escape(
                  error?.message || "تعذر اعتماد المادة."
                )}
              </div>
            `;
          }
        }
      }
    );

    content.querySelector("#academic-material-form")?.addEventListener(
      "submit",
      async event => {
        event.preventDefault();

        const form = event.currentTarget;
        const message = form.querySelector(
          "#academic-material-form-message"
        );

        const formData = new FormData(form);

        const body = {
          title: String(formData.get("title") || "").trim(),
          subject_type: String(formData.get("subject_type") || ""),
          description: String(formData.get("description") || "").trim(),
          content: String(formData.get("content") || "").trim(),
          external_url: String(formData.get("external_url") || "").trim()
        };

        try {
          const response = await fetch(
            isNew
              ? "/api/academic-materials"
              : `/api/academic-materials?id=${encodeURIComponent(materialId)}`,
            {
              method: isNew ? "POST" : "PATCH",
              headers: {
                "Content-Type": "application/json"
              },
              credentials: "include",
              body: JSON.stringify(
                isNew ? body : { id: materialId, ...body }
              )
            }
          );

          const data = await response.json().catch(() => null);

          if (!response.ok || data?.success === false) {
            throw new Error(
              data?.message ||
              data?.error ||
              "تعذر حفظ المادة."
            );
          }

          message.innerHTML = `
            <div class="success-state">
              تم حفظ المادة بنجاح كمسودة.
            </div>
          `;

          if (isNew && data?.data?.id) {
            setTimeout(() => {
              this.openAcademicMaterialEditor(
                Number(data.data.id),
                subjectLabels
              );
            }, 250);
          }
        } catch (error) {
          message.innerHTML = `
            <div class="error-state">
              ${this.escape(error?.message || "تعذر حفظ المادة.")}
            </div>
          `;
        }
      }
    );

    if (materialId) {
      await this.loadAcademicMaterialStructure(
        Number(materialId),
        subjectLabels
      );
    }
  }

  async loadAcademicMaterialStructure(materialId, subjectLabels) {
    const structure =
      this.root.querySelector("#academic-material-structure");

    if (!structure) return;

    try {
      const result = await this.apiGet(
        `/api/academic-materials?action=units&material_id=${encodeURIComponent(materialId)}`
      );

      const units = Array.isArray(result?.data)
        ? result.data
        : [];

      structure.innerHTML = `
        <div class="section-heading">
          <div>
            <span class="eyebrow">هيكل المادة</span>
            <h3>الوحدات والدروس</h3>
            <p>أضيفي الوحدات ثم الدروس التابعة لكل وحدة.</p>
          </div>

          <button class="primary-button" id="add-academic-unit" type="button">
            ➕ إضافة وحدة
          </button>
        </div>

        ${
          units.length
            ? units.map(unit => `
                <div class="content-card academic-unit-card">
                  <div class="section-heading">
                    <div>
                      <h3>${this.escape(unit.title || "وحدة")}</h3>
                      <p>${this.escape(unit.description || "بدون وصف")}</p>
                    </div>

                    <button
                      class="secondary-button academic-add-lesson"
                      type="button"
                      data-unit-id="${this.escape(unit.id)}"
                    >
                      ➕ إضافة درس
                    </button>
                  </div>

                  <div
                    class="academic-lessons"
                    data-unit-id="${this.escape(unit.id)}"
                  >
                    جاري تحميل الدروس...
                  </div>
                </div>
              `).join("")
            : `
              <div class="empty-state">
                <div class="empty-icon">📘</div>
                <h3>لا توجد وحدات بعد</h3>
                <p>أضيفي أول وحدة للمادة.</p>
              </div>
            `
        }
      `;

      structure.querySelector("#add-academic-unit")?.addEventListener(
        "click",
        () => this.addAcademicUnit(materialId, subjectLabels)
      );

      structure.querySelectorAll(".academic-add-lesson").forEach(button => {
        button.addEventListener("click", () => {
          this.addAcademicLesson(
            Number(button.dataset.unitId),
            materialId,
            subjectLabels
          );
        });
      });

      for (const container of structure.querySelectorAll(
        ".academic-lessons"
      )) {
        await this.loadAcademicLessons(
          Number(container.dataset.unitId),
          container
        );
      }
    } catch (error) {
      structure.innerHTML = `
        <div class="empty-state premium-empty">
          <h3>تعذر تحميل هيكل المادة</h3>
          <p>${this.escape(error?.message || "حدث خطأ غير متوقع.")}</p>
        </div>
      `;
    }
  }

  async loadAcademicLessons(unitId, container) {
    try {
      const result = await this.apiGet(
        `/api/academic-materials?action=lessons&unit_id=${encodeURIComponent(unitId)}`
      );

      const lessons = Array.isArray(result?.data)
        ? result.data
        : [];

      container.innerHTML = lessons.length
        ? `
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>الدرس</th>
                  <th>المحتوى</th>
                  <th>الرابط</th>
                </tr>
              </thead>

              <tbody>
                ${lessons.map(lesson => `
                  <tr
                    class="academic-material-lesson-row"
                    data-lesson-id="${this.escape(lesson.id)}"
                    style="cursor:pointer;"
                    title="فتح الدرس"
                  >
                    <td>${this.escape(lesson.id)}</td>
                    <td><strong>${this.escape(lesson.title || "—")}</strong></td>
                    <td>
                      ${this.escape(
                        lesson.content
                          ? String(lesson.content).slice(0, 140)
                          : "—"
                      )}
                    </td>
                    <td>${lesson.external_url ? "🔗 متاح" : "—"}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        `
        : `<div class="muted">لا توجد دروس بعد.</div>`;

      container
        .querySelectorAll(".academic-material-lesson-row")
        .forEach(row => {
          row.addEventListener("click", () => {
            const lessonId = Number(row.dataset.lessonId);

            if (!Number.isInteger(lessonId) || lessonId <= 0) {
              return;
            }

            this.openAcademicLessonEditor(lessonId);
          });
        });
    } catch (error) {
      container.innerHTML = `
        <div class="error-state">
          ${this.escape(error?.message || "تعذر تحميل الدروس.")}
        </div>
      `;
    }
  }

  async openAcademicLessonEditor(lessonId) {
    const content = this.root.querySelector("#module-live-content");

    if (!content) return;

    if (!Number.isInteger(Number(lessonId)) || Number(lessonId) <= 0) {
      return;
    }

    content.innerHTML = `
      <div class="loading-state">
        <div class="loading-spinner"></div>
        <h3>جاري تحميل الدرس...</h3>
      </div>
    `;

    try {
      const result = await this.apiGet(
        `/api/academic-materials?action=lesson&id=${encodeURIComponent(lessonId)}`
      );

      const lesson = result?.data;

      if (!lesson) {
        throw new Error("تعذر العثور على الدرس.");
      }

      content.innerHTML = `
        <div class="section-heading">
          <div>
            <span class="eyebrow">المواد التعليمية</span>
            <h3>تعديل الدرس</h3>
            <p>
              تعديل محتوى الدرس وروابطه وترتيبه دون حذف بياناته.
            </p>
          </div>

          <button
            class="secondary-button"
            id="back-academic-lesson"
            type="button"
          >
            ← العودة للمادة
          </button>
        </div>

        <form id="academic-lesson-form" class="content-card">
          <div class="form-grid">

            <label class="field">
              <span>عنوان الدرس</span>
              <input
                type="text"
                name="title"
                value="${this.escape(lesson.title || "")}"
                required
              />
            </label>

            <label class="field">
              <span>ترتيب الدرس</span>
              <input
                type="number"
                name="sort_order"
                min="0"
                step="1"
                value="${this.escape(
                  Number.isInteger(Number(lesson.sort_order))
                    ? Number(lesson.sort_order)
                    : 0
                )}"
              />
            </label>

          </div>

          <label class="field">
            <span>محتوى الدرس</span>
            <textarea
              name="content"
              rows="12"
              placeholder="اكتبي محتوى الدرس هنا..."
            >${this.escape(lesson.content || "")}</textarea>
          </label>

          <label class="field">
            <span>الرابط الخارجي</span>
            <input
              type="url"
              name="external_url"
              value="${this.escape(lesson.external_url || "")}"
              placeholder="https://..."
            />
          </label>

          <label class="field">
            <span>معرّف المستند</span>
            <input
              type="number"
              name="document_id"
              min="1"
              step="1"
              value="${lesson.document_id ? this.escape(lesson.document_id) : ""}"
              placeholder="اختياري"
            />
          </label>

          <div id="academic-lesson-form-message"></div>

          <div class="section-heading" style="margin-top:16px;">
            <div>
              <strong>حالة الدرس</strong>
              <p>
                ${
                  lesson.status === "active"
                    ? "🟢 الدرس نشط ويظهر ضمن المادة."
                    : "🟠 الدرس مؤرشف."
                }
              </p>
            </div>

            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button
                class="secondary-button"
                id="archive-academic-lesson"
                type="button"
              >
                ${
                  lesson.status === "active"
                    ? "📦 أرشفة الدرس"
                    : "♻️ إعادة تفعيل الدرس"
                }
              </button>

              <button
                class="primary-button"
                type="submit"
              >
                💾 حفظ التعديلات
              </button>
            </div>
          </div>
        </form>
      `;

      content.querySelector("#back-academic-lesson")?.addEventListener(
        "click",
        () => this.renderModule("academic-materials")
      );

      const form = content.querySelector("#academic-lesson-form");
      const message = content.querySelector(
        "#academic-lesson-form-message"
      );

      form?.addEventListener("submit", async event => {
        event.preventDefault();

        const formData = new FormData(form);

        const title = String(
          formData.get("title") || ""
        ).trim();

        if (!title) {
          if (message) {
            message.innerHTML = `
              <div class="error-state">
                عنوان الدرس مطلوب.
              </div>
            `;
          }
          return;
        }

        const sortOrder = Number(
          formData.get("sort_order") || 0
        );

        if (!Number.isInteger(sortOrder) || sortOrder < 0) {
          if (message) {
            message.innerHTML = `
              <div class="error-state">
                ترتيب الدرس غير صالح.
              </div>
            `;
          }
          return;
        }

        const documentValue = String(
          formData.get("document_id") || ""
        ).trim();

        const body = {
          id: Number(lessonId),
          title,
          content: String(
            formData.get("content") || ""
          ).trim(),
          external_url: String(
            formData.get("external_url") || ""
          ).trim(),
          sort_order: sortOrder,
          document_id: documentValue
            ? Number(documentValue)
            : null
        };

        try {
          const response = await fetch(
            `/api/academic-materials?action=lesson&id=${encodeURIComponent(lessonId)}`,
            {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json"
              },
              credentials: "include",
              body: JSON.stringify(body)
            }
          );

          const data = await response.json().catch(() => null);

          if (!response.ok || data?.success === false) {
            throw new Error(
              data?.message ||
              data?.error ||
              "تعذر حفظ الدرس."
            );
          }

          if (message) {
            message.innerHTML = `
              <div class="success-state">
                تم حفظ الدرس بنجاح.
              </div>
            `;
          }

          if (data?.data) {
            lesson.title = data.data.title;
            lesson.content = data.data.content;
            lesson.external_url = data.data.external_url;
            lesson.document_id = data.data.document_id;
            lesson.sort_order = data.data.sort_order;
          }
        } catch (error) {
          if (message) {
            message.innerHTML = `
              <div class="error-state">
                ${this.escape(
                  error?.message || "تعذر حفظ الدرس."
                )}
              </div>
            `;
          }
        }
      });

      content.querySelector("#archive-academic-lesson")?.addEventListener(
        "click",
        async () => {
          const button = content.querySelector(
            "#archive-academic-lesson"
          );

          if (!button) return;

          const nextStatus =
            lesson.status === "active"
              ? "archived"
              : "active";

          button.disabled = true;

          try {
            const response = await fetch(
              `/api/academic-materials?action=lesson&id=${encodeURIComponent(lessonId)}`,
              {
                method: "PATCH",
                headers: {
                  "Content-Type": "application/json"
                },
                credentials: "include",
                body: JSON.stringify({
                  id: Number(lessonId),
                  status: nextStatus
                })
              }
            );

            const data = await response.json().catch(() => null);

            if (!response.ok || data?.success === false) {
              throw new Error(
                data?.message ||
                data?.error ||
                "تعذر تغيير حالة الدرس."
              );
            }

            lesson.status = nextStatus;

            await this.openAcademicLessonEditor(
              Number(lessonId)
            );
          } catch (error) {
            button.disabled = false;

            if (message) {
              message.innerHTML = `
                <div class="error-state">
                  ${this.escape(
                    error?.message ||
                    "تعذر تغيير حالة الدرس."
                  )}
                </div>
              `;
            }
          }
        }
      );
    } catch (error) {
      content.innerHTML = `
        <div class="empty-state premium-empty">
          <h3>تعذر فتح الدرس</h3>
          <p>
            ${this.escape(
              error?.message ||
              "حدث خطأ غير متوقع."
            )}
          </p>
          <button
            class="secondary-button"
            id="back-academic-lesson-error"
            type="button"
          >
            العودة
          </button>
        </div>
      `;

      content.querySelector(
        "#back-academic-lesson-error"
      )?.addEventListener(
        "click",
        () => this.renderModule("academic-materials")
      );
    }
  }

  async addAcademicUnit(materialId, subjectLabels) {
    const title = window.prompt("عنوان الوحدة:");
    if (!title?.trim()) return;

    const description =
      window.prompt("وصف الوحدة (اختياري):") || "";

    try {
      const response = await fetch(
        "/api/academic-materials?action=unit",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          credentials: "include",
          body: JSON.stringify({
            material_id: materialId,
            title: title.trim(),
            description: description.trim()
          })
        }
      );

      const data = await response.json().catch(() => null);

      if (!response.ok || data?.success === false) {
        throw new Error(
          data?.message ||
          data?.error ||
          "تعذر إضافة الوحدة."
        );
      }

      await this.loadAcademicMaterialStructure(
        materialId,
        subjectLabels
      );
    } catch (error) {
      window.alert(
        error?.message || "تعذر إضافة الوحدة."
      );
    }
  }

  async addAcademicLesson(unitId, materialId, subjectLabels) {
    const title = window.prompt("عنوان الدرس:");
    if (!title?.trim()) return;

    const content = window.prompt(
      "المحتوى المختصر للدرس (اختياري):"
    ) || "";

    const externalUrl = window.prompt(
      "رابط خارجي للدرس (اختياري):"
    ) || "";

    try {
      const response = await fetch(
        "/api/academic-materials?action=lesson",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          credentials: "include",
          body: JSON.stringify({
            unit_id: unitId,
            title: title.trim(),
            content: content.trim(),
            external_url: externalUrl.trim()
          })
        }
      );

      const data = await response.json().catch(() => null);

      if (!response.ok || data?.success === false) {
        throw new Error(
          data?.message ||
          data?.error ||
          "تعذر إضافة الدرس."
        );
      }

      await this.loadAcademicMaterialStructure(
        materialId,
        subjectLabels
      );
    } catch (error) {
      window.alert(
        error?.message || "تعذر إضافة الدرس."
      );
    }
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

    const sponsorshipSetting = rows.find(
      row => row.setting_key === "academy.sponsorship_seats_open"
    );

    const individualSetting = rows.find(
      row => row.setting_key === "academy.individual_booking_open"
    );

    const isSettingOpen = (value) =>
      value === true ||
      value === 1 ||
      String(value).toLowerCase() === "true" ||
      String(value) === "1";

    const sponsorshipOpen =
      isSettingOpen(sponsorshipSetting?.setting_value);

    const individualOpen =
      isSettingOpen(individualSetting?.setting_value);

    content.innerHTML = `
      <div class="section-heading">
        <div>
          <span class="eyebrow">إدارة الأكاديمية</span>
          <h3>${this.escape(title)}</h3>
          <p>التحكم في الخدمات المتاحة للطلاب وإعدادات الأكاديمية.</p>
        </div>
        <button class="secondary-button" id="refresh-module" type="button">
          تحديث
        </button>
      </div>

      <section class="premium-card" style="margin-bottom:20px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;">
          <div>
            <span class="eyebrow">إتاحة الخدمات للطلاب</span>
            <h3 style="margin:6px 0;">فتح وإغلاق الخدمات</h3>
            <p style="margin:0;">
              يتحكم هذا القسم في إمكانية الطلاب استخدام الكفالة والحجز الفردي.
            </p>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-top:18px;">

          <div class="premium-card" style="margin:0;">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;">
              <div>
                <strong>كفالة مقاعد الطلاب</strong>
                <p style="margin:6px 0 0;">
                  ${sponsorshipOpen
                    ? "الطلاب يستطيعون التقديم والاستفادة من الكفالات المتاحة."
                    : "التقديم والاستفادة من كفالة المقاعد مغلقان حاليًا."}
                </p>
              </div>

              <button
                type="button"
                class="${sponsorshipOpen ? "primary-button" : "secondary-button"} availability-toggle"
                data-setting-id="${sponsorshipSetting?.id ?? ""}"
                data-setting-key="academy.sponsorship_seats_open"
                data-next-value="${sponsorshipOpen ? "0" : "1"}"
                ${sponsorshipSetting?.id ? "" : "disabled"}
              >
                ${sponsorshipOpen ? "إغلاق الكفالة" : "فتح الكفالة"}
              </button>
            </div>

            <div style="margin-top:12px;">
              <span class="status-badge">
                ${sponsorshipOpen ? "مفتوحة للطلاب" : "مغلقة للطلاب"}
              </span>
            </div>
          </div>

          <div class="premium-card" style="margin:0;">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;">
              <div>
                <strong>الحجز الفردي</strong>
                <p style="margin:6px 0 0;">
                  ${individualOpen
                    ? "الطلاب يستطيعون إرسال طلبات الحجز الفردي."
                    : "إرسال طلبات الحجز الفردي مغلق حاليًا."}
                </p>
              </div>

              <button
                type="button"
                class="${individualOpen ? "primary-button" : "secondary-button"} availability-toggle"
                data-setting-id="${individualSetting?.id ?? ""}"
                data-setting-key="academy.individual_booking_open"
                data-next-value="${individualOpen ? "0" : "1"}"
                ${individualSetting?.id ? "" : "disabled"}
              >
                ${individualOpen ? "إغلاق الحجز" : "فتح الحجز"}
              </button>
            </div>

            <div style="margin-top:12px;">
              <span class="status-badge">
                ${individualOpen ? "مفتوح للطلاب" : "مغلق للطلاب"}
              </span>
            </div>
          </div>

        </div>
      </section>

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

    content.querySelectorAll(".availability-toggle").forEach(button => {
      button.addEventListener("click", async () => {
        const settingId = Number(button.dataset.settingId);
        const settingKey = button.dataset.settingKey;
        const nextValue = button.dataset.nextValue;

        if (!Number.isFinite(settingId) || !settingKey) {
          return;
        }

        const originalText = button.textContent;
        button.disabled = true;
        button.textContent = "جارٍ الحفظ...";

        try {
          const response = await fetch("/api/settings", {
            method: "PATCH",
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json"
            },
            body: JSON.stringify({
              id: settingId,
              setting_key: settingKey,
              setting_value: nextValue
            })
          });

          const data = await response.json().catch(() => ({}));

          if (!response.ok || !data.success) {
            throw new Error(
              data.message ||
              data.error ||
              "تعذر حفظ إعداد الخدمة."
            );
          }

          await this.renderModule("settings");
        } catch (error) {
          button.disabled = false;
          button.textContent = originalText;
          alert(error.message || "حدث خطأ أثناء تحديث الإعداد.");
        }
      });
    });
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
