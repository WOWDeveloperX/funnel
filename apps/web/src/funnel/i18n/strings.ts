/**
 * Runtime chrome strings of the public funnel (buttons, counters, fallback and error states).
 * Funnel *content* comes from the config and is translated through the content catalogs
 * (@funnel/shared localizeFunnel); only the frame around it is translated here, picked by the
 * selected UI language (lib/language): ru → Russian, anything else → English.
 */
import { en2, plural, ru3 } from '../../lib/plural';
import type { BootErrorKind } from '../session/errors';

export interface FunnelStrings {
  back: string;
  continue: string;
  progress: string;
  stepOf: (index: number, total: number) => string;
  questions: (n: number) => string;
  selected: (count: number, max?: number) => string;
  limit: string;
  keysHint: (lastKey: string) => string;
  decrease: string;
  increase: string;
  maxSelections: (max: number) => string;
  loading: string;
  loadingTitle: string;
  loadingSteps: readonly [string, string, string];
  recommendations: string;
  yourResult: string;
  startOver: string;
  planEyebrow: string;
  planTitle: string;
  week: (n: number) => string;
  /**
   * Generic 30-day rollout cadence shown when a result has no `plan` in the config. It says HOW to
   * apply the recommendations instead of repeating them (the CTA must reveal something new).
   */
  genericPlan: readonly string[];
  collapsePlan: string;
  resultErrorTitle: string;
  resultErrorText: string;
  retry: string;
  expiredBadge: string;
  expiredTitle: string;
  expiredText: string;
  notFoundBadge: string;
  notFoundTitle: string;
  notFoundText: string;
  startAgain: string;
  bootErrorTitle: string;
  /** Explanation under the boot error title, per failure kind. */
  errors: Record<BootErrorKind, string>;
  unavailableTitle: string;
  unavailableText: string;
  offline: string;
}

const en: FunnelStrings = {
  back: 'Back',
  continue: 'Continue',
  progress: 'Progress',
  stepOf: (i, n) => `Step ${i} of ${n}`,
  questions: (n) => `${n} ${plural('en', n, en2('question', 'questions'))}`,
  selected: (k, max) => (max === undefined ? `Selected ${k}` : `Selected ${k} of ${max}`),
  limit: 'limit',
  keysHint: (last) => (last === 'A' ? 'Key A · Enter' : `Keys A–${last} · Enter`),
  decrease: 'Decrease',
  increase: 'Increase',
  maxSelections: (max) => `Select no more than ${max}.`,
  loading: 'Loading…',
  loadingTitle: 'Building your result…',
  loadingSteps: ['Analysing answers', 'Matching recommendations', 'Building your plan'],
  recommendations: 'Recommendations',
  yourResult: 'Your result',
  startOver: 'Start over',
  planEyebrow: '30 days',
  planTitle: '30-day plan',
  week: (n) => `Week ${n}`,
  genericPlan: [
    'Pick an owner for each change above and announce in your next team sync what will be different from Monday.',
    'Run the first change for a full week. Keep a shared note of what slowed people down.',
    'Add the remaining changes and drop any step that nobody used in week 2.',
    'Compare meeting hours and response times with week 1, then decide what to keep, adjust or stop.',
  ],
  collapsePlan: 'Collapse the plan',
  resultErrorTitle: 'Something went wrong',
  resultErrorText: 'Your answers are saved, so you can simply try again.',
  retry: 'Try again',
  expiredBadge: 'Session expired',
  expiredTitle: 'This session has expired. Let’s start again',
  expiredText: 'Your previous answers no longer apply. A new run only takes a couple of minutes.',
  notFoundBadge: 'Session not found',
  notFoundTitle: 'This session is no longer available',
  notFoundText: 'Start again to get a fresh recommendation.',
  startAgain: 'Start again',
  bootErrorTitle: 'We couldn’t load the questionnaire',
  errors: {
    network: 'The server could not be reached. Check your connection and try again.',
    server: 'The server had a problem. Please try again in a moment.',
    empty: 'This funnel has no steps to show.',
    unknown: 'Something went wrong. Please try again.',
  },
  unavailableTitle: 'Step unavailable',
  unavailableText: 'This step can’t be shown here. You can safely skip it.',
  offline: 'You’re offline. Progress is saved on this device and will sync automatically.',
};

const ru: FunnelStrings = {
  back: 'Назад',
  continue: 'Продолжить',
  progress: 'Прогресс',
  stepOf: (i, n) => `Шаг ${i} из ${n}`,
  questions: (n) => `${n} ${plural('ru', n, ru3('вопрос', 'вопроса', 'вопросов'))}`,
  selected: (k, max) => (max === undefined ? `Выбрано ${k}` : `Выбрано ${k} из ${max}`),
  limit: 'лимит',
  keysHint: (last) => (last === 'A' ? 'Клавиша A · Enter' : `Клавиши A–${last} · Enter`),
  decrease: 'Уменьшить',
  increase: 'Увеличить',
  maxSelections: (max) => `Выберите не больше ${max}.`,
  loading: 'Загрузка…',
  loadingTitle: 'Собираем результат…',
  loadingSteps: ['Анализируем ответы', 'Подбираем рекомендации', 'Собираем план'],
  recommendations: 'Рекомендации',
  yourResult: 'Ваш результат',
  startOver: 'Пройти заново',
  planEyebrow: '30 дней',
  planTitle: 'План на 30 дней',
  week: (n) => `Неделя ${n}`,
  genericPlan: [
    'Назначьте ответственного за каждую рекомендацию и на ближайшей встрече команды расскажите, что изменится с понедельника.',
    'Неделю поработайте с первым изменением. В общей заметке отмечайте, что мешало.',
    'Внедрите остальные изменения и откажитесь от того, чем никто не пользовался на второй неделе.',
    'Сравните с первой неделей время на встречи и скорость ответов, затем решите, что оставить, что изменить, а от чего отказаться.',
  ],
  collapsePlan: 'Свернуть план',
  resultErrorTitle: 'Что-то пошло не так',
  resultErrorText: 'Ответы сохранены — можно просто попробовать ещё раз.',
  retry: 'Повторить',
  expiredBadge: 'Сессия истекла',
  expiredTitle: 'Давайте начнём сначала',
  expiredText: 'Прежние ответы больше не учитываются. Пройти опрос заново — пара минут.',
  notFoundBadge: 'Сессия не найдена',
  notFoundTitle: 'Эта сессия больше недоступна',
  notFoundText: 'Начните заново, чтобы получить новую рекомендацию.',
  startAgain: 'Начать заново',
  bootErrorTitle: 'Не удалось загрузить опрос',
  errors: {
    network: 'Не удалось связаться с сервером. Проверьте подключение и попробуйте ещё раз.',
    server: 'На сервере произошла ошибка. Попробуйте ещё раз чуть позже.',
    empty: 'В этом опросе пока нет вопросов.',
    unknown: 'Что-то пошло не так. Попробуйте ещё раз.',
  },
  unavailableTitle: 'Шаг недоступен',
  unavailableText: 'Этот шаг сейчас недоступен — его можно пропустить.',
  offline: 'Нет подключения к интернету. Ответы сохранены на этом устройстве и отправятся автоматически.',
};

/** ru / ru-* → Russian; everything else (en, en-AU, unknown) → English. */
export function stringsFor(language: string | null | undefined): FunnelStrings {
  return language && /^ru(-|_|$)/i.test(language) ? ru : en;
}
