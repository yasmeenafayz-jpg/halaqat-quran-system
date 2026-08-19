# الأوَّابين

منصة خفيفة ومتوافقة مع الهاتف لأكاديمية الأوَّابين للقرآن الكريم.

## التشغيل
1. `npm install`
2. `npm run dev`

## البناء
`npm run build`

## Cloudflare
- أنشئ D1 باسم `alawabin-db`.
- ضع `database_id` الحقيقي في `wrangler.jsonc`.
- نفّذ ملفات `migrations/` بالترتيب.
- اربط المشروع بـ Cloudflare Pages بعد نجاح `npm run build`.

> لا ترفع أي ملف `.env` أو مفاتيح سرية إلى GitHub.
