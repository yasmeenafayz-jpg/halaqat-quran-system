# بنية الأوَّابين

- Frontend: Vite + JavaScript خفيف مناسب للهاتف.
- Hosting: Cloudflare Pages.
- Database: Cloudflare D1.
- API: Pages Functions، مع Worker مستقل اختياري.
- PWA: manifest + بنية قابلة لإضافة Service Worker.
- Migrations: داخل `migrations/` بالترتيب.

القاعدة: لا تُحذف النسخة الأصلية قبل التأكد من نجاح البناء والاختبار.
