/**
 * Desktop (≥1024px, Tailwind `lg:`) composition of the funnel card. Phones and tablets ignore all
 * of this: every class here is `lg:`-prefixed or `max-lg:contents`, so below 1024px the markup
 * renders exactly as the single-column layout.
 *
 * StepShell turns the card into a CSS grid per layout and the step body (the animated section) into
 * a subgrid spanning it, so a step renderer can drop its heading into the left column and its
 * answers into the right one while the progress header and the footer stay outside the sliding
 * section (they animate between steps instead of sliding with them).
 *
 *   question                          split (intro)
 *   ┌──────────────┬───────────────┐  ┌───────────────────┬──────────────┐
 *   │ banner (both columns)        │  │ banner                           │
 *   ├──────────────┬───────────────┤  ├───────────────────┼──────────────┤
 *   │ progress     │ answers       │  │ dark hero         │  ↕ 1fr       │
 *   │ heading      │ answers       │  │                   │ body         │
 *   │ heading      │ footer        │  │                   │ footer (CTA) │
 *   └──────────────┴───────────────┘  │                   │  ↕ 1fr       │
 *                                     └───────────────────┴──────────────┘
 * Line numbers below are relative to the section subgrid (row 1 = the card's second row).
 */

/** Left column under the progress header: eyebrow, title, helper (question steps). */
export const DESK_ASIDE = 'lg:col-start-1 lg:row-[2/4] lg:px-10 lg:pt-7 lg:pb-10';

/** Right column from the top of the card down to the footer: the answer UI (question steps, unknown fallback). */
export const DESK_MAIN = 'lg:col-start-2 lg:row-[1/3] lg:px-10 lg:pt-9';

/** Intro: the dark hero fills the left column top to bottom… */
export const DESK_HERO = 'lg:col-start-1 lg:row-[1/5]';

/** …and the body text sits in the right column, centred together with the footer below it. */
export const DESK_BODY = 'lg:col-start-2 lg:row-start-2';

/** Columns shared by the question grid, the result and the status screens (≈45 / 55). */
export const DESK_COLUMNS = 'lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]';

/**
 * Status screens (result error, expired session, boot error): a dark visual panel on the left, the
 * copy and the action centred on the right. Applied to the screen's root; the visual / copy /
 * action elements carry the placements below.
 */
export const DESK_STATUS = 'lg:grid lg:grid-rows-[1fr_auto_auto_1fr] lg:gap-0 lg:p-0';
export const DESK_STATUS_VISUAL =
  'lg:col-start-1 lg:row-span-full lg:flex lg:flex-col lg:justify-center lg:rounded-r-[32px] lg:bg-ink lg:p-12 lg:text-paper';
export const DESK_STATUS_COPY = 'lg:col-start-2 lg:row-start-2 lg:px-12 lg:pb-0';
export const DESK_STATUS_ACTION = 'lg:col-start-2 lg:row-start-3 lg:mx-12 lg:mt-8 lg:w-auto';
