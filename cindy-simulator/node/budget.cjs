'use strict';

// Only a calculation for the existing subprocess timeout, with no timer or
// background work. Foreground stages consume the caller's same deadline.
function commandBudget(timeout, deadline, now = Date.now) {
  if (deadline === undefined) return {timeout};
  const remaining = Math.floor(deadline - now());
  if (remaining <= 0) throw Object.assign(new Error('Request time budget exhausted; this step was not started. Check any earlier steps before retrying.'), {code: 'TIME_BUDGET_EXHAUSTED', execution: 'not_executed'});
  return {timeout: Math.min(timeout, remaining)};
}

module.exports = {commandBudget};
