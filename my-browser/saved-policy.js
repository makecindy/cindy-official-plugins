'use strict';
(function(root) {
  // Old saved policies have no provenance. Even an exact preset may have been
  // deliberately retained by the user; only explicit permission edits remove it.
  function savedPolicy(cfg, P) {
    return cfg.policy ? P.normalizePolicy(cfg.policy) : P.defaults();
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = savedPolicy;
  else root.myBrowserSavedPolicy = savedPolicy;
})(globalThis);
