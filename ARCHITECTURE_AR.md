# معمارية الأوَّابين

## الطبقات
1. واجهة PWA.
2. API.
3. خدمات الأعمال.
4. D1.
5. مزودات خارجية.

## الوحدات
- auth
- students
- teachers
- circles
- sessions
- attendance
- quran
- tests
- subscriptions
- finance
- notifications
- telegram
- audio
- reports
- backup
- settings
- audit

كل وحدة يجب أن تكون مستقلة قدر الإمكان.

## قاعدة مهمة
الواجهة لا تتخذ قرارًا أمنيًا. كل الصلاحيات والتحقق من الملكية يتم على الخادم.

## إضافة خدمة مستقبلية
مثال: إضافة WhatsApp أو مزود دفع جديد يجب أن تكون عبر Adapter/Provider مستقل دون تعديل الجداول الأساسية إلا عند الحاجة.
