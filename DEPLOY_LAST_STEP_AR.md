# آخر خطوة — الرفع فقط

هذه الصفحة لا تحتوي على برمجة. كل الملفات جاهزة.

## قبل الرفع
يلزم حساب Cloudflare مجاني فقط. لا تحتاجين GitHub أو Docker أو Android Studio.

## عند إنشاء قاعدة D1
أنشئي قاعدة باسم:
`halaqat-db`

ثم انسخي Database ID الذي يعرضه Cloudflare وضعيه مكان:
`REPLACE_AFTER_CREATE`
في `wrangler.toml`.

## الأسرار
من إعدادات Worker أضيفي Secrets:
- `ADMIN_PASSWORD`: كلمة مرور المشرف.
- `SESSION_SECRET`: قيمة طويلة عشوائية.
- `TELEGRAM_BOT_TOKEN`: بعد إنشاء البوت.
- `QF_CLIENT_ID` و `QF_CLIENT_SECRET`: بعد الحصول على اعتماد Quran Foundation.

## النشر
شغّلي أوامر Wrangler من جهاز/بيئة نشر، وليس على الهاتف. الهاتف لا يحتفظ بملفات الخادم بعد النشر.

بعد النشر يصبح الرابط مثل:
`https://halaqat-quran.<حسابك>.workers.dev`

ثم افتحي الرابط في Chrome واخترِي «إضافة إلى الشاشة الرئيسية».

## مهم
لم يتم وضع أي Token أو كلمة مرور حقيقية داخل الملفات. لا تضعي أسرارك في `app.js` أو `index.html`.
