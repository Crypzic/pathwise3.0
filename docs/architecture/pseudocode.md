# Pathwise — Pseudocode Reference

*Language-agnostic logic for the core engines, matching the Build Plan steps. This is a design reference for implementation, not runnable code — translate into FastAPI/Python (backend) or React/TypeScript (frontend) as you build each step.*

---

## 1. Auth & Onboarding Flow

```
function signUp(name, email, password):
    validate email is unique
    hash password
    create User record
    create empty Subscription record (tier = "free")
    return session token

function onFirstLogin(user):
    show PrivacyStatementScreen()
    on accept:
        mark user.privacy_ack = true
        redirect to AddCourseScreen()
```

---

## 2. Course Intelligence Engine (Step 2)

The core pipeline every other feature depends on.

```
function uploadCourseMaterials(user, course_name, files):
    course = createCourse(user, course_name)
    for file in files:
        validate file_type in [pdf, docx, pptx]
        validate file_size <= MAX_SIZE
        store file in Uploads table, linked to course
        raw_text = extractText(file)
        addToProcessingQueue(course.id, raw_text)   # synchronous is fine at MVP scale

    topics = extractTopics(all_raw_text_for(course))
    weighted_topics = weighTopics(topics, raw_text_sources)
    saveKnowledgeMap(course, weighted_topics)
    return course

function extractTopics(raw_text):
    # AI call: segment material into distinct topics/concepts
    call AI_model(prompt = "extract distinct academic topics from this material", input = raw_text)
    return list of topic_names_with_context

function weighTopics(topics, sources):
    for topic in topics:
        emphasis_score = 0
        emphasis_score += count(topic appears across multiple files)
        emphasis_score += bonus if topic appears in stated learning objectives
        emphasis_score += bonus if topic appears in section headers/titles
        topic.weight = normalize(emphasis_score)
    return topics

function addMaterialsToExistingCourse(course, new_files):
    # Step 2 requirement: uploads aren't one-time
    process new_files same as above
    merge new topics into existing KnowledgeMap
    re-run weighTopics() across ALL materials (old + new)
    update course.knowledge_map
```

---

## 3. Mastery Engine (Step 4)

```
function updateMastery(user, topic, interaction_result):
    # interaction_result comes from Quiz or Socratic Mode
    current = getMasteryRecord(user, topic)

    if interaction_result.source == "quiz":
        delta = calculateQuizDelta(interaction_result.correct, interaction_result.difficulty)
    if interaction_result.source == "socratic":
        delta = calculateSocraticDelta(interaction_result.reasoning_quality)

    current.score = clamp(current.score + delta, 0, 100)
    current.last_updated = now()
    current.last_source = interaction_result.source
    save(current)

    # feeds the "guessing vs understanding" dashboard view
    current.confirmed_by_reasoning = (interaction_result.source == "socratic" and interaction_result.reasoning_quality > THRESHOLD)
    save(current)

function calculateQuizDelta(correct, difficulty):
    if correct: return +BASE_GAIN * difficulty_multiplier(difficulty)
    else: return -BASE_LOSS

function calculateSocraticDelta(reasoning_quality):
    # reasoning_quality is a 0-1 score from evaluating the conversation
    return +BASE_GAIN * reasoning_quality * SOCRATIC_WEIGHT_BONUS
```

---

## 4. Spaced Repetition Scheduler (Step 4)

```
function scheduleNextReview(user, topic, last_result):
    record = getSpacedRepRecord(user, topic)

    if last_result.correct:
        record.interval_days = record.interval_days * EASE_FACTOR
    else:
        record.interval_days = MIN_INTERVAL   # reset on failure

    record.due_date = now() + record.interval_days
    save(record)

function getTopicsDueForReview(user, course):
    all_topics = getKnowledgeMapTopics(course)
    return [t for t in all_topics if getSpacedRepRecord(user, t).due_date <= now()]
```

Note: no exam dates involved anywhere in this engine — purely performance + time-based.

---

## 5. Study Plan Generation (Step 6)

```
function generateStudyPlan(user, course):
    due_topics = getTopicsDueForReview(user, course)
    weak_topics = getTopicsBelowMasteryThreshold(user, course, threshold = 60)

    quests = []
    for topic in prioritize(due_topics + weak_topics, by = "weight" then "mastery_gap"):
        quests.append({
            type: "quiz" or "review" or "socratic_suggestion",
            topic: topic,
            xp_reward: calculateXP(topic.difficulty, topic.weight)
        })

    return quests[:MAX_DAILY_QUESTS]   # keep it to 2-3 so it doesn't overwhelm
```

---

## 6. Course Confidence Score (Step 6)

```
function calculateConfidenceScore(user, course):
    mastery_avg = average(all topic mastery scores, weighted by topic.weight)
    consistency = quizStreakConsistency(user, course)     # rewards regular engagement
    socratic_depth = averageSocraticReasoningQuality(user, course)

    score = (mastery_avg * 0.5) + (consistency * 0.25) + (socratic_depth * 0.25)
    tier = "Shaky" if score < 40 else "Solid" if score < 75 else "Strong"

    return { score, tier }

function checkForConfidenceDrop(user, course):
    for topic in getKnowledgeMapTopics(course):
        if topic.mastery_trend_last_7_days < -DROP_THRESHOLD:
            triggerConfidenceBanner(user, topic, tone = "supportive")
            # e.g. "{topic} is slipping a bit — want a quick review?"
```

---

## 7. Quiz Engine (Step 5)

```
function generatePracticeQuestions(course, topic, count):
    # explicitly NOT "predicted exam questions" — framed as practice, professor-safe
    call AI_model(
        prompt = "generate original practice questions on this topic, fixed difficulty, no reference to any specific exam",
        input = topic.context,
        count = count
    )
    return questions

function submitQuizAnswer(user, question, selected_answer):
    correct = (selected_answer == question.correct_answer)
    updateMastery(user, question.topic, { source: "quiz", correct, difficulty: question.difficulty })
    scheduleNextReview(user, question.topic, { correct })
    awardXP(user, correct ? XP_CORRECT : XP_ATTEMPT)
    return { correct, explanation: question.explanation }
```

---

## 8. Socratic Tutor Mode (Step 7) — the highest-stakes logic in the app

```
function startSocraticSession(user, topic_or_context):
    if user.first_socratic_session:
        showExplainerScreen()
        mark user.first_socratic_session = false

    session = createSession(user, topic_or_context)
    return session

function handleSocraticMessage(session, user_message):
    response = call AI_model(
        system_prompt = SOCRATIC_SYSTEM_PROMPT,   # never give final answers, only guiding questions
        conversation_history = session.history,
        new_message = user_message
    )

    # critical guardrail — validate before sending back to user
    if containsDirectAnswer(response):
        response = regenerateAsGuidingQuestion(response)
        # or: reroute to a safe fallback guiding question

    session.history.append(user_message, response)
    return response

function endSocraticSession(session):
    reasoning_quality = evaluateReasoningQuality(session.history)
    updateMastery(session.user, session.topic, { source: "socratic", reasoning_quality })
    awardXP(session.user, XP_SOCRATIC_SESSION)
    save(session)

function containsDirectAnswer(response):
    # runs a classifier/secondary check — do NOT rely on the system prompt alone
    return classifier_flags_direct_answer(response)
```

**Build note**: `containsDirectAnswer()` is not optional — test this adversarially (deliberately try to extract answers) before considering Step 7 done.

---

## 9. Gamification (Step 9)

```
function awardXP(user, amount):
    user.total_xp += amount
    checkRankUp(user)
    updateCompanionGrowth(user, amount)   # studying XP passively grows the pet
    save(user)

function checkRankUp(user):
    new_rank = calculateRank(user.total_xp)
    if new_rank > user.current_rank:
        user.current_rank = new_rank
        unlockRankRewards(user, new_rank)
        triggerNotification(user, type = "rank_up")

function updateStreak(user):
    if user.last_active_date == yesterday():
        user.streak_count += 1
    elif user.last_active_date == today():
        pass   # already counted today
    else:
        if user.streak_freezes_available > 0 and missedOnlyOneDay(user):
            user.streak_freezes_available -= 1
            # streak preserved, no reset
        else:
            user.streak_count = 0
    user.last_active_date = today()
    save(user)

function earnStreakFreeze(user):
    if user.consecutive_days % 7 == 0:
        user.streak_freezes_available += 1

function buyStreakFreezeWithGardenXP(user):
    if user.garden_xp >= STREAK_FREEZE_COST:
        user.garden_xp -= STREAK_FREEZE_COST
        user.streak_freezes_available += 1
```

---

## 10. Companion Pet + Mini-Game (Step 11)

```
function updateCompanionGrowth(user, study_xp_earned):
    user.companion.growth_xp += study_xp_earned
    if user.companion.growth_xp >= nextStageThreshold(user.companion.stage):
        user.companion.stage += 1
        triggerNotification(user, type = "companion_grew")

function playMiniGame(user, game_result):
    garden_xp_earned = calculateGardenXP(game_result)
    user.garden_xp += garden_xp_earned
    return garden_xp_earned

function purchaseCosmetic(user, item):
    if user.garden_xp >= item.cost:
        user.garden_xp -= item.cost
        user.companion.equipped_items.append(item)
        save(user)
```

---

## 11. Notifications (Step 12)

```
function dailyNotificationJob():
    for user in allActiveUsers():
        local_time = convertToUserTimezone(now(), user.timezone)
        if local_time == user.preferred_reminder_time:
            if not hasStudiedToday(user):
                sendNotification(user, type = "streak_reminder")

        due_topics = getTopicsDueForReview(user, all courses)
        if due_topics.length > 0:
            sendNotification(user, type = "review_due", data = due_topics)

# rank_up and companion_grew notifications are triggered inline (see Sections 9 & 10),
# not on this daily batch job
```

---

## 12. Monetization Gate (Step 13)

```
function canAddCourse(user):
    if user.subscription.tier == "premium":
        return true
    return countCourses(user) < FREE_COURSE_LIMIT

function attemptAddCourse(user, course_data):
    if not canAddCourse(user):
        showUpgradeScreen()
        return null
    return uploadCourseMaterials(user, course_data)

function checkPremiumFeatureAccess(user, feature):
    premium_only = ["unlimited_courses", "full_analytics_history", "cosmetic_items"]
    if feature in premium_only:
        return user.subscription.tier == "premium"
    return true   # everything else stays free — never gate core learning features
```

---

## Build order reminder

This pseudocode maps directly to Build Plan steps — implement in this order:
`2 (Knowledge Map) → 4 (Mastery + Spaced Rep) → 5 (Quiz) → 6 (Study Plan + Confidence) → 7 (Socratic) → 9 (Gamification) → 11 (Pet/Game) → 12 (Notifications) → 13 (Monetization)`
