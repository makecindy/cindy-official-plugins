/** Apply independently discovered required checks, including ones not registered yet. */
export function applyRequiredChecks(checks, requirements) {
  const result = checks.map(c => ({ ...c }));
  for (const rule of requirements) {
    const matches = result.filter(c => !c.expected && c.name === rule.context);
    if (matches.length) for (const c of matches) c.required = true;
    else if (!result.some(c => c.expected && c.name === rule.context)) {
      result.push({ type: 'ExpectedCheck', name: rule.context, appId: rule.appId,
        workflowName: '',
        status: 'EXPECTED', outcome: 'pending', required: true, expected: true });
    }
  }
  return result;
}

export function requiredChecksOf(baseRef, rules) {
  if (!baseRef || !Object.hasOwn(baseRef, 'branchProtectionRule') || !Array.isArray(rules)) {
    throw new Error('Required-check inventory is unavailable');
  }
  const result = [];
  const add = (context, id) => {
    if (typeof context !== 'string' || !context) throw new Error('Invalid required-check context');
    result.push({ context, appId: Number.isInteger(id) && id > 0 ? id : null });
  };
  const classic = baseRef.branchProtectionRule;
  if (classic?.requiresStatusChecks) {
    if (!Array.isArray(classic.requiredStatusChecks)) throw new Error('Missing classic required checks');
    for (const c of classic.requiredStatusChecks) add(c.context, c.app?.databaseId);
  }
  for (const rule of rules) {
    if (rule.type !== 'required_status_checks') continue;
    if (!Array.isArray(rule.parameters?.required_status_checks)) throw new Error('Missing ruleset required checks');
    for (const c of rule.parameters.required_status_checks) add(c.context, c.integration_id);
  }
  return result;
}
