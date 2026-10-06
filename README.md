# Maestro Skills 🎼

**قائد واحد بيفكّر ويقرّر، وموديلات مجانية بتنفّذ.**

Maestro مجموعة skills بتخلّي أي agent (Claude Code افتراضياً، أو OpenCode، أو Pi، أو غيرهم) يشتغل على أي مهمة بنفس الطريقة كل مرة، من غير ما تحتاج تشرح له الخطوات:

```
طلب ─► تحليل ─► قرارات بيزنس (دور الخبير) ⏸ موافقتك ─► خطة (speckit) ─► كروت مهام واضحة جداً
     ─► مديرين فرعيين (sub-agents) لكل مسار شغل ─► موديلات مجانية (opencode / pi / cmd) مع تحويل تلقائي لموديل تاني عند الحد
     ─► اختبار + مراجعة متبادلة بموديل مختلف ─► مراجعة نهائية ─► تقرير
```

الهدف إن **توكين Claude يتصرف على الحكم والقرار بس**، والكتابة والمراجعة الأولى تروح للموديلات المجانية.

---

## المهارات (v1: Core)

| المهارة | الدور |
|---|---|
| `maestro` | **المنسّق الرئيسي.** بيشتغل تلقائياً على أي مهمة، وبيمشّي المراحل كلها، وبيكمّل من آخر نقطة لو الجلسة اتقطعت |
| `maestro-decisions` | بيتقمّص دور الخبير في المجال، ويجهّز كل قرار باختياراته وإيجابياته وسلبياته وتوصيته، و**يوقف لحد ما توافق** |
| `maestro-breakdown` | بيحوّل الخطة لكروت مهام مفصّلة جداً تناسب موديل مجاني، وكل كارت عليه Type و Sensitivity و Workstream |
| `maestro-router` | بيختار الـ agent والموديل لكل كارت، ويبعته عن طريق delegate-skills، ولو الموديل وصل للحد بيحوّل للي بعده |
| `maestro-workstream` | تعليمات المدير الفرعي (sub-lead) لمسار شغل واحد: يوزّع الكروت ويراجع ويعمل commit، ويرجّع للقائد ملخص قصير |
| `maestro-review` | بيشغّل التستات بنفسه، ويعمل مراجعة متبادلة بموديل من provider مختلف، ويحكم بـ PASS أو FIX أو TAKEOVER، ويعمل المراجعة النهائية |

---

## التثبيت

```bash
# 1) المهارات (global)
npx skills add <owner>/maestro-skills
#    أو من نسخة محلية:
git clone <repo-url> && cd maestro-skills && ./install.sh          # --link عشان تعديلاتك تتطبق على طول

# 2) المتطلبات
npx skills add amElnagdy/delegate-skills                             # relays التنفيذ (مطلوبة)
uv tool install specify-cli --from git+https://github.com/github/spec-kit.git   # speckit (اختياري ومفضّل)
#    وأدوات الـ agents اللي هتستخدمها: opencode / pi / cmd، مع تسجيل الدخول في كل واحدة

# 3) الإعدادات (نسخة تقدر تعدّلها)
node ~/.claude/skills/maestro-router/scripts/maestro.mjs init --global     # ~/.config/maestro/
node ~/.claude/skills/maestro-router/scripts/maestro.mjs init --project    # <repo>/.maestro/ (للمشروع ده بس)

# 4) فحص الإعداد
node ~/.claude/skills/maestro-router/scripts/maestro.mjs doctor
```

**عشان يشتغل تلقائياً في كل مهمة:** انسخ محتوى `skills/maestro/templates/CLAUDE.md.snippet` في `~/.claude/CLAUDE.md`، أو في `CLAUDE.md` بتاع المشروع. ولو القائد مش Claude، استخدم `AGENTS.md.snippet`.

---

## الإعدادات: `config.yaml`

بيتدوّر عليه بالترتيب ده، وأول واحد موجود هو اللي بيتاخد:
1. `--config-dir`
2. `$MAESTRO_HOME`
3. `<repo>/.maestro/`
4. `~/.config/maestro/`
5. الإعدادات الافتراضية في `skills/maestro/defaults/`

### الـ Profiles والأدوار
```yaml
profile: claude-led          # الافتراضي. أو: free-only، أو profile تعمله بنفسك
profiles:
  claude-led:
    roles:
      leader:         { agent: claude-code, model: opus,   effort: high,   used_for: [...] }
      sub_lead:       { agent: claude-code, model: haiku,  effort: medium, used_for: [...] }
      implementer:    { pool: agents, effort: medium }       # بيختار من ملفات الـ agents
      reviewer:       { pool: agents, min_tier: 3, effort: high }
      final_reviewer: { agent: claude-code, model: sonnet, effort: high }
```
- **تغيير القائد:** غيّر `leader.agent` و `leader.model`. مثلاً `free-only` بيخلّي القائد `opencode` بموديل مجاني، ومن غير Claude خالص.
- **مستوى التفكير `effort`:** واحد من `low | medium | high | max`. بيتحوّل تلقائياً للمقابل بتاعه في كل agent: `--variant` في opencode، و `--effort` في cmd.
- **`used_for`:** مكتوب فيه كل دور بيستخدم موديله في إيه.

### لما كل الموديلات المجانية توصل للحد
```yaml
on_exhaustion: ask           # الافتراضي: يوقف ويسألك
# on_exhaustion: wait_and_retry
wait_and_retry: { max_wait_minutes: 120, max_cycles: 3 }
```

---

## ملفات الـ Agents: `agents/*.yaml`

كل agent ليه ملف، وفي كل ملف **قايمة مفتوحة من الموديلات من أي provider**:

```yaml
agent: opencode
delegate_skill: opencode-delegate
limit_scope: provider        # الحد بيتطبق على الـ provider كله، في كل الـ agents
cooldown_minutes: 60
models:
  - id: opencode/big-pickle
    provider: opencode-zen
    tier: 4                  # 1 ضعيف … 5 الأقوى
    good_for: [feature, refactor, complex-logic, general]
    status: active           # active | standby (احتياطي) | disabled
    fallback_order: 1
  - id: ollama-cloud/gpt-oss:120b
    provider: ollama-cloud
    tier: 4
    status: standby          # «صفته تمام بس ما ضفتهوش»: بيشتغل بس لما اللي قبله يوصل للحد
```

- **تضيف موديل:** تضيف entry جديد، وبعدها تشغّل `doctor` يتأكد إن الموديل موجود فعلاً.
- **تضيف agent جديد:** تعمل ملف جديد يشاور على relay من delegate-skills، زي `codex-delegate` أو `kimi-delegate`.

الملفات الافتراضية فيها أشهر الموديلات المجانية وقت كتابة الملفات دي:

| الـ Agent | الموديلات |
|---|---|
| opencode | الموديلات المجانية في OpenCode Zen: `big-pickle`، `minimax-m2.5-free`، `mimo-v2-pro-free`، `nemotron-3-super-free`، `gpt-5-nano` |
| pi | موديلات Zen من خلال pi، وموديلات Ollama Cloud و OpenRouter المجانية (محتاجة `pi install npm:pi-free`) |
| cmd | `ling-3.1-flash:free`، `laguna-s-2.1-free`، `space-bunny-alpha`، `ling-3.0-flash-sante:free` |

⚠️ أسماء الموديلات المجانية بتتغيّر كتير. **شغّل `doctor`** بعد التثبيت، وعدّل الملفات على حسب حسابك.

### الموديل بيتختار إزاي؟
1. **الاستبعاد:** بيتشال أي موديل `disabled`، أو في فترة cooldown، أو `tier` بتاعه أقل من الحد الأدنى، أو ما يناسبش نوع المهمة.
2. **الترتيب:**
   - `active` الأول، وبعده `standby`.
   - الموديل المناسب للنوع بالظبط قبل الموديل العام (`general`).
   - **المهام الحساسة** بتاخد أقوى موديل الأول.
   - **المهام العادية** بتاخد أرخص موديل يكفيها، عشان حصص الموديلات القوية تفضل للمهام اللي محتاجاها.
3. **التحويل:** الترتيب ده هو سلسلة التحويل. لو موديل وصل للحد، بيتعمل له cooldown، ولو `limit_scope: provider` بيتوقف الـ provider كله في كل الـ agents، وبعدها ينتقل للمرشح اللي بعده.

```bash
MR="node ~/.claude/skills/maestro-router/scripts/maestro.mjs"
$MR route --type feature --sensitivity sensitive     # يوريك الترتيب من غير ما ينفّذ حاجة
$MR limits show                                      # مين واقف ولحد إمتى
$MR limits clear provider:opencode-zen               # لو عارف إن الحد اتجدد
$MR config                                           # الإعدادات النهائية بعد الدمج
```

---

## الـ Sub-agents (التسلسل الهرمي)
```
القائد ─► sub-lead لكل مسار شغل (sub-agent رخيص، وسياقه منفصل) ─► موديلات مجانية ─► (الـ sub-agents بتوعها جوه الأداة نفسها)
```
القائد بيقرا من كل sub-lead ملخص قصير بس. **في v1 المسارات بتشتغل واحد ورا التاني**، عشان ما يحصلش تعارض في git.

لو القائد ما بيدعمش sub-agents، أو `sub_lead.agent: none`، المسارات بتتنفّذ inline جوه القائد نفسه.

---

## الحالة والاستكمال
كل مهمة ليها مجلد `.workflow/NNN-slug/`، وفيه التحليل والقرارات والخطة والكروت و`status.md` والـ logs. لو الجلسة اتقطعت، القائد بيقرا `status.md` ويكمّل من مكانه.

وقرارات البيزنس اللي اتوافق عليها بتتسجّل كمان في `docs/business-rules.md` جوه المشروع، عشان نفس السؤال ما يتسألش مرتين.

---

## الإضافات (Extensions)
الـ core **مش معتمد على أي إضافة**. الإضافات بتتحط في مجلد `extensions/`، والمخطط ليها:
- **OmniRoute:** طبقة providers تحت الـ agents.
- **decision engine:** زي موديل *jev* من Command Code.

التفاصيل في `extensions/README.md`.

## التطوير
```bash
npm test        # تستات الـ router والـ YAML (من غير dependencies)
npm run doctor
```
