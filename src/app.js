export class App {
  constructor(root) {
    this.root = root;
    this.user = null;
    this.render();
  }

  async render() {
    this.root.innerHTML = `
      <main class="app-shell" dir="rtl">
        <header class="app-header">
          <h1>الأوَّابين</h1>
          <p>أكاديمية القرآن الكريم</p>
        </header>

        <section class="app-content" id="app-content">
          <h2>جاري التحقق من تسجيل الدخول...</h2>
        </section>
      </main>
    `;

    try {
      const response = await fetch('/api/auth?action=me', {
        credentials: 'include',
        headers: { Accept: 'application/json' }
      });

      const data = await response.json().catch(() => ({}));

      if (response.ok && data.authenticated) {
        this.user = data.user;
        this.renderDashboard();
      } else {
        this.renderLogin();
      }
    } catch {
      this.renderLogin('تعذر الاتصال بخدمة تسجيل الدخول.');
    }
  }

  renderLogin(message = '') {
    const content = this.root.querySelector('#app-content');

    content.innerHTML = `
      <div class="auth-card">
        <h2>تسجيل الدخول</h2>
        <p>أدخل رقم الهاتف أو البريد الإلكتروني وكلمة المرور.</p>

        ${message ? `<p class="error-message">${this.escape(message)}</p>` : ''}

        <form id="login-form">
          <label for="identifier">رقم الهاتف أو البريد الإلكتروني</label>
          <input
            id="identifier"
            name="identifier"
            type="text"
            autocomplete="username"
            required
          >

          <label for="password">كلمة المرور</label>
          <input
            id="password"
            name="password"
            type="password"
            autocomplete="current-password"
            required
          >

          <button type="submit">دخول</button>

          <p id="login-error" class="error-message" hidden></p>
        </form>
      </div>
    `;

    this.root
      .querySelector('#login-form')
      .addEventListener('submit', (event) => this.login(event));
  }

  async login(event) {
    event.preventDefault();

    const form = event.currentTarget;
    const button = form.querySelector('button');
    const error = form.querySelector('#login-error');

    const identifier = form.identifier.value.trim();
    const password = form.password.value;

    button.disabled = true;
    button.textContent = 'جارٍ الدخول...';
    error.hidden = true;

    try {
      const response = await fetch('/api/auth?action=login', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          identifier,
          password
        })
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.authenticated) {
        throw new Error(
          data.message || 'بيانات تسجيل الدخول غير صحيحة.'
        );
      }

      this.user = data.user;
      this.renderDashboard();

    } catch (err) {
      error.textContent =
        err.message || 'حدث خطأ أثناء تسجيل الدخول.';

      error.hidden = false;

      button.disabled = false;
      button.textContent = 'دخول';
    }
  }

  renderDashboard() {
    const name = this.escape(
      this.user?.full_name || 'المستخدم'
    );

    const role = this.escape(
      this.user?.role || ''
    );

    this.root.querySelector('#app-content').innerHTML = `
      <div class="dashboard-card">
        <h2>مرحبًا، ${name}</h2>

        <p>تم تسجيل الدخول بنجاح.</p>

        <p>
          الصلاحية:
          <strong>${role}</strong>
        </p>

        <button id="logout-button" type="button">
          تسجيل الخروج
        </button>
      </div>
    `;

    this.root
      .querySelector('#logout-button')
      .addEventListener('click', () => this.logout());
  }

  async logout() {
    try {
      await fetch('/api/auth?action=logout', {
        method: 'POST',
        credentials: 'include',
        headers: {
          Accept: 'application/json'
        }
      });
    } finally {
      this.user = null;
      this.renderLogin();
    }
  }

  escape(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }
}
