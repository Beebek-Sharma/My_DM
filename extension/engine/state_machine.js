/**
 * MyDM Download Engine - State Machine
 * Deterministic, finite state machine for download lifecycle management.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const exportsObj = factory();
    root.MyDMStateMachine = exportsObj;
    root.StateMachine = exportsObj;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STATES = Object.freeze({
    QUEUED: 'QUEUED',
    STARTING: 'STARTING',
    DOWNLOADING: 'DOWNLOADING',
    PAUSING: 'PAUSING',
    PAUSED: 'PAUSED',
    RESUMING: 'RESUMING',
    COMPLETING: 'COMPLETING',
    COMPLETED: 'COMPLETED',
    CANCELLING: 'CANCELLING',
    CANCELLED: 'CANCELLED',
    RETRYING: 'RETRYING',
    FAILED: 'FAILED'
  });

  const ALLOWED_TRANSITIONS = Object.freeze({
    [STATES.QUEUED]: [STATES.STARTING, STATES.CANCELLING, STATES.FAILED],
    [STATES.STARTING]: [STATES.DOWNLOADING, STATES.FAILED, STATES.CANCELLING, STATES.PAUSING],
    [STATES.DOWNLOADING]: [STATES.PAUSING, STATES.COMPLETING, STATES.COMPLETED, STATES.FAILED, STATES.CANCELLING],
    [STATES.PAUSING]: [STATES.PAUSED, STATES.DOWNLOADING, STATES.FAILED, STATES.CANCELLING],
    [STATES.PAUSED]: [STATES.RESUMING, STATES.CANCELLING, STATES.FAILED],
    [STATES.RESUMING]: [STATES.DOWNLOADING, STATES.PAUSED, STATES.FAILED, STATES.CANCELLING],
    [STATES.COMPLETING]: [STATES.COMPLETED, STATES.FAILED],
    [STATES.COMPLETED]: [],
    [STATES.CANCELLING]: [STATES.CANCELLED, STATES.FAILED],
    [STATES.CANCELLED]: [STATES.QUEUED],
    [STATES.RETRYING]: [STATES.STARTING, STATES.DOWNLOADING, STATES.CANCELLING, STATES.FAILED],
    [STATES.FAILED]: [STATES.QUEUED, STATES.RETRYING, STATES.CANCELLING]
  });

  function canTransition(current, next) {
    if (!current || !next) return false;
    if (current === next) return true;
    const allowed = ALLOWED_TRANSITIONS[current];
    return Array.isArray(allowed) && allowed.includes(next);
  }

  function validateTransition(current, next) {
    if (!canTransition(current, next)) {
      throw new Error(`Invalid download state transition: '${current}' -> '${next}'`);
    }
    return next;
  }

  function isActive(state) {
    return [
      STATES.QUEUED,
      STATES.STARTING,
      STATES.DOWNLOADING,
      STATES.PAUSING,
      STATES.PAUSED,
      STATES.RESUMING,
      STATES.COMPLETING,
      STATES.RETRYING
    ].includes(state);
  }

  function isTerminal(state) {
    return [STATES.COMPLETED, STATES.CANCELLED, STATES.FAILED].includes(state);
  }

  function isPaused(state) {
    return state === STATES.PAUSED || state === STATES.PAUSING;
  }

  return {
    STATES,
    ALLOWED_TRANSITIONS,
    canTransition,
    validateTransition,
    isActive,
    isTerminal,
    isPaused
  };
});
