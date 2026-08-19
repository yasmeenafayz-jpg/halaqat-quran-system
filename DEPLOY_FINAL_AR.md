# النشر النهائي
1. ارفع محتويات هذه الحزمة إلى جذر المستودع.
2. Cloudflare Pages → GitHub.
3. Build command: `npm run build`
4. Output: `dist`
5. أنشئ D1 باسم `alawabin-db`.
6. استبدل `REPLACE_WITH_D1_DATABASE_ID` بالمعرّف الحقيقي في إعداد Cloudflare.
7. طبّق migrations من 001 إلى 004 بالترتيب.
8. اختبر `/api/health`.
9. بعد نجاح البناء ثبّت التطبيق على الهاتف.
