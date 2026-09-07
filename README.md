# 🚀 Cloud APK Factory — AI Universal APK Factory

منصّة سحابية كاملة لبناء تطبيقات Android (APK / AAB) بالكامل في السحابة.
الهاتف أو الحاسوب مجرد **واجهة Web/PWA** — لا SDK، لا Java، لا Gradle، لا Node على جهاز المستخدم.

> بناءً على التصميم المعماري المفصّل (45 قسماً) — نفّذناه كـ monorepo حقيقي بخدمات قابلة للاختبار.

---

## 🏛️ المعمارية

```
📱 Web Client (PWA)            ← Next.js + Tailwind  (apps/web)
        │  Cloudflare Pages
        ▼
🛡️ API Gateway (Worker)         ← services/api  (Cloudflare Worker)
        ├─ Analyzer     (services/analyzer)   ← كشف الإطار + تقرير الصحة + التقييم
        ├─ Orchestrator (services/orchestrator) ← Build Router + Retry Engine
        ├─ Repair Agent (services/repair-agent) ← Knowledge Base + AI Router + Patch Engine
        ├─ Validator    (services/validator)  ← فحص حقيقي لملف APK
        ├─ Quota Mgr    (services/quota-manager) ← Free-Tier Orchestration
        └─ Notify       (services/notification-service)
                │
   ┌────────────────┼────────────────┐
   ▼                ▼                ▼
 EAS          GitHub Actions     Cloudflare Builds      ← مبانٍ مسبقاً في GHCR (environments/)
 (Expo)       (عام = مجاني)      (Fallback)
```

المنصّة **لا تعتمد على خدمة واحدة**: إن تعطّلت خدمة أو انتهى Free Tier الخاص بها،
ينتقل الـ Router إلى Builder آخر (Build Router §14، Free-Tier Manager §35).

---

## 📦 بنية المشروع (Monorepo)

```
cloud-apk-factory/
├── apps/web/                 # واجهة Next.js (PWA) — كل الصفحات المطلوبة
├── services/
│   ├── api/                  # بوابة Cloudflare Worker + Store (InMemory + Supabase)
│   ├── analyzer/             # المحلّل: detect → compatibility → score → issues
│   ├── orchestrator/         # Build Router + Retry Engine (حتى 3 محاولات)
│   ├── repair-agent/         # Knowledge Base + AI Router + Repair Engine (4 مستويات)
│   ├── validator/            # تحليل APK: SHA256، ABIs، توقيع، أذونات
│   ├── quota-manager/        # إدارة الحصص المجانية لكل مزوّد
│   └── notification-service/ # Webhook / Email / Console
├── packages/
│   ├── types/                # العقود المشتركة بين كل الخدمات
│   ├── logger/               # تسجيل منظّم (يخفي الأسرار)
│   ├── security/             # Token Vault (AES-256-GCM) + فحص الأسرار
│   └── build-core/           # واجهة BuildBackend المجرّدة
├── builders/                 # سكربتات بناء expo / rn / capacitor / flutter / android
├── environments/             # Dockerfiles جاهزة لـ GHCR
├── database/migrations/      # جداول Supabase/Postgres (§33)
├── knowledge/errors/         # قاعدة المعرفة الأولية (§20)
├── fixtures/sample-expo/     # مستودع تجريبي لاختبار المحلّل
└── .github/workflows/        # build-apk / ci / publish-environments
```

---

## ⚡ التشغيل المحلي

```bash
npm install                 # يثبّت كل مساحات العمل
npm test                   # 39 اختبار للخدمات الأساسية (vitest)
npx tsc -b                 # فحص الأنواع لكل الخدمات

# بوابة الـ API (Worker) على http://localhost:8787
npm run dev:api

# واجهة الويب على http://localhost:3000
npm run dev:web

# تحليل مستودع تجريبي عبر CLI المحلّل
npm run analyze:fixture
```

### تجربة التدفق الكامل (end-to-end) عبر الـ API

```bash
# 1) تسجيل دخول (محاكاة)
curl -X POST localhost:8787/auth/google \
  -H 'content-type: application/json' \
  -d '{"googleId":"g1","email":"a@b.co","name":"Tester"}'

# 2) تحليل مستودع (يمرّر ملفات manifest فقط — لا تنفيذ لكود المستخدم)
curl -X POST localhost:8787/projects/analyze -H 'content-type: application/json' -d '{
  "repositoryId":"charfeddineAZ/CPAAutomator","repoName":"CPAAutomator","org":"charfeddine",
  "files":{
    "package.json":"{\"dependencies\":{\"expo\":\"^53.0.0\",\"react\":\"19.0.0\",\"react-native\":\"0.79.3\",\"react-native-dynamic\":\"1.2.0\"}}",
    "app.json":"{\"expo\":{\"name\":\"CPAAutomator\",\"android\":{\"minSdkVersion\":24,\"targetSdkVersion\":35}}}"
  }
}'

# 3) بناء APK
curl -X POST localhost:8787/projects/<projectId>/build -d '{"target":"apk"}'
```

---

## 🧠 ما الذي يعمل فعلاً (وليس مجرد تصميم)

| المكوّن | الحالة | الدليل |
|---|---|---|
| كشف الإطار (Expo/RN/Capacitor/Flutter/Native/PWA) | ✅ مُختبر | `services/analyzer` |
| مصفوفة التوافق + اختيار بيئة GHCR | ✅ مُختبر | `services/analyzer/compatibility.ts` |
| تقرير الصحة + تقييم 0..100 | ✅ مُختبر | `services/analyzer/score.ts` |
| تصنيف المشاكل (Required/Recommended/Optional/Good) | ✅ مُختبر | `services/analyzer/analyzer.ts` |
| قاعدة المعرفة + الإصلاح المعروف | ✅ مُختبر | `services/repair-agent/knowledge.ts` |
| موجّه الذكاء الاصطناعي (مزوّد قابل للاستبدال) | ✅ مُختبر | `services/repair-agent/ai-router.ts` |
| محرك إصلاح 4 مستويات + تطبيق patches | ✅ مُختبر | `services/repair-agent/repair-engine.ts` |
| Build Router + Retry (حتى 3 محاولات) | ✅ مُختبر | `services/orchestrator` |
| التحقق من APK (SHA256/ABIs/توقيع/أذونات) | ✅ مُختبر | `services/validator` |
| Free-Tier Manager | ✅ مُختبر | `services/quota-manager` |
| Token Vault (تشفير الرموز) + فحص الأسرار | ✅ مُختبر | `packages/security` |
| بوابة API كاملة (تحليل→بناء→تحقق→إشعار) | ✅ مُختبر | `services/api` |
| واجهة Next.js (كل الصفحات + PWA) | ✅ يُجمّع | `apps/web` |
| جداول قاعدة البيانات | ✅ SQL | `database/migrations` |
| بيئات Docker جاهزة + سكربتات بناء | ✅ | `environments/`, `builders/` |
| عميل GitHub App (مستودعات/PR/Webhook/Dispatch) | ✅ مُختبر | `services/github` |
| Auto Fix PR على فرع منفصل (§22) | ✅ مُختبر | `services/repair-agent/src/branch.ts` |
| الإصدار التلقائي (§44) | ✅ مُختبر | `services/build-core/src/version.ts` |
| فاحص الأذونات الخطيرة (§26) | ✅ مُختبر | `packages/security` |
| محاكاة التشغيل/الدخان (§25) | ✅ مُختبر | `services/validator/src/smoke.ts` |
| الجدولة (cron) للبناء (§30) | ✅ مُختبر | `services/quota-manager/src/cron.ts` |
| نشر Play Store (§44) | ✅ مُختبر | `services/api/src/deploy.ts` |
| التوقيع التلقائي + خزنة المفاتيح (§44/§6) | ✅ مُختبر | `packages/build-core/src/signing.ts` |
| سجل التدقيق (§34) | ✅ مُختبر | `services/api/src/audit.ts` + `/audit` |
| تتبّع الحصص/الاستهلاك (§35) | ✅ مُختبر | `services/quota-manager/src/usage.ts` + `/usage` |
| مسار iOS (§44) | ✅ مُختبر | `builders/ios/build.sh` + `BuildTarget.ios` |
| نشر تلقائي (Pages + Worker) | ✅ | `.github/workflows/deploy.yml` |

---

## 🔐 الأمان (مبدأ Sandbox §32)

- المستودع يُحلَّل عبر **قراءة ملفات manifest فقط** — لا يُنفَّذ أي كود للمشروع داخل الـ Worker/API.
- الأسرار تُكتشف قبل أن تصل إلى الذكاء الاصطناعي (`scanForSecrets`) ولا تُرسل أبداً للـ AI.
- الرموز تُشفَّر بـ AES-256-GCM داخل `TokenVault` ولا تُخزَّن كنص صريح.
- الإصلاحات من مستوى 2/3 تُطبَّق على **فرع منفصل** (لا يُعدَّل `main`) ويحتاج موافقة.

---

## 🗺️ خارطة الطريق (المراحل §44)

- [x] **المرحلة 1–6**: أساس + GitHub + Analyzer + Build Engine + Auto Repair + Validation
- [~] **المرحلة 7**: تحسين — Quota Manager ✅، Build Router ✅، Cache (طبقات Docker/GHCR) ✅؛ التحليل المتوازي + إعادة استخدام البيئات قيد التحسين
- [~] **المرحلة 8**: متقدّم — Auto PR ✅، Auto versioning ✅، فاحص أذونات ✅، محاكاة تشغيل ✅، جدولة ✅، نشر Play Store (عميل) ✅، إشعارات ✅، AAB/متغيّرات ✅، Flutter/Capacitor (سكربتات) ✅، توقيع تلقائي (تهيئة+خزنة) ✅، سجل تدقيق ✅، تتبّع الحصص ✅، iOS (مسار+سكربت) ✅؛ التوقيع الفعلي عبر keytool في البيئة + تشغيل محاكي حقيقي متبقٍ

انظر [`ARCHITECTURE.md`](./ARCHITECTURE.md) للربط التفصيلي بين كل قسم من التصميم والكود.
