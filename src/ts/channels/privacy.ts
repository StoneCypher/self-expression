/**
 * Which harness-observed fields the user has consented to record.
 *
 * `cwd`, `project`, and `git_branch` are real filesystem paths and identifiers, and even
 * a prompt's length is a signal a work machine may want kept out of the log. The design
 * requires these to be redacted **at write time** — never captured, not
 * captured-then-hidden — so both the `UserPromptSubmit` hook and the `express` tool read
 * the choice here and drop a suppressed field before it ever reaches the database.
 *
 * @see ./store.js
 */

import { readConfig } from './store.js';
import type { Store } from './store.js';

/** The subset of harness context the user has permitted to be stored. */
export interface PrivacyFlags {
  /** Record `cwd`, `project`, and `git_branch`. Off when `privacy.store_cwd` is `'false'`. */
  readonly storeCwd       : boolean;
  /** Record the prompt's length. Off when `privacy.store_prompt_len` is `'false'`. */
  readonly storePromptLen : boolean;
}

/**
 * Read the privacy choices, defaulting to recording.
 *
 * An unset key returns `null` from `readConfig`, which is not the string `'false'`, so an
 * unconfigured install records everything — the default lives here in code rather than as
 * a seeded row, so a later change to it reaches existing installs. Only the exact string
 * `'false'` suppresses a field; any other value records, on the principle that a privacy
 * switch should take effect only when unambiguously set.
 *
 * @example
 *   privacyFlags(store)                              // => { storeCwd: true, storePromptLen: true }
 *   writeConfig(store, 'privacy.store_cwd', false);
 *   privacyFlags(store)                              // => { storeCwd: false, storePromptLen: true }
 */
export function privacyFlags(store: Store): PrivacyFlags {
  return {
    storeCwd       : readConfig(store, 'privacy.store_cwd')        !== 'false',
    storePromptLen : readConfig(store, 'privacy.store_prompt_len') !== 'false',
  };
}
