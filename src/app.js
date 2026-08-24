export class App {
  constructor(root) {
    this.root = root;
    this.render();
  }

  render() {
    this.root.innerHTML = `
      <main class="app-shell">
        <header class="app-header">
          <h1>الأوَّابين</h1>
          <p>أكاديمية القرآن الكريم</p>
        </header>

        <section class="app-content">
          <h2>مرحبًا بكم في الأوَّابين</h2>
          <p>جاري تجهيز لوحة النظام...</p>
        </section>
      </main>
    `;
  }
}
