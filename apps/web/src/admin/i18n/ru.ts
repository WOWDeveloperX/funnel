/**
 * Admin UI copy, Russian (the default). This object defines the dictionary shape: en.ts is typed
 * as `AdminMessages`, so a key missing from (or extra in) the English dictionary is a compile error.
 *
 * Technical identifiers stay as they are in every language: step_id, event names, reason codes,
 * JSON paths, `utm_campaign`, version labels (v3). Everything a person reads is translated.
 */
import type { PluralForms } from '@funnel/shared';
import { plural, ru3 } from '../../lib/plural';

const p = (n: number, forms: PluralForms): string => plural('ru', n, forms);
const q = (s: string): string => `«${s}»`;

/** Server validation issue (English, from validateConfig in @funnel/shared) → UI text. */
export interface IssueRule {
  re: RegExp;
  text: (m: RegExpMatchArray) => string;
}

const ISSUES: IssueRule[] = [
  { re: /^unknown step "(.+)"$/, text: (m) => `stepSequence ссылается на несуществующий шаг ${q(m[1]!)}` },
  { re: /^duplicate step "(.+)"$/, text: (m) => `Шаг ${q(m[1]!)} повторяется в stepSequence` },
  { re: /^result step "(.+)" must be the last step$/, text: (m) => `Шаг результата ${q(m[1]!)} должен быть последним` },
  { re: /^must end with a result step$/, text: () => 'stepSequence должна заканчиваться шагом результата' },
  { re: /^unknown resultId "(.+)"$/, text: (m) => `resultRules ссылается на несуществующий result ${q(m[1]!)}` },
  { re: /^unknown result "(.+)"$/, text: (m) => `Ссылка на несуществующий result ${q(m[1]!)}` },
  { re: /^defaultResultId is required$/, text: () => 'defaultResultId не указан' },
  { re: /^references unknown answer "(.+)"$/, text: (m) => `Условие ссылается на неизвестный ответ ${q(m[1]!)}` },
  { re: /^unknown operator "(.+?)"/, text: (m) => `Неизвестный оператор ${q(m[1]!)}` },
  {
    re: /^operator "(.+)" on "(.+)" requires an array value$/,
    text: (m) => `Оператору ${q(m[1]!)} для ${q(m[2]!)} нужен массив`,
  },
  {
    re: /^operator "(.+)" on "(.+)" requires a numeric value$/,
    text: (m) => `Оператору ${q(m[1]!)} для ${q(m[2]!)} нужно число`,
  },
  { re: /^missing core event "(.+)"$/, text: (m) => `Нет обязательного события ${q(m[1]!)}` },
  { re: /^duplicate event "(.+)"$/, text: (m) => `Событие ${q(m[1]!)} объявлено дважды` },
  { re: /^unknown step type "(.+)"$/, text: (m) => `Неизвестный тип шага ${q(m[1]!)}` },
  { re: /^(.+) step requires input\.options$/, text: () => 'У шага выбора нет input.options' },
  { re: /^interactive step requires input\.name$/, text: () => 'У шага с ответом нет input.name' },
  {
    re: /^input\.name "(.+)" is already used by step "(.+)"$/,
    text: (m) => `input.name ${q(m[1]!)} уже занят шагом ${q(m[2]!)}`,
  },
  { re: /^duplicate option value "(.+)"$/, text: (m) => `Значение опции ${q(m[1]!)} повторяется` },
  {
    re: /^input\.min \((.+)\) is greater than input\.max \((.+)\)$/,
    text: (m) => `input.min (${m[1]}) больше input.max (${m[2]})`,
  },
  { re: /^id "(.+)" does not match its key "(.+)"$/, text: (m) => `id ${q(m[1]!)} не совпадает с ключом ${q(m[2]!)}` },
  { re: /^weights are all zero$/, text: () => 'Все веса вариантов равны нулю' },
  { re: /^at least one variant is required$/, text: () => 'Нужен хотя бы один вариант' },
  { re: /^overriding "id" is not allowed$/, text: () => 'Переопределять id нельзя' },
  // warnings
  {
    re: /^step "(.+)" visibleWhen references "(.+)", which this variant never asks$/,
    text: (m) => `Шаг ${q(m[1]!)} зависит от ответа ${q(m[2]!)}, которого нет в варианте`,
  },
  {
    re: /^step "(.+)" visibleWhen references "(.+)", which is asked later in this variant$/,
    text: (m) => `Шаг ${q(m[1]!)} зависит от ответа ${q(m[2]!)}, который задаётся позже`,
  },
  {
    re: /^resultRules reference "(.+)", which this variant never asks$/,
    text: (m) => `resultRules зависят от ответа ${q(m[1]!)}, которого нет в варианте`,
  },
  { re: /^defined but not used by any variant$/, text: () => 'Шаг не используется ни одним вариантом' },
  {
    re: /^step "(.+)" is not in this variant's sequence$/,
    text: (m) => `Шаг ${q(m[1]!)} не входит в последовательность варианта`,
  },
  {
    re: /^maxSelections \((.+)\) exceeds the number of options \((.+)\)$/,
    text: (m) => `maxSelections (${m[1]}) больше числа опций (${m[2]})`,
  },
];

export const ru = {
  /** BCP 47 locale for Intl number and date formatting. */
  locale: 'ru-RU',

  format: {
    /** Day + month of short timestamps: "03.10 14:20". */
    dayMonth: { day: '2-digit', month: '2-digit' } as Intl.DateTimeFormatOptions,
    /** Percentage points suffix: "+3.2 п.п.". */
    pp: 'п.п.',
    seconds: (n: number) => `${n} с`,
    minutes: (n: number) => `${n} мин`,
    hours: (n: number) => `${n} ч`,
    days: (n: number) => `${n} д`,
    justNow: 'только что',
    ago: (value: string) => `${value} назад`,
    in: (value: string) => `через ${value}`,
  },

  common: {
    loading: 'Загрузка…',
    retry: 'Повторить',
    close: 'Закрыть',
    cancel: 'Отмена',
    all: 'все',
    version: 'Версия',
    variant: 'Вариант',
    publish: 'Опубликовать',
    makeActive: 'Сделать активной',
    offline: 'Нет связи с сервером.',
    newSessionsGoTo: (v: number) => `Новые сессии пойдут на v${v}.`,
    /** "12 сессий" (count is already formatted). */
    sessions: (count: string, n: number) => `${count} ${p(n, ru3('сессия', 'сессии', 'сессий'))}`,
  },

  errors: {
    unauthorized: 'Нужен токен администратора.',
    network: 'API недоступен. Проверьте соединение.',
    server: 'Ошибка сервера. Попробуйте ещё раз.',
  },

  app: {
    documentTitle: 'Funnel Runtime · Админка',
    reauthTitle: 'Нужно войти снова',
    reauthText: 'Токен администратора не принят.',
  },

  nav: {
    versions: 'Версии',
    analytics: 'Аналитика',
    events: 'События',
    sessions: 'Сессии',
    sections: 'Разделы',
    home: 'Funnel Runtime — Версии',
    funnel: 'Воронка',
    signOut: 'Выйти',
  },

  signIn: {
    heroLine1: 'Версии, эксперимент',
    heroLine2: 'и события',
    serverDown: 'Сервер недоступен',
    serverUp: 'Сервер доступен',
    checking: 'Проверка связи…',
    title: 'Вход',
    tokenLabel: 'ТОКЕН ДОСТУПА',
    hide: 'скрыть',
    show: 'показать',
    submit: 'Войти',
    emptyToken: 'Введите токен',
    invalidToken: 'Неверный токен',
    unreachable: 'Сервер недоступен. Попробуйте ещё раз.',
  },

  versions: {
    rolledBack: (v: number) => `Откат на v${v}`,
    activated: (v: number) => `v${v} активна`,
    rollbackFailed: 'Не удалось откатить',
    switchFailed: 'Не удалось сменить версию',
    history: 'История',
    count: (count: string, n: number) => `${count} ${p(n, ru3('версия', 'версии', 'версий'))}`,
    empty: 'Версий пока нет',
    jsonAria: (v: number) => `JSON v${v}`,
    makeActiveAria: (v: number) => `Сделать v${v} активной`,
    audit: 'Аудит',
    auditEmpty: 'Записей пока нет',
    auditTime: 'ВРЕМЯ',
    auditVersion: 'ВЕРСИЯ',
    auditAction: 'ДЕЙСТВИЕ',
    collapse: 'Свернуть',
    showAll: (n: number) => `Показать все (${n})`,
    openAsAria: (variant: string) => `Открыть воронку, вариант ${variant}`,
    openAs: 'открыть ↗',
    activeVersion: 'Активная версия',
    noActive: 'НЕТ АКТИВНОЙ',
    statPublished: 'Опубликована',
    statSessions: 'Сессий',
    statActive: 'В процессе',
    activeBadge: 'АКТИВНА',
    pointerActive: '◀ активна',
    pointer: 'Указатель',
    rollbackTo: (v: number) => `Откатить на v${v}`,
    rollback: 'Откатить',
    confirmTitle: (v: number) => `Сделать v${v} активной?`,
    /** Follows the formatted in-progress count: "12 активных сессий останутся на своих версиях." */
    inProgressStay: (n: number) =>
      p(
        n,
        ru3(
          'активная сессия останется на своей версии.',
          'активные сессии останутся на своих версиях.',
          'активных сессий останутся на своих версиях.',
        ),
      ),
    config: 'Конфиг',
    copied: 'Скопировано',
    copyJson: 'Скопировать JSON',
  },

  publish: {
    title: 'Опубликовать новую версию',
    errors: (n: number) => `${n} ${p(n, ru3('ошибка', 'ошибки', 'ошибок'))}`,
    clear: 'Очистить',
    pasted: 'Вставленный JSON',
    placeholderName: 'Конфиг воронки',
    dropPrefix: 'Перетащите файл,',
    choose: 'выберите',
    or: 'или',
    paste: 'вставьте JSON',
    jsonAria: 'JSON-конфиг',
    checking: 'ПРОВЕРКА',
    failedBadge: 'НЕ ПРОЙДЕНО',
    validBadge: 'ПРОЙДЕНО',
    tooBig: 'Файл слишком большой',
    tooBigText: 'Максимум 2 МБ.',
    published: (v: number) => `v${v} опубликована`,
    reactivated: (v: number) => `v${v} снова активна`,
    rejected: 'Конфиг не прошёл проверку',
    conflict: 'Конфликт версий',
    conflictText: (v: string) => `v${v} уже опубликована с другим содержимым.`,
    failed: 'Не удалось опубликовать',
    notJson: 'Файл не является корректным JSON',
    lineColumn: (line: number | string, column: number | string) => `Строка ${line}, столбец ${column}`,
    truncated: 'Файл обрывается раньше времени',
  },

  validation: {
    checks: {
      schema: 'Схема валидна',
      steps: 'Все шаги stepSequence существуют',
      results: 'resultRules → существующие results',
      default: 'defaultResultId найден',
    },
    variants: 'Варианты:',
    noBranches: 'Ветвлений нет',
    branches: 'Ветки:',
    identical: (v: number) => `v${v} уже опубликована с тем же содержимым`,
    conflict: (v: number) => `v${v} уже опубликована с другим содержимым — увеличьте version`,
    /** `unknown result "x"` reported for defaultResultId. */
    unknownDefault: (id: string) => `defaultResultId ${q(id)} не найден в results`,
    issues: ISSUES,
    steps: (n: number) => `${n} ${p(n, ru3('шаг', 'шага', 'шагов'))}`,
    srPassed: 'Пройдено: ',
    srError: 'Ошибка: ',
    srWarning: 'Предупреждение: ',
    diffHeader: (from: number, to: number) => `DIFF · v${from} (активна) ⟶ v${to}`,
    diffAdded: 'добавлено',
    diffRemoved: 'удалено',
    diffChanged: 'изменено',
    unchanged: 'без изменений',
    variantRemoved: 'вариант удалён',
    reordered: 'порядок шагов',
    experimentChanged: 'варианты или веса',
  },

  analytics: {
    noSessionsTitle: 'Пока нет сессий',
    noSessionsText: 'Показатели появятся, когда пользователи начнут проходить воронку.',
    openFunnel: 'Открыть воронку',
    emptyCohort: 'Нет сессий под эти фильтры',
    resetFilters: 'Сбросить фильтры',
    refreshFailed: 'Не удалось обновить данные.',
    loadFailed: 'Не удалось загрузить аналитику.',
    staleData: 'Показаны последние полученные цифры.',

    // Filter bar
    selected: (n: number) => `${n} выбрано`,
    noOverride: 'без override',
    reset: 'Сбросить',
    noCampaigns: 'Кампаний пока нет',
    allCampaigns: 'Все кампании',
    /** Sessions without utm_campaign. */
    noCampaign: 'без метки',

    // How it's calculated
    howCalculated: 'Как считается',
    howCalculatedEyebrow: 'КАК СЧИТАЕТСЯ',
    rules: [
      'Единица — уникальная сессия: COUNT(DISTINCT session_id), а не число событий.',
      'Повторные просмотры шага (назад, обновление страницы) засчитываются один раз.',
      'Дубли отсекаются при приёме по event_id — повторная отправка пачки не меняет цифры.',
      'Порядок событий не важен: «дошёл до шага» — есть любое событие с этим step_id. Безусловный шаг считается просмотренным, если сессия ушла дальше.',
      'Как далеко прошла сессия — по позиции в stepSequence её версии и варианта, а не по времени.',
      'Отвал — сессия видела шаг, но не завершила его и не дошла дальше. Доля шага — от сессий, у которых он есть в последовательности; ветка — от сессий, которым она была доступна.',
      'Результат достигнут: result_viewed или cta_clicked (клик без result_viewed тоже засчитывается) — при результате, рассчитанном сервером.',
      'Версия, вариант и кампания берутся из сессии, не из события.',
      'A vs B: z-тест двух пропорций по CTR от начавших внутри одной версии, только случайное назначение (override исключён), от 30 сессий в группе. Шаги сравниваются по step_id.',
      'Время прохождения — медиана от первого события сессии до показа результата.',
    ],

    // KPIs
    mainBadge: 'ОСН.',
    kpiStarted: 'Начали',
    kpiReachedResult: 'Дошли до результата',
    kpiCtaClicked: 'Кликнули CTA',
    kpiCtrFromStarted: 'CTR от начавших',
    kpiCtrFromResult: 'CTR от результата',
    kpiCompletion: 'Доходимость',
    kpiCtrFromViewedResult: 'CTR от увидевших результат',
    kpiTime: 'Время прохождения',
    ofStarted: (pct: string) => `${pct} от начавших`,
    clicksOfStarted: (clicks: string, started: string, n: number) =>
      `${clicks} из ${started} ${p(n, ru3('начавшего', 'начавших', 'начавших'))}`,
    ofResults: (count: string, n: number) => `по ${count} ${p(n, ru3('результату', 'результатам', 'результатам'))}`,

    // Step funnel
    stepFunnel: 'Воронка по шагам',
    legendSessions: '▮ уник. сессии',
    legendBranch: '⑂ ветка',
    colSessions: 'СЕССИИ',
    colConversion: 'КОНВ.',
    colDropOff: 'ОТВАЛ',
    colStep: 'ШАГ',
    guardBadge: 'КОНТРОЛЬ',
    noStepData: 'Нет данных по шагам',
    tipViewed: (viewed: string, eligible: string) => `${viewed} из ${eligible} сессий увидели шаг`,
    tipBranch: (viewed: string, arrived: string) => `ветка открылась у ${viewed} из ${arrived} дошедших`,
    tipBack: (n: string) => `назад: ${n}`,
    tipViewsPerSession: (x: string) => `просмотров на сессию: ${x}`,
    tipResult: (viewed: string, eligible: string) => `${viewed} из ${eligible} сессий дошли до результата`,
    ofEligible: 'от доступных ·',
    onlyIn: (where: string) => `только ${where}`,

    // A vs B
    abNeedBoth: 'Нужны сессии в обоих вариантах',
    abNeedBothText: 'Сравнение появится, когда в когорте будут сессии A и B.',
    notEnoughData: 'недостаточно данных',
    significant: (pValue: string) => `значимо · ${pValue}`,
    notSignificant: (pValue: string) => `не значимо · ${pValue}`,
    noData: 'нет данных',
    overrideExcluded: (n: string) => `исключено override: ${n}`,
    armSessions: (n: string) => `сессий ${n}`,
    relativeTo: (b: string, a: string) => `${b} относительно ${a}`,

    // Breakdowns
    versionsTitle: 'Версии',
    noVersions: 'Нет версий с сессиями',
    kpiByVersion: 'KPI по версиям',
    results: 'Результаты',
    legendSessionsShort: 'сессии',
    noResults: 'Пока нет результатов',
    utmCampaign: 'КАМПАНИЯ',
    utmStarted: 'НАЧ.',
    utmResult: 'РЕЗ.',
    noCampaignsInCohort: 'Нет кампаний в выборке',
    extraEvents: 'Дополнительные события',
    noExtraEvents: 'В выборке нет дополнительных событий',
    of: (a: string, b: string) => `${a} из ${b}`,
    dataQuality: 'Качество данных',
    eventLogLink: 'журнал событий →',
    dqDuplicates: 'дубли отсечены',
    dqRejected: 'отклонено',
    dqOutOfOrder: 'не по порядку',
    dqUnverified: 'без серверного результата',

    // Step comparison chart
    stepsByVariant: 'Шаги по вариантам',
    metric: 'Метрика',
    metricReached: 'дошли',
    metricConversion: 'конверсия',
    metricDropOff: 'отвал',
    noVariantData: 'Нет данных по вариантам',
    noStep: 'нет шага',
  },

  events: {
    resume: 'Возобновить обновление',
    pause: 'Приостановить обновление',
    paused: 'ПАУЗА',
    live: (seconds: number) => `ОНЛАЙН · ${seconds} С`,
    acceptedTitle: 'ПРИНЯТО',
    duplicatesTitle: 'ДУБЛИ',
    rejectedTitle: 'ОТКЛОНЕНО',
    columns: ['СЕРВЕР', 'КЛИЕНТ', 'СОБЫТИЕ', 'СЕССИЯ', 'ВЕР · ВАР', 'ШАГ', 'СВОЙСТВА'] as readonly string[],
    eventLabel: 'Событие',
    allEvents: 'все события',
    sessionFilterAria: 'Фильтр по session_id',
    sessionFilterPlaceholder: 'фильтр по session_id',
    clearFilter: 'Очистить фильтр',
    acceptedSub: 'за всё время',
    duplicatesSub: 'отсечены',
    rejectedSub: 'с причиной',
    logAria: 'Журнал событий',
    emptyFiltered: 'Нет событий для этого фильтра',
    resetFilter: 'Сбросить фильтр',
    waitingTitle: 'Ожидание событий',
    waitingText: 'Новые события появятся здесь автоматически.',
    legendNew: 'новая',
    legendDuplicate: 'дубль отсечён',
    legendRejected: 'отклонено',
    noAccess: 'Нет доступа к журналу. Войдите снова.',
    refreshFailed: 'Не удалось обновить журнал.',
    duplicateChip: 'дубль',
    rejected: 'отклонено',
    /** Rejection reason codes (shared REJECT_REASONS) → short labels; the code stays in the tooltip. */
    reasons: {
      invalid_shape: 'неверный формат',
      unknown_session: 'неизвестная сессия',
      event_not_allowed_for_version: 'событие не из этой версии',
      server_only_event: 'только серверное событие',
      unknown_step: 'неизвестный шаг',
      missing_step_id: 'нет step_id',
      step_mismatch: 'не тот шаг',
      invalid_timestamp: 'неверное время',
    } as Record<string, string>,
  },

  sessions: {
    statusInProgress: 'в процессе',
    statusCompleted: 'завершена',
    statusExpired: 'истекла',
    totalInProgress: 'в процессе',
    totalCompleted: 'завершено',
    totalExpired: 'истекло',
    total: 'всего',
    empty: 'Сессий пока нет',
    colSession: 'Сессия',
    colVersion: 'Версия',
    colVariant: 'Вариант',
    colCampaign: 'Кампания',
    colStep: 'Текущий шаг',
    colResult: 'Результат',
    colStatus: 'Статус',
    colEvents: 'Событий',
    colUpdated: 'Обновлена',
    rowAria: (id: string) => `События сессии ${id}`,
  },
};

export type AdminMessages = typeof ru;
